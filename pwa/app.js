/**
 * Internet Monitor PWA - Client
 * Simplified Version: Connect -> Wait for Command -> Test Speed -> Report
 */

class InternetMonitor {
    constructor() {
        this.ws = null;
        this.deviceId = this.generateDeviceId();
        this.accessToken = localStorage.getItem('accessToken');
        this.isConnected = false;
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.reconnectTimeout = null;

        this.settings = {
            serverUrl: 'wss://befiebubopal.beget.app/ws',
            testFileSize: 200000, // 200KB - увеличен для более точных измерений
            reconnectInterval: 5000,
            maxReconnectAttempts: 20, // Увеличено до 20 попыток
            reconnectDelay: 30000 // Начальная задержка 30 секунд
        };

        this.init();
    }

    init() {
        this.version = "v6.1.0"; // Версия для проверки обновления - 200KB тест
        this.setupUI();
        this.log(`🚀 App Version: ${this.version}`); // Лог версии при старте
        this.checkAccess();
        
        // Auto connect
        if (this.accessToken) {
            this.connect();
        }

        // Wake Lock
        this.requestWakeLock();
        document.addEventListener('visibilitychange', () => {
             if (!document.hidden) this.requestWakeLock();
        });
    }

    setupUI() {
        this.ui = {
            status: document.getElementById('status'),
            speed: document.getElementById('speed'),
            logs: document.getElementById('logs'),
            connectBtn: document.getElementById('connectBtn')
        };

        if (this.ui.connectBtn) {
            this.ui.connectBtn.addEventListener('click', () => {
                if (!this.accessToken) this.checkAccess();
                this.connect();
            });
        }
        
        // Скрываем loading screen
        const loader = document.getElementById('loadingScreen');
        if (loader) setTimeout(() => loader.style.display = 'none', 500);
    }

    checkAccess() {
        const VALID_TOKENS = ['PHONE001', 'PHONE002', 'PHONE003', 'TEST123'];
        
        if (!this.accessToken || !VALID_TOKENS.includes(this.accessToken)) {
            const token = prompt('Введите код доступа:');
            if (token && VALID_TOKENS.includes(token)) {
                this.accessToken = token;
                localStorage.setItem('accessToken', token);
                return true;
            }
            return false;
        }
        return true;
    }

    generateDeviceId() {
        const raw = navigator.userAgent + screen.width + screen.height;
        let hash = 0;
        for (let i = 0; i < raw.length; i++) {
            hash = ((hash << 5) - hash) + raw.charCodeAt(i);
            hash |= 0;
        }
        return 'device_' + Math.abs(hash).toString(16).substring(0, 8);
    }

