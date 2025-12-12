# 🚀 Полное руководство по установке Internet Monitor

## 📋 Обзор системы

**Internet Monitor** - это полноценная система мониторинга скорости интернета с:
- PWA приложением на телефоне
- WebSocket сервером на VPS
- Интеграцией с N8N для обработки данных

## 🎯 Быстрый старт (для существующих пользователей)

Если система уже настроена, вот что нужно сделать:

### 1. Установка PWA на телефон
```bash
# Откройте в Chrome на Android:
https://artemtech007.github.io/internet-monitor-pwa/

# Подключитесь с токеном: PHONE001
# Нажмите "📱 Установить PWA"
# Следуйте инструкциям по установке
```

### 2. Проверка работы
- Иконка появится на рабочем столе
- Приложение работает автономно
- Автоматические тесты каждые 30 минут

## 🛠️ Полная установка системы (с нуля)

### Шаг 1: Настройка сервера WebSocket

#### VPS Требования:
- Ubuntu 22.04
- Минимум 1GB RAM
- Публичный IP

#### Автоматическая установка:
```bash
# Скачайте скрипт установки
wget https://raw.githubusercontent.com/artemtech007/internet-monitor-pwa/main/setup_server.sh

# Сделайте исполняемым
chmod +x setup_server.sh

# Запустите установку (требует sudo)
sudo ./setup_server.sh
```

#### Ручная установка:
```bash
# 1. Обновите систему
sudo apt update && sudo apt upgrade -y

# 2. Установите Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Установите PM2
sudo npm install -g pm2

# 4. Клонируйте репозиторий
git clone https://github.com/artemtech007/internet-monitor-pwa.git
cd internet-monitor-pwa/server_websocket

# 5. Установите зависимости
npm install

# 6. Настройте переменные окружения
nano .env
# PORT=8080
# WS_PORT=8081
# N8N_WEBHOOK_URL=https://your-n8n-webhook.com/webhook/id

# 7. Запустите сервер
npm start

# 8. Настройте автозапуск
pm2 startup
pm2 save
```

### Шаг 2: Настройка домена и SSL

#### С помощью Nginx + Certbot:
```bash
# 1. Установите Nginx
sudo apt install nginx certbot python3-certbot-nginx

# 2. Настройте Nginx конфиг
sudo nano /etc/nginx/sites-available/internet-monitor

# Добавьте:
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /ws {
        proxy_pass http://localhost:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# 3. Активируйте сайт
sudo ln -s /etc/nginx/sites-available/internet-monitor /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# 4. Получите SSL сертификат
sudo certbot --nginx -d your-domain.com
```

### Шаг 3: Настройка N8N интеграции

#### Создайте webhook в N8N:
1. **Создайте новый workflow**
2. **Добавьте Webhook trigger**
   - Method: GET
   - Path: `/webhook/ph1`
3. **Добавьте Function node для обработки:**
```javascript
// Обработка данных от Internet Monitor
const query = $node["Webhook"].query;

// Преобразование данных
return {
  speed_mbps: parseFloat(query.speedMbps),
  device_id: query.deviceId,
  token: query.token,
  timestamp: new Date(parseInt(query.timestamp) * 1000),
  bytes_sent: parseInt(query.bytesSent),
  bytes_received: parseInt(query.bytesReceived),
  duration_ms: parseInt(query.duration),
  success: query.success === 'true'
};
```

### Шаг 4: Установка PWA на устройства

#### Для Android (Chrome) - РЕКОМЕНДУЕТСЯ:
```bash
# 1. Откройте приложение
https://artemtech007.github.io/internet-monitor-pwa/

# 2. Подключитесь
# Токен: PHONE001 (или PHONE002, PHONE003)

# 3. Установите PWA
# Нажмите "📱 Установить PWA"
# Следуйте инструкциям:
# ⋮ → "Добавить на главный экран" → "Добавить"
```

#### Для других браузеров:
- **Firefox:** Работает как веб-приложение (без PWA установки)
- **Safari (iOS):** Требуется тестирование
- **Chrome инкогнито:** НЕ ИСПОЛЬЗОВАТЬ (вызывает падение)

## 🔧 Диагностика и устранение проблем

### Проверка статуса сервера:
```bash
# Статус PM2 процессов
ssh root@your-server 'pm2 list'

# Логи сервера
ssh root@your-server 'pm2 logs internet-monitor-ws --lines 10'

# Проверка портов
ssh root@your-server 'netstat -tlnp | grep :808'
```

### Проверка PWA:
```javascript
// В консоли браузера на телефоне:
console.log('Service Worker:', !!navigator.serviceWorker);
console.log('WebSocket:', !!window.WebSocket);
console.log('Background Sync:', 'sync' in window.ServiceWorkerRegistration.prototype);
```

### Проверка N8N интеграции:
```bash
# Ручной тест webhook
curl -X GET "https://your-n8n-domain.com/webhook/ph1?test=manual&speedMbps=15.5&deviceId=test"
```

## 📊 Мониторинг работы

### Автоматические тесты:
- **Каждые 30 минут** сервер отправляет команды на тесты
- **Результаты** автоматически отправляются в N8N
- **Логи** доступны через PM2

### Ручные тесты:
- В PWA нажать "⚡ Тест скорости"
- Результаты отображаются в интерфейсе
- Данные отправляются в N8N

## 🔐 Безопасность

### Рекомендации:
- **Регулярно обновляйте** SSL сертификаты
- **Используйте сильные токены** для устройств
- **Ограничьте доступ** к серверу по IP
- **Мониторьте логи** на подозрительную активность

### Переменные окружения:
```bash
# В .env файле сервера
NODE_ENV=production
PORT=8080
WS_PORT=8081
N8N_WEBHOOK_URL=https://your-n8n-webhook.com/webhook/id
VALID_TOKENS=PHONE001,PHONE002,PHONE003
```

## 🎯 Итоговый чек-лист

- [x] **Сервер запущен** (PM2 автозапуск)
- [x] **SSL настроен** (Let's Encrypt)
- [x] **N8N webhook активен**
- [x] **PWA установлено** на Android
- [x] **Тесты скорости работают**
- [x] **Данные поступают в N8N**

## 📞 Поддержка

### При проблемах:
1. **Проверьте логи** сервера: `pm2 logs`
2. **Очистите кэш** браузера
3. **Переустановите PWA**
4. **Проверьте webhook** в N8N

### Документация:
- [PWA Установка](pwa_installation.md)
- [Настройка сервера](server_setup_guide.md)
- [Анализ ошибок](javascript_error_analysis.md)

---

**🎉 Система готова к работе!**
