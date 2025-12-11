/**
 * Internet Monitor PWA
 * WebSocket-based internet speed monitoring
 */

class InternetMonitor {
    constructor() {
        this.ws = null;
        this.deviceId = this.generateDeviceId();
        this.isConnected = false;
        this.accessToken = null;
        this.settings = {
            serverUrl: 'wss://botstroikom.store/ws', // WebSocket сервер
            testFileSize: 50000, // 50KB
            reconnectInterval: 5000
        };

        this.init();
    }

    init() {
        this.setupUI();
        this.checkAccess();
        this.registerServiceWorker();
        this.loadSettings();

        // Автоподключение если есть токен
        if (this.accessToken) {
            this.connect();
        }
    }

    setupUI() {
        this.elements = {
            status: document.getElementById('status'),
            speed: document.getElementById('speed'),
            ping: document.getElementById('ping'),
            connectBtn: document.getElementById('connectBtn'),
            testBtn: document.getElementById('testBtn'),
            disconnectBtn: document.getElementById('disconnectBtn'),
            logs: document.getElementById('logs')
        };

        // Event listeners
        this.elements.connectBtn.addEventListener('click', () => this.connect());
        this.elements.testBtn.addEventListener('click', () => this.manualTest());
        this.elements.disconnectBtn.addEventListener('click', () => this.disconnect());

        this.updateStatus('Ожидание подключения...', 'offline');
    }

    checkAccess() {
        // Простая аутентификация
        const validTokens = [
            'PHONE001', 'PHONE002', 'PHONE003', // Заменить на реальные токены
            'TEST123' // Для тестирования
        ];

        const savedToken = localStorage.getItem('accessToken');
        if (savedToken && validTokens.includes(savedToken)) {
            this.accessToken = savedToken;
            this.log('✅ Доступ подтверждён', 'success');
            return;
        }

        // Запрос токена
        const token = prompt('Введите код доступа:');
        if (!token || !validTokens.includes(token)) {
            alert('Неверный код доступа!');
            window.location.href = 'about:blank';
            return;
        }

        this.accessToken = token;
        localStorage.setItem('accessToken', token);
        this.log('✅ Доступ подтверждён', 'success');
    }

