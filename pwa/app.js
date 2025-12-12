/**
 * Internet Monitor PWA - Client
 * Simplified Version: Connect -> Wait for Command -> Test Speed -> Report
 */

class InternetMonitor {
    constructor() {
        this.ws = null;
        this.deviceId = this.generateDeviceId();
        this.accessToken = localStorage.getItem('accessToken');
        
        this.settings = {
            serverUrl: 'wss://befiebubopal.beget.app/ws',
            reconnectInterval: 5000 
        };

        this.init();
    }

    init() {
        this.version = "Speed-Only v1.0"; // Версия для проверки обновления
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
        if (this.ws) return; // Уже подключаемся или подключены

        this.log('🔌 Подключение к серверу...');
        this.updateStatus('Подключение...', 'testing');

        this.ws = new WebSocket(this.settings.serverUrl);

        this.ws.onopen = () => {
            this.log('✅ WebSocket соединен');
            this.updateStatus('Онлайн (Жду команд)', 'online');
            
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

        this.ws.onclose = (e) => {
            this.log('🔌 Соединение разорвано. Реконнект через 5 сек...');
            this.updateStatus('Офлайн', 'offline');
            this.ws = null;
            setTimeout(() => this.connect(), this.settings.reconnectInterval);
        };

        this.ws.onerror = (e) => {
            console.error('WS Error', e);
            // onclose сработает следом
        };
    }

    handleMessage(msg) {
        switch (msg.type) {
            case 'welcome':
                this.log(`👋 Сервер: ${msg.message}`);
                break;
            
            case 'speed_test_request':
                this.log('🚀 Запрос теста скорости от сервера');
                this.performSpeedTest(msg.fileSize);
                break;
                
            case 'error':
                this.log(`❌ Ошибка от сервера: ${msg.message}`, 'error');
                break;
        }
    }

    async performSpeedTest(fileSize = 50000) {
        this.updateStatus('⚡ Измерение скорости...', 'testing');
        
        try {
            const startTime = performance.now();
            
            // Генерируем "мусор" для url, чтобы обойти кэш
            const random = Math.random();
            const response = await fetch(`https://befiebubopal.beget.app/speed-test?r=${random}`, {
                method: 'POST',
                body: new Uint8Array(fileSize), // Отправляем пустые байты
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-Device-ID': this.deviceId,
                    'X-Access-Token': this.accessToken
                }
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            // Читаем ответ (Stream)
            const reader = response.body.getReader();
            let received = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                received += value.length;
            }

            const duration = performance.now() - startTime;
            const speedMbps = (received * 8) / (duration / 1000) / 1_000_000;
            
            this.log(`✅ Скорость: ${speedMbps.toFixed(2)} Mbps`);
            if (this.ui.speed) this.ui.speed.textContent = `${speedMbps.toFixed(1)} Mbps`;

            // Отправляем результат
            this.send({
                type: 'speed_result',
                speedMbps: speedMbps,
                duration: duration,
                bytes: received
            });
            
            this.updateStatus('Онлайн (Жду команд)', 'online');

        } catch (error) {
            this.log(`❌ Ошибка теста: ${error.message}`, 'error');
            this.updateStatus('Ошибка теста', 'offline');
            // При ошибке теста можно ничего не слать - сервер сам отвалится по таймауту
            // Или можно послать speed: 0, но лучше пусть сработает таймаут сервера (надежнее)
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
}

// Start
document.addEventListener('DOMContentLoaded', () => {
    window.app = new InternetMonitor();
});
