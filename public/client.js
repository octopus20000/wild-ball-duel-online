const socket = io();

const STORAGE_KEY = 'wild_ball_duel_online_keybinds_v1';
const ACTIONS = ['up', 'down', 'left', 'right', 'hit', 'dash', 'special'];
const ACTION_LABELS = { up:'上', down:'下', left:'左', right:'右', hit:'擊球', dash:'衝刺', special:'強化' };
const DEFAULT_KEYBINDS = { up:'KeyW', down:'KeyS', left:'KeyA', right:'KeyD', hit:'Space', dash:'ShiftLeft', special:'KeyE' };

const state = {
  roomId: null, mySide: null, serverState: null, lobby: null, ready: false, connected: false,
  rebinding: null, pauseOpen: false, keybinds: loadKeybinds(),
  input: { up:false, down:false, left:false, right:false, hit:false, dash:false, special:false },
  snapshots: [],
  renderDelayMs: 22,
  lastFrameAt: performance.now(),
  predictedLocal: null,
  predictedTimers: { dashUntil: 0, dashCooldownUntil: 0 },
  visualBall: null,
  prevInput: { up:false, down:false, left:false, right:false, hit:false, dash:false, special:false },
  inputSeq: 0,
  lastAckSeq: 0,
  pendingInputs: [],
  ballPreview: { offsetX:0, offsetY:0, velX:0, velY:0, lastTriggerAt:0, activeUntil:0 },
  predictedBall: null,
  currentRenderState: null,
  predictedSpecialUntil: 0,
  predictedHitUntil: 0,
  hitStopUntil: 0,
  localStepMs: 1000/120,
  localAccumulatorMs: 0,
  lastLocalSimAt: performance.now(),
  lastMoveInputAt: 0
};

const NET_CFG = {
  moveSpeed: 405,
  dashSpeed: 760,
  dashDurationMs: 190,
  dashCooldownMs: 1150,
  specialDurationMs: 1400
};

const els = {
  app: document.getElementById('app'),
  statusText: document.getElementById('statusText'),
  connectionBadge: document.getElementById('connectionBadge'),
  roomIdText: document.getElementById('roomIdText'),
  mySideText: document.getElementById('mySideText'),
  createRoomBtn: document.getElementById('createRoomBtn'),
  joinRoomBtn: document.getElementById('joinRoomBtn'),
  joinRoomInput: document.getElementById('joinRoomInput'),
  copyRoomBtn: document.getElementById('copyRoomBtn'),
  readyBtn: document.getElementById('readyBtn'),
  restartBtn: document.getElementById('restartBtn'),
  leaveRoomBtn: document.getElementById('leaveRoomBtn'),
  scoreLeft: document.getElementById('scoreLeft'),
  scoreRight: document.getElementById('scoreRight'),
  leftReadyText: document.getElementById('leftReadyText'),
  rightReadyText: document.getElementById('rightReadyText'),
  phaseText: document.getElementById('phaseText'),
  roomStateText: document.getElementById('roomStateText'),
  keybindList: document.getElementById('keybindList'),
  openKeybindBtn: document.getElementById('openKeybindBtn'),
  resetKeybindBtn: document.getElementById('resetKeybindBtn'),
  keybindModal: document.getElementById('keybindModal'),
  keybindEditor: document.getElementById('keybindEditor'),
  closeKeybindBtn: document.getElementById('closeKeybindBtn'),
  dynamicHelp: document.getElementById('dynamicHelp'),
  canvas: document.getElementById('gameCanvas'),
  fullscreenBtn: document.getElementById('fullscreenBtn'),
  pauseModal: document.getElementById('pauseModal'),
  resumeBtn: document.getElementById('resumeBtn'),
  pauseRestartBtn: document.getElementById('pauseRestartBtn'),
  pauseKeybindBtn: document.getElementById('pauseKeybindBtn'),
  pauseLeaveBtn: document.getElementById('pauseLeaveBtn')
};

const ctx = els.canvas.getContext('2d');

