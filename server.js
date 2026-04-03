const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
app.use(express.static("public"));

const rooms = new Map();

const GAME = {
  maxHp: 24,
  maxEnergy: 5,
  maxRoundsLog: 18,
  actions: ["attack", "guard", "charge", "special", "heal"]
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function makeRoomCode() {
  let code = "";
  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  return code;
}

function createPlayer(name, side) {
  return {
    name: name || (side === "left" ? "房主" : "挑戰者"),
    side,
    hp: GAME.maxHp,
    energy: 0,
    shield: 0,
    isReady: false,
    submitted: false,
    action: null,
    connected: true,
    rematchVote: false
  };
}

function createRoom(hostSocket, hostName) {
  const code = makeRoomCode();
  const room = {
    code,
    phase: "lobby", // lobby, playing, ended
    turn: 1,
    hostId: hostSocket.id,
    guestId: null,
    players: {
      left: createPlayer(hostName, "left"),
      right: createPlayer("", "right")
    },
    winner: null,
    log: [{
      turn: 0,
      title: "房間建立",
      detail: `${hostName || "房主"} 已建立房間 ${code}`
    }]
  };
  rooms.set(code, room);
  hostSocket.join(code);
  return room;
}

function getRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.hostId === socketId || room.guestId === socketId) return room;
  }
  return null;
}

function getSideBySocket(room, socketId) {
  if (room.hostId === socketId) return "left";
  if (room.guestId === socketId) return "right";
  return null;
}

function pushLog(room, title, detail) {
  room.log.push({ turn: room.turn, title, detail });
  room.log = room.log.slice(-GAME.maxRoundsLog);
}

function summarize(room, viewerId = null) {
  const viewerSide = viewerId ? getSideBySocket(room, viewerId) : null;

  function packPlayer(player, side) {
    const isSelf = viewerSide === side;
    return {
      side,
      name: player.name,
      hp: player.hp,
      energy: player.energy,
      shield: player.shield,
      isReady: player.isReady,
      submitted: player.submitted,
      actionLocked: isSelf ? player.submitted : false,
      connected: player.connected,
      rematchVote: player.rematchVote
    };
  }

  return {
    code: room.code,
    phase: room.phase,
    turn: room.turn,
    winner: room.winner,
    you: viewerSide,
    canStart: !!room.guestId,
    actions: GAME.actions,
    players: {
      left: packPlayer(room.players.left, "left"),
      right: packPlayer(room.players.right, "right")
    },
    log: room.log.slice(-GAME.maxRoundsLog)
  };
}

function emitRoom(room) {
  if (room.hostId) io.to(room.hostId).emit("room:update", summarize(room, room.hostId));
  if (room.guestId) io.to(room.guestId).emit("room:update", summarize(room, room.guestId));
}

function resetPlayersForNewMatch(room) {
  room.phase = "playing";
  room.turn = 1;
  room.winner = null;
  for (const side of ["left", "right"]) {
    const p = room.players[side];
    p.hp = GAME.maxHp;
    p.energy = 0;
    p.shield = 0;
    p.submitted = false;
    p.action = null;
    p.rematchVote = false;
    p.connected = true;
  }
  room.log = [{
    turn: 0,
    title: "對局開始",
    detail: "雙方都已就緒，開始第一回合。"
  }];
}

function label(action) {
  return {
    attack: "普通攻擊",
    guard: "防禦",
    charge: "蓄力",
    special: "強襲",
    heal: "治療"
  }[action] || action;
}

