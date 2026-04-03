const socket = io();

const state = {
  room: null,
  selectedLane: "mid",
  selectedAction: "drive",
  selectedCardId: null,
  selectedTargetLane: "mid"
};

const el = {
  connectionBadge: document.getElementById("connectionBadge"),
  lobbyCard: document.getElementById("lobbyCard"),
  roomCard: document.getElementById("roomCard"),
  hostName: document.getElementById("hostName"),
  guestName: document.getElementById("guestName"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  roomCode: document.getElementById("roomCode"),
  copyCodeBtn: document.getElementById("copyCodeBtn"),
  phasePill: document.getElementById("phasePill"),
  leftName: document.getElementById("leftName"),
  rightName: document.getElementById("rightName"),
  leftHp: document.getElementById("leftHp"),
  rightHp: document.getElementById("rightHp"),
  leftEnergy: document.getElementById("leftEnergy"),
  rightEnergy: document.getElementById("rightEnergy"),
  leftScore: document.getElementById("leftScore"),
  rightScore: document.getElementById("rightScore"),
  leftHpBar: document.getElementById("leftHpBar"),
  rightHpBar: document.getElementById("rightHpBar"),
  leftEnergyBar: document.getElementById("leftEnergyBar"),
  rightEnergyBar: document.getElementById("rightEnergyBar"),
  leftStatus: document.getElementById("leftStatus"),
  rightStatus: document.getElementById("rightStatus"),
  turnNumber: document.getElementById("turnNumber"),
  youBox: document.getElementById("youBox"),
  laneNodes: Array.from(document.querySelectorAll(".lane")),
  laneSelect: document.getElementById("laneSelect"),
  actionGrid: document.getElementById("actionGrid"),
  cardGrid: document.getElementById("cardGrid"),
  targetLaneSelect: document.getElementById("targetLaneSelect"),
  submitTurnBtn: document.getElementById("submitTurnBtn"),
  selectionSummary: document.getElementById("selectionSummary"),
  readyBtn: document.getElementById("readyBtn"),
  rematchBtn: document.getElementById("rematchBtn"),
  logList: document.getElementById("logList"),
  toastContainer: document.getElementById("toastContainer")
};

const laneLabel = {
  up: "上路",
  mid: "中路",
  down: "下路"
};

const actionLabel = {
  drive: "抽射",
  power: "爆射",
  curve: "曲球",
  guard: "封堵",
  charge: "蓄力"
};

const actionDesc = {
  drive: "穩定進攻，若命中可得分。",
  power: "耗 2 能量，威力更強。",
  curve: "耗 1 能量，可改變球路。",
  guard: "若對到正確路線可封堵來球。",
  charge: "獲得更多能量，準備大招。"
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function toast(message, type = "info") {
  const div = document.createElement("div");
  div.className = `toast ${type}`;
  div.textContent = message;
  el.toastContainer.appendChild(div);
  setTimeout(() => div.remove(), 3200);
}

function updateBar(barEl, ratio) {
  barEl.style.width = `${clamp(ratio, 0, 1) * 100}%`;
}

function phaseText(phase, winner) {
  if (phase === "lobby") return "大廳中";
  if (phase === "playing") return "對戰中";
  if (phase === "ended") {
    if (winner === "left") return "左側獲勝";
    if (winner === "right") return "右側獲勝";
  }
  return phase;
}

function sideStatus(player, phase) {
  if (!player.connected) return "已離線";
  if (phase === "lobby") return player.ready ? "已準備" : "等待準備";
  if (phase === "playing") return player.submitted ? "已鎖定本回合戰術" : "思考中";
  if (phase === "ended") return player.rematchVote ? "已投票再戰" : "等待再戰";
  return "";
}

function renderLaneSelectors() {
  el.laneSelect.innerHTML = "";
  ["up", "mid", "down"].forEach((lane) => {
    const btn = document.createElement("button");
    btn.className = `pick ${state.selectedLane === lane ? "active" : ""}`;
    btn.innerHTML = `<strong>${laneLabel[lane]}</strong><small>站到這一路等待接球或防守。</small>`;
    btn.addEventListener("click", () => {
      state.selectedLane = lane;
      renderSelections();
    });
    el.laneSelect.appendChild(btn);
  });

  el.targetLaneSelect.innerHTML = "";
  ["up", "mid", "down"].forEach((lane) => {
    const btn = document.createElement("button");
    btn.className = `pick ${state.selectedTargetLane === lane ? "active" : ""}`;
    btn.innerHTML = `<strong>${laneLabel[lane]}</strong><small>曲球成功時將球導向這一路。</small>`;
    btn.addEventListener("click", () => {
      state.selectedTargetLane = lane;
      renderSelections();
    });
    el.targetLaneSelect.appendChild(btn);
  });
}

function renderActions() {
  el.actionGrid.innerHTML = "";
  ["drive", "power", "curve", "guard", "charge"].forEach((action) => {
    const btn = document.createElement("button");
    btn.className = `pick ${state.selectedAction === action ? "active" : ""}`;
    btn.innerHTML = `<strong>${actionLabel[action]}</strong><small>${actionDesc[action]}</small>`;
    btn.addEventListener("click", () => {
      state.selectedAction = action;
      renderSelections();
    });
    el.actionGrid.appendChild(btn);
  });
}

function renderCards() {
  el.cardGrid.innerHTML = "";
  const me = state.room?.you ? state.room.players[state.room.you] : null;
  const deck = me?.deck || [];
  if (!deck.length) {
    const empty = document.createElement("div");
    empty.className = "pick";
    empty.innerHTML = "<strong>沒有戰術卡</strong><small>本局目前沒有可用的戰術卡。</small>";
    el.cardGrid.appendChild(empty);
    return;
  }

  const noneBtn = document.createElement("button");
  noneBtn.className = `pick ${state.selectedCardId === null ? "active" : ""}`;
  noneBtn.innerHTML = "<strong>不使用</strong><small>本回合不啟用戰術卡。</small>";
  noneBtn.addEventListener("click", () => {
    state.selectedCardId = null;
    renderSelections();
  });
  el.cardGrid.appendChild(noneBtn);

  deck.forEach((card) => {
    const btn = document.createElement("button");
    btn.className = `pick ${state.selectedCardId === card.id ? "active" : ""}`;
    btn.innerHTML = `<strong>${card.name}</strong><small>${card.desc}</small>`;
    btn.addEventListener("click", () => {
      state.selectedCardId = card.id;
      renderSelections();
    });
    el.cardGrid.appendChild(btn);
  });
}

function renderSelections() {
  renderLaneSelectors();
  renderActions();
  renderCards();

  el.selectionSummary.textContent =
    `站位：${laneLabel[state.selectedLane]}｜球技：${actionLabel[state.selectedAction]}` +
    `${state.selectedAction === "curve" ? `｜目標：${laneLabel[state.selectedTargetLane]}` : ""}` +
    `${state.selectedCardId ? `｜戰術卡：${state.selectedCardId}` : ""}`;

  const me = state.room?.you ? state.room.players[state.room.you] : null;
  el.submitTurnBtn.disabled = !(state.room?.phase === "playing" && me && !me.submitted);
}

function renderRoom(room) {
  state.room = room;

  el.lobbyCard.classList.add("hidden");
  el.roomCard.classList.remove("hidden");

  el.roomCode.textContent = room.code;
  el.phasePill.textContent = phaseText(room.phase, room.winner);
  el.turnNumber.textContent = room.phase === "lobby" ? "-" : room.turn;
  el.youBox.textContent = room.you === "left" ? "你是左側（房主）" : room.you === "right" ? "你是右側（挑戰者）" : "尚未入座";

  const left = room.players.left;
  const right = room.players.right;

  el.leftName.textContent = left.name;
  el.rightName.textContent = right.name;
  el.leftHp.textContent = left.hp;
  el.rightHp.textContent = right.hp;
  el.leftEnergy.textContent = left.energy;
  el.rightEnergy.textContent = right.energy;
  el.leftScore.textContent = left.score;
  el.rightScore.textContent = right.score;

  updateBar(el.leftHpBar, left.hp / 7);
  updateBar(el.rightHpBar, right.hp / 7);
  updateBar(el.leftEnergyBar, left.energy / 5);
  updateBar(el.rightEnergyBar, right.energy / 5);

  el.leftStatus.textContent = sideStatus(left, room.phase);
  el.rightStatus.textContent = sideStatus(right, room.phase);

  el.laneNodes.forEach((node) => {
    node.classList.toggle("active", node.dataset.lane === room.ballLane);
  });

  const me = room.you ? room.players[room.you] : null;
  el.readyBtn.classList.toggle("hidden", room.phase !== "lobby");
  el.readyBtn.textContent = me?.ready ? "取消準備" : "準備";
  el.rematchBtn.classList.toggle("hidden", room.phase !== "ended");
  el.rematchBtn.disabled = !me || me.rematchVote;

  renderSelections();

  el.logList.innerHTML = "";
  room.log.forEach((item) => {
    const div = document.createElement("div");
    div.className = "log-item";
    div.innerHTML = `<strong>${item.title}</strong><div>${item.detail}</div>`;
    el.logList.appendChild(div);
  });

  if (room.phase === "ended" && room.winner) {
    if (room.winner === room.you) toast("你獲勝了！", "success");
    else if (room.you) toast("你落敗了。", "error");
  }
}

el.createRoomBtn.addEventListener("click", () => {
  socket.emit("room:create", { name: el.hostName.value.trim() || "房主" });
});

el.joinRoomBtn.addEventListener("click", () => {
  socket.emit("room:join", {
    code: el.roomCodeInput.value.trim(),
    name: el.guestName.value.trim() || "挑戰者"
  });
});

el.copyCodeBtn.addEventListener("click", async () => {
  if (!state.room?.code) return;
  try {
    await navigator.clipboard.writeText(state.room.code);
    toast("房號已複製。", "success");
  } catch {
    toast("複製失敗。", "error");
  }
});

el.readyBtn.addEventListener("click", () => {
  if (!state.room || !state.room.you) return;
  const me = state.room.players[state.room.you];
  socket.emit("player:ready", { ready: !me.ready });
});

el.submitTurnBtn.addEventListener("click", () => {
  socket.emit("turn:submit", {
    lane: state.selectedLane,
    action: state.selectedAction,
    cardId: state.selectedCardId,
    targetLane: state.selectedTargetLane
  });
});

el.rematchBtn.addEventListener("click", () => {
  socket.emit("match:rematch");
});

socket.on("connect", () => {
  el.connectionBadge.textContent = "已連線";
});

socket.on("disconnect", () => {
  el.connectionBadge.textContent = "連線中斷";
  toast("與伺服器連線中斷。", "error");
});

socket.on("room:created", ({ code }) => {
  toast(`房間已建立，房號：${code}`, "success");
});

socket.on("room:update", (room) => {
  renderRoom(room);
});

socket.on("toast", ({ message, type }) => {
  toast(message, type);
});