function saveKeybinds() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.keybinds)); }
function loadKeybinds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_KEYBINDS };
    const parsed = JSON.parse(raw);
    const out = { ...DEFAULT_KEYBINDS };
    for (const action of ACTIONS) if (typeof parsed[action] === 'string') out[action] = parsed[action];
    return out;
  } catch { return { ...DEFAULT_KEYBINDS }; }
}
function codeToText(code) {
  const map = {
    KeyW:'W', KeyA:'A', KeyS:'S', KeyD:'D', KeyE:'E', KeyF:'F',
    ArrowUp:'↑', ArrowDown:'↓', ArrowLeft:'←', ArrowRight:'→',
    ShiftLeft:'左 Shift', ShiftRight:'右 Shift', Space:'Space', Escape:'ESC',
    NumpadEnter:'數字鍵盤 Enter', Numpad0:'數字鍵盤 0', NumpadDecimal:'數字鍵盤 .'
  };
  return map[code] || code.replace(/^Key/, '').replace(/^Digit/, '');
}
function setStatus(text) { els.statusText.textContent = text; }
function updateConnection() { els.connectionBadge.textContent = state.connected ? '已連線' : '未連線'; }
function updateFocusMode() {
  const phase = state.serverState?.phase || 'waiting';
  els.app.classList.toggle('game-focus', ['countdown','playing','finished'].includes(phase));
}
function updateReadyTexts() {
  const format = (p) => !p?.connected ? '未加入' : p.ready ? '已準備' : '未準備';
  els.leftReadyText.textContent = format(state.lobby?.players?.left);
  els.rightReadyText.textContent = format(state.lobby?.players?.right);
}
function updateKeybindUI() {
  els.keybindList.innerHTML = '';
  els.keybindEditor.innerHTML = '';
  for (const action of ACTIONS) {
    const row = document.createElement('div');
    row.className = 'key-row';
    row.innerHTML = `<label>${ACTION_LABELS[action]}</label><div class="key-chip">${codeToText(state.keybinds[action])}</div>`;
    els.keybindList.appendChild(row);

    const editRow = document.createElement('div');
    editRow.className = 'key-row';
    const waiting = state.rebinding === action;
    editRow.innerHTML = `<label>${ACTION_LABELS[action]}</label><button class="key-chip ${waiting ? 'waiting' : ''}">${waiting ? '請按新按鍵...' : codeToText(state.keybinds[action])}</button>`;
    editRow.querySelector('button').addEventListener('click', () => {
      state.rebinding = action;
      updateKeybindUI();
    });
    els.keybindEditor.appendChild(editRow);
  }
  els.dynamicHelp.textContent = `目前操作：移動 ${codeToText(state.keybinds.up)}/${codeToText(state.keybinds.left)}/${codeToText(state.keybinds.down)}/${codeToText(state.keybinds.right)}，擊球 ${codeToText(state.keybinds.hit)}，衝刺 ${codeToText(state.keybinds.dash)}，強化 ${codeToText(state.keybinds.special)}。房主固定左側，挑戰者固定右側。`;
}


function stepBallPreview(dtMs, nowMs) {
  const bp = state.ballPreview;
  bp.offsetX *= 0.55;
  bp.offsetY *= 0.55;
  if (Math.abs(bp.offsetX) < 0.05) bp.offsetX = 0;
  if (Math.abs(bp.offsetY) < 0.05) bp.offsetY = 0;

  if (state.predictedBall) {
    const dt = Math.min(0.03, dtMs / 1000);
    state.predictedBall.x += state.predictedBall.vx * dt;
    state.predictedBall.y += state.predictedBall.vy * dt;
    state.predictedBall.vx *= 0.992;
    state.predictedBall.vy *= 0.992;
    const r = 18;
    if (state.predictedBall.y - r <= 0) {
      state.predictedBall.y = r;
      state.predictedBall.vy = Math.abs(state.predictedBall.vy) * 0.94;
    } else if (state.predictedBall.y + r >= 720) {
      state.predictedBall.y = 720 - r;
      state.predictedBall.vy = -Math.abs(state.predictedBall.vy) * 0.94;
    }
    if (nowMs >= state.predictedBall.until) state.predictedBall = null;
  }
}

function maybeTriggerLocalBallPreview(renderState, nowMs) {
  state.currentRenderState = renderState;
}

