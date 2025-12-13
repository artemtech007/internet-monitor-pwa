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

        // Состояние жизненного цикла приложения
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.reconnectTimeout = null;
        this.pageVisible = !document.hidden;
        this.lastHeartbeat = Date.now();
        this.settings = {
            serverUrl: 'wss://befiebubopal.beget.app/ws', // WebSocket сервер
            testFileSize: 200000, // 200KB - увеличен для более точных измерений
            reconnectInterval: 5000,
            maxReconnectAttempts: 20, // Увеличено до 20 попыток
            reconnectDelay: 30000 // Начальная задержка 30 секунд
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

        // Обработка жизненного цикла страницы (лучше чем visibilitychange для PWA)
        document.addEventListener('pageshow', (event) => {
            console.log('📱 Страница восстановлена (pageshow)', event.persisted ? '(из bfcache)' : '');
            this.handlePageRestore();
            // Отправить статус восстановления страницы
            this.sendConnectionStatus('app_foreground', 'page_restored');
        });

        document.addEventListener('pagehide', (event) => {
            console.log('📱 Страница скрыта (pagehide)', event.persisted ? '(сохранится в bfcache)' : '');
            this.handlePageHide();
            // Отправить статус сворачивания страницы
            this.sendConnectionStatus('app_background', 'page_hidden');
        });

        // Дополнительная обработка видимости
        document.addEventListener('visibilitychange', () => {
            console.log(`📱 Visibility change: hidden=${document.hidden}, pageVisible=${this.pageVisible}`);
            if (document.hidden) {
                console.log('📱 Страница свернута (visibilitychange)');
                this.handleVisibilityHidden();
            } else {
                console.log('📱 Страница активна (visibilitychange)');
                this.handleVisibilityVisible();
            }
        });

        // Обработка сетевых событий браузера
        window.addEventListener('online', () => {
            console.log('🌐 Интернет соединение восстановлено');
            this.sendConnectionStatus('connection_restored', 'network_online');
            // Попытаться восстановить WebSocket
            if (!this.isConnected && !this.isReconnecting) {
                this.attemptReconnect();
            }
        });

        window.addEventListener('offline', () => {
            console.log('🌐 Интернет соединение потеряно');
            this.isConnected = false;
            this.updateStatus('❌ Нет интернета', 'offline');
            // Принудительно отправляем connection_lost
            this.forceSendConnectionLost('network_offline');
        });

        // Обработка beforeunload для корректного завершения
        window.addEventListener('beforeunload', () => {
            console.log('📱 Страница закрывается (beforeunload)');
            this.sendConnectionStatus('app_closed', 'page_unload');
            this.handlePageUnload();
        });

        // Периодическая проверка соединения каждые 30 секунд
        setInterval(() => {
            const wasConnected = this.isConnected;
            const isNowConnected = this.ws && this.ws.readyState === WebSocket.OPEN;
            const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;

            // Дополнительная проверка по heartbeat (если прошло больше 60 секунд)
            const heartbeatTimeout = timeSinceLastHeartbeat > 60000; // 60 секунд

            if (wasConnected && (!isNowConnected || heartbeatTimeout)) {
                // Соединение только что потеряно
                console.log(`🔌 Обнаружена потеря соединения при периодической проверке (${heartbeatTimeout ? 'heartbeat timeout' : 'connection check'})`);
                this.isConnected = false;
                this.updateStatus('❌ Соединение потеряно', 'offline');
                // Отправляем connection_lost через HTTP с дополнительными попытками
                this.forceSendConnectionLost(heartbeatTimeout ? 'heartbeat_timeout' : 'connection_check_failed');
                this.log('🔌 Соединение потеряно (обнаружено проверкой)', 'error');
            }

            if (!isNowConnected || heartbeatTimeout) {
                console.log(`🔄 Периодическая проверка: соединение все еще потеряно (страница ${this.pageVisible ? 'видима' : 'свернута'})`);
                if (!this.isReconnecting) {
                    this.attemptReconnect();
                }
            }
        }, 30 * 1000);

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
                    return;
                }
            }).catch(error => {
                console.log('📱 Error checking installed apps:', error);
            });
        }

        // Дополнительная проверка - пробуем вызвать prompt вручную
        setTimeout(() => {
            if (!this.deferredPrompt) {
                console.log('📱 No deferredPrompt found, checking alternative installation methods');

                // Проверяем, есть ли window.install (некоторые браузеры)
                if ('install' in window) {
                    console.log('📱 window.install available');
                    this.showInstallButton();
                } else {
                    console.log('📱 No alternative installation methods found');
                }
            }
        }, 2000);

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
            logs: document.getElementById('logs'),
            loadingScreen: document.getElementById('loadingScreen')
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

        // Скрыть loading screen после небольшой задержки
        setTimeout(() => {
            this.hideLoadingScreen();
        }, 500);
    }

    // Скрытие loading screen
    hideLoadingScreen() {
        if (this.elements.loadingScreen) {
            this.elements.loadingScreen.classList.add('hidden');
            setTimeout(() => {
                this.elements.loadingScreen.style.display = 'none';
            }, 300); // Время анимации
        }
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
                const wasDisconnected = !this.isConnected;
                console.log('✅ WebSocket opened successfully');
                this.isConnected = true;
                this.isReconnecting = false;
                this.reconnectAttempts = 0; // Сброс счетчика при успешном подключении
                this.updateStatus('✅ Подключено', 'online');
                this.log('🔌 WebSocket подключён', 'success');

                // connection_restored будет отправлен в welcome сообщении

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
            };

            this.ws.onmessage = (event) => {
                this.lastHeartbeat = Date.now(); // Обновляем время последнего heartbeat
                this.handleMessage(JSON.parse(event.data));
            };

            this.ws.onclose = (event) => {
                console.log('🔌 WebSocket closed:', event.code, event.reason);
                this.isConnected = false;
                this.updateStatus('❌ Отключено', 'offline');
                this.log('🔌 WebSocket отключён', 'error');

                // Сбрасываем флаг переподключения при разрыве
                this.isReconnecting = false;

                // Принудительно отправляем статус потери соединения
                this.forceSendConnectionLost(`websocket_closed_code_${event.code}`);

                // Переподключение при любом разрыве (кроме нормального закрытия)
                if (event.code !== 1000) {
                    console.log(`🔄 Переподключение через ${this.settings.reconnectInterval}ms (страница ${this.pageVisible ? 'видима' : 'свернута'})...`);
                    this.scheduleReconnect();
                } else {
                    console.log('✅ Нормальное отключение - переподключение не требуется');
                }
            };

            this.ws.onerror = (error) => {
                console.log('❌ WebSocket error:', error);
                this.log(`❌ WebSocket ошибка: ${error}`, 'error');
                this.isConnected = false;
                this.isReconnecting = false; // Сбрасываем флаг
                this.updateStatus('❌ Ошибка соединения', 'offline');
                // Принудительно отправить connection_lost
                this.forceSendConnectionLost('websocket_error');
            };

        } catch (error) {
            this.log(`❌ Ошибка подключения: ${error.message}`, 'error');
            this.updateStatus('❌ Ошибка подключения', 'offline');
        } finally {
            // Всегда сбрасываем флаг переподключения
            this.isReconnecting = false;
        }
    }

    disconnect() {
        // Отправить статус отключения перед закрытием
        this.sendConnectionStatus('connection_lost', 'manual_disconnect');

        // Очистить таймауты переподключения
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        if (this.ws) {
            this.ws.close(1000, 'Manual disconnect');
            this.ws = null;
        }
        this.isConnected = false;
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.updateStatus('Отключено', 'offline');
        this.log('🔌 Отключено вручную', 'info');
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

        // Хранение логов в массиве с timestamp
        if (!this.logs) this.logs = [];
        this.logs.push({
            message: message,
            type: type,
            timestamp: Date.now()
        });

        // Ограничение количества логов - последние 200 записей
        if (this.logs.length > 200) {
            this.logs = this.logs.slice(-200); // Оставляем последние 200
        }

        // Ограничение отображения в UI
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
            backgroundSync: false, // Проверяем безопасно
            periodicSync: false, // Проверяем безопасно
            wakeLock: 'wakeLock' in navigator,
            notifications: 'Notification' in window,
            push: 'PushManager' in window
        };

        // Безопасная проверка ServiceWorkerRegistration
        try {
            if ('serviceWorker' in navigator && navigator.serviceWorker) {
                navigator.serviceWorker.ready.then(registration => {
                    features.backgroundSync = 'sync' in registration;
                    features.periodicSync = 'periodicSync' in registration;
                }).catch(() => {
                    // Игнорируем ошибки
                });
            }
        } catch (error) {
            console.warn('⚠️ Error checking ServiceWorker features:', error);
        }

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

    // Обработка восстановления страницы
    handlePageRestore() {
        console.log('🔄 Восстановление страницы - проверка соединения...');

        // Проверить WebSocket соединение
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.log('🔄 WebSocket не подключен, переподключаемся...');
            this.attemptReconnect();
        } else {
            console.log('✅ WebSocket соединение активно');
        }

        // Скрыть loading screen при восстановлении
        this.hideLoadingScreen();

        // Восстановить UI состояние
        this.updateStatus('Восстановлено', 'online');
        this.log('📱 Приложение восстановлено', 'success');
    }

    // Обработка скрытия страницы
    handlePageHide() {
        console.log('💤 Страница скрыта - оптимизация ресурсов');

        // Можно приостановить некоторые процессы, но не закрывать соединение
        // WebSocket останется активным для background sync
    }

    // Обработка скрытия видимости
    handleVisibilityHidden() {
        console.log('👁️ Страница невидима - фоновый режим');
        this.pageVisible = false;

        // Отправляем статус в фоне
        this.sendConnectionStatus('app_background', 'visibility_hidden');

        // Приложение в фоне - можно приостановить некоторые активности
        // WebSocket остается активным для получения команд сервера
    }

    // Обработка восстановления видимости
    handleVisibilityVisible() {
        console.log('👁️ Страница видима - активный режим');
        this.pageVisible = true;
        // Отправляем статус восстановления
        this.sendConnectionStatus('app_foreground', 'visibility_visible');


        // Всегда проверять соединение при возвращении в foreground
        console.log('🔄 Проверка соединения при возвращении в foreground...');
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.log('🔄 Соединение потеряно при возвращении в foreground, восстанавливаем...');
            this.reconnectAttempts = 0; // Сбросить счетчик попыток
            this.attemptReconnect();
        } else {
            console.log('✅ Соединение активно при возвращении в foreground');
            // Отправить статус что мы снова активны
            this.sendConnectionStatus('app_foreground', 'visibility_restored');
        }
    }

    // Обработка закрытия страницы
    handlePageUnload() {
        console.log('🚪 Страница закрывается - корректное завершение');

        // Очистить таймауты
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        // Корректно закрыть соединения
        if (this.ws) {
            this.ws.close(1000, 'Page unloading');
        }

        // Освободить ресурсы
        if (this.wakeLock) {
            this.releaseWakeLock();
        }
    }

    // Планирование переподключения с градацией
    scheduleReconnect() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }

        let delay;
        if (this.reconnectAttempts < 10) {
            // Первые 10 попыток: каждые 30 секунд
            delay = 30000;
        } else {
            // Следующие 10 попыток: каждые 30 минут
            delay = 30 * 60 * 1000; // 30 минут
        }

        console.log(`⏰ Переподключение запланировано через ${Math.round(delay/1000)} сек (попытка ${this.reconnectAttempts + 1}/${this.settings.maxReconnectAttempts})`);

        this.reconnectTimeout = setTimeout(() => {
            this.attemptReconnect();
        }, delay);
    }

    // Попытка переподключения с улучшенной логикой
    attemptReconnect() {
        if (this.isReconnecting) {
            console.log('🔄 Переподключение уже выполняется');
            return;
        }

        if (this.reconnectAttempts >= this.settings.maxReconnectAttempts) {
            console.log('❌ Превышено максимальное количество попыток переподключения');
            this.log('❌ Не удалось подключиться после нескольких попыток', 'error');
            return;
        }

        this.isReconnecting = true;
        this.reconnectAttempts++;

        console.log(`🔄 Попытка переподключения ${this.reconnectAttempts}/${this.settings.maxReconnectAttempts}...`);

        if (this.accessToken) {
            this.connect();
        } else {
            console.log('⚠️ Нет токена для переподключения');
            this.isReconnecting = false;
        }
    }

    // Принудительная отправка connection_lost с повторными попытками
    async forceSendConnectionLost(reason) {
        console.log(`🚨 FORCE SEND CONNECTION_LOST: ${reason}`);
        const maxAttempts = 3;
        const delay = 1000; // 1 секунда между попытками

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                console.log(`🔄 Попытка ${attempt}/${maxAttempts} отправки connection_lost: ${reason}`);

                const statusMessage = {
                    type: 'connection_lost',
                    deviceId: this.deviceId || 'unknown',
                    token: this.accessToken || 'unknown',
                    timestamp: Date.now(),
                    reason: reason,
                    userAgent: navigator.userAgent,
                    url: window.location.href,
                    attempt: attempt
                };

                const response = await fetch(`https://befiebubopal.beget.app/api/connection-status`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(statusMessage),
                    // Таймаут 5 секунд
                    signal: AbortSignal.timeout(5000)
                });

                if (response.ok) {
                    console.log(`✅ connection_lost отправлен успешно на попытке ${attempt}`);
                    return; // Успешно отправили, выходим
                } else {
                    console.log(`❌ Попытка ${attempt} - HTTP ${response.status}`);
                }
            } catch (error) {
                console.log(`❌ Попытка ${attempt} - ошибка:`, error.message);
            }

            // Ждем перед следующей попыткой (кроме последней)
            if (attempt < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        console.log('❌ Все попытки отправки connection_lost провалились');
    }

    // Отправка статуса соединения на сервер
    async sendConnectionStatus(type, reason = '') {
        if (!this.accessToken || !this.deviceId) {
            console.log('⚠️ Нет данных для отправки статуса');
            return;
        }

        const statusMessage = {
            type: type,
            deviceId: this.deviceId,
            token: this.accessToken,
            timestamp: Date.now(),
            reason: reason,
            userAgent: navigator.userAgent,
            url: window.location.href
        };

        console.log('📡 Отправка статуса:', type, reason);

        // Для connection_lost используем принудительную отправку
        if (type === 'connection_lost') {
            await this.forceSendConnectionLost(reason);
        } else {
            // Для остальных статусов используем WebSocket
            this.send(statusMessage);
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
            } else             if (isAndroid) {
                if (isChrome) {
                    instructions += '• Нажмите "⋮" (три точки) в правом верхнем углу\n';
                    instructions += '• Выберите "Добавить на главный экран"\n';
                    instructions += '• В диалоговом окне нажмите "Добавить"\n';
                    instructions += '• Готово! Иконка появится на рабочем столе';
                } else if (isFirefox) {
                    instructions += '• Нажмите "⋮" (три точки)\n';
                    instructions += '• Выберите "Установить это приложение"\n';
                    instructions += '• Подтвердите установку';
                } else if (isOpera) {
                    instructions += '• Нажмите значок Opera (красный "O")\n';
                    instructions += '• Выберите "Добавить на главный экран"\n';
                    instructions += '• Или: ⋮ меню → "Добавить на главный экран"';
                } else {
                    // Samsung Internet, другие браузеры
                    const isSamsung = /SamsungBrowser/.test(navigator.userAgent);
                    if (isSamsung) {
                        instructions += '• Нажмите ⋮ меню\n';
                        instructions += '• Выберите "Добавить страницу на"\n';
                        instructions += '• Выберите "Главный экран"';
                    } else {
                        instructions += '• Откройте меню браузера (⋮)\n';
                        instructions += '• Найдите "Добавить на главный экран"\n';
                        instructions += '• Или "Установить приложение"';
                    }
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