    generateDeviceId() {
        // Генерация уникального ID устройства
        const navigatorInfo = navigator.userAgent + navigator.language + screen.width + screen.height;
        let hash = 0;
        for (let i = 0; i < navigatorInfo.length; i++) {
            const char = navigatorInfo.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return 'device_' + Math.abs(hash).toString(16).substring(0, 8);
    }

    async loadSettings() {
        try {
            // Загрузка настроек с сервера
            const response = await fetch(`https://your-api.com/settings?device=${this.deviceId}&token=${this.accessToken}`);
            if (response.ok) {
                const serverSettings = await response.json();
                this.settings = { ...this.settings, ...serverSettings };
                this.log('✅ Настройки загружены с сервера', 'success');
            }
        } catch (error) {
            this.log('⚠️ Используются настройки по умолчанию', 'info');
        }
    }

    connect() {
        if (this.isConnected) return;

        try {
            this.updateStatus('Подключение...', 'testing');
            this.ws = new WebSocket(this.settings.serverUrl);

            this.ws.onopen = () => {
                this.isConnected = true;
                this.updateStatus('✅ Подключено', 'online');
                this.log('🔌 WebSocket подключён', 'success');

                // Отправка информации об устройстве
                this.send({
                    type: 'device_info',
                    deviceId: this.deviceId,
                    token: this.accessToken,
                    userAgent: navigator.userAgent,
                    timestamp: Date.now()
                });
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(JSON.parse(event.data));
            };

            this.ws.onclose = () => {
                this.isConnected = false;
                this.updateStatus('❌ Отключено', 'offline');
                this.log('🔌 WebSocket отключён', 'error');

                // Автопереподключение
                setTimeout(() => {
                    if (!this.isConnected) {
                        this.connect();
                    }
                }, this.settings.reconnectInterval);
            };

            this.ws.onerror = (error) => {
                this.log(`❌ WebSocket ошибка: ${error}`, 'error');
            };

        } catch (error) {
            this.log(`❌ Ошибка подключения: ${error.message}`, 'error');
            this.updateStatus('❌ Ошибка подключения', 'offline');
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        this.updateStatus('Отключено', 'offline');
        this.log('🔌 Отключено вручную', 'info');
    }

    handleMessage(data) {
        this.log(`📨 Получено: ${data.type}`, 'info');

        switch (data.type) {
            case 'speed_test_request':
                this.performSpeedTest(data.fileSize || this.settings.testFileSize);
                break;

            case 'ping_test_request':
                this.performPingTest();
                break;

            case 'settings_update':
                this.settings = { ...this.settings, ...data.settings };
                this.log('✅ Настройки обновлены', 'success');
                break;

            case 'disconnect':
                this.disconnect();
                break;

            default:
                this.log(`⚠️ Неизвестный тип сообщения: ${data.type}`, 'info');
        }
    }

    async performPingTest() {
        this.updateStatus('🏓 Проверка ping...', 'testing');
        const startTime = performance.now();

        try {
            // Пинг через fetch к надежному ресурсу
            const response = await fetch('https://www.google.com/favicon.ico', {
                method: 'HEAD',
                cache: 'no-cache'
            });

            const endTime = performance.now();
            const ping = Math.round(endTime - startTime);

            this.elements.ping.textContent = `${ping}ms`;

            this.send({
                type: 'ping_result',
                ping: ping,
                success: response.ok,
                timestamp: Date.now()
            });

            this.log(`🏓 Ping: ${ping}ms`, 'success');

        } catch (error) {
            this.elements.ping.textContent = 'Ошибка';
            this.send({
                type: 'ping_result',
                success: false,
                error: error.message,
                timestamp: Date.now()
            });
            this.log(`❌ Ping ошибка: ${error.message}`, 'error');
        }
    }

    async performSpeedTest(fileSize = this.settings.testFileSize) {
        this.updateStatus('⚡ Тест скорости...', 'testing');

        try {
            // Создание тестовых данных в памяти (не файл!)
            const testData = new Uint8Array(fileSize);
            for (let i = 0; i < fileSize; i++) {
                testData[i] = Math.random() * 256;
            }

            const startTime = performance.now();

            // Отправка на сервер
            const response = await fetch('https://your-server.com/speed-test', {
                method: 'POST',
                body: testData,
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-Device-ID': this.deviceId,
                    'X-Access-Token': this.accessToken
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            // Чтение ответа как поток (экономит память)
            const reader = response.body.getReader();
            let bytesReceived = 0;
            const chunks = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                bytesReceived += value.length;
                // Не сохраняем данные, только считаем байты
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            // Расчет скорости
            const speedMbps = (bytesReceived * 8) / (duration / 1000) / 1_000_000;

            this.elements.speed.textContent = `${speedMbps.toFixed(1)} Mbps`;

            this.send({
                type: 'speed_result',
                speedMbps: speedMbps,
                bytesSent: fileSize,
                bytesReceived: bytesReceived,
                duration: duration,
                success: true,
                timestamp: Date.now()
            });

            this.updateStatus('✅ Тест завершён', 'online');
            this.log(`⚡ Скорость: ${speedMbps.toFixed(1)} Mbps`, 'success');

        } catch (error) {
            this.elements.speed.textContent = 'Ошибка';
            this.send({
                type: 'speed_result',
                success: false,
                error: error.message,
                timestamp: Date.now()
            });
            this.updateStatus('❌ Ошибка теста', 'offline');
            this.log(`❌ Ошибка теста: ${error.message}`, 'error');
        }
    }

    async manualTest() {
        if (!this.isConnected) {
            this.log('⚠️ Сначала подключитесь', 'error');
            return;
        }

        await this.performSpeedTest();
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                ...data,
                deviceId: this.deviceId,
                token: this.accessToken
            }));
        } else {
            this.log('⚠️ WebSocket не подключён', 'error');
        }
    }

    updateStatus(text, type = 'offline') {
        this.elements.status.className = `status ${type}`;
        this.elements.status.innerHTML = `<div>${text}</div>`;
    }

    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        logEntry.textContent = `[${timestamp}] ${message}`;

        this.elements.logs.appendChild(logEntry);
        this.elements.logs.scrollTop = this.elements.logs.scrollHeight;

        // Ограничение количества логов
        while (this.elements.logs.children.length > 50) {
            this.elements.logs.removeChild(this.elements.logs.firstChild);
        }
    }

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js')
                .then(registration => {
                    this.log('✅ Service Worker зарегистрирован', 'success');
                })
                .catch(error => {
                    this.log(`❌ Service Worker ошибка: ${error}`, 'error');
                });
        }
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    window.internetMonitor = new InternetMonitor();
});

// Экспорт для отладки
if (typeof module !== 'undefined' && module.exports) {
    module.exports = InternetMonitor;
}
