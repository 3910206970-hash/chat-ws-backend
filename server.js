const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// 读取平台分配端口，关键！不能固定8080
const PORT = process.env.PORT || 8080;
const server = http.createServer();

// HTTP服务：访问根路径直接返回前端index.html
server.on('request', (req, res) => {
    // 健康检测接口 /ping
    if (req.url === '/ping') {
        res.writeHead(200);
        res.end('pong');
        return;
    }
    // 返回聊天室页面
    if (req.url === '/' || req.url.startsWith('/?room=')) {
        const htmlPath = path.join(__dirname, 'index.html');
        fs.readFile(htmlPath, (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('html not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
            res.end(data);
        });
        return;
    }
    res.writeHead(404);
    res.end();
});

// WebSocket挂载
const wss = new WebSocket.Server({ noServer: true });
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

// 房间内存容器
const rooms = {};
function broadcast(roomId, data, excludeWs = null) {
    const room = rooms[roomId];
    if (!room) return;
    room.users.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

wss.on('connection', (ws) => {
    let currentRoomId = null;
    let userName = null;

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            switch (msg.action) {
                case 'join':
                    currentRoomId = msg.roomId;
                    userName = msg.nick;
                    if (!rooms[currentRoomId]) {
                        rooms[currentRoomId] = { users: new Set(), messages: [] };
                    }
                    const room = rooms[currentRoomId];
                    room.users.add(ws);
                    ws.send(JSON.stringify({ type: 'history', list: room.messages }));
                    const joinSysMsg = { type: 'system', text: `${userName} 进入房间` };
                    room.messages.push(joinSysMsg);
                    broadcast(currentRoomId, joinSysMsg);
                    break;
                case 'chat':
                    const chatMsg = {
                        type: 'chat',
                        name: userName,
                        text: msg.text,
                        time: new Date().toLocaleTimeString()
                    };
                    const targetRoom = rooms[currentRoomId];
                    targetRoom.messages.push(chatMsg);
                    broadcast(currentRoomId, chatMsg);
                    break;
            }
        } catch (e) {
            console.error("消息解析异常", e);
        }
    });

    ws.on('close', () => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        room.users.delete(ws);
        if (userName) {
            const leaveMsg = { type: 'system', text: `${userName} 离开房间` };
            room.messages.push(leaveMsg);
            broadcast(currentRoomId, leaveMsg);
        }
        if (room.users.size === 0) {
            delete rooms[currentRoomId];
        }
    });
});

server.listen(PORT, () => {
    console.log(`服务启动，端口:${PORT}`);
});
