const { nanoid } = require('nanoid');
const { GameRoom } = require('./gameRoom');

function createRoomId() {
  return nanoid(6).toUpperCase().replace(/[_-]/g, 'X');
}

function createRoomManager(io) {
  const rooms = new Map();
  const playerToRoom = new Map();

  function roomCount() {
    return rooms.size;
  }

  function getRoomByPlayer(socketId) {
    const roomId = playerToRoom.get(socketId);
    return roomId ? rooms.get(roomId) : null;
  }

  function createRoom(socket) {
    leaveCurrentRoom(socket.id, false);
    let roomId = createRoomId();
    while (rooms.has(roomId)) roomId = createRoomId();
    const room = new GameRoom(io, roomId);
    rooms.set(roomId, room);
    room.addPlayer(socket, 'left');
    playerToRoom.set(socket.id, roomId);
    return { roomId, side: 'left' };
  }

  function joinRoom(socket, roomIdRaw) {
    leaveCurrentRoom(socket.id, false);
    const roomId = String(roomIdRaw || '').trim().toUpperCase();
    const room = rooms.get(roomId);
    if (!room) throw new Error('找不到房間');
    if (room.players.right.connected) throw new Error('房間已滿');
    room.addPlayer(socket, 'right');
    playerToRoom.set(socket.id, roomId);
    room.broadcastLobby();
    return { roomId, side: 'right' };
  }

  function leaveCurrentRoom(socketId, deleteEmpty = true) {
    const roomId = playerToRoom.get(socketId);
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) {
      playerToRoom.delete(socketId);
      return;
    }
    room.removePlayer(socketId);
    playerToRoom.delete(socketId);
    if (deleteEmpty && !room.players.left.connected && !room.players.right.connected) {
      room.stop();
      rooms.delete(roomId);
    }
  }

  function handleDisconnect(socketId) {
    leaveCurrentRoom(socketId, true);
  }

  function setReady(socketId, ready) {
    const room = getRoomByPlayer(socketId);
    if (!room) throw new Error('你目前不在房間內');
    room.setReady(socketId, ready);
  }

  function applyInput(socketId, payload) {
    const room = getRoomByPlayer(socketId);
    room?.applyInput(socketId, payload);
  }

  function restartMatch(socketId) {
    const room = getRoomByPlayer(socketId);
    if (!room) throw new Error('你目前不在房間內');
    room.restartMatch();
  }

  return {
    roomCount,
    createRoom,
    joinRoom,
    leaveCurrentRoom,
    handleDisconnect,
    setReady,
    applyInput,
    restartMatch
  };
}

module.exports = { createRoomManager };
