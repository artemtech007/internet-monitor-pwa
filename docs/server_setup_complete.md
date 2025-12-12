# 🚀 Полная настройка сервера Internet Monitor

**Адрес сервера:** `root@93.189.231.3`
**Цель:** Запустить WebSocket сервер для обработки данных от PWA

---

## 📋 ПОДРОБНЫЙ ПЛАН НАСТРОЙКИ (КОПИРУЙ КОМАНДЫ)

### **Шаг 1: Подключение к серверу**
```bash
ssh root@93.189.231.3
```

---

### **Шаг 2: Обновление системы**
```bash
# Обновить пакеты
apt update && apt upgrade -y

# Установить необходимые пакеты
apt install -y curl wget git htop ufw
```

---

### **Шаг 3: Установка Node.js 18**
```bash
# Добавить репозиторий NodeSource
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -

# Установить Node.js
apt-get install -y nodejs

# Проверить установку
node --version    # Должен показать v18.x.x
npm --version     # Должен показать 9.x.x

# Установить дополнительные пакеты
npm install -g pm2 nodemon
```

---

### **Шаг 4: Создание структуры проекта**
```bash
# Создать директории
mkdir -p ~/internet-monitor/server
cd ~/internet-monitor/server

# Создать package.json
cat > package.json << 'EOF'
{
  "name": "internet-monitor-websocket-server",
  "version": "1.0.0",
  "description": "WebSocket сервер для Internet Monitor PWA",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "pm2": "pm2 start server.js --name internet-monitor"
  },
  "dependencies": {
    "ws": "^8.14.2",
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
EOF

# Установить зависимости
npm install
```

---

### **Шаг 5: Создание WebSocket сервера**
```bash
# Создать server.js
cat > server.js << 'EOF'
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;
const WS_PORT = process.env.WS_PORT || 8081;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Валидные токены доступа (ОБЯЗАТЕЛЬНО ИЗМЕНИТЬ!)
const VALID_TOKENS = [
    'PHONE001',
    'PHONE002',
    'PHONE003',
    'TEST123'  // Для тестирования
];

// Хранение подключенных устройств
const devices = new Map();

// Логирование
function log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${type.toUpperCase()}: ${message}`);
}

// REST API для управления устройствами
app.get('/api/devices', (req, res) => {
    const deviceList = Array.from(devices.entries()).map(([id, device]) => ({
        id,
        info: device.info,
        lastSeen: device.lastSeen,
        isOnline: device.ws.readyState === WebSocket.OPEN
    }));
    res.json({
        success: true,
        devices: deviceList,
        total: deviceList.length
    });
});

app.post('/api/devices/:deviceId/command', (req, res) => {
    const { deviceId } = req.params;
    const { type, data } = req.body;

    const device = devices.get(deviceId);
    if (!device || device.ws.readyState !== WebSocket.OPEN) {
        return res.status(404).json({
            success: false,
            error: 'Device not found or offline'
        });
    }

    device.ws.send(JSON.stringify({
        type,
        ...data,
        timestamp: Date.now()
    }));

    log(`Команда ${type} отправлена устройству ${deviceId}`);
    res.json({
        success: true,
        message: `Command ${type} sent to ${deviceId}`
    });
});

app.get('/api/devices/:deviceId/settings', (req, res) => {
    const { deviceId } = req.params;
    const { token } = req.query;

    if (!VALID_TOKENS.includes(token)) {
        return res.status(401).json({
            success: false,
            error: 'Invalid token'
        });
    }

    const settings = {
        testFileSize: 50000,
        intervalMinutes: 5,
        serverUrl: process.env.WS_SERVER_URL || `ws://93.189.231.3:${WS_PORT}`,
        enabled: true
    };

    res.json({ success: true, settings });
});

// Speed test endpoint
app.post('/speed-test', express.raw({ type: 'application/octet-stream', limit: '50mb' }), (req, res) => {
    const { 'x-device-id': deviceId, 'x-access-token': token } = req.headers;

    if (!VALID_TOKENS.includes(token)) {
        log(`❌ Неверный токен от ${deviceId}`, 'error');
        return res.status(401).send('Unauthorized');
    }

    log(`📊 Speed test от ${deviceId}: ${req.body.length} bytes`);
    res.set({
        'Content-Type': 'application/octet-stream',
        'X-Test-Result': 'success'
    });
    res.send(req.body);
});

// WebSocket сервер
const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('connection', (ws, req) => {
    log(`🔌 Новое WebSocket подключение`);

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            handleMessage(ws, message);
        } catch (error) {
            log(`❌ Ошибка парсинга: ${error.message}`, 'error');
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid JSON format'
            }));
        }
    });

    ws.on('close', () => {
        // Удаление устройства при отключении
        for (const [deviceId, device] of devices.entries()) {
            if (device.ws === ws) {
                log(`🔌 Устройство ${deviceId} отключено`);
                devices.delete(deviceId);
                break;
            }
        }
    });

    ws.on('error', (error) => {
        log(`❌ WebSocket ошибка: ${error}`, 'error');
    });
});