    connect() {
        console.log('🔌 Attempting to connect to:', this.settings.serverUrl);
        console.log('🔑 Access token available:', !!this.accessToken);

        if (this.isConnected) {
            console.log('⚠️ Already connected, skipping');
            return;
        }

        try {
            this.updateStatus('Подключение...', 'testing');
            this.ws = new WebSocket(this.settings.serverUrl);
            console.log('🌐 WebSocket instance created:', !!this.ws);

            this.ws.onopen = () => {
                const wasDisconnected = !this.isConnected;
                console.log('✅ WebSocket opened successfully');
                this.isConnected = true;
                this.isReconnecting = false;
                this.reconnectAttempts = 0; // Сброс счетчика при успешном подключении
                this.updateStatus('✅ Подключено', 'online');
                this.log('🔌 WebSocket подключён', 'success');

                // Очистить таймаут переподключения если он был
                if (this.reconnectTimeout) {
                    clearTimeout(this.reconnectTimeout);
                    this.reconnectTimeout = null;
                }

                // Отправка информации об устройстве
                this.send({
                    type: 'device_info',
                    deviceId: this.deviceId,
                    token: this.accessToken,
                    userAgent: navigator.userAgent,
                    timestamp: Date.now()
                });

                // Auth
                this.send({
                    type: 'auth',
                    token: this.accessToken,
                    deviceId: this.deviceId
                });
            };

        this.ws.onmessage = async (event) => {
            try {
                const msg = JSON.parse(event.data);
                this.handleMessage(msg);
            } catch (e) {
                console.error('JSON Error', e);
            }
        };

            this.ws.onclose = (event) => {
                console.log('🔌 WebSocket closed:', event.code, event.reason);
                this.isConnected = false;
                this.ws = null;

                this.updateStatus('Офлайн', 'offline');
                this.log('🔌 Соединение разорвано', 'error');

                // Запускаем переподключение только если не в процессе переподключения
                if (!this.isReconnecting) {
                    this.scheduleReconnect();
                }
            };

            this.ws.onerror = (e) => {
                console.error('WS Error', e);
                // onclose сработает следом
            };
    }

    handleMessage(data) {
        this.log(`📨 Получено: ${data.type}`, 'info');

        switch (data.type) {
            case 'welcome':
                console.log(`👋 Welcome received: ${data.message}, device: ${data.deviceId}, reconnect: ${data.isReconnect}`);
                if (data.isReconnect) {
                    // Это переподключение - отправляем connection_restored
                    this.sendConnectionStatus('connection_restored', 'reconnection_successful');
                } else {
                    // Первичное подключение - ничего не отправляем, connection_restored придет от сервера
                    console.log('✅ Первичное подключение установлено');
                }
                break;

            case 'speed_test_request':
                this.performSpeedTest(data.fileSize || this.settings.testFileSize);
                break;

            case 'settings_update':
                this.settings = { ...this.settings, ...data.settings };
                this.log('✅ Настройки обновлены', 'success');
                break;

            case 'disconnect':
                this.disconnect();
                break;

            case 'error':
                this.log(`❌ Ошибка от сервера: ${data.message}`, 'error');
                break;

            default:
                this.log(`⚠️ Неизвестный тип сообщения: ${data.type}`, 'info');
        }
    }

    async performSpeedTest(fileSize = this.settings.testFileSize) {
        console.log('🔍 Starting speed test...');

        // Предотвращаем одновременные тесты
        if (this.isTesting) {
            console.log('⚠️ Test already in progress, skipping');
            return;
        }
        this.isTesting = true;

        this.updateStatus('⚡ Тест скорости...', 'testing');

        try {
            // Создание тестовых данных в памяти (не файл!)
            const testData = new Uint8Array(fileSize);
            for (let i = 0; i < fileSize; i++) {
                testData[i] = Math.random() * 256;
            }

            const startTime = performance.now();

            // Отправка на сервер с случайным параметром для предотвращения кэширования
            const randomParam = Math.random().toString(36).substring(2);
            const response = await fetch(`https://befiebubopal.beget.app/speed-test?_=${randomParam}`, {
                method: 'POST',
                body: testData,
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-Device-ID': this.deviceId,
                    'X-Access-Token': this.accessToken,
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
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
                chunks.push(value);
            }

            const duration = performance.now() - startTime;
            const speedMbps = (bytesReceived * 8) / (duration / 1000) / 1_000_000;

            console.log(`✅ Speed test completed: ${speedMbps.toFixed(2)} Mbps, ${bytesReceived} bytes in ${duration.toFixed(0)}ms`);

            this.log(`✅ Скорость: ${speedMbps.toFixed(2)} Mbps`);
            if (this.ui.speed) this.ui.speed.textContent = `${speedMbps.toFixed(1)} Mbps`;

            // Отправляем результат
            this.send({
                type: 'speed_result',
                speedMbps: speedMbps,
                duration: duration,
                bytes: bytesReceived
            });

            this.updateStatus('Онлайн (Жду команд)', 'online');

        } catch (error) {
            console.error('❌ Speed test error:', error);
            this.log(`❌ Ошибка теста: ${error.message}`, 'error');
            this.updateStatus('Ошибка теста', 'offline');
        } finally {
            this.isTesting = false;
        }
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    updateStatus(text, className) {
        if (this.ui.status) {
            this.ui.status.innerHTML = `<div>${text}</div>`;
            this.ui.status.className = `status ${className}`;
        }
    }

    log(msg, type = 'info') {
        const time = new Date().toLocaleTimeString();
        const div = document.createElement('div');
        div.className = `log-entry ${type}`;
        div.textContent = `[${time}] ${msg}`;
        if (this.ui.logs) {
            this.ui.logs.appendChild(div);
            this.ui.logs.scrollTop = this.ui.logs.scrollHeight;
            // Limit logs
            if (this.ui.logs.children.length > 50) this.ui.logs.firstChild.remove();
        }
        console.log(`[${type}] ${msg}`);
    }
    
    async requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
                console.log('🔋 Wake Lock active');
            } catch (err) {
                console.log('🔋 Wake Lock error:', err);
            }
        }
    }

    sendConnectionStatus(type, reason) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: type,
                deviceId: this.deviceId,
                token: this.accessToken,
                reason: reason,
                timestamp: Date.now()
            }));
        }
    }

    scheduleReconnect() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }

        if (this.reconnectAttempts >= this.settings.maxReconnectAttempts) {
            console.log('❌ Maximum reconnection attempts reached, giving up');
            this.log('❌ Превышено максимальное количество попыток переподключения', 'error');
            this.updateStatus('Не удалось подключиться', 'offline');
            return;
        }

        this.isReconnecting = true;
        this.reconnectAttempts++;

        const delay = this.settings.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1); // Экспоненциальная задержка
        console.log(`🔄 Scheduling reconnect attempt ${this.reconnectAttempts}/${this.settings.maxReconnectAttempts} in ${delay}ms`);

        this.reconnectTimeout = setTimeout(() => {
            this.attemptReconnect();
        }, delay);
    }

    attemptReconnect() {
        console.log(`🔄 Attempting to reconnect (${this.reconnectAttempts}/${this.settings.maxReconnectAttempts})`);
        this.log(`🔄 Попытка переподключения ${this.reconnectAttempts}/${this.settings.maxReconnectAttempts}`, 'info');
        this.connect();
    }
}

// Start
document.addEventListener('DOMContentLoaded', () => {
    window.app = new InternetMonitor();
});


