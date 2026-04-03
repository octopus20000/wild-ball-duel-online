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

const LANES = ["up", "mid", "down"];
const ACTIONS = ["drive", "power", "curve", "guard", "charge"];
const MAX_HP = 7;
const MAX_ENERGY = 5;
const WIN_SCORE = 5;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function roomCode() {
  let code = "";
  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  return code;
}

function makeDeck() {
  return [
    { id: "mirror-wall", name: "鏡牆", desc: "封堵成功時可把普通抽射直接反射回去。", rarity: "epic" },
    { id: "double-drive", name: "雙重抽射", desc: "抽射傷害 +1。", rarity: "rare" },
    { id: "focus-charge", name: "專注蓄力", desc: "蓄力時額外 +1 能量。", rarity: "common" }
  ];
}

function createPlayer(name, side) {
  return {
    name: name || (side === "left" ? "房主" : "挑戰者"),
    side,
    hp: MAX_HP,
    energy: 1,
    score: 0,
    ready: false,
    submitted: false,
    choice: null,
    connected: true,
    rematchVote: false,
    deck: makeDeck(),
    activeCard: null,
    lastAction: null
  };
}

function createRoom(socket, name) {
  const code = roomCode();
  const room = {
    code,
    phase: "lobby",
    turn: 1,
    hostId: socket.id,
    guestId: null,
    winner: null,
    ballLane: "mid",
    reveal: null,
    log: [{
      turn: 0,
      title: "房間建立",
      detail: `${name || "房主"} 建立了房間 ${code}。`
    }],
    players: {
      left: createPlayer(name, "left"),
      right: createPlayer("", "right")
    }
  };
  rooms.set(code, room);
  socket.join(code);
  return room;
}

function getRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.hostId === socketId || room.guestId === socketId) return room;
  }
  return null;
}

function getSide(room, socketId) {
  if (room.hostId === socketId) return "left";
  if (room.guestId === socketId) return "right";
  return null;
}

function otherSide(side) {
  return side === "left" ? "right" : "left";
}

function laneLabel(lane) {
  return { up: "上路", mid: "中路", down: "下路" }[lane] || lane;
}

function actionLabel(action) {
  return {
    drive: "抽射",
    power: "爆射",
    curve: "曲球",
    guard: "封堵",
    charge: "蓄力"
  }[action] || action;
}

function pushLog(room, title, detail) {
  room.log.push({ turn: room.turn, title, detail });
  room.log = room.log.slice(-20);
}

function hasCard(player, id) {
  return player.activeCard?.id === id;
}

function summarize(room, viewerId) {
  const you = getSide(room, viewerId);

  function pack(player, side) {
    const isSelf = you === side;
    return {
      side,
      name: player.name,
      hp: player.hp,
      energy: player.energy,
      score: player.score,
      ready: player.ready,
      submitted: player.submitted,
      connected: player.connected,
      rematchVote: player.rematchVote,
      activeCard: player.activeCard,
      lastAction: player.lastAction,
      deck: isSelf
        ? player.deck
        : player.deck.map((c) => ({ id: c.id, name: "未知戰術卡", desc: "對手手中的卡牌。", rarity: c.rarity }))
    };
  }

  return {
    code: room.code,
    phase: room.phase,
    turn: room.turn,
    winner: room.winner,
    you,
    ballLane: room.ballLane,
    reveal: room.reveal,
    lanes: LANES,
    actions: ACTIONS,
    players: {
      left: pack(room.players.left, "left"),
      right: pack(room.players.right, "right")
    },
    log: room.log
  };
}

function emitRoom(room) {
  if (room.hostId) io.to(room.hostId).emit("room:update", summarize(room, room.hostId));
  if (room.guestId) io.to(room.guestId).emit("room:update", summarize(room, room.guestId));
}

function resetBattle(room) {
  room.phase = "playing";
  room.turn = 1;
  room.winner = null;
  room.ballLane = "mid";
  room.reveal = null;
  room.log = [{
    turn: 0,
    title: "開戰",
    detail: "雙方就位，球從中路發動。"
  }];
  for (const side of ["left", "right"]) {
    const p = room.players[side];
    p.hp = MAX_HP;
    p.energy = 1;
    p.score = 0;
    p.ready = true;
    p.submitted = false;
    p.choice = null;
    p.rematchVote = false;
    p.activeCard = null;
    p.lastAction = null;
    p.connected = true;
    p.deck = makeDeck();
  }
}

