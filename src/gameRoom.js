const { FIELD, CONFIG } = require('./constants');

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function len(x, y) {
  return Math.hypot(x, y);
}

function norm(x, y) {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

function makePlayer(side) {
  return {
    side,
    socketId: null,
    connected: false,
    ready: false,
    input: {
      up: false,
      down: false,
      left: false,
      right: false,
      hit: false,
      dash: false,
      special: false
    },
    prevInput: {
      up: false,
      down: false,
      left: false,
      right: false,
      hit: false,
      dash: false,
      special: false
    },
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    lastTouchAt: -999999,
    hitUntil: 0,
    hitCooldownUntil: 0,
    dashUntil: 0,
    dashCooldownUntil: 0,
    specialUntil: 0,
    specialCooldownUntil: 0,
    pingMs: 0
  };
}

class GameRoom {
  constructor(io, roomId) {
    this.io = io;
    this.roomId = roomId;
    this.players = {
      left: makePlayer('left'),
      right: makePlayer('right')
    };
    this.phase = 'waiting';
    this.score = { left: 0, right: 0 };
    this.ball = {
      x: FIELD.width / 2,
      y: FIELD.height / 2,
      vx: 0,
      vy: 0,
      fireUntil: 0,
      lastHitBy: null
    };
    this.lastTickAt = Date.now();
    this.stateSeq = 0;
    this.roundTimer = null;
    this.tickHandle = setInterval(() => this.tick(), Math.round(1000 / CONFIG.fps));
    this.broadcastHandle = setInterval(() => this.broadcastState(), Math.round(1000 / CONFIG.broadcastHz));
    this.broadcastLobby();
  }

  stop() {
    clearInterval(this.tickHandle);
    clearInterval(this.broadcastHandle);
    clearTimeout(this.roundTimer);
  }

  bounds(side) {
    const s = CONFIG.playerSize;
    if (side === 'left') {
      return {
        minX: CONFIG.minXPadding,
        maxX: FIELD.halfWidth - s - CONFIG.minXPadding,
        minY: CONFIG.minYPadding,
        maxY: FIELD.height - s - CONFIG.maxBottomPadding
      };
    }
    return {
      minX: FIELD.halfWidth + CONFIG.minXPadding,
      maxX: FIELD.width - s - CONFIG.minXPadding,
      minY: CONFIG.minYPadding,
      maxY: FIELD.height - s - CONFIG.maxBottomPadding
    };
  }

  resetPlayers() {
    const lb = this.bounds('left');
    const rb = this.bounds('right');
    Object.assign(this.players.left, {
      x: lb.minX + (lb.maxX - lb.minX) * 0.28,
      y: lb.minY + (lb.maxY - lb.minY) * 0.5,
      vx: 0,
      vy: 0,
      lastTouchAt: -999999,
      hitUntil: 0,
      hitCooldownUntil: 0,
      dashUntil: 0,
      dashCooldownUntil: 0,
      specialUntil: 0,
      specialCooldownUntil: 0
    });
    Object.assign(this.players.right, {
      x: rb.minX + (rb.maxX - rb.minX) * 0.5,
      y: rb.minY + (rb.maxY - rb.minY) * 0.5,
      vx: 0,
      vy: 0,
      lastTouchAt: -999999,
      hitUntil: 0,
      hitCooldownUntil: 0,
      dashUntil: 0,
      dashCooldownUntil: 0,
      specialUntil: 0,
      specialCooldownUntil: 0
    });
  }

  placeBall(servingTo = 'left') {
    const dir = servingTo === 'left' ? -1 : 1;
    this.ball.x = FIELD.width / 2;
    this.ball.y = FIELD.height / 2;
    this.ball.vx = dir * 330;
    this.ball.vy = (Math.random() * 180) - 90;
    this.ball.fireUntil = 0;
    this.ball.lastHitBy = null;
  }

  serializeFor(socketId) {
    const mySide = this.players.left.socketId === socketId ? 'left' : this.players.right.socketId === socketId ? 'right' : null;
    return {
      roomId: this.roomId,
      phase: this.phase,
      field: FIELD,
      mySide,
      serverTime: Date.now(),
      stateSeq: ++this.stateSeq,
      players: {
        left: this.exportPlayer(this.players.left),
        right: this.exportPlayer(this.players.right)
      },
      ball: {
        x: this.ball.x,
        y: this.ball.y,
        vx: this.ball.vx,
        vy: this.ball.vy,
        fire: Date.now() < this.ball.fireUntil
      },
      score: this.score,
      winningScore: CONFIG.winningScore
    };
  }

  exportPlayer(p) {
    const now = Date.now();
    return {
      side: p.side,
      connected: p.connected,
      ready: p.ready,
      x: p.x,
      y: p.y,
      dashCooldownRemainMs: Math.max(0, p.dashCooldownUntil - now),
      specialCooldownRemainMs: Math.max(0, p.specialCooldownUntil - now),
      empowered: now < p.specialUntil,
      dashing: now < p.dashUntil,
      hitting: now < p.hitUntil
    };
  }

  addPlayer(socket, side) {
    const p = this.players[side];
    p.socketId = socket.id;
    p.connected = true;
    p.ready = false;
    socket.join(this.roomId);
    this.broadcastLobby();
  }

  removePlayer(socketId) {
    for (const side of ['left', 'right']) {
      const p = this.players[side];
      if (p.socketId === socketId) {
        p.connected = false;
        p.ready = false;
        p.socketId = null;
      }
    }
    if (this.phase !== 'waiting') {
      this.phase = 'waiting';
    }
    this.broadcastLobby();
  }

  setReady(socketId, ready) {
    const p = this.findPlayer(socketId);
    if (!p) return;
    p.ready = ready;
    this.broadcastLobby();
    if (this.canStart()) this.startMatch();
  }

  canStart() {
    return this.players.left.connected && this.players.right.connected && this.players.left.ready && this.players.right.ready;
  }

  startMatch() {
    clearTimeout(this.roundTimer);
    this.phase = 'countdown';
    this.score = { left: 0, right: 0 };
    this.resetPlayers();
    this.placeBall(Math.random() > 0.5 ? 'left' : 'right');
    this.broadcastState();
    this.roundTimer = setTimeout(() => {
      this.phase = 'playing';
    }, CONFIG.roundDelayMs);
  }

  restartMatch() {
    if (!(this.players.left.connected && this.players.right.connected)) return;
    this.players.left.ready = true;
    this.players.right.ready = true;
    this.startMatch();
  }

  applyInput(socketId, payload) {
    const p = this.findPlayer(socketId);
    if (!p) return;
    for (const key of ['up', 'down', 'left', 'right', 'hit', 'dash', 'special']) {
      p.input[key] = !!payload[key];
    }
  }

  findPlayer(socketId) {
    for (const side of ['left', 'right']) {
      if (this.players[side].socketId === socketId) return this.players[side];
    }
    return null;
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(0.02, (now - this.lastTickAt) / 1000);
    this.lastTickAt = now;

    if (this.phase === 'playing') {
      this.updatePlayer(this.players.left, dt, now);
      this.updatePlayer(this.players.right, dt, now);
      this.updateBall(dt, now);
      this.resolveCollision(this.players.left, now);
      this.resolveCollision(this.players.right, now);
      this.checkGoal();
    }

  }

  updatePlayer(player, dt, now) {
    const input = player.input;
    const prev = player.prevInput;
    let mx = 0, my = 0;
    if (input.up) my -= 1;
    if (input.down) my += 1;
    if (input.left) mx -= 1;
    if (input.right) mx += 1;

    if (input.hit && !prev.hit && now >= player.hitCooldownUntil) {
      player.hitUntil = now + CONFIG.hitWindowMs;
      player.hitCooldownUntil = now + CONFIG.hitCooldownMs;
    }
    if (input.dash && !prev.dash && now >= player.dashCooldownUntil) {
      player.dashUntil = now + CONFIG.dashDurationMs;
      player.dashCooldownUntil = now + CONFIG.dashCooldownMs;
    }
    if (input.special && !prev.special && now >= player.specialCooldownUntil) {
      player.specialUntil = now + CONFIG.specialDurationMs;
      player.specialCooldownUntil = now + CONFIG.specialCooldownMs;
    }

    const n = norm(mx, my);
    const moving = mx !== 0 || my !== 0;
    const speed = now < player.dashUntil ? CONFIG.dashSpeed : CONFIG.moveSpeed;
    player.vx = moving ? n.x * speed : 0;
    player.vy = moving ? n.y * speed : 0;
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    const b = this.bounds(player.side);
    player.x = clamp(player.x, b.minX, b.maxX);
    player.y = clamp(player.y, b.minY, b.maxY);

    player.prevInput = { ...input };
  }

  updateBall(dt, now) {
    this.ball.x += this.ball.vx * dt;
    this.ball.y += this.ball.vy * dt;
    this.ball.vx *= CONFIG.friction;
    this.ball.vy *= CONFIG.friction;

    if (this.ball.y - CONFIG.ballRadius <= 0) {
      this.ball.y = CONFIG.ballRadius;
      this.ball.vy = Math.abs(this.ball.vy) * CONFIG.wallBounce;
    } else if (this.ball.y + CONFIG.ballRadius >= FIELD.height) {
      this.ball.y = FIELD.height - CONFIG.ballRadius;
      this.ball.vy = -Math.abs(this.ball.vy) * CONFIG.wallBounce;
    }

    const s = len(this.ball.vx, this.ball.vy);
    if (s > CONFIG.maxBallSpeed) {
      const n = norm(this.ball.vx, this.ball.vy);
      this.ball.vx = n.x * CONFIG.maxBallSpeed;
      this.ball.vy = n.y * CONFIG.maxBallSpeed;
    }
    if (now > this.ball.fireUntil) this.ball.fireUntil = 0;
  }

  resolveCollision(player, now) {
    const px = player.x;
    const py = player.y;
    const pw = CONFIG.playerSize;
    const ph = CONFIG.playerSize;
    const bx = this.ball.x;
    const by = this.ball.y;

    const inHit = now <= player.hitUntil;
    const inSpecial = now <= player.specialUntil;
    const collisionPadding = (inHit ? CONFIG.touchPaddingHit : CONFIG.touchPaddingIdle) + (inSpecial ? CONFIG.touchPaddingSpecial : 0);
    const topBoost = py < CONFIG.topBoostZoneY ? CONFIG.topBoostPadding : 0;

    const nearestX = Math.max(px - collisionPadding, Math.min(bx, px + pw + collisionPadding));
    const nearestY = Math.max(py - collisionPadding - topBoost, Math.min(by, py + ph + collisionPadding));
    const dx = bx - nearestX;
    const dy = by - nearestY;
    const distSq = dx * dx + dy * dy;
    if (distSq > CONFIG.ballRadius * CONFIG.ballRadius) return;

    const playerCx = px + pw / 2;
    const playerCy = py + ph / 2;
    let nx = bx - playerCx;
    let ny = by - playerCy;
    let nl = Math.hypot(nx, ny);
    if (nl < 0.0001) {
      nx = player.side === 'left' ? 1 : -1;
      ny = 0;
      nl = 1;
    }
    const n = { x: nx / nl, y: ny / nl };
    const overlap = CONFIG.ballRadius - Math.sqrt(Math.max(0, distSq));
    if (overlap > 0) {
      this.ball.x += n.x * (overlap + 2.5);
      this.ball.y += n.y * (overlap + 2.5);
    }

    const toward = player.side === 'left' ? 1 : -1;
    const tangent = { x: -n.y, y: n.x };
    const tangentialMove = (player.vx * tangent.x + player.vy * tangent.y) * 0.45;
    let power = inHit ? CONFIG.hitSpeed : CONFIG.softBounce;
    let boostX = toward * power;
    let boostY = ((by - playerCy) / (ph / 2 || 1)) * 260 + tangentialMove + player.vy * 0.2;

    if (now < player.dashUntil) {
      boostX *= 1.18;
      boostY += player.vy * 0.35;
    }

    let empowered = false;
    if (inSpecial && inHit) {
      boostX *= CONFIG.empoweredMultiplierX;
      boostY *= CONFIG.empoweredMultiplierY;
      empowered = true;
    }

    if (inHit && now - player.lastTouchAt > 70) {
      this.ball.vx = boostX + player.vx * 0.28 + (Math.random() * 60 - 30);
      this.ball.vy = boostY + (Math.random() * 90 - 45);
      if (empowered) {
        const n2 = norm(this.ball.vx, this.ball.vy);
        const empoweredSpeed = Math.max(CONFIG.empoweredMinSpeed, len(this.ball.vx, this.ball.vy) * 1.18);
        this.ball.vx = n2.x * empoweredSpeed;
        this.ball.vy = n2.y * empoweredSpeed;
        this.ball.fireUntil = now + CONFIG.empoweredFireMs;
        player.specialUntil = 0;
      }
      player.lastTouchAt = now;
      this.ball.lastHitBy = player.side;
    } else {
      this.ball.vx += n.x * power * 0.72 + player.vx * 0.10;
      this.ball.vy += n.y * power * 0.58 + player.vy * 0.10;
      if (player.side === 'left' && this.ball.vx < 120) this.ball.vx = 120;
      if (player.side === 'right' && this.ball.vx > -120) this.ball.vx = -120;
    }
  }

  checkGoal() {
    if (this.ball.x - CONFIG.ballRadius <= 0) {
      this.scorePoint('right');
    } else if (this.ball.x + CONFIG.ballRadius >= FIELD.width) {
      this.scorePoint('left');
    }
  }

  scorePoint(side) {
    this.score[side] += 1;
    if (this.score[side] >= CONFIG.winningScore) {
      this.phase = 'finished';
      return;
    }
    this.phase = 'countdown';
    this.resetPlayers();
    this.placeBall(side === 'left' ? 'right' : 'left');
    clearTimeout(this.roundTimer);
    this.roundTimer = setTimeout(() => {
      this.phase = 'playing';
    }, CONFIG.roundDelayMs);
  }

  broadcastLobby() {
    this.io.to(this.roomId).emit('room:lobby', {
      roomId: this.roomId,
      phase: this.phase,
      players: {
        left: { connected: this.players.left.connected, ready: this.players.left.ready },
        right: { connected: this.players.right.connected, ready: this.players.right.ready }
      }
    });
  }

  broadcastState() {
    for (const side of ['left', 'right']) {
      const socketId = this.players[side].socketId;
      if (socketId) {
        this.io.to(socketId).emit('match:state', this.serializeFor(socketId));
      }
    }
  }
}

module.exports = { GameRoom };