function tryPredictedBallHit(nowMs) {
  if (!state.mySide || !state.predictedLocal || !state.currentRenderState) return;
  if (state.currentRenderState.phase !== 'playing') return;

  const ball = state.visualBall || state.currentRenderState.ball;
  if (!ball) return;

  const local = state.predictedLocal;
  const playerCx = local.x + 42;
  const playerCy = local.y + 42;
  const dx = ball.x - playerCx;
  const dy = ball.y - playerCy;
  const dist = Math.hypot(dx, dy);
  const generousRadius = 86;
  if (dist > generousRadius) return;

  const toward = state.mySide === 'left' ? 1 : -1;
  const movingX = (state.input.right ? 1 : 0) - (state.input.left ? 1 : 0);
  const movingY = (state.input.down ? 1 : 0) - (state.input.up ? 1 : 0);
  const specialOn = nowMs < state.predictedSpecialUntil;
  const dashOn = nowMs < state.predictedTimers.dashUntil;
  const baseSpeed = specialOn ? 820 : 585;
  const powerBoost = dashOn ? 70 : 0;
  const vx = toward * (baseSpeed + powerBoost + Math.abs(movingX) * 36);
  const vy = (dy / generousRadius) * 185 + movingY * 72;

  state.predictedBall = {
    x: ball.x,
    y: ball.y,
    vx,
    vy,
    until: nowMs + (specialOn ? 170 : 105),
    lockUntil: nowMs + (specialOn ? 95 : 45),
    strong: specialOn,
    fire: specialOn
  };
  state.predictedHitUntil = nowMs + (specialOn ? 165 : 120);
  state.hitStopUntil = nowMs + (specialOn ? 36 : 0);
}


function emitInput() {
  if (!state.roomId) return;
  const seq = ++state.inputSeq;
  socket.emit('player:input', { seq, ...state.input });
}
function setInputFromEvent(code, isDown) {
  for (const action of ACTIONS) if (state.keybinds[action] === code) state.input[action] = isDown;
}
function openKeybindModal() { state.rebinding = null; updateKeybindUI(); els.keybindModal.classList.remove('hidden'); }
function closeKeybindModal() { state.rebinding = null; els.keybindModal.classList.add('hidden'); }
function openPause() { if (!state.roomId) return; state.pauseOpen = true; els.pauseModal.classList.remove('hidden'); }
function closePause() { state.pauseOpen = false; els.pauseModal.classList.add('hidden'); }

function handleLobby(lobby) {
  state.lobby = lobby;
  updateReadyTexts();
  if (!state.serverState || state.serverState.phase === 'waiting') {
    els.roomStateText.textContent = `左側：${lobby.players.left.connected ? (lobby.players.left.ready ? '已準備' : '未準備') : '未加入'} / 右側：${lobby.players.right.connected ? (lobby.players.right.ready ? '已準備' : '未準備') : '未加入'}`;
  }
}
function cloneObj(v) { return JSON.parse(JSON.stringify(v)); }
function lerp(a,b,t){ return a + (b-a)*t; }
function lerpPlayer(a,b,t){
  return { ...b, x: lerp(a.x,b.x,t), y: lerp(a.y,b.y,t), dashCooldownRemainMs: lerp(a.dashCooldownRemainMs,b.dashCooldownRemainMs,t), specialCooldownRemainMs: lerp(a.specialCooldownRemainMs,b.specialCooldownRemainMs,t) };
}
function lerpBall(a,b,t){
  return { x: lerp(a.x,b.x,t), y: lerp(a.y,b.y,t), vx: lerp(a.vx,b.vx,t), vy: lerp(a.vy,b.vy,t), fire: b.fire || a.fire };
}
function resetNetSmoothing() {
  state.snapshots = [];
  state.predictedLocal = null;
  state.predictedTimers = { dashUntil: 0, dashCooldownUntil: 0 };
  state.visualBall = null;
  state.prevInput = { up:false, down:false, left:false, right:false, hit:false, dash:false, special:false };
  state.inputSeq = 0;
  state.lastAckSeq = 0;
  state.pendingInputs = [];
  state.ballPreview = { offsetX:0, offsetY:0, velX:0, velY:0, lastTriggerAt:0, activeUntil:0 };
  state.predictedBall = null;
  state.currentRenderState = null;
  state.predictedSpecialUntil = 0;
  state.predictedHitUntil = 0;
  state.hitStopUntil = 0;
}

