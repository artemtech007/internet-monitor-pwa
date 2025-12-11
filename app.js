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
        this.wakeLock = null; // Wake Lock для предотвращения засыпания
        this.isTesting = false; // Флаг для предотвращения одновременных тестов
        this.deferredPrompt = null; // Для установки PWA
        this.settings = {
            serverUrl: 'wss://befiebubopal.beget.app/ws', // WebSocket сервер
            testFileSize: 200000, // 200KB - увеличен для более точных измерений
            reconnectInterval: 5000
        };

        this.init();
    }

    init() {
        this.setupUI();
        this.checkAccess();
        this.registerServiceWorker();
        this.setupBackgroundSync();

        // Проверка PWA поддержки
        this.checkPWASupport();

        // Автоподключение если есть токен
        console.log('🔑 Access token on init:', !!this.accessToken, this.accessToken);
        if (this.accessToken) {
            console.log('🚀 Auto-connecting with token...');
            this.connect();
        } else {
            console.log('⚠️ No access token, waiting for manual connection');
        }

        // Обработка видимости страницы
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('📱 Страница свернута');
            } else {
                console.log('📱 Страница активна');
            }
        });

        // Обработка установки PWA
        window.addEventListener('beforeinstallprompt', (e) => {
            console.log('📱 PWA install prompt available');
            console.log('📱 BeforeInstallPromptEvent:', e);
            console.log('📱 Platforms:', e.platforms);
            e.preventDefault();
            this.deferredPrompt = e;
            this.showInstallButton();
        });

        // Проверяем, установлен ли уже PWA
        if ('getInstalledRelatedApps' in navigator) {
            navigator.getInstalledRelatedApps().then(apps => {
                console.log('📱 Installed related apps:', apps);
                const isInstalled = apps.some(app => app.id === 'internet-monitor-pwa');
                console.log('📱 PWA already installed:', isInstalled);
                if (isInstalled) {
                    this.hideInstallButton();
                    this.log('✅ PWA уже установлен', 'success');
                }
            }).catch(error => {
                console.log('📱 Error checking installed apps:', error);
            });
        }

        // Обработка успешной установки
        window.addEventListener('appinstalled', () => {
            console.log('✅ PWA installed successfully');
            this.hideInstallButton();
            this.log('✅ PWA установлено!', 'success');
        });

        // Показываем кнопку установки сразу после инициализации
        setTimeout(() => {
            this.showInstallButton();
        }, 1000);

        // Повторная проверка через 5 секунд (на случай если Service Worker еще не зарегистрирован)
        setTimeout(() => {
            if (!this.deferredPrompt) {
                console.log('📱 Retrying install button show after 5 seconds');
                this.showInstallButton();
            }
        }, 5000);
    }

    setupUI() {
        this.elements = {
            status: document.getElementById('status'),
            speed: document.getElementById('speed'),
            connectBtn: document.getElementById('connectBtn'),
            testBtn: document.getElementById('testBtn'),
            disconnectBtn: document.getElementById('disconnectBtn'),
            installBtn: document.getElementById('installBtn'),
            logs: document.getElementById('logs')
        };

        console.log('🔍 DOM elements found:', {
            speed: !!this.elements.speed,
            ping: !!this.elements.ping,
            status: !!this.elements.status
        });

        // Event listeners
        this.elements.connectBtn.addEventListener('click', () => this.connect());
        this.elements.testBtn.addEventListener('click', () => this.manualTest());
        this.elements.disconnectBtn.addEventListener('click', () => this.disconnect());

        // Обработчик для кнопки установки PWA
        if (this.elements.installBtn) {
            this.elements.installBtn.addEventListener('click', (e) => {
                console.log('📱 Install button clicked');
                e.preventDefault();
                this.installPWA();
            });
        }

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
                console.log('✅ WebSocket opened successfully');
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

            this.ws.onclose = (event) => {
                console.log('🔌 WebSocket closed:', event.code, event.reason);
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
                console.log('❌ WebSocket error:', error);
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


    async performSpeedTest(fileSize = this.settings.testFileSize) {
        console.log('🔍 Starting speed test...');
        console.log('🔍 Speed element:', this.elements.speed);
        console.log('🔍 Speed element exists:', !!this.elements.speed);

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
                // Не сохраняем данные, только считаем байты
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            // Расчет скорости
            const speedMbps = (bytesReceived * 8) / (duration / 1000) / 1_000_000;

            console.log('🔄 Calculated speed:', speedMbps.toFixed(1), 'Mbps');
            console.log('🔄 Setting speed element textContent to:', `${speedMbps.toFixed(1)} Mbps`);
            this.elements.speed.textContent = `${speedMbps.toFixed(1)} Mbps`;
            console.log('🔄 Speed element updated to:', this.elements.speed.textContent);
            console.log('🔄 Speed element actual text:', this.elements.speed.textContent);

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
            console.log('❌ Speed test failed with error:', error.message);
            console.log('❌ Setting speed element to "Ошибка"');
            this.elements.speed.textContent = 'Ошибка';
            this.send({
                type: 'speed_result',
                success: false,
                error: error.message,
                timestamp: Date.now()
            });
            this.updateStatus('❌ Ошибка теста', 'offline');
            this.log(`❌ Ошибка теста: ${error.message}`, 'error');
        } finally {
            // Сбрасываем флаг тестирования
            this.isTesting = false;
        }
    }

    async manualTest() {
        if (!this.isConnected) {
            this.log('⚠️ Сначала подключитесь', 'error');
            return;
        }

        // Проверка элементов DOM
        if (!this.elements.speed) {
            console.error('❌ Speed element not found:', this.elements.speed);
            this.log('❌ Ошибка UI: элемент скорости не найден', 'error');
            return;
        }

        console.log('✅ DOM elements OK, starting speed test');
        this.log('🚀 Запуск тестирования скорости...', 'info');

        // Запрашиваем Wake Lock для предотвращения засыпания
        await this.requestWakeLock();

        try {
            // Выполняем speed тест
            await this.performSpeedTest();
            this.log('✅ Тестирование завершено', 'success');
        } finally {
            // Освобождаем Wake Lock
            await this.releaseWakeLock();
        }
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

    // Wake Lock API для предотвращения засыпания экрана
    async requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
                console.log('🔋 Wake Lock активирован');
                this.wakeLock.addEventListener('release', () => {
                    console.log('🔋 Wake Lock освобожден');
                });
            } catch (error) {
                console.log('❌ Wake Lock не поддерживается или заблокирован:', error);
            }
        } else {
            console.log('❌ Wake Lock API не поддерживается');
        }
    }

    async releaseWakeLock() {
        if (this.wakeLock) {
            await this.wakeLock.release();
            this.wakeLock = null;
        }
    }

    // Background Sync для работы в фоне
    setupBackgroundSync() {
        if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
            navigator.serviceWorker.ready.then(registration => {
                // Регистрируем periodic sync каждые 30 минут
                if ('periodicSync' in registration) {
                    registration.periodicSync.register('internet-test', {
                        minInterval: 30 * 60 * 1000 // 30 минут
                    }).then(() => {
                        console.log('📅 Periodic background sync зарегистрирован');
                    }).catch(error => {
                        console.log('❌ Periodic sync не поддерживается:', error);
                    });
                }

                // Регистрируем обычный background sync
                registration.sync.register('internet-test').catch(error => {
                    console.log('❌ Background sync не поддерживается:', error);
                });
            });
        } else {
            console.log('❌ Background Sync API не поддерживается');
        }
    }

    // Проверка поддержки PWA функций
    checkPWASupport() {
        const features = {
            serviceWorker: 'serviceWorker' in navigator,
            backgroundSync: 'sync' in window.ServiceWorkerRegistration.prototype,
            periodicSync: 'periodicSync' in window.ServiceWorkerRegistration.prototype,
            wakeLock: 'wakeLock' in navigator,
            notifications: 'Notification' in window,
            push: 'PushManager' in window
        };

        console.log('🔍 PWA поддержка:', features);
        return features;
    }

    // Показать кнопку установки PWA
    showInstallButton() {
        console.log('📱 showInstallButton called');
        console.log('📱 installBtn element:', this.elements.installBtn);
        console.log('📱 deferredPrompt:', !!this.deferredPrompt);

        if (this.elements.installBtn) {
            const pwaSupport = this.checkPWASupport();
            console.log('📱 PWA support check:', pwaSupport);

            // Показываем кнопку всегда, если есть поддержка Service Worker
            if (pwaSupport.serviceWorker) {
                this.elements.installBtn.style.display = 'block';
                this.log('📱 Кнопка установки PWA доступна', 'info');
                console.log('📱 Install button should now be visible');
            } else {
                console.log('📱 Service Worker not supported, hiding install button');
                this.elements.installBtn.style.display = 'none';
            }
        } else {
            console.log('📱 Install button element not found!');
        }
    }

    // Скрыть кнопку установки PWA
    hideInstallButton() {
        if (this.elements.installBtn) {
            this.elements.installBtn.style.display = 'none';
        }
    }

    // Установка PWA
    async installPWA() {
        console.log('📱 installPWA called, deferredPrompt:', !!this.deferredPrompt);
        console.log('📱 deferredPrompt object:', this.deferredPrompt);

        if (this.deferredPrompt) {
            // Используем стандартный API
            console.log('📱 Using deferredPrompt for installation');
            console.log('📱 Calling deferredPrompt.prompt()...');
            try {
                const result = this.deferredPrompt.prompt();
                console.log('📱 Prompt result:', result);
                console.log('📱 Prompt called, waiting for userChoice...');
                const { outcome } = await this.deferredPrompt.userChoice;
                console.log('📱 User choice outcome:', outcome);
            } catch (error) {
                console.error('❌ Error calling prompt():', error);
                this.log('❌ Ошибка при показе диалога установки', 'error');
                return;
            }

            if (outcome === 'accepted') {
                console.log('✅ Пользователь принял установку PWA');
                this.log('✅ Установка PWA принята', 'success');
            } else {
                console.log('❌ Пользователь отклонил установку PWA');
                this.log('❌ Установка PWA отклонена', 'info');
            }

            this.deferredPrompt = null;
            this.hideInstallButton();
        } else {
            // Fallback - пытаемся показать инструкции
            console.log('📱 No deferredPrompt, showing manual install instructions');
            this.log('ℹ️ Для установки PWA используйте меню браузера', 'info');

            // Показываем инструкции для разных браузеров
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            const isAndroid = /Android/.test(navigator.userAgent);
            const isChrome = /Chrome/.test(navigator.userAgent);
            const isFirefox = /Firefox/.test(navigator.userAgent);
            const isSafari = /Safari/.test(navigator.userAgent) && !isChrome;
            const isOpera = /OPR|Opera/.test(navigator.userAgent);

            let instructions = 'Для установки PWA:\n\n';

            if (isIOS) {
                instructions += '• Нажмите кнопку "Поделиться" (квадрат со стрелкой вверх)\n';
                instructions += '• Выберите "На экран Домой"\n';
                instructions += '• Нажмите "Добавить"\n\n';
                instructions += 'Или в Safari: меню → "Поделиться" → "На экран Домой"';
            } else if (isAndroid) {
                if (isChrome) {
                    instructions += '• Нажмите "⋮" (меню) в правом верхнем углу\n';
                    instructions += '• Выберите "Добавить на главный экран"\n';
                    instructions += '• Нажмите "Добавить" в диалоге';
                } else if (isFirefox) {
                    instructions += '• Нажмите "⋮" (меню)\n';
                    instructions += '• Выберите "Установить это приложение"';
                } else if (isOpera) {
                    instructions += '• Нажмите значок Opera в правом верхнем углу\n';
                    instructions += '• Выберите "Добавить на главный экран"';
                } else {
                    instructions += '• Нажмите меню браузера (⋮)\n';
                    instructions += '• Найдите "Добавить на главный экран" или "Установить"';
                }
            } else {
                // Desktop browsers
                if (isChrome) {
                    instructions += '• Нажмите "⋮" (меню) в правом верхнем углу\n';
                    instructions += '• Выберите "Установить Internet Monitor Pro"';
                } else if (isFirefox) {
                    instructions += '• Нажмите кнопку установки в адресной строке\n';
                    instructions += '• Или: меню → "Приложения" → "Установить это приложение"';
                } else if (isSafari) {
                    instructions += '• Файл → "Поделиться" → "Добавить на Dock"\n';
                    instructions += '• Или: Вид → "Настроить панель Touch Bar" (если применимо)';
                } else if (isOpera) {
                    instructions += '• Нажмите значок сердца в адресной строке\n';
                    instructions += '• Или: меню → "Установить приложение"';
                } else {
                    instructions += '• Ищите кнопку "Установить" в адресной строке\n';
                    instructions += '• Или в меню браузера: "Установить приложение"';
                }
            }

            instructions += '\n\n💡 Совет: Очистите кэш браузера и попробуйте в режиме инкогнито';

            alert(instructions);
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
