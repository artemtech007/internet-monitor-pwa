# 🌐 Internet Monitor WebSocket Server

Сервер для мониторинга скорости интернета с WebSocket поддержкой. Предназначен для работы с PWA клиентом.

## 🚀 Быстрый старт

### Требования
- Node.js 18+ (рекомендуется 20+)
- PM2 (для продакшена)
- Nginx (для SSL прокси)

### Установка

1. **Клонируйте репозиторий:**
```bash
git clone <repository-url>
cd internet-monitor-websocket
```

2. **Установите зависимости:**
```bash
npm install
```

3. **Запустите сервер:**
```bash
# Для разработки
npm start

# Для продакшена с PM2
pm2 start server.js --name "internet-monitor-ws"
pm2 save
pm2 startup
```

## ⚙️ Конфигурация

### Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `PORT` | HTTP порт сервера | `8080` |
| `WS_PORT` | WebSocket порт | `8081` |
| `N8N_WEBHOOK_URL` | URL для отправки результатов | `https://botstroikom.store/webhook/ph1` |

### Допустимые токены

Токены устройств настраиваются в коде:
```javascript
const VALID_TOKENS = [
    'PHONE001',
    'PHONE002',
    'PHONE003',
    'TEST123' // Для тестирования
];
```

## 🔧 Настройка сервера

### 1. Установка Node.js

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# CentOS/RHEL
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs
```

### 2. Установка PM2

```bash
sudo npm install -g pm2
```

### 3. Настройка автозапуска

```bash
pm2 startup
# Следуйте инструкциям PM2
pm2 save
```

### 4. Настройка Nginx (рекомендуется)

Создайте конфигурацию `/etc/nginx/sites-available/internet-monitor`:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # WebSocket proxy
    location /ws {
        proxy_pass http://localhost:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_buffering off;
        proxy_request_buffering off;
    }

    # HTTP API proxy
    location /api {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

Включите сайт:
```bash
sudo ln -s /etc/nginx/sites-available/internet-monitor /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5. SSL сертификат

```bash
# Установка certbot
sudo apt install certbot python3-certbot-nginx

# Получение сертификата
sudo certbot --nginx -d your-domain.com

# Автопродление
sudo crontab -e
# Добавить: 0 12 * * * /usr/bin/certbot renew --quiet
```

## 📡 API Endpoints

### WebSocket сообщения

#### От клиента к серверу:
- `auth` - Аутентификация устройства
- `device_info` - Информация об устройстве
- `ping_result` - Результаты ping теста
- `speed_result` - Результаты speed теста

#### От сервера к клиенту:
- `auth_success` - Успешная аутентификация
- `speed_test_request` - Запрос на speed тест
- `error` - Ошибка

### HTTP API

- `GET /api/devices` - Список подключенных устройств
- `POST /api/broadcast` - Отправка команд всем устройствам

## 📊 Мониторинг

### PM2 команды

```bash
pm2 list                    # Список процессов
pm2 logs internet-monitor-ws # Просмотр логов
pm2 restart internet-monitor-ws # Перезапуск
pm2 stop internet-monitor-ws    # Остановка
```

### Логи

Логи хранятся в:
- `/root/.pm2/logs/internet-monitor-ws-out.log`
- `/root/.pm2/logs/internet-monitor-ws-error.log`

## 🔍 Диагностика

### Проверка работы

```bash
# Проверка HTTP API
curl http://localhost:8080/api/devices

# Проверка WebSocket
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8081');
ws.on('open', () => console.log('✅ WS connected'));
ws.on('error', (e) => console.log('❌ WS error:', e.message));
"
```

### Распространенные проблемы

1. **Port already in use**
   - Проверьте: `netstat -tlnp | grep :8080`
   - Остановите конфликтный процесс

2. **SSL certificate issues**
   - Проверьте пути к сертификатам в nginx
   - Перезапустите nginx: `sudo systemctl reload nginx`

3. **WebSocket connection fails**
   - Проверьте firewall: `sudo ufw status`
   - Проверьте nginx конфигурацию

## 🚀 Развертывание

### На VPS (рекомендуемый способ)

1. Настройте SSH доступ
2. Установите Node.js и PM2
3. Настройте Nginx с SSL
4. Скопируйте файлы проекта
5. Запустите через PM2

### Docker (альтернативный способ)

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
EXPOSE 8080 8081

CMD ["pm2-runtime", "server.js", "--name", "internet-monitor-ws"]
```

## 📞 Поддержка

При проблемах проверьте:
1. Логи сервера: `pm2 logs internet-monitor-ws`
2. Статус процессов: `pm2 list`
3. Сетевые подключения: `netstat -tlnp`
4. Nginx статус: `sudo systemctl status nginx`