function applyPredictedStep(local, timers, input, prevInput, dtMs, nowMs) {
  if (!local) return;
  if (input.dash && !prevInput.dash && nowMs >= timers.dashCooldownUntil) {
    timers.dashUntil = nowMs + NET_CFG.dashDurationMs;
    timers.dashCooldownUntil = nowMs + NET_CFG.dashCooldownMs;
  }
  if (input.special && !prevInput.special && nowMs >= state.predictedSpecialUntil) {
    state.predictedSpecialUntil = nowMs + NET_CFG.specialDurationMs;
  }
  const dt = Math.min(0.03, dtMs / 1000);
  let mx = 0, my = 0;
  if (input.up) my -= 1;
  if (input.down) my += 1;
  if (input.left) mx -= 1;
  if (input.right) mx += 1;
  const l = Math.hypot(mx,my) || 1;
  const moving = mx !== 0 || my !== 0;
  const speed = nowMs < timers.dashUntil ? NET_CFG.dashSpeed : NET_CFG.moveSpeed;
  const vx = moving ? (mx / l) * speed : 0;
  const vy = moving ? (my / l) * speed : 0;
  const b = getBounds(state.mySide);
  local.x = Math.max(b.minX, Math.min(b.maxX, local.x + vx * dt));
  local.y = Math.max(b.minY, Math.min(b.maxY, local.y + vy * dt));
}

function reconcileLocalFromServer(payload) {
  if (!payload.mySide) return;
  const auth = payload.players[payload.mySide];
  state.lastAckSeq = payload.lastProcessedInputSeq || 0;

  const now = performance.now();
  if (!state.predictedLocal) {
    state.predictedLocal = { x: auth.x, y: auth.y };
  } else {
    const dx = auth.x - state.predictedLocal.x;
    const dy = auth.y - state.predictedLocal.y;
    const dist = Math.hypot(dx, dy);
    const isActivelyMoving = state.input.up || state.input.down || state.input.left || state.input.right || now - state.lastMoveInputAt < 140;

    // Hide almost all visual correction while the local player is actively moving.
    // Only very large desyncs are softly corrected, never hard-snapped during play.
    if (dist > 320) {
      state.predictedLocal.x += dx * 0.12;
      state.predictedLocal.y += dy * 0.12;
    } else if (!isActivelyMoving && dist > 120) {
      state.predictedLocal.x += dx * 0.08;
      state.predictedLocal.y += dy * 0.08;
    } else if (!isActivelyMoving && dist > 48) {
      state.predictedLocal.x += dx * 0.035;
      state.predictedLocal.y += dy * 0.035;
    }
  }

  state.predictedTimers.dashCooldownUntil = now + (auth.dashCooldownRemainMs || 0);
  if (auth.empowered && state.predictedSpecialUntil < now + 80) state.predictedSpecialUntil = now + 320;
  if (auth.dashing && state.predictedTimers.dashUntil < now + 50) {
    state.predictedTimers.dashUntil = now + 120;
  } else if (!auth.dashing && state.predictedTimers.dashUntil < now) {
    state.predictedTimers.dashUntil = 0;
  }
}


function getBounds(side) {
  const size = 84;
  return side === 'left'
    ? { minX: 14, maxX: 640 - size - 14, minY: 72, maxY: 720 - size - 18 }
    : { minX: 640 + 14, maxX: 1280 - size - 14, minY: 72, maxY: 720 - size - 18 };
}
function updatePredictedLocal(dtMs) {
  if (!state.serverState || !state.mySide) return;
  if (!['countdown', 'playing'].includes(state.serverState.phase)) return;
  const auth = state.serverState.players[state.mySide];
  if (!state.predictedLocal) {
    state.predictedLocal = { x: auth.x, y: auth.y };
    state.predictedTimers.dashCooldownUntil = performance.now() + auth.dashCooldownRemainMs;
    state.predictedTimers.dashUntil = auth.dashing ? performance.now() + 100 : 0;
  }

  if (state.input.up || state.input.down || state.input.left || state.input.right) {
    state.lastMoveInputAt = performance.now();
  }

  state.localAccumulatorMs += dtMs;
  let safety = 0;
  while (state.localAccumulatorMs >= state.localStepMs && safety < 6) {
    applyPredictedStep(state.predictedLocal, state.predictedTimers, state.input, state.prevInput, state.localStepMs, state.lastFrameAt);
    state.prevInput = { ...state.input };
    state.localAccumulatorMs -= state.localStepMs;
    safety++;
  }
}