function resolveTurn(room) {
  const L = room.players.left;
  const R = room.players.right;
  const la = L.action;
  const ra = R.action;

  let dmgToLeft = 0;
  let dmgToRight = 0;

  L.shield = la === "guard" ? 2 : 0;
  R.shield = ra === "guard" ? 2 : 0;

  if (la === "charge") L.energy = clamp(L.energy + 1, 0, GAME.maxEnergy);
  if (ra === "charge") R.energy = clamp(R.energy + 1, 0, GAME.maxEnergy);

  if (la === "heal" && L.energy >= 1) {
    L.energy -= 1;
    L.hp = clamp(L.hp + 3, 0, GAME.maxHp);
  }
  if (ra === "heal" && R.energy >= 1) {
    R.energy -= 1;
    R.hp = clamp(R.hp + 3, 0, GAME.maxHp);
  }

  if (la === "attack") dmgToRight += 3;
  if (ra === "attack") dmgToLeft += 3;

  if (la === "special" && L.energy >= 2) {
    L.energy -= 2;
    dmgToRight += 6;
  }
  if (ra === "special" && R.energy >= 2) {
    R.energy -= 2;
    dmgToLeft += 6;
  }

  dmgToLeft = Math.max(0, dmgToLeft - L.shield);
  dmgToRight = Math.max(0, dmgToRight - R.shield);

  L.hp = clamp(L.hp - dmgToLeft, 0, GAME.maxHp);
  R.hp = clamp(R.hp - dmgToRight, 0, GAME.maxHp);

  pushLog(
    room,
    `第 ${room.turn} 回合`,
    `${L.name} 使用【${label(la)}】，${R.name} 使用【${label(ra)}】。` +
      ` ${L.name} 受到 ${dmgToLeft} 傷害，${R.name} 受到 ${dmgToRight} 傷害。`
  );

  L.submitted = false;
  R.submitted = false;
  L.action = null;
  R.action = null;

  if (L.hp <= 0 && R.hp <= 0) {
    room.phase = "ended";
    room.winner = "draw";
    pushLog(room, "平手", "雙方同時倒下，本局平手。");
    return;
  }
  if (L.hp <= 0) {
    room.phase = "ended";
    room.winner = "right";
    pushLog(room, "勝負已定", `${R.name} 獲勝。`);
    return;
  }
  if (R.hp <= 0) {
    room.phase = "ended";
    room.winner = "left";
    pushLog(room, "勝負已定", `${L.name} 獲勝。`);
    return;
  }

  room.turn += 1;
}

io.on("connection", (socket) => {
  socket.emit("toast", { type: "info", message: "已連線至伺服器。" });

  socket.on("room:create", ({ name }) => {
    const room = createRoom(socket, String(name || "").trim() || "房主");
    socket.emit("room:created", { code: room.code });
    emitRoom(room);
  });

  socket.on("room:join", ({ code, name }) => {
    const normalized = String(code || "").trim().toUpperCase();
    const room = rooms.get(normalized);
    if (!room) {
      socket.emit("toast", { type: "error", message: "找不到這個房號。" });
      return;
    }
    if (room.guestId && room.guestId !== socket.id) {
      socket.emit("toast", { type: "error", message: "房間已滿。" });
      return;
    }
    room.guestId = socket.id;
    room.players.right = createPlayer(String(name || "").trim() || "挑戰者", "right");
    room.players.right.connected = true;
    socket.join(room.code);
    pushLog(room, "玩家加入", `${room.players.right.name} 已加入房間。`);
    emitRoom(room);
  });

  socket.on("player:ready", ({ ready }) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;
    const side = getSideBySocket(room, socket.id);
    room.players[side].isReady = !!ready;

    if (room.guestId && room.players.left.isReady && room.players.right.isReady) {
      resetPlayersForNewMatch(room);
    }
    emitRoom(room);
  });

  socket.on("turn:submit", ({ action }) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.phase !== "playing") return;

    const side = getSideBySocket(room, socket.id);
    const player = room.players[side];

    if (!GAME.actions.includes(action)) return;
    if (player.submitted) return;

    if (action === "special" && player.energy < 2) {
      socket.emit("toast", { type: "error", message: "強襲需要 2 點能量。" });
      return;
    }
    if (action === "heal" && player.energy < 1) {
      socket.emit("toast", { type: "error", message: "治療需要 1 點能量。" });
      return;
    }

    player.action = action;
    player.submitted = true;
    emitRoom(room);

    if (room.players.left.submitted && room.players.right.submitted) {
      resolveTurn(room);
      emitRoom(room);
    }
  });

  socket.on("match:rematch", () => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.phase !== "ended") return;
    const side = getSideBySocket(room, socket.id);
    room.players[side].rematchVote = true;
    pushLog(room, "再戰投票", `${room.players[side].name} 想再來一局。`);

    if (room.players.left.rematchVote && room.players.right.rematchVote) {
      room.players.left.isReady = true;
      room.players.right.isReady = true;
      resetPlayersForNewMatch(room);
    }
    emitRoom(room);
  });

  socket.on("disconnect", () => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;

    const side = getSideBySocket(room, socket.id);
    const player = room.players[side];
    player.connected = false;
    player.isReady = false;
    player.submitted = false;

    if (side === "left") {
      pushLog(room, "房主離線", `${player.name} 已離線，房間將關閉。`);
      emitRoom(room);
      setTimeout(() => {
        if (!io.sockets.sockets.get(socket.id)) {
          rooms.delete(room.code);
        }
      }, 2000);
    } else {
      room.guestId = null;
      room.players.right = createPlayer("", "right");
      room.phase = "lobby";
      pushLog(room, "挑戰者離線", "挑戰者已離開，等待新的玩家加入。");
      emitRoom(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Arcane Duel Online server running on port ${PORT}`);
});
