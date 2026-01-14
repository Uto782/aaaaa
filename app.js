const SERVICE_UUID = "12345678-1234-5678-1234-56789abcdef0";

// バット側ファームに合わせる
// TAP 通知: 12345678-1234-5678-1234-56789abcdef2 (Notify)
// パターン制御: 12345678-1234-5678-1234-56789abcdef1 (Write)
const TAP_NOTIFY_UUID = "12345678-1234-5678-1234-56789abcdef2";
const PATTERN_WRITE_UUID = "12345678-1234-5678-1234-56789abcdef1";

let device = null;
let server = null;
let service = null;
let tapCharacteristic = null;
let patternCharacteristic = null;

let totalHits = 0;
let recentHits = [];
let passionLevel = 0;

let isPaused = false;
let lastPatternId = 255;
let timerId = null;

const RECENT_WINDOW_MS = 30000;

function nowMs() {
  return Date.now();
}

function pruneRecent(now) {
  const cutoff = now - RECENT_WINDOW_MS;
  while (recentHits.length > 0 && recentHits[0] < cutoff) {
    recentHits.shift();
  }
}

function calcPassionLevel(recentCount) {
  if (recentCount >= 16) return 4;
  if (recentCount >= 10) return 3;
  if (recentCount >= 5) return 2;
  if (recentCount >= 1) return 1;
  return 0;
}

function levelToPatternId(level) {
  if (level >= 4) return 2;
  if (level >= 2) return 1;
  return 0;
}

function setFlameLevel(level) {
  const flame = document.getElementById("flame-animation");
  flame.classList.remove("level-0", "level-1", "level-2", "level-3", "level-4");
  flame.classList.add("level-" + String(level));
}

function updateStatsUi() {
  document.getElementById("hit-count").textContent = String(totalHits);
  document.getElementById("total-hits").textContent = String(totalHits);
  document.getElementById("recent-hits").textContent = String(recentHits.length);
  document.getElementById("passion-level").textContent = String(passionLevel);
  setFlameLevel(passionLevel);
}

async function sendPattern(id) {
  if (!patternCharacteristic) return;

  const data = new Uint8Array([id]);

  try {
    if (patternCharacteristic.writeValueWithoutResponse) {
      await patternCharacteristic.writeValueWithoutResponse(data);
    } else {
      await patternCharacteristic.writeValue(data);
    }
    lastPatternId = id;
  } catch (e) {
    console.log("sendPattern error", e);
  }
}

function refreshDerivedState() {
  const now = nowMs();
  pruneRecent(now);

  const newLevel = calcPassionLevel(recentHits.length);
  passionLevel = newLevel;

  updateStatsUi();

  const nextPattern = isPaused ? 0 : levelToPatternId(passionLevel);
  if (nextPattern !== lastPatternId) {
    sendPattern(nextPattern);
  }
}

function onTapNotify(event) {
  if (isPaused) return;

  const v = event.target.value.getUint8(0);
  if (v === 0) return;

  totalHits += 1;
  recentHits.push(nowMs());
  refreshDerivedState();
}

async function connectGatt() {
  server = await device.gatt.connect();
  service = await server.getPrimaryService(SERVICE_UUID);

  tapCharacteristic = await service.getCharacteristic(TAP_NOTIFY_UUID);
  patternCharacteristic = await service.getCharacteristic(PATTERN_WRITE_UUID);

  tapCharacteristic.addEventListener("characteristicvaluechanged", onTapNotify);
  await tapCharacteristic.startNotifications();

  device.addEventListener("gattserverdisconnected", () => {
    stopCheeringUi();
    alert("切断されました");
  });
}

function startCheeringUi() {
  document.getElementById("connection").classList.add("hidden");
  document.getElementById("parent-panel").classList.add("hidden");

  updateStatsUi();
  refreshDerivedState();

  if (timerId) clearInterval(timerId);
  timerId = setInterval(refreshDerivedState, 250);
}

function stopCheeringUi() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }

  document.getElementById("connection").classList.remove("hidden");
  document.getElementById("connect-button").classList.add("hidden");
  document.getElementById("start-cheering").classList.add("hidden");
}

function toggleParentPanel() {
  const panel = document.getElementById("parent-panel");
  const hidden = panel.classList.contains("hidden");
  if (hidden) {
    panel.classList.remove("hidden");
  } else {
    panel.classList.add("hidden");
  }
}

document.getElementById("scan-button").addEventListener("click", async () => {
  try {
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }]
    });
    document.getElementById("connect-button").classList.remove("hidden");
  } catch (e) {
    alert("デバイスが見つかりませんでした");
  }
});

document.getElementById("connect-button").addEventListener("click", async () => {
  try {
    await connectGatt();
    document.getElementById("start-cheering").classList.remove("hidden");
  } catch (e) {
    alert("接続に失敗しました");
  }
});

document.getElementById("start-cheering").addEventListener("click", () => {
  startCheeringUi();
});

document.getElementById("hit-count").addEventListener("click", toggleParentPanel);
document.getElementById("flame-animation").addEventListener("click", toggleParentPanel);

document.getElementById("close-panel").addEventListener("click", () => {
  document.getElementById("parent-panel").classList.add("hidden");
});

document.getElementById("pause").addEventListener("click", () => {
  isPaused = !isPaused;
  const btn = document.getElementById("pause");
  btn.textContent = isPaused ? "さいかい" : "いったん止める";
  refreshDerivedState();
});

document.getElementById("test-vibration").addEventListener("click", async () => {
  await sendPattern(1);
  setTimeout(() => {
    const next = isPaused ? 0 : levelToPatternId(passionLevel);
    sendPattern(next);
  }, 500);
});