function getRenderState() {
  if (!state.serverState) return null;
  let out;
  if (state.snapshots.length < 2) {
    out = cloneObj(state.serverState);
  } else {
    const targetTime = Date.now() - state.renderDelayMs;
    while (state.snapshots.length >= 3 && state.snapshots[1].serverTime <= targetTime) state.snapshots.shift();
    const a = state.snapshots[0];
    const b = state.snapshots[1] || a;
    const span = Math.max(1, b.serverTime - a.serverTime);
    const t = Math.max(0, Math.min(1, (targetTime - a.serverTime) / span));
    out = cloneObj(b);
    out.players.left = lerpPlayer(a.players.left, b.players.left, t);
    out.players.right = lerpPlayer(a.players.right, b.players.right, t);
    out.ball = lerpBall(a.ball, b.ball, t);
  }

  if (state.mySide && state.predictedLocal) {
    out.players[state.mySide].x = state.predictedLocal.x;
    out.players[state.mySide].y = state.predictedLocal.y;
  }
  const targetBall = out.ball;

  if (!state.visualBall) {
    state.visualBall = { ...targetBall };
  } else if (state.predictedBall) {
    const nowMs = performance.now();
    const dt = Math.min(0.03, (nowMs - Math.min(nowMs, state.lastFrameAt || nowMs)) / 1000) || 0.016;
    // During a predicted hit window, let the local strong-hit feel lead the visual ball.
    state.visualBall.x += state.predictedBall.vx * dt;
    state.visualBall.y += state.predictedBall.vy * dt;
    state.predictedBall.vx *= state.predictedBall.strong ? 0.994 : 0.991;
    state.predictedBall.vy *= state.predictedBall.strong ? 0.994 : 0.991;

    const remain = Math.max(0, state.predictedBall.until - nowMs);
    const lockRemain = Math.max(0, state.predictedBall.lockUntil - nowMs);
    const dx = targetBall.x - state.visualBall.x;
    const dy = targetBall.y - state.visualBall.y;
    const dist = Math.hypot(dx, dy);

    // First align velocity, not position, so strong hits do not look like
    // "ball waited, then suddenly teleported fast".
    const velBlend = lockRemain > 0 ? 0.12 : 0.24;
    state.predictedBall.vx += (targetBall.vx - state.predictedBall.vx) * velBlend;
    state.predictedBall.vy += (targetBall.vy - state.predictedBall.vy) * velBlend;

    if (lockRemain <= 0) {
      if (dist > 160) {
        state.visualBall.x += dx * 0.35;
        state.visualBall.y += dy * 0.35;
      } else {
        const posBlend = state.predictedBall.strong ? 0.10 : 0.16;
        state.visualBall.x += dx * posBlend;
        state.visualBall.y += dy * posBlend;
      }
    }

    state.visualBall.vx = state.predictedBall.vx;
    state.visualBall.vy = state.predictedBall.vy;
    state.visualBall.fire = targetBall.fire || state.predictedBall.fire;

    if (remain <= 0) {
      state.predictedBall = null;
    }
  } else {
    const dx = targetBall.x - state.visualBall.x;
    const dy = targetBall.y - state.visualBall.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 220) {
      state.visualBall.x = targetBall.x;
      state.visualBall.y = targetBall.y;
    } else {
      state.visualBall.x += dx * 0.20;
      state.visualBall.y += dy * 0.20;
    }
    state.visualBall.vx += (targetBall.vx - state.visualBall.vx) * 0.22;
    state.visualBall.vy += (targetBall.vy - state.visualBall.vy) * 0.22;
    state.visualBall.fire = targetBall.fire;
  }

  maybeTriggerLocalBallPreview(out, performance.now());
  out.ball = {
    ...state.visualBall,
    x: state.visualBall.x + state.ballPreview.offsetX,
    y: state.visualBall.y + state.ballPreview.offsetY
  };
  return out;
}


