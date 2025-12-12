# 🚀 Настройка сервера для Internet Monitor

## 📋 Предварительные требования

- Ubuntu/Debian сервер
- Root доступ
- n8n уже установлен

## 🔧 Шаг 1: Установить Node.js и зависимости

```bash
# Обновить систему
sudo apt update && sudo apt upgrade -y

# Установить Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Проверить установку
node --version
npm --version
```

## 🔧 Шаг 2: Настроить WebSocket сервер

```bash
# Создать директорию проекта
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
    "dev": "nodemon server.js"
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

## 🔧 Шаг 3: Создать WebSocket сервер

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

// Валидные токены доступа
const VALID_TOKENS = [
    'PHONE001',
    'PHONE002',
    'PHONE003',
    'TEST123'
];

// Хранение устройств
const devices = new Map();

// REST API для управления
app.get('/api/devices', (req, res) => {
    const deviceList = Array.from(devices.entries()).map(([id, device]) => ({
        id,
        info: device.info,
        lastSeen: device.lastSeen,
        isOnline: device.ws.readyState === WebSocket.OPEN
    }));
    res.json(deviceList);
});

app.post('/api/devices/:deviceId/command', (req, res) => {
    const { deviceId } = req.params;
    const { type, data } = req.body;

    const device = devices.get(deviceId);
    if (!device || device.ws.readyState !== WebSocket.OPEN) {
        return res.status(404).json({ error: 'Device not found or offline' });
    }

    device.ws.send(JSON.stringify({
        type,
        ...data,
        timestamp: Date.now()
    }));

    res.json({ success: true, message: `Command ${type} sent to ${deviceId}` });
});

// Speed test endpoint
app.post('/speed-test', express.raw({ type: 'application/octet-stream', limit: '50mb' }), (req, res) => {
    const { 'x-device-id': deviceId, 'x-access-token': token } = req.headers;

    if (!VALID_TOKENS.includes(token)) {
        return res.status(401).send('Unauthorized');
    }

    console.log(`📊 Speed test from ${deviceId}, received ${req.body.length} bytes`);
    res.set({
        'Content-Type': 'application/octet-stream',
        'X-Test-Result': 'success'
    });
    res.send(req.body);
});

// WebSocket сервер
const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('connection', (ws, req) => {
    console.log('🔌 Новое WebSocket подключение');

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            handleMessage(ws, message);
        } catch (error) {
            console.error('❌ Ошибка парсинга:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Invalid JSON format'
            }));
        }
    });

    ws.on('close', () => {
        for (const [deviceId, device] of devices.entries()) {
            if (device.ws === ws) {
                console.log(`🔌 Устройство ${deviceId} отключено`);
                devices.delete(deviceId);
                break;
            }
        }
    });

    ws.on('error', (error) => {
        console.error('❌ WebSocket ошибка:', error);
    });
});

function handleMessage(ws, message) {
    const { type, deviceId, token } = message;
    console.log(`📨 ${type} от ${deviceId}`);

    switch (type) {
        case 'device_info':
            if (!VALID_TOKENS.includes(token)) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Invalid token'
                }));
                ws.close();
                return;
            }

            devices.set(deviceId, {
                ws,
                info: message,
                lastSeen: Date.now()
            });

            console.log(`✅ ${deviceId} зарегистрирован`);
            ws.send(JSON.stringify({
                type: 'welcome',
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
            console.log(`📊 Результат от ${deviceId}`);
            forwardToN8n(message);
            break;
    }
}

async function forwardToN8n(data) {
    try {
        const n8nUrl = process.env.N8N_WEBHOOK_URL || 'https://botstroikom.store/webhook/ph1';
        await fetch(n8nUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        console.log('✅ Отправлено в n8n');
    } catch (error) {
        console.error('❌ Ошибка n8n:', error);
    }
}

// Автоматические тесты каждые 5 минут
setInterval(() => {
    console.log('⏰ Автоматические тесты...');
    for (const [deviceId, device] of devices.entries()) {
        if (device.ws.readyState === WebSocket.OPEN) {
            device.ws.send(JSON.stringify({
                type: 'speed_test_request',
                fileSize: 50000
            }));
        }
    }
}, 5 * 60 * 1000);

// Запуск серверов
app.listen(PORT, () => {
    console.log(`🌐 HTTP сервер: ${PORT}`);
    console.log(`🔌 WebSocket сервер: ${WS_PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/api/devices`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('🛑 Завершение...');
    wss.clients.forEach(client => client.close());
    wss.close(() => process.exit(0));
});
EOF
```

## 🔧 Шаг 4: Создать .env файл

```bash
# Создать .env файл
cat > .env << 'EOF'
PORT=8080
WS_PORT=8081
N8N_WEBHOOK_URL=https://botstroikom.store/webhook/ph1
NODE_ENV=production
EOF
```

## 🔧 Шаг 5: Запустить сервер

```bash
# Тестовый запуск
npm start

# Или в фоне
nohup npm start > server.log 2>&1 &

# Проверить что работает
curl http://localhost:8080/api/devices
```

## 🔧 Шаг 6: Настроить автозапуск

```bash
# Создать systemd сервис
sudo tee /etc/systemd/system/internet-monitor.service > /dev/null <<EOF
[Unit]
Description=Internet Monitor WebSocket Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/internet-monitor/server
ExecStart=/usr/bin/node /root/internet-monitor/server/server.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Включить и запустить
sudo systemctl daemon-reload
sudo systemctl enable internet-monitor
sudo systemctl start internet-monitor
sudo systemctl status internet-monitor
```

## 🔧 Шаг 7: Настроить Nginx (опционально)

```bash
# Установить Nginx
sudo apt install nginx

# Создать конфиг
sudo tee /etc/nginx/sites-available/internet-monitor > /dev/null <<EOF
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    # WebSocket
    location /ws {
        proxy_pass http://localhost:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF

# Включить сайт
sudo ln -s /etc/nginx/sites-available/internet-monitor /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 🔧 Шаг 8: Настроить firewall

```bash
# Разрешить порты
sudo ufw allow 8080
sudo ufw allow 8081
sudo ufw allow 80
sudo ufw --force enable
```

## 📊 Проверка работы

```bash
# Проверить HTTP API
curl http://localhost:8080/api/devices

# Проверить логи
tail -f ~/internet-monitor/server/server.log

# Проверить systemd
sudo systemctl status internet-monitor
```

## 🎯 Следующие шаги

1. **Обновить PWA** с правильным WebSocket URL
2. **Настроить n8n workflow** для обработки данных
3. **Добавить уведомления** (Telegram, SMS)
4. **Настроить мониторинг** сервера

---

## 🚨 Важные настройки для PWA

**Обновить в `app.js`:**
```javascript
serverUrl: 'ws://your-server-ip:8081', // или wss:// для HTTPS
```

**Токены в `server.js`:**
```javascript
const VALID_TOKENS = [
    'YOUR_ACTUAL_PHONE_TOKEN',
    'TEST123'
];
```
