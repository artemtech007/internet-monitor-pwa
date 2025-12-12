/**
 * WebSocket сервер для Internet Monitor PWA
 * Сфокусирован на периодических тестах скорости для контроля качества соединения.
 */

const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;
const WS_PORT = process.env.WS_PORT || 8081;

// Настройки
const TEST_INTERVAL_MS = 30000; // 30 секунд между тестами
const TEST_TIMEOUT_MS = 15000;  // 15 секунд на ожидание ответа
const TEST_FILE_SIZE = 50000;   // 50KB для быстрого теста

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Хранение подключенных устройств
// deviceId -> { ws, info, lastSeen, waitingForTest, testStartTime }
const devices = new Map();

// Валидные токены доступа
const VALID_TOKENS = [
    'PHONE001',
    'PHONE002',
    'PHONE003',
    'TEST123'
];

// Config for N8N Webhook
const N8N_BASE_URL = process.env.N8N_WEBHOOK_URL || 'https://botstroikom.store';

// --- REST API ---

app.get('/api/devices', (req, res) => {
    const deviceList = Array.from(devices.entries()).map(([id, device]) => ({
        id,
        info: device.info,
        lastSeen: device.lastSeen,
        isOnline: device.ws.readyState === WebSocket.OPEN,
        waitingForTest: device.waitingForTest
    }));
    res.json(deviceList);
});

// Speed test endpoint (download)
app.post('/speed-test', express.raw({ type: 'application/octet-stream', limit: '50mb' }), (req, res) => {
    // Просто возвращаем данные (эхо) для теста скорости
    res.set({
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-cache'
    });
    res.send(req.body);
});


// --- WebSocket Server ---

const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('connection', (ws) => {
    console.log('🔌 Новое подключение');

    // Временный ID до аутентификации
    ws.tempId = Date.now();

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            handleMessage(ws, message);
        } catch (error) {
            console.error('❌ Ошибка парсинга:', error.message);
        }
    });

    ws.on('close', (code, reason) => {
        // Находим устройство по ws
        for (const [deviceId, device] of devices.entries()) {
            if (device.ws === ws) {
                console.log(`🔌 Устройство ${deviceId} отключено (сокет закрыт)`);
                handleDeviceDisconnect(deviceId, device, 'socket_closed');
                break;
            }
        }
    });

    ws.on('error', (error) => {
        console.error('❌ Ошибка сокета:', error.message);
        // Обработка отключения произойдет в on('close')
    });
});

function handleMessage(ws, message) {
    const { type, deviceId, token } = message;

    switch (type) {
        case 'auth':
            if (!VALID_TOKENS.includes(token)) {
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
                ws.close();
                return;
            }

            const actualDeviceId = deviceId || `device_${Date.now()}`;
            console.log(`✅ Auth: ${actualDeviceId} (Token: ${token})`);

            // Регистрируем устройство
            devices.set(actualDeviceId, {
                ws,
                info: { token, deviceId: actualDeviceId },
                lastSeen: Date.now(),
                waitingForTest: false
            });

            ws.send(JSON.stringify({
                type: 'welcome',
                message: 'Connected. Waiting for speed tests.',
                deviceId: actualDeviceId
            }));
            
            // Сразу запускаем первый тест
            sendSpeedTestRequest(actualDeviceId);
            break;

        case 'speed_result':
            if (devices.has(deviceId)) {
                const device = devices.get(deviceId);
                device.waitingForTest = false;
                device.lastSeen = Date.now();
                
                console.log(`📊 Result from ${deviceId}: ${message.speedMbps} Mbps`);
                
                // Отправляем успешный результат в N8N
                forwardToN8n({
                    type: 'speed_result',
                    deviceId,
                    token: device.info.token,
                    speedMbps: message.speedMbps,
                    success: true,
                    timestamp: Date.now()
                });
            }
            break;

        default:
            console.log(`⚠️ Неизвестное сообщение от ${deviceId}: ${type}`);
    }
}

// --- Logic ---

function sendSpeedTestRequest(deviceId) {
    const device = devices.get(deviceId);
    if (!device || device.ws.readyState !== WebSocket.OPEN) return;

    console.log(`📡 Запрос теста для ${deviceId}`);
    
    device.waitingForTest = true;
    device.testStartTime = Date.now();
    
    device.ws.send(JSON.stringify({
        type: 'speed_test_request',
        fileSize: TEST_FILE_SIZE
    }));
}

function handleDeviceDisconnect(deviceId, device, reason) {
    // Отправляем алерт в N8N
    forwardToN8n({
        type: 'connection_lost',
        deviceId: deviceId,
        token: device.info.token,
        speedMbps: 0, // Явный маркер потери связи
        reason: reason,
        timestamp: Date.now()
    });

    // Удаляем из памяти
    devices.delete(deviceId);
}

// Главный цикл опроса
setInterval(() => {
    const now = Date.now();

    for (const [deviceId, device] of devices.entries()) {
        
        // 1. Проверяем таймаут ожидания ответа
        if (device.waitingForTest) {
            if (now - device.testStartTime > TEST_TIMEOUT_MS) {
                console.log(`⏰ Таймаут теста для ${deviceId}`);
                // Закрываем сокет, чтобы вызвать cleanup
                // Но лучше сразу обработать логику потери
                handleDeviceDisconnect(deviceId, device, 'test_timeout');
                
                // Пробуем закрыть сокет корректно
                try { device.ws.terminate(); } catch (e) {}
                continue; // Переходим к следующему
            }
        }
        
        // 2. Если не ждем ответа, проверяем, пора ли запускать новый тест
        // (например, если прошло > TEST_INTERVAL_MS с последнего lastSeen)
        // Но проще просто запускать по интервалу, если не занят
        else {
             sendSpeedTestRequest(deviceId);
        }
    }
}, TEST_INTERVAL_MS);


// --- Webhook ---

async function forwardToN8n(data) {
    try {
        const endpoint = '/webhook/ph1'; // Единый эндпоинт, логика внутри n8n
        const fullUrl = `${N8N_BASE_URL}${endpoint}`;
        
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(data)) {
            params.append(key, String(value));
        }

        const urlWithParams = `${fullUrl}?${params.toString()}`;
        
        // console.log(`📤 Webhook: ${urlWithParams}`); // Debug
        
        fetch(urlWithParams).catch(err => console.error(`❌ Webhook error: ${err.message}`));

    } catch (error) {
        console.error('❌ Critical webhook error:', error);
    }
}

// --- Start ---

app.listen(PORT, () => {
    console.log(`🌐 HTTP Server: port ${PORT}`);
    console.log(`🔌 WebSocket Server: port ${WS_PORT}`);
    console.log('🚀 Monitor started in Speed-Only mode');
});