function resolveShot(attacker, defender, aChoice, dChoice, currentLane) {
  let lane = aChoice.lane;
  let power = 1;
  let damage = 1;
  let text = "抽射";

  if (aChoice.action === "drive") {
    damage = 1 + (hasCard(attacker, "double-drive") ? 1 : 0);
    text = "抽射";
  } else if (aChoice.action === "power") {
    if (attacker.energy < 2) return { detail: `${attacker.name} 爆射失敗，能量不足。`, success: false, nextLane: currentLane };
    attacker.energy -= 2;
    damage = 2;
    text = "爆射";
  } else if (aChoice.action === "curve") {
    if (attacker.energy < 1) return { detail: `${attacker.name} 曲球失敗，能量不足。`, success: false, nextLane: currentLane };
    attacker.energy -= 1;
    damage = 1;
    lane = aChoice.targetLane || aChoice.lane;
    text = "曲球";
  } else {
    return { detail: `${attacker.name} 沒有形成有效射門。`, success: false, nextLane: currentLane };
  }

  const defenderBlocking = dChoice.action === "guard" && dChoice.lane === lane;
  if (defenderBlocking) {
    if (hasCard(defender, "mirror-wall") && aChoice.action === "drive") {
      return {
        detail: `${defender.name} 用【鏡牆】把 ${attacker.name} 的抽射反射了回去！`,
        success: false,
        reflected: true,
        nextLane: lane,
        reflectedBy: defender.side
      };
    }
    if (damage <= 1) {
      return {
        detail: `${defender.name} 在${laneLabel(lane)}完成封堵，成功擋下 ${attacker.name} 的${text}。`,
        success: false,
        nextLane: lane
      };
    }
    defender.hp = clamp(defender.hp - 1, 0, MAX_HP);
    return {
      detail: `${attacker.name} 的${text}突破封堵！${defender.name} 額外失去 1 點生命。`,
      success: true,
      nextLane: lane
    };
  }

  defender.hp = clamp(defender.hp - damage, 0, MAX_HP);
  return {
    detail: `${attacker.name} 從${laneLabel(aChoice.lane)}發動${text}，命中成功！`,
    success: true,
    nextLane: lane
  };
}

