const http = require('http');
const WebSocket = require('ws');

const server = http.createServer();
const PORT = process.env.PORT || 8080;

// HTTP健康检测接口 /ping 用于保活，防止Render误杀
server.on('request', (req, res) => {
    if (req.url === '/ping') {
        res.writeHead(200);
        res.end('pong');
        return;
    }
    res.writeHead(404);
    res.end();
});

// WebSocket服务挂载至http服务
const wss = new WebSocket.Server({ noServer: true });
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

// 房间容器 roomId -> {users:连接集合, messages:消息数组}
const rooms = {};

// 同房间广播
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
                    // 下发历史消息
                    ws.send(JSON.stringify({ type: 'history', list: room.messages }));
                    // 系统通知
                    const joinSysMsg = {
                        type: 'system',
                        text: `${userName} 进入房间`
                    };
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
            const leaveMsg = {
                type: 'system',
                text: `${userName} 离开房间`
            };
            room.messages.push(leaveMsg);
            broadcast(currentRoomId, leaveMsg);
        }
        // 房间无人，直接销毁所有数据
        if (room.users.size === 0) {
            delete rooms[currentRoomId];
        }
    });
});

server.listen(PORT, () => {
    console.log(`服务启动，端口:${PORT}`);
});