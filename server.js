const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createRoomManager } = require('./src/roomManager');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const manager = createRoomManager(io);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: manager.roomCount() });
});

io.on('connection', (socket) => {
  socket.emit('server:hello', { socketId: socket.id });

  socket.on('room:create', (_payload, cb) => {
    try {
      const result = manager.createRoom(socket);
      cb?.({ ok: true, ...result });
    } catch (error) {
      cb?.({ ok: false, error: error.message });
    }
  });

  socket.on('room:join', ({ roomId }, cb) => {
    try {
      const result = manager.joinRoom(socket, roomId);
      cb?.({ ok: true, ...result });
    } catch (error) {
      cb?.({ ok: false, error: error.message });
    }
  });

  socket.on('room:leave', (_payload, cb) => {
    manager.leaveCurrentRoom(socket.id, true);
    cb?.({ ok: true });
  });

  socket.on('player:ready', ({ ready }, cb) => {
    try {
      manager.setReady(socket.id, !!ready);
      cb?.({ ok: true });
    } catch (error) {
      cb?.({ ok: false, error: error.message });
    }
  });

  socket.on('player:input', (payload) => {
    manager.applyInput(socket.id, payload || {});
  });

  socket.on('match:restart', (_payload, cb) => {
    try {
      manager.restartMatch(socket.id);
      cb?.({ ok: true });
    } catch (error) {
      cb?.({ ok: false, error: error.message });
    }
  });

  socket.on('disconnect', () => {
    manager.handleDisconnect(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Wild Ball Duel Online server listening on http://localhost:${PORT}`);
});