function handleMessage(ws, message) {
    const { type, deviceId, token } = message;
    log(`📨 ${type} от ${deviceId}`);

    switch (type) {
        case 'device_info':
            if (!VALID_TOKENS.includes(token)) {
                log(`❌ Неверный токен для ${deviceId}`, 'error');
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Invalid access token'
                }));
                ws.close();
                return;
            }

            devices.set(deviceId, {
                ws,
                info: message,
                lastSeen: Date.now()
            });

            log(`✅ Устройство ${deviceId} зарегистрировано`);
            ws.send(JSON.stringify({
                type: 'welcome',
                message: 'Connected successfully',
                deviceId
            }));

            // Первый тест через 2 секунды
            setTimeout(() => {
                ws.send(JSON.stringify({
                    type: 'speed_test_request',
                    fileSize: 50000
                }));
            }, 2000);
            break;

        case 'ping_result':
        case 'speed_result':
            if (devices.has(deviceId)) {
                devices.get(deviceId).lastSeen = Date.now();
            }

            log(`📊 Результат от ${deviceId}: ${message.success ? 'OK' : 'ERROR'}`);
            forwardToN8n(message);
            break;

        default:
            log(`⚠️ Неизвестный тип: ${type}`);
    }
}

async function forwardToN8n(data) {
    try {
        const n8nUrl = process.env.N8N_WEBHOOK_URL || 'https://botstroikom.store/webhook/ph1';

        const response = await fetch(n8nUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            log('✅ Отправлено в n8n');
        } else {
            log(`❌ Ошибка n8n: ${response.status}`, 'error');
        }
    } catch (error) {
        log(`❌ Ошибка сети n8n: ${error.message}`, 'error');
    }
}

// Автоматические тесты каждые 5 минут
setInterval(() => {
    log('⏰ Автоматические тесты...');
    let activeDevices = 0;

    for (const [deviceId, device] of devices.entries()) {
        if (device.ws.readyState === WebSocket.OPEN) {
            device.ws.send(JSON.stringify({
                type: 'speed_test_request',
                fileSize: 50000
            }));
            activeDevices++;
        }
    }

    log(`📡 Отправлено ${activeDevices} устройствам`);
}, 5 * 60 * 1000);

// Запуск HTTP сервера
app.listen(PORT, () => {
    log(`🌐 HTTP сервер запущен на порту ${PORT}`);
    log(`🔌 WebSocket сервер запущен на порту ${WS_PORT}`);
    log(`📊 Dashboard: http://localhost:${PORT}/api/devices`);
    log(`🛑 Для остановки: Ctrl+C`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    log('🛑 Завершение работы...');
    wss.clients.forEach(client => client.close());
    wss.close(() => {
        log('✅ Сервер остановлен');
        process.exit(0);
    });
});

// Обработка необработанных ошибок
process.on('uncaughtException', (error) => {
    log(`💥 Необработанная ошибка: ${error.message}`, 'error');
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    log(`💥 Необработанное отклонение: ${reason}`, 'error');
});
EOF
```

---

### **Шаг 6: Создание конфигурации**
```bash
# Создать .env файл
cat > .env << 'EOF'
PORT=8080
WS_PORT=8081
N8N_WEBHOOK_URL=https://botstroikom.store/webhook/ph1
WS_SERVER_URL=ws://93.189.231.3:8081
NODE_ENV=production
EOF
```

---

### **Шаг 7: Настройка firewall**
```bash
# Проверить статус
ufw status

# Разрешить нужные порты
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # HTTP (если есть nginx)
ufw allow 8080/tcp    # HTTP API
ufw allow 8081/tcp    # WebSocket
ufw allow 5678/tcp    # n8n (если используется)

# Включить firewall
ufw --force enable

# Проверить статус
ufw status
```

---

### **Шаг 8: Тестовый запуск**
```bash
# Запустить сервер
npm start

# В новом терминале проверить
curl http://localhost:8080/api/devices
# Должен вернуть: {"success":true,"devices":[],"total":0}

# Остановить сервер (Ctrl+C в первом терминале)
```

---

### **Шаг 9: Настройка автозапуска с PM2**
```bash
# Установить PM2 глобально (если не установлен)
npm install -g pm2

# Запустить с PM2
pm2 start server.js --name internet-monitor

# Проверить статус
pm2 status

# Сохранить конфигурацию
pm2 save
pm2 startup

# Просмотр логов
pm2 logs internet-monitor

# Перезапуск
pm2 restart internet-monitor

# Остановка
pm2 stop internet-monitor
```

---

### **Шаг 10: Проверка работы**
```bash
# Проверить что сервер работает
curl http://localhost:8080/api/devices

# Проверить порты
netstat -tlnp | grep -E ':(8080|8081)'

# Проверить PM2
pm2 status
pm2 logs internet-monitor --lines 20
```

---

### **Шаг 11: Тестирование с PWA**
```bash
# На телефоне открыть:
# https://artemtech007.github.io/internet-monitor-pwa/

# Ввести код: TEST123
# Нажать "Подключиться"
# Нажать "Запустить мониторинг"
```

---

## 🔧 ДОПОЛНИТЕЛЬНЫЕ НАСТРОЙКИ

### **Мониторинг сервера**
```bash
# Установить htop для мониторинга
apt install htop

# Просмотр ресурсов
htop

# Мониторинг логов
tail -f ~/.pm2/logs/internet-monitor-out.log
```

### **Резервное копирование**
```bash
# Создать скрипт бэкапа
cat > ~/backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
tar -czf ~/backup_$DATE.tar.gz ~/internet-monitor/
echo "Backup created: ~/backup_$DATE.tar.gz"
EOF

chmod +x ~/backup.sh

# Добавить в crontab (ежедневно в 2:00)
crontab -e
# Добавить строку: 0 2 * * * ~/backup.sh
```

### **Обновление сервера**
```bash
# Остановить сервер
pm2 stop internet-monitor

# Обновить код
cd ~/internet-monitor/server
git pull  # если используешь git

# Перезапустить
pm2 restart internet-monitor
```

---

## 🚨 ПРОВЕРКА РАБОТЫ

### **1. Локальная проверка**
```bash
# HTTP API
curl http://localhost:8080/api/devices

# WebSocket (установить websocat)
# echo '{"type":"ping"}' | websocat ws://localhost:8081
```

### **2. Внешняя проверка**
```bash
# С другого устройства
curl http://93.189.231.3:8080/api/devices

# Проверка портов
nmap -p 8080,8081 93.189.231.3
```

### **3. Тестирование PWA**
- Открыть `https://artemtech007.github.io/internet-monitor-pwa/`
- Ввести код доступа
- Проверить подключение и тесты

---

## 🎯 ЧЕК-ЛИСТ ГОТОВНОСТИ

- [ ] Node.js установлен (v18+)
- [ ] Проект создан в `~/internet-monitor/server`
- [ ] Зависимости установлены (`npm install`)
- [ ] server.js создан и настроен
- [ ] .env файл создан
- [ ] Firewall настроен (порты 8080, 8081 открыты)
- [ ] Сервер протестирован (`npm start`)
- [ ] PM2 настроен для автозапуска
- [ ] PWA протестирована на телефоне
- [ ] n8n получает данные

---

## 🔍 ДИАГНОСТИКА ПРОБЛЕМ

### **Сервер не запускается**
```bash
# Проверить логи
pm2 logs internet-monitor

# Проверить порты
lsof -i :8080
lsof -i :8081

# Проверить Node.js
node --version
```

### **PWA не подключается**
```bash
# Проверить WebSocket
curl http://localhost:8081  # должен вернуть ошибку (но порт открыт)

# Проверить firewall
ufw status
```

### **n8n не получает данные**
```bash
# Проверить webhook URL
curl -X POST https://botstroikom.store/webhook/ph1 \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

---

## 🚀 БЫСТРЫЙ СТАРТ (КОПИРУЙ ВСЕ КОМАНДЫ)

```bash
# Подключение и базовая настройка
ssh root@93.189.231.3
apt update && apt upgrade -y
apt install -y curl wget git htop ufw

# Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs
npm install -g pm2 nodemon

# Проект
mkdir -p ~/internet-monitor/server
cd ~/internet-monitor/server

# package.json
cat > package.json << 'EOF'
{
  "name": "internet-monitor-websocket-server",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "pm2": "pm2 start server.js --name internet-monitor"
  },
  "dependencies": {
    "ws": "^8.14.2",
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "helmet": "^7.1.0",
    "dotenv": "^16.3.1"
  }
}
EOF

# server.js (вставь полный код отсюда)
# ... (копируй код server.js из этого файла)

# .env
cat > .env << 'EOF'
PORT=8080
WS_PORT=8081
N8N_WEBHOOK_URL=https://botstroikom.store/webhook/ph1
WS_SERVER_URL=ws://93.189.231.3:8081
NODE_ENV=production
EOF

# Установка и запуск
npm install
ufw allow 8080 && ufw allow 8081 && ufw --force enable
npm run pm2

# Проверка
curl http://localhost:8080/api/devices
pm2 status
pm2 logs internet-monitor
```

---

**🎉 После выполнения всех шагов сервер будет готов к работе!**

**PWA сможет подключаться и отправлять данные в n8n!** 🚀