function resolveTurn(room) {
  const left = room.players.left;
  const right = room.players.right;
  const L = left.choice;
  const R = right.choice;

  left.lastAction = L;
  right.lastAction = R;

  const leftOnBall = L.lane === room.ballLane;
  const rightOnBall = R.lane === room.ballLane;

  let nextBallLane = room.ballLane;
  let logParts = [];

  if (L.action === "charge") {
    left.energy = clamp(left.energy + 1 + (hasCard(left, "focus-charge") ? 1 : 0), 0, MAX_ENERGY);
    logParts.push(`${left.name} 完成蓄力。`);
  }
  if (R.action === "charge") {
    right.energy = clamp(right.energy + 1 + (hasCard(right, "focus-charge") ? 1 : 0), 0, MAX_ENERGY);
    logParts.push(`${right.name} 完成蓄力。`);
  }

  room.reveal = {
    turn: room.turn,
    left: { lane: L.lane, action: L.action, card: left.activeCard?.name || null },
    right: { lane: R.lane, action: R.action, card: right.activeCard?.name || null },
    ballLaneBefore: room.ballLane,
    ballLaneAfter: room.ballLane,
    resultText: ""
  };

  if (leftOnBall && rightOnBall) {
    const lWeight = (L.action === "power" ? 3 : L.action === "curve" ? 2.4 : L.action === "drive" ? 2 : L.action === "guard" ? 1.8 : 1) + left.energy * 0.06;
    const rWeight = (R.action === "power" ? 3 : R.action === "curve" ? 2.4 : R.action === "drive" ? 2 : R.action === "guard" ? 1.8 : 1) + right.energy * 0.06;

    if (Math.abs(lWeight - rWeight) < 0.35) {
      logParts.push("雙方在中場形成僵持，球留在原路線。");
      room.reveal.resultText = "勢均力敵，球仍停留在原路線。";
    } else if (lWeight > rWeight) {
      const result = resolveShot(left, right, L, R, room.ballLane);
      logParts.push(result.detail);
      nextBallLane = result.nextLane;
      if (result.success) {
        left.score += 1;
        room.reveal.resultText = `${left.name} 取得 1 分！`;
      } else if (result.reflected) {
        room.reveal.resultText = `${right.name} 完成反射，球回到 ${laneLabel(result.nextLane)}。`;
      } else {
        room.reveal.resultText = `${right.name} 成功防下這球。`;
      }
    } else {
      const result = resolveShot(right, left, R, L, room.ballLane);
      logParts.push(result.detail);
      nextBallLane = result.nextLane;
      if (result.success) {
        right.score += 1;
        room.reveal.resultText = `${right.name} 取得 1 分！`;
      } else if (result.reflected) {
        room.reveal.resultText = `${left.name} 完成反射，球回到 ${laneLabel(result.nextLane)}。`;
      } else {
        room.reveal.resultText = `${left.name} 成功防下這球。`;
      }
    }
  } else if (leftOnBall) {
    const result = resolveShot(left, right, L, R, room.ballLane);
    logParts.push(result.detail);
    nextBallLane = result.nextLane;
    room.reveal.resultText = result.success ? `${left.name} 取得 1 分！` : result.reflected ? `${right.name} 反射成功。` : `${right.name} 擋下這球。`;
    if (result.success) left.score += 1;
  } else if (rightOnBall) {
    const result = resolveShot(right, left, R, L, room.ballLane);
    logParts.push(result.detail);
    nextBallLane = result.nextLane;
    room.reveal.resultText = result.success ? `${right.name} 取得 1 分！` : result.reflected ? `${left.name} 反射成功。` : `${left.name} 擋下這球。`;
    if (result.success) right.score += 1;
  } else {
    logParts.push("雙方都沒抓到球點，球沿原路線滾動。");
    room.reveal.resultText = "雙方都沒有碰到球，球仍在原路線。";
  }

  room.ballLane = nextBallLane;
  room.reveal.ballLaneAfter = nextBallLane;

  pushLog(
    room,
    `第 ${room.turn} 回合`,
    `${left.name}：${laneLabel(L.lane)} + ${actionLabel(L.action)}；${right.name}：${laneLabel(R.lane)} + ${actionLabel(R.action)}。 ${logParts.join(" ")}`
  );

  left.submitted = false;
  right.submitted = false;
  left.choice = null;
  right.choice = null;
  left.activeCard = null;
  right.activeCard = null;

  if (left.score >= WIN_SCORE || right.hp <= 0) {
    room.phase = "ended";
    room.winner = "left";
    pushLog(room, "勝負已定", `${left.name} 取得勝利。`);
    return;
  }
  if (right.score >= WIN_SCORE || left.hp <= 0) {
    room.phase = "ended";
    room.winner = "right";
    pushLog(room, "勝負已定", `${right.name} 取得勝利。`);
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
    const room = rooms.get(String(code || "").trim().toUpperCase());
    if (!room) {
      socket.emit("toast", { type: "error", message: "找不到房號。" });
      return;
    }
    if (room.guestId && room.guestId !== socket.id) {
      socket.emit("toast", { type: "error", message: "房間已滿。" });
      return;
    }
    room.guestId = socket.id;
    room.players.right = createPlayer(String(name || "").trim() || "挑戰者", "right");
    socket.join(room.code);
    pushLog(room, "玩家加入", `${room.players.right.name} 已加入房間。`);
    emitRoom(room);
  });

  socket.on("player:ready", ({ ready }) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;
    const side = getSide(room, socket.id);
    room.players[side].ready = !!ready;
    if (room.guestId && room.players.left.ready && room.players.right.ready) {
      resetBattle(room);
    }
    emitRoom(room);
  });

  socket.on("turn:submit", ({ lane, action, cardId, targetLane }) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.phase !== "playing") return;
    const side = getSide(room, socket.id);
    const player = room.players[side];
    if (player.submitted) return;
    if (!LANES.includes(lane) || !ACTIONS.includes(action)) return;

    if (action === "power" && player.energy < 2) {
      socket.emit("toast", { type: "error", message: "爆射需要 2 點能量。" });
      return;
    }
    if (action === "curve" && player.energy < 1) {
      socket.emit("toast", { type: "error", message: "曲球需要 1 點能量。" });
      return;
    }

    player.activeCard = player.deck.find((c) => c.id === cardId) || null;
    player.choice = {
      lane,
      action,
      targetLane: LANES.includes(targetLane) ? targetLane : lane
    };
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
    const side = getSide(room, socket.id);
    room.players[side].rematchVote = true;
    pushLog(room, "再戰投票", `${room.players[side].name} 想再來一局。`);
    if (room.players.left.rematchVote && room.players.right.rematchVote) {
      room.players.left.ready = true;
      room.players.right.ready = true;
      resetBattle(room);
    }
    emitRoom(room);
  });

  socket.on("disconnect", () => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;
    const side = getSide(room, socket.id);
    if (!side) return;

    room.players[side].connected = false;
    room.players[side].ready = false;
    room.players[side].submitted = false;

    if (side === "left") {
      pushLog(room, "房主離線", "房主已離線，房間即將關閉。");
      emitRoom(room);
      setTimeout(() => {
        if (!io.sockets.sockets.get(socket.id)) rooms.delete(room.code);
      }, 2000);
    } else {
      room.guestId = null;
      room.players.right = createPlayer("", "right");
      room.phase = "lobby";
      pushLog(room, "挑戰者離線", "挑戰者已離開，等待新的玩家。");
      emitRoom(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Wild Ball Tactics Online visual server running on port ${PORT}`);
});
