#!/bin/bash

# ============================================
# Internet Monitor Server Setup Script
# Автоматическая настройка сервера
# ============================================

set -e  # Остановить при ошибке

echo "🌐 Internet Monitor Server Setup"
echo "================================"

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}" >&2
}

warning() {
    echo -e "${YELLOW}[WARNING] $1${NC}"
}

info() {
    echo -e "${BLUE}[INFO] $1${NC}"
}

# Проверка root прав
if [ "$EUID" -ne 0 ]; then
    error "Пожалуйста, запустите скрипт с правами root: sudo $0"
    exit 1
fi

log "Начало настройки сервера..."

# Обновление системы
log "📦 Обновление системы..."
apt update && apt upgrade -y
apt install -y curl wget git htop ufw software-properties-common

# Установка Node.js 18
log "📦 Установка Node.js 18..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
    log "✅ Node.js установлен: $(node --version)"
else
    log "✅ Node.js уже установлен: $(node --version)"
fi

# Установка PM2
log "📦 Установка PM2..."
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
    log "✅ PM2 установлен"
else
    log "✅ PM2 уже установлен"
fi

# Создание директорий
log "📁 Создание директорий проекта..."
mkdir -p ~/internet-monitor/server
cd ~/internet-monitor/server

# Создание package.json
log "📄 Создание package.json..."
cat > package.json << 'EOF'
{
  "name": "internet-monitor-websocket-server",
  "version": "1.0.0",
  "description": "WebSocket сервер для Internet Monitor PWA",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "pm2": "pm2 start server.js --name internet-monitor",
    "stop": "pm2 stop internet-monitor",
    "restart": "pm2 restart internet-monitor",
    "logs": "pm2 logs internet-monitor",
    "status": "pm2 status"
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

# Установка зависимостей
log "📦 Установка зависимостей..."
npm install

# Создание server.js
log "📄 Создание server.js..."
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

# Создание .env файла
log "📄 Создание .env файла..."
cat > .env << 'EOF'
PORT=8080
WS_PORT=8081
N8N_WEBHOOK_URL=https://botstroikom.store/webhook/ph1
WS_SERVER_URL=ws://93.189.231.3:8081
NODE_ENV=production
EOF

# Настройка firewall
log "🔥 Настройка firewall..."
ufw allow 22/tcp      # SSH
ufw allow 8080/tcp    # HTTP API
ufw allow 8081/tcp    # WebSocket
ufw --force enable

# Тестовый запуск
log "🧪 Тестовый запуск сервера..."
timeout 10s npm start &
sleep 5

# Проверка работы
if curl -s http://localhost:8080/api/devices > /dev/null 2>&1; then
    log "✅ HTTP API работает"
else
    warning "⚠️ HTTP API не отвечает (возможно, нормально для первого запуска)"
fi

# Убиваем тестовый процесс
pkill -f "node server.js" || true

# Запуск с PM2
log "🚀 Запуск сервера с PM2..."
pm2 delete internet-monitor 2>/dev/null || true  # Удалить если существует
pm2 start server.js --name internet-monitor
pm2 save
pm2 startup systemd -u root --hp /root

log "✅ Сервер запущен с PM2"

# Финальная проверка
log "📊 Финальная проверка..."
sleep 3

if pm2 list | grep -q "internet-monitor"; then
    log "✅ Сервер успешно запущен!"
    info ""
    info "📋 Информация о сервере:"
    info "🌐 HTTP API: http://93.189.231.3:8080"
    info "🔌 WebSocket: ws://93.189.231.3:8081"
    info "📊 Dashboard: http://93.189.231.3:8080/api/devices"
    info ""
    info "🛠️ Управление сервером:"
    info "pm2 status                    # Статус"
    info "pm2 logs internet-monitor     # Логи"
    info "pm2 restart internet-monitor  # Перезапуск"
    info "pm2 stop internet-monitor     # Остановка"
    info ""
    info "🧪 Тестирование:"
    info "curl http://localhost:8080/api/devices"
    info ""
    info "📱 PWA: https://artemtech007.github.io/internet-monitor-pwa/"
    info "🔑 Код доступа: TEST123"
else
    error "❌ Ошибка запуска сервера"
    pm2 logs internet-monitor --lines 20
    exit 1
fi

log "🎉 Настройка завершена успешно!"
info ""
info "🌟 Система готова к работе!"
info "📱 Подключи PWA и наслаждайся мониторингом интернета!"
