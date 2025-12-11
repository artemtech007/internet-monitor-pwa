/**
 * Service Worker для Internet Monitor PWA
 * Обеспечивает работу в фоне и push-уведомления
 */

const CACHE_NAME = 'internet-monitor-v1';
const STATIC_CACHE = 'internet-monitor-static-v1';

// Файлы для кэширования
const STATIC_FILES = [
    '/',
    '/index.html',
    '/app.js',
    '/manifest.json'
];

// Установка Service Worker
self.addEventListener('install', event => {
    console.log('🔧 Service Worker: установка');

    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => {
                console.log('📦 Кэширование статических файлов');
                // Кэшируем файлы по одному с обработкой ошибок
                return Promise.allSettled(
                    STATIC_FILES.map(url =>
                        cache.add(url).catch(error => {
                            console.warn(`⚠️ Не удалось закэшировать: ${url}`, error);
                            return null; // Продолжаем без этого файла
                        })
                    )
                );
            })
            .then(() => {
                return self.skipWaiting();
            })
            .catch(error => {
                console.warn('⚠️ Ошибка кэширования при установке:', error);
                return self.skipWaiting(); // Продолжаем установку
            })
    );
});

// Активация Service Worker
self.addEventListener('activate', event => {
    console.log('🚀 Service Worker: активация');

    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== STATIC_CACHE && cacheName !== CACHE_NAME) {
                        console.log('🗑️ Удаление старого кэша:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            return self.clients.claim();
        })
    );
});

// Обработка fetch запросов
self.addEventListener('fetch', event => {
    // Кэширование стратегия: Network First для динамического контента
    if (event.request.url.includes('/api/') ||
        event.request.url.includes('/ws') ||
        event.request.url.includes('speed-test')) {
        // Network First для API запросов
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Кэшируем успешные ответы
                    if (response.status === 200) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => cache.put(event.request, responseClone));
                    }
                    return response;
                })
                .catch(() => {
                    // Fallback к кэшу при ошибке сети
                    return caches.match(event.request);
                })
        );
    } else {
        // Cache First для статических файлов
        event.respondWith(
            caches.match(event.request)
                .then(response => {
                    return response || fetch(event.request);
                })
        );
    }
});

// Обработка push уведомлений (для будущего использования)
self.addEventListener('push', event => {
    console.log('📨 Push уведомление получено');

    if (event.data) {
        const data = event.data.json();

        const options = {
            body: data.message || 'Проверка интернета',
            icon: '/icon-192x192.png',
            badge: '/icon-192x192.png',
            vibrate: [100, 50, 100],
            data: data,
            actions: [
                {
                    action: 'test',
                    title: 'Запустить тест'
                },
                {
                    action: 'view',
                    title: 'Посмотреть'
                }
            ]
        };

        event.waitUntil(
            self.registration.showNotification(
                data.title || 'Internet Monitor',
                options
            )
        );
    }
});

// Обработка кликов по уведомлениям
self.addEventListener('notificationclick', event => {
    console.log('🔔 Клик по уведомлению');

    event.notification.close();

    if (event.action === 'test') {
        // Запуск теста
        event.waitUntil(
            clients.openWindow('/?action=test')
        );
    } else {
        // Открытие приложения
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});

// Обработка сообщений от основного потока
self.addEventListener('message', event => {
    console.log('💬 Сообщение от клиента:', event.data);

    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Периодическая синхронизация (background sync)
self.addEventListener('sync', event => {
    console.log('🔄 Background sync:', event.tag);

    if (event.tag === 'internet-test') {
        event.waitUntil(doBackgroundTest());
    }
});

async function doBackgroundTest() {
    // Фоновая проверка интернета
    try {
        const response = await fetch('/api/ping');
        if (response.ok) {
            // Отправка уведомления
            await self.registration.showNotification(
                'Internet Monitor',
                {
                    body: 'Фоновая проверка выполнена',
                    icon: '/icon-192x192.png'
                }
            );
        }
    } catch (error) {
        console.error('Background test failed:', error);
    }
}

// Обработка ошибок
self.addEventListener('error', event => {
    console.error('❌ Service Worker error:', event.error);
});

self.addEventListener('unhandledrejection', event => {
    console.error('❌ Unhandled rejection:', event.reason);
});
