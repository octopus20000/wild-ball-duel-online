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

function randomCode() {
  let code = "";
  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  return code;
}

function defaultDeck() {
  return [
    { id: "mirror-wall", name: "鏡牆", desc: "本回合防守成功時可完全反射普通球。" },
    { id: "double-drive", name: "雙重抽射", desc: "普通射門傷害 +1。" },
    { id: "focus-charge", name: "專注蓄力", desc: "蓄力時額外 +1 能量。" }
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
    deck: defaultDeck(),
    activeCard: null
  };
}

function createRoom(socket, name) {
  const code = randomCode();
  const room = {
    code,
    phase: "lobby",
    turn: 1,
    hostId: socket.id,
    guestId: null,
    winner: null,
    ballLane: "mid",
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
      deck: isSelf ? player.deck : player.deck.map((c) => ({ id: c.id, name: "未知戰術卡", desc: "對手持有的卡牌。" }))
    };
  }

  return {
    code: room.code,
    phase: room.phase,
    turn: room.turn,
    winner: room.winner,
    you,
    ballLane: room.ballLane,
    lanes: LANES,
    actions: ACTIONS,
    players: {
      left: pack(room.players.left, "left"),
      right: pack(room.players.right, "right")
    },
    log: room.log.slice(-18)
  };
}

function emitRoom(room) {
  if (room.hostId) io.to(room.hostId).emit("room:update", summarize(room, room.hostId));
  if (room.guestId) io.to(room.guestId).emit("room:update", summarize(room, room.guestId));
}

function pushLog(room, title, detail) {
  room.log.push({ turn: room.turn, title, detail });
  room.log = room.log.slice(-18);
}

function resetBattle(room) {
  room.phase = "playing";
  room.turn = 1;
  room.winner = null;
  room.ballLane = "mid";
  room.log = [{ turn: 0, title: "對局開始", detail: "雙方都已就緒，球目前位於中路。" }];
  for (const side of ["left", "right"]) {
    const p = room.players[side];
    p.hp = MAX_HP;
    p.energy = 1;
    p.score = 0;
    p.submitted = false;
    p.choice = null;
    p.rematchVote = false;
    p.activeCard = null;
    p.connected = true;
    p.deck = defaultDeck();
  }
}

function actionLabel(a) {
  return {
    drive: "抽射",
    power: "爆射",
    curve: "曲球",
    guard: "封堵",
    charge: "蓄力"
  }[a] || a;
}

function laneLabel(l) {
  return {
    up: "上路",
    mid: "中路",
    down: "下路"
  }[l] || l;
}

function hasCard(player, cardId) {
  return player.activeCard?.id === cardId;
}

