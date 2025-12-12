#!/bin/bash

# Configuration
SERVER_IP="155.212.220.59"
REMOTE_DIR="/root/internet-monitor-websocket"
LOCAL_SERVER_FILE="server_websocket/server.js"

echo "🚀 Starting deployment to $SERVER_IP..."

# 1. Upload server.js
echo "📦 Uploading server.js..."
scp $LOCAL_SERVER_FILE root@$SERVER_IP:$REMOTE_DIR/server.js

if [ $? -eq 0 ]; then
    echo "✅ File uploaded successfully."
    
    # 2. Restart PM2 process
    echo "🔄 Restarting server process..."
    ssh root@$SERVER_IP "pm2 restart internet-monitor-ws"
    
    echo "🎉 Deployment complete! Server restarted."
    echo "   View logs: ssh root@$SERVER_IP 'pm2 logs internet-monitor-ws --lines 20'"
else
    echo "❌ Upload failed. Please check your SSH connection."
fi