function drawCooldownBar(x, y, width, remainMs, totalMs, label) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x, y, width, 8);
  const p = totalMs ? Math.max(0, Math.min(1, 1 - remainMs / totalMs)) : 1;
  ctx.fillStyle = remainMs <= 0 ? '#34d399' : '#facc15';
  ctx.fillRect(x, y, width * p, 8);
  ctx.fillStyle = '#fff';
  ctx.font = '12px Arial';
  ctx.fillText(`${label}: ${remainMs <= 0 ? 'READY' : (remainMs / 1000).toFixed(1) + 's'}`, x, y - 4);
}
function render() {
  ctx.clearRect(0,0,els.canvas.width,els.canvas.height);
  ctx.fillStyle = '#1d6a48';
  ctx.fillRect(0,0,1280,720);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 6;
  ctx.setLineDash([20,18]);
  ctx.beginPath(); ctx.moveTo(640,0); ctx.lineTo(640,720); ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(640,360,110,0,Math.PI*2); ctx.stroke();

  const renderState = getRenderState();
  if (!renderState) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 34px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('建立或加入房間後開始對戰', 640, 360);
    return;
  }
  const s = renderState;
  drawCooldownBar(30, 42, 170, s.players.left.dashCooldownRemainMs, 1150, '左衝刺');
  drawCooldownBar(30, 78, 170, s.players.left.specialCooldownRemainMs, 4500, '左強化');
  drawCooldownBar(1080, 42, 170, s.players.right.dashCooldownRemainMs, 1150, '右衝刺');
  drawCooldownBar(1080, 78, 170, s.players.right.specialCooldownRemainMs, 4500, '右強化');
  renderPlayer(s.players.left, '🐶', '#60a5fa');
  renderPlayer(s.players.right, '🐱', '#f87171');
  renderBall(s.ball);
}
function renderPlayer(player, emoji, ringColor) {
  const size = 84;
  const cx = player.x + size/2;
  const cy = player.y + size/2;
  if (player.empowered) {
    const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, 62);
    g.addColorStop(0, 'rgba(251,191,36,0.18)');
    g.addColorStop(0.45, 'rgba(249,115,22,0.24)');
    g.addColorStop(1, 'rgba(239,68,68,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, 62, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = player.empowered ? '#fb923c' : ringColor;
  ctx.lineWidth = player.hitting ? 8 : 5;
  ctx.beginPath(); ctx.arc(cx, cy, 34, 0, Math.PI * 2); ctx.stroke();
  ctx.font = '54px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, cx, cy + (player.dashing ? -3 : 0));
}
function renderBall(ball) {
  if (ball.fire) {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = `rgba(249,115,22,${0.18 - i * 0.03})`;
      ctx.beginPath();
      ctx.arc(ball.x - ball.vx * 0.01 * i, ball.y - ball.vy * 0.01 * i, 18 - i * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const g = ctx.createRadialGradient(ball.x - 4, ball.y - 4, 2, ball.x, ball.y, 20);
  g.addColorStop(0, '#fff7c7'); g.addColorStop(0.45, '#ffe082'); g.addColorStop(0.78, '#f59e0b'); g.addColorStop(1, '#b45309');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(ball.x, ball.y, 18, 0, Math.PI * 2); ctx.fill();
}
function updateServerState(payload) {
  state.serverState = payload;
  state.mySide = payload.mySide;
  state.snapshots.push(cloneObj(payload));
  if (state.snapshots.length > 6) state.snapshots.shift();
  reconcileLocalFromServer(payload);
  els.roomIdText.textContent = payload.roomId || '-';
  els.mySideText.textContent = payload.mySide === 'left' ? '左側（房主）' : payload.mySide === 'right' ? '右側（挑戰者）' : '-';
  els.scoreLeft.textContent = payload.score.left;
  els.scoreRight.textContent = payload.score.right;
  els.phaseText.textContent = payload.phase.toUpperCase();
  const phaseMap = { waiting:'等待雙方進房並準備', countdown:'倒數中', playing:'對戰進行中', finished: payload.score.left >= payload.winningScore ? '左側獲勝' : '右側獲勝' };
  els.roomStateText.textContent = phaseMap[payload.phase] || payload.phase;
  updateFocusMode();
}
function resetLocalRoomState() {
  state.roomId = null; state.mySide = null; state.serverState = null; state.lobby = null; state.ready = false;
  resetNetSmoothing();
  els.readyBtn.textContent = '準備';
  updateReadyTexts();
  updateFocusMode();
}
function requestRestart() {
  if (!state.roomId) return;
  socket.emit('match:restart', {}, (res) => { if (!res?.ok) alert(res?.error || '重新開始失敗'); });
}

els.createRoomBtn.addEventListener('click', () => {
  socket.emit('room:create', {}, (res) => {
    if (!res?.ok) return alert(res?.error || '建立房間失敗');
    state.roomId = res.roomId; state.mySide = res.side; state.ready = false; resetNetSmoothing();
    setStatus(`房間 ${res.roomId} 已建立，等待挑戰者加入`);
  });
});
els.joinRoomBtn.addEventListener('click', () => {
  const roomId = els.joinRoomInput.value.trim();
  if (!roomId) return;
  socket.emit('room:join', { roomId }, (res) => {
    if (!res?.ok) return alert(res?.error || '加入房間失敗');
    state.roomId = res.roomId; state.mySide = res.side; state.ready = false; resetNetSmoothing();
    setStatus(`已加入房間 ${res.roomId}，你是右側挑戰者`);
  });
});
els.copyRoomBtn.addEventListener('click', async () => {
  if (!state.roomId) return;
  try { await navigator.clipboard.writeText(state.roomId); setStatus(`房號 ${state.roomId} 已複製`); }
  catch { setStatus('瀏覽器未允許複製'); }
});
els.readyBtn.addEventListener('click', () => {
  if (!state.roomId) return;
  state.ready = !state.ready;
  socket.emit('player:ready', { ready: state.ready }, (res) => {
    if (!res?.ok) { state.ready = !state.ready; return alert(res?.error || '設定準備失敗'); }
    els.readyBtn.textContent = state.ready ? '取消準備' : '準備';
  });
});
els.restartBtn.addEventListener('click', requestRestart);
els.leaveRoomBtn.addEventListener('click', () => {
  socket.emit('room:leave', {}, () => { resetLocalRoomState(); setStatus('已離開房間'); });
});
els.openKeybindBtn.addEventListener('click', openKeybindModal);
els.closeKeybindBtn.addEventListener('click', closeKeybindModal);
els.resetKeybindBtn.addEventListener('click', () => {
  state.keybinds = { ...DEFAULT_KEYBINDS }; saveKeybinds(); updateKeybindUI();
});
els.fullscreenBtn.addEventListener('click', async () => {
  try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen(); } catch {}
});
els.resumeBtn.addEventListener('click', closePause);
els.pauseRestartBtn.addEventListener('click', () => { closePause(); requestRestart(); });
els.pauseKeybindBtn.addEventListener('click', () => { closePause(); openKeybindModal(); });
els.pauseLeaveBtn.addEventListener('click', () => { closePause(); els.leaveRoomBtn.click(); });

socket.on('connect', () => { state.connected = true; updateConnection(); });
socket.on('disconnect', () => { state.connected = false; updateConnection(); setStatus('與伺服器中斷連線'); });
socket.on('room:lobby', handleLobby);
socket.on('match:state', updateServerState);

window.addEventListener('keydown', (e) => {
  if (state.rebinding) {
    if (e.code === 'Escape') { state.rebinding = null; updateKeybindUI(); return; }
    for (const action of ACTIONS) {
      if (action !== state.rebinding && state.keybinds[action] === e.code) {
        state.keybinds[action] = state.keybinds[state.rebinding];
      }
    }
    state.keybinds[state.rebinding] = e.code;
    state.rebinding = null;
    saveKeybinds();
    updateKeybindUI();
    return;
  }
  if (e.code === 'Escape') {
    if (!els.keybindModal.classList.contains('hidden')) { closeKeybindModal(); return; }
    if (!state.roomId) return;
    if (state.pauseOpen) closePause(); else openPause();
    return;
  }
  if (state.pauseOpen || !els.keybindModal.classList.contains('hidden')) return;
  setInputFromEvent(e.code, true);
  const now = performance.now();
  if ([state.keybinds.up,state.keybinds.down,state.keybinds.left,state.keybinds.right].includes(e.code)) state.lastMoveInputAt = now;
  if (state.keybinds.special === e.code) state.predictedSpecialUntil = now + NET_CFG.specialDurationMs;
  if (state.keybinds.hit === e.code) tryPredictedBallHit(now);
  emitInput();
});
window.addEventListener('keyup', (e) => { setInputFromEvent(e.code, false); emitInput(); });
window.addEventListener('blur', () => {
  for (const k of Object.keys(state.input)) state.input[k] = false;
  emitInput();
  closePause();
});

updateConnection();
updateKeybindUI();
updateReadyTexts();
setStatus('建立房間或加入房間。此版本先優化本地角色抖動：前端固定步長預測與伺服器速度對齊，減少被拉回感。');
(function loop(now){
  const dt = now - state.lastFrameAt;
  state.lastFrameAt = now;
  updatePredictedLocal(dt);
  if (now >= state.hitStopUntil) {
    stepBallPreview(dt, now);
  }
  render();
  requestAnimationFrame(loop);
})(performance.now());
