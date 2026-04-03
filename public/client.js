const socket = io();

const state = {
  room: null,
  selectedAction: null,
  youReady: false
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
  leftHpBar: document.getElementById("leftHpBar"),
  rightHpBar: document.getElementById("rightHpBar"),
  leftEnergyBar: document.getElementById("leftEnergyBar"),
  rightEnergyBar: document.getElementById("rightEnergyBar"),
  leftStatus: document.getElementById("leftStatus"),
  rightStatus: document.getElementById("rightStatus"),
  turnNumber: document.getElementById("turnNumber"),
  youBox: document.getElementById("youBox"),
  actionsWrap: document.getElementById("actionsWrap"),
  submitActionBtn: document.getElementById("submitActionBtn"),
  selectedActionText: document.getElementById("selectedActionText"),
  readyBtn: document.getElementById("readyBtn"),
  rematchBtn: document.getElementById("rematchBtn"),
  logList: document.getElementById("logList"),
  toastContainer: document.getElementById("toastContainer"),
  actionBtns: Array.from(document.querySelectorAll(".action-btn"))
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
    if (winner === "draw") return "平手";
    return winner === "left" ? "左側獲勝" : "右側獲勝";
  }
  return phase;
}

function sideStatus(player, phase) {
  if (!player.connected) return "已離線";
  if (phase === "lobby") return player.isReady ? "已準備" : "等待準備";
  if (phase === "playing") return player.submitted ? "已鎖定動作" : "思考中";
  if (phase === "ended") return player.rematchVote ? "已投票再戰" : "等待再戰";
  return "";
}

function actionLabel(action) {
  return {
    attack: "普通攻擊",
    guard: "防禦",
    charge: "蓄力",
    special: "強襲",
    heal: "治療"
  }[action] || action;
}

function renderRoom(room) {
  state.room = room;

  el.lobbyCard.classList.add("hidden");
  el.roomCard.classList.remove("hidden");

  el.roomCode.textContent = room.code;
  el.phasePill.textContent = phaseText(room.phase, room.winner);
  el.turnNumber.textContent = room.phase === "lobby" ? "-" : room.turn;
  el.youBox.textContent = room.you === "left" ? "你是左側（房主）" : room.you === "right" ? "你是右側（挑戰者）" : "觀察中";

  const L = room.players.left;
  const R = room.players.right;

  el.leftName.textContent = L.name;
  el.rightName.textContent = R.name;

  el.leftHp.textContent = L.hp;
  el.rightHp.textContent = R.hp;
  el.leftEnergy.textContent = L.energy;
  el.rightEnergy.textContent = R.energy;

  updateBar(el.leftHpBar, L.hp / 24);
  updateBar(el.rightHpBar, R.hp / 24);
  updateBar(el.leftEnergyBar, L.energy / 5);
  updateBar(el.rightEnergyBar, R.energy / 5);

  el.leftStatus.textContent = sideStatus(L, room.phase);
  el.rightStatus.textContent = sideStatus(R, room.phase);

  const me = room.you ? room.players[room.you] : null;
  const canSubmit = room.phase === "playing" && me && !me.submitted;
  el.actionsWrap.classList.toggle("hidden", room.phase !== "playing");
  el.submitActionBtn.disabled = !canSubmit || !state.selectedAction;

  el.readyBtn.classList.toggle("hidden", room.phase !== "lobby");
  el.readyBtn.textContent = me?.isReady ? "取消準備" : "準備";

  el.rematchBtn.classList.toggle("hidden", room.phase !== "ended");
  el.rematchBtn.disabled = !me || me.rematchVote;

  if (room.phase === "ended" && room.winner) {
    if (room.winner === "draw") {
      toast("本局平手。", "info");
    } else if (room.winner === room.you) {
      toast("你獲勝了！", "success");
    } else if (room.you) {
      toast("你落敗了。", "error");
    }
  }

  el.actionBtns.forEach((btn) => {
    const active = btn.dataset.action === state.selectedAction;
    btn.classList.toggle("active", active);
    btn.disabled = room.phase !== "playing" || !me || me.submitted;
  });

  el.selectedActionText.textContent = state.selectedAction
    ? `目前選擇：${actionLabel(state.selectedAction)}`
    : "尚未選擇";

  el.logList.innerHTML = "";
  room.log.forEach((item) => {
    const div = document.createElement("div");
    div.className = "log-item";
    div.innerHTML = `<strong>${item.title}</strong><div>${item.detail}</div>`;
    el.logList.appendChild(div);
  });
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
    toast("複製失敗，請手動複製。", "error");
  }
});

el.readyBtn.addEventListener("click", () => {
  if (!state.room || !state.room.you) return;
  const me = state.room.players[state.room.you];
  socket.emit("player:ready", { ready: !me.isReady });
});

el.submitActionBtn.addEventListener("click", () => {
  if (!state.selectedAction) {
    toast("請先選擇動作。", "error");
    return;
  }
  socket.emit("turn:submit", { action: state.selectedAction });
});

el.rematchBtn.addEventListener("click", () => {
  socket.emit("match:rematch");
});

el.actionBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    state.selectedAction = btn.dataset.action;
    if (state.room) renderRoom(state.room);
  });
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