function resolveTurn(room) {
  const left = room.players.left;
  const right = room.players.right;
  const L = left.choice;
  const R = right.choice;

  const leftOnBall = L.lane === room.ballLane;
  const rightOnBall = R.lane === room.ballLane;

  let nextBallLane = room.ballLane;
  let scoreEvent = null;
  let detailParts = [];

  // passive: charge
  if (L.action === "charge") {
    left.energy = clamp(left.energy + 1 + (hasCard(left, "focus-charge") ? 1 : 0), 0, MAX_ENERGY);
    detailParts.push(`${left.name} 蓄力成功。`);
  }
  if (R.action === "charge") {
    right.energy = clamp(right.energy + 1 + (hasCard(right, "focus-charge") ? 1 : 0), 0, MAX_ENERGY);
    detailParts.push(`${right.name} 蓄力成功。`);
  }

  function attemptShot(attacker, defender, A, D, attackerSide) {
    let power = 1;
    let text = "";
    let scored = false;
    let lane = A.lane;

    if (A.action === "drive") {
      power = 1 + (hasCard(attacker, "double-drive") ? 1 : 0);
      text = "抽射";
    } else if (A.action === "power" && attacker.energy >= 2) {
      attacker.energy -= 2;
      power = 2;
      text = "爆射";
    } else if (A.action === "curve" && attacker.energy >= 1) {
      attacker.energy -= 1;
      power = 1;
      text = "曲球";
      lane = A.targetLane || lane;
    } else {
      return { detail: `${attacker.name} 想出招但能量不足。`, scored: false, nextLane: room.ballLane };
    }

    const defenderGuarding = D.action === "guard" && D.lane === lane;
    if (defenderGuarding) {
      if (hasCard(defender, "mirror-wall") && A.action === "drive") {
        return {
          detail: `${defender.name} 用鏡牆完美反射了 ${attacker.name} 的抽射！`,
          scored: false,
          reflected: true,
          nextLane: lane
        };
      }
      if (power <= 1) {
        return {
          detail: `${defender.name} 成功封堵了 ${attacker.name} 的${text}。`,
          scored: false,
          nextLane: lane
        };
      }
      defender.hp = clamp(defender.hp - 1, 0, MAX_HP);
      return {
        detail: `${attacker.name} 的${text}突破封堵！${defender.name} 額外失去 1 點生命。`,
        scored: true,
        nextLane: lane
      };
    }

    return {
      detail: `${attacker.name} 從${laneLabel(A.lane)}發動${text}，成功得分！`,
      scored: true,
      nextLane: lane
    };
  }

  // both contest the ball
  if (leftOnBall && rightOnBall) {
    const lWeight = (L.action === "power" ? 3 : L.action === "drive" ? 2 : L.action === "curve" ? 2 : L.action === "guard" ? 2 : 1) + left.energy * 0.1;
    const rWeight = (R.action === "power" ? 3 : R.action === "drive" ? 2 : R.action === "curve" ? 2 : R.action === "guard" ? 2 : 1) + right.energy * 0.1;

    if (Math.abs(lWeight - rWeight) < 0.35) {
      detailParts.push("雙方在球路交會處僵持，球仍停留在原路線。");
    } else if (lWeight > rWeight) {
      const result = attemptShot(left, right, L, R, "left");
      detailParts.push(result.detail);
      if (result.reflected) {
        nextBallLane = result.nextLane;
      } else if (result.scored) {
        left.score += 1;
        right.hp = clamp(right.hp - 1, 0, MAX_HP);
        scoreEvent = "left";
        nextBallLane = result.nextLane;
      }
    } else {
      const result = attemptShot(right, left, R, L, "right");
      detailParts.push(result.detail);
      if (result.reflected) {
        nextBallLane = result.nextLane;
      } else if (result.scored) {
        right.score += 1;
        left.hp = clamp(left.hp - 1, 0, MAX_HP);
        scoreEvent = "right";
        nextBallLane = result.nextLane;
      }
    }
  } else if (leftOnBall) {
    const result = attemptShot(left, right, L, R, "left");
    detailParts.push(result.detail);
    if (result.reflected) {
      nextBallLane = result.nextLane;
    } else if (result.scored) {
      left.score += 1;
      right.hp = clamp(right.hp - 1, 0, MAX_HP);
      scoreEvent = "left";
      nextBallLane = result.nextLane;
    }
  } else if (rightOnBall) {
    const result = attemptShot(right, left, R, L, "right");
    detailParts.push(result.detail);
    if (result.reflected) {
      nextBallLane = result.nextLane;
    } else if (result.scored) {
      right.score += 1;
      left.hp = clamp(left.hp - 1, 0, MAX_HP);
      scoreEvent = "right";
      nextBallLane = result.nextLane;
    }
  } else {
    detailParts.push("雙方都沒有接到球，球沿原路線漂移。");
  }

  room.ballLane = nextBallLane;

  pushLog(
    room,
    `第 ${room.turn} 回合`,
    `${left.name}：${laneLabel(L.lane)} + ${actionLabel(L.action)}；` +
    `${right.name}：${laneLabel(R.lane)} + ${actionLabel(R.action)}。 ` +
    detailParts.join(" ")
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

    const chosenCard = player.deck.find((c) => c.id === cardId) || null;
    player.activeCard = chosenCard;
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
    pushLog(room, "再戰投票", `${room.players[side].name} 希望再來一局。`);
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
  console.log(`Wild Ball Tactics Online server running on port ${PORT}`);
});
