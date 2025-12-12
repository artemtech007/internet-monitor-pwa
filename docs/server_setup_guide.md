# 🚀 Настройка сервера Internet Monitor

## Быстрая настройка на новом VPS

### 1. Подготовка сервера

```bash
# Обновление системы
sudo apt update && sudo apt upgrade -y

# Установка Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Установка PM2
sudo npm install -g pm2

# Установка Nginx и SSL
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 2. Настройка проекта

```bash
# Создание директории
mkdir -p ~/internet-monitor
cd ~/internet-monitor

# Копирование файлов (замените на ваш способ)
# Например, через git clone или scp

# Установка зависимостей
npm install
```

### 3. Настройка SSL сертификата

```bash
# Получение сертификата (замените yourdomain.com)
sudo systemctl stop nginx
sudo certbot certonly --standalone -d yourdomain.com --email your@email.com --agree-tos
sudo systemctl start nginx
```

### 4. Настройка Nginx

Создайте файл `/etc/nginx/sites-available/internet-monitor`:

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # WebSocket прокси
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
        proxy_buffering off;
    }

    # API прокси
    location /api {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Редирект на PWA
    location / {
        return 302 https://username.github.io/internet-monitor-pwa/;
    }
}

server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

Включение сайта:
```bash
sudo ln -s /etc/nginx/sites-available/internet-monitor /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5. Запуск сервера

```bash
# Запуск через PM2
cd ~/internet-monitor
pm2 start server.js --name "internet-monitor-ws"

# Настройка автозапуска
pm2 save
pm2 startup

# Проверка статуса
pm2 list
pm2 logs internet-monitor-ws
```

### 6. Настройка PWA

В файле `pwa/app.js` обновите URL сервера:
```javascript
serverUrl: 'wss://yourdomain.com/ws'
```

Загрузите обновленные файлы на GitHub Pages.

## 🔍 Проверка работы

### Тест WebSocket
```bash
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('wss://yourdomain.com/ws');
ws.on('open', () => console.log('✅ Подключено'));
ws.on('error', (e) => console.log('❌ Ошибка:', e.message));
"
```

### Тест API
```bash
curl https://yourdomain.com/api/devices
```

## 🛠️ Диагностика проблем

### Сервер не запускается
```bash
# Проверить порты
netstat -tlnp | grep -E ":(8080|8081)"

# Проверить логи
pm2 logs internet-monitor-ws

# Проверить Node.js
node --version
npm --version
```

### WebSocket не работает
```bash
# Проверить Nginx
sudo systemctl status nginx
sudo nginx -t

# Проверить логи Nginx
sudo tail -f /var/log/nginx/error.log

# Проверить SSL
openssl s_client -connect yourdomain.com:443 -servername yourdomain.com
```

### PWA не подключается
```bash
# Проверить URL в app.js
grep "serverUrl" internet-monitor/pwa/app.js

# Проверить GitHub Pages
curl https://username.github.io/internet-monitor-pwa/app.js
```

## 📊 Мониторинг

### Просмотр подключенных устройств
```bash
curl https://yourdomain.com/api/devices
```

### Логи сервера
```bash
pm2 logs internet-monitor-ws
tail -f /var/log/nginx/access.log
```

### Ресурсы системы
```bash
htop
df -h
free -h
```

## 🔄 Обновление

```bash
# Остановка сервера
pm2 stop internet-monitor-ws

# Обновление кода
git pull

# Перезапуск
pm2 restart internet-monitor-ws
```

## 🚨 Аварийные ситуации

### Сервер не отвечает
```bash
# Перезапуск сервисов
sudo systemctl restart nginx
pm2 restart all

# Проверка дискового пространства
df -h
```

### Высокая нагрузка
```bash
# Проверить процессы
pm2 monit

# Ограничить ресурсы
pm2 scale internet-monitor-ws 1
```

## 📞 Поддержка

При возникновении проблем:
1. Проверьте логи: `pm2 logs internet-monitor-ws`
2. Проверьте статус: `pm2 list`
3. Проверьте сеть: `curl -I https://yourdomain.com/api/devices`
4. Создайте issue в репозитории с логами
