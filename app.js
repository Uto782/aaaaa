(function () {
  "use strict";

  const UUID_SERVICE = "12345678-1234-5678-1234-56789abcdef0";
  const UUID_HIT = "12345678-1234-5678-1234-56789abcdef1";
  const UUID_VIB = "12345678-1234-5678-1234-56789abcdef2";

  const HOLD_MS = 2000;
  const WINDOW_MS = 30000;
  const LEVEL_DOWN_DELAY_MS = 3000;
  const GLITTER_COST_COLOR = 5;

  const el = (id) => document.getElementById(id);

  const views = {
    connect: el("view-connect"),
    cheer: el("view-cheer")
  };

  const overlay = el("overlay");
  const panel = el("panel");
  const sheet = el("sheet");
  const sheetTitle = el("sheet-title");
  const sheetBody = el("sheet-body");

  const toast = el("toast");

  let btDevice = null;
  let gattServer = null;
  let hitChar = null;
  let vibChar = null;

  let holdTimer = null;
  let isPaused = false;
  let levelDownTimer = null;

  const STORAGE_KEY = "cheer_parent_webapp_v1";

  function nowMs() {
    return Date.now();
  }

  function dateKeyLocal() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + da;
  }

  function buildDailyMissions() {
    return [
      {
        id: "m_window_10",
        title: "30秒で10回こえる",
        desc: "直近30秒で10回以上",
        reward: 2,
        achieved: false,
        claimed: false
      },
      {
        id: "m_total_50",
        title: "合計50回たたく",
        desc: "きょうの合計が50回",
        reward: 1,
        achieved: false,
        claimed: false
      },
      {
        id: "m_level_3",
        title: "熱さLv3にする",
        desc: "熱さがLv3以上",
        reward: 2,
        achieved: false,
        claimed: false
      }
    ];
  }

  function defaultState() {
    return {
      tickets: 0,
      glitter: 0,
      inventory: [],
      equippedItemId: "",
      realWishlist: [],
      firstBonusClaimed: false,
      settings: {
        sensitivity: 50,
        vibration: 60
      },
      daily: {
        dateKey: dateKeyLocal(),
        totalHits: 0,
        hitTimes: [],
        passionLevel: 0,
        missions: buildDailyMissions()
      }
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const obj = JSON.parse(raw);
      const st = Object.assign(defaultState(), obj);

      if (!st.daily || st.daily.dateKey !== dateKeyLocal()) {
        st.daily = {
          dateKey: dateKeyLocal(),
          totalHits: 0,
          hitTimes: [],
          passionLevel: 0,
          missions: buildDailyMissions()
        };
      }
      if (!Array.isArray(st.inventory)) st.inventory = [];
      if (!Array.isArray(st.realWishlist)) st.realWishlist = [];
      if (!st.settings) st.settings = { sensitivity: 50, vibration: 60 };
      if (!st.daily.missions || !Array.isArray(st.daily.missions)) {
        st.daily.missions = buildDailyMissions();
      }
      return st;
    } catch (e) {
      return defaultState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  let state = loadState();

  function showToast(msg) {
    toast.textContent = msg;
    toast.style.display = "block";
    setTimeout(() => { toast.style.display = "none"; }, 1800);
  }

  function setView(name) {
    Object.values(views).forEach(v => v.classList.remove("view-active"));
    views[name].classList.add("view-active");
  }

  function setSupportHint() {
    const hint = el("support-hint");
    if (!("bluetooth" in navigator)) {
      hint.textContent = "このブラウザではBluetoothが使えません。Bluefyで開いてください。";
      return;
    }
    hint.textContent = "Bluefyで開いて「さがす」から接続します。";
  }

  function setConnState(text) {
    el("conn-state").textContent = text;
    el("panel-conn").textContent = text;
  }

  function updateConnectUI() {
    el("sens-slider").value = String(state.settings.sensitivity);
    el("vib-slider").value = String(state.settings.vibration);
    el("sens-slider-2").value = String(state.settings.sensitivity);
    el("vib-slider-2").value = String(state.settings.vibration);

    el("btn-connect").disabled = !btDevice;
    el("btn-start").disabled = !(hitChar && vibChar);
  }

  function updateHeatDots(level) {
    const dots = el("heat-dots");
    dots.innerHTML = "";
    const max = 5;
    const onCount = Math.min(max, level + 1);
    let i = 0;
    while (i < max) {
      const d = document.createElement("div");
      d.className = i < onCount ? "dot dot-on" : "dot";
      dots.appendChild(d);
      i += 1;
    }
  }

  function levelLabel(level) {
    if (level <= 0) return "ふつう";
    if (level === 1) return "あつい";
    if (level === 2) return "かなりあつい";
    if (level === 3) return "さいこう";
    return "最高潮";
  }

  function updateFlame(level) {
    const flame = el("flame");
    flame.className = "flame level-" + String(level);
    el("flame-text").textContent = levelLabel(level);
  }

  function computeWindowHits() {
    const t = nowMs();
    const limit = t - WINDOW_MS;
    const arr = state.daily.hitTimes;
    while (arr.length > 0 && arr[0] < limit) {
      arr.shift();
    }
    return arr.length;
  }

  function computePassionLevelFromWindow(windowHits) {
    if (windowHits >= 25) return 4;
    if (windowHits >= 20) return 3;
    if (windowHits >= 15) return 2;
    if (windowHits >= 10) return 1;
    return 0;
  }

  function scheduleLevelDownIfNeeded(nextLevel) {
    if (nextLevel >= state.daily.passionLevel) {
      if (levelDownTimer) {
        clearTimeout(levelDownTimer);
        levelDownTimer = null;
      }
      return;
    }
    if (levelDownTimer) return;
    levelDownTimer = setTimeout(() => {
      levelDownTimer = null;
      const windowHits = computeWindowHits();
      const trueLevel = computePassionLevelFromWindow(windowHits);
      if (trueLevel < state.daily.passionLevel) {
        state.daily.passionLevel = trueLevel;
        saveState();
        updateCheerUI();
        updateMissionsProgress();
      }
    }, LEVEL_DOWN_DELAY_MS);
  }

  function onHit() {
    if (isPaused) return;

    const t = nowMs();
    state.daily.totalHits += 1;
    state.daily.hitTimes.push(t);

    const windowHits = computeWindowHits();
    const nextLevel = computePassionLevelFromWindow(windowHits);

    if (nextLevel > state.daily.passionLevel) {
      state.daily.passionLevel = nextLevel;
      showToast("アツい！");
      sendVibration(1, state.settings.vibration);
    } else {
      scheduleLevelDownIfNeeded(nextLevel);
    }

    saveState();
    updateCheerUI();
    updateMissionsProgress();
  }

  function updateMissionsProgress() {
    const windowHits = computeWindowHits();
    const level = state.daily.passionLevel;
    const total = state.daily.totalHits;

    state.daily.missions.forEach(m => {
      if (m.id === "m_window_10") {
        m.achieved = windowHits >= 10;
      } else if (m.id === "m_total_50") {
        m.achieved = total >= 50;
      } else if (m.id === "m_level_3") {
        m.achieved = level >= 3;
      }
    });
    saveState();
  }

  function claimMission(id) {
    const m = state.daily.missions.find(x => x.id === id);
    if (!m) return;
    if (!m.achieved) return;
    if (m.claimed) return;
    m.claimed = true;
    state.tickets += m.reward;
    saveState();
    showToast("チケット +" + String(m.reward));
  }

  function claimFirstBonus() {
    if (state.firstBonusClaimed) return;
    state.firstBonusClaimed = true;
    state.tickets += 10;
    saveState();
    showToast("はじめてボーナス +10");
  }

  function getItemPool() {
    return [
      { itemId: "cap_flame_01", name: "ほのおキャップ", rarity: "N", colors: ["オレンジ", "あか", "きいろ"] },
      { itemId: "cap_flame_02", name: "キラほのおキャップ", rarity: "R", colors: ["オレンジ", "ピンク", "しろ"] },
      { itemId: "cap_flame_03", name: "もくもくキャップ", rarity: "N", colors: ["グレー", "しろ", "あお"] },
      { itemId: "mascot_01", name: "にこにこスター", rarity: "N", colors: ["きいろ", "しろ", "ピンク"] },
      { itemId: "mascot_02", name: "ちいさなライオン", rarity: "R", colors: ["きいろ", "オレンジ", "しろ"] },
      { itemId: "mascot_03", name: "まるまるパンダ", rarity: "N", colors: ["しろ", "くろ", "みずいろ"] },
      { itemId: "mecha_01", name: "メカキャップ", rarity: "N", colors: ["シルバー", "あお", "むらさき"] },
      { itemId: "mecha_02", name: "ライトメカ", rarity: "R", colors: ["シルバー", "みどり", "あお"] },
      { itemId: "mecha_03", name: "ジェットキャップ", rarity: "SR", colors: ["シルバー", "あか", "あお"] },
      { itemId: "cap_fun_01", name: "ふわふわキャップ", rarity: "N", colors: ["ピンク", "しろ", "みずいろ"] },
      { itemId: "cap_fun_02", name: "スパークキャップ", rarity: "R", colors: ["あか", "きいろ", "しろ"] },
      { itemId: "cap_fun_03", name: "つぶつぶキャップ", rarity: "N", colors: ["みどり", "きいろ", "しろ"] },
      { itemId: "mascot_04", name: "ハートくん", rarity: "N", colors: ["ピンク", "むらさき", "しろ"] },
      { itemId: "mascot_05", name: "おうえんロボ", rarity: "R", colors: ["あお", "みどり", "しろ"] },
      { itemId: "mascot_06", name: "ドラゴンミニ", rarity: "SR", colors: ["あか", "むらさき", "くろ"] },
      { itemId: "mecha_04", name: "ギアキャップ", rarity: "N", colors: ["シルバー", "くろ", "しろ"] },
      { itemId: "mecha_05", name: "ネオンキャップ", rarity: "R", colors: ["みどり", "むらさき", "あお"] },
      { itemId: "cap_flame_04", name: "ほのおつの", rarity: "SR", colors: ["オレンジ", "あか", "くろ"] },
      { itemId: "cap_flame_05", name: "しずくほのお", rarity: "N", colors: ["みずいろ", "しろ", "あお"] }
    ];
  }

  function weightedPick(pool) {
    const weights = pool.map(it => {
      if (it.rarity === "SR") return 2;
      if (it.rarity === "R") return 18;
      return 80;
    });
    let sum = 0;
    let i = 0;
    while (i < weights.length) {
      sum += weights[i];
      i += 1;
    }
    const rand = Math.random();
    const rInit = Math.floor(rand / (1 / sum));
    let r = rInit;
    let j = 0;
    while (j < pool.length) {
      r -= weights[j];
      if (r < 0) return pool[j];
      j += 1;
    }
    return pool[0];
  }

  function ensureEquippedFallback() {
    if (state.equippedItemId) return;
    if (state.inventory.length > 0) state.equippedItemId = state.inventory[0].itemId;
  }

  function gachaOnce() {
    if (state.tickets <= 0) {
      showToast("チケットがない");
      return;
    }
    state.tickets -= 1;

    const pool = getItemPool();
    const item = weightedPick(pool);

    const owned = state.inventory.find(x => x.itemId === item.itemId);
    if (!owned) {
      state.inventory.push({
        itemId: item.itemId,
        name: item.name,
        ownedCount: 1,
        unlockedColors: [item.colors[0]]
      });
      if (!state.equippedItemId) state.equippedItemId = item.itemId;
      showToast("でた！ " + item.name);
    } else {
      owned.ownedCount += 1;
      state.glitter += 1;
      showToast("かぶり！ キラ粉 +1");
    }

    saveState();
  }

  function toggleWishlist(itemId) {
    const idx = state.realWishlist.indexOf(itemId);
    if (idx >= 0) state.realWishlist.splice(idx, 1);
    else state.realWishlist.push(itemId);
    saveState();
  }

  function equipItem(itemId) {
    state.equippedItemId = itemId;
    saveState();
    showToast("つけた！");
  }

  function unlockColor(itemId) {
    if (state.glitter < GLITTER_COST_COLOR) {
      showToast("キラ粉がたりない");
      return;
    }
    const pool = getItemPool();
    const def = pool.find(x => x.itemId === itemId);
    if (!def) return;
    const inv = state.inventory.find(x => x.itemId === itemId);
    if (!inv) return;

    const available = def.colors.filter(c => inv.unlockedColors.indexOf(c) < 0);
    if (available.length === 0) {
      showToast("もう増やせない");
      return;
    }
    state.glitter -= GLITTER_COST_COLOR;
    inv.unlockedColors.push(available[0]);
    saveState();
    showToast("色がふえた！");
  }

  function missionProgressText(id) {
    const windowHits = computeWindowHits();
    const level = state.daily.passionLevel;
    const total = state.daily.totalHits;

    if (id === "m_window_10") return String(Math.min(10, windowHits)) + " / 10";
    if (id === "m_total_50") return String(Math.min(50, total)) + " / 50";
    if (id === "m_level_3") return String(Math.min(3, level)) + " / 3";
    return "0 / 1";
  }

  function renderMissions() {
    const t = [];
    t.push("<div class='kv'><div class='k'>チケット</div><div class='v'>" + String(state.tickets) + "枚</div></div>");
    t.push("<div class='kv'><div class='k'>キラ粉</div><div class='v'>" + String(state.glitter) + "</div></div>");

    if (!state.firstBonusClaimed) {
      t.push("<div class='card' style='margin-top:12px;'>");
      t.push("<div style='font-weight:900; font-size:14px;'>はじめてボーナス</div>");
      t.push("<div class='small'>デモ用：チケット10枚</div>");
      t.push("<button id='btn-claim-first' class='btn btn-accent' style='width:100%; margin-top:10px;'>うけとる</button>");
      t.push("</div>");
    }

    t.push("<div style='margin-top:12px;' class='item-grid' id='mission-grid'></div>");
    sheetBody.innerHTML = t.join("");

    const grid = el("mission-grid");
    grid.innerHTML = "";

    state.daily.missions.forEach(m => {
      const card = document.createElement("div");
      card.className = "item-card";

      const status = m.claimed ? "受け取り済み" : (m.achieved ? "達成" : "未達成");
      const progressText = missionProgressText(m.id);

      card.innerHTML =
        "<div class='item-name'>" + esc(m.title) + "</div>" +
        "<div class='item-sub'>" + esc(m.desc) + "</div>" +
        "<div class='item-sub'>進みぐあい " + esc(progressText) + "</div>" +
        "<div class='item-sub'>状態 " + esc(status) + "</div>" +
        "<div class='badge'>チケット " + String(m.reward) + "</div>";

      const btn = document.createElement("button");
      btn.className = "btn btn-primary";
      btn.style.width = "100%";
      btn.style.marginTop = "10px";
      btn.textContent = m.claimed ? "うけとった" : (m.achieved ? "うけとる" : "まだ");
      btn.disabled = m.claimed || !m.achieved;
      btn.addEventListener("click", () => {
        claimMission(m.id);
        openSheet("ミッション", renderMissions);
        updatePanelStats();
      });

      card.appendChild(btn);
      grid.appendChild(card);
    });

    const claim = el("btn-claim-first");
    if (claim) {
      claim.addEventListener("click", () => {
        claimFirstBonus();
        openSheet("ミッション", renderMissions);
      });
    }
  }

  function renderGacha() {
    const t = [];
    t.push("<div class='kv'><div class='k'>チケット</div><div class='v'>" + String(state.tickets) + "枚</div></div>");
    t.push("<div class='card' style='margin-top:12px;'>");
    t.push("<button id='btn-gacha-once' class='btn btn-accent' style='width:100%;'>1回ひく（1枚）</button>");
    t.push("<div class='small' style='margin-top:10px;'>おとなが押してね</div>");
    t.push("</div>");
    t.push("<div class='card' style='margin-top:12px;'>");
    t.push("<div class='kv'><div class='k'>キラ粉</div><div class='v'>" + String(state.glitter) + "</div></div>");
    t.push("<div class='small'>かぶりでキラ粉がふえる。キラ粉5で色をふやせる。</div>");
    t.push("</div>");
    sheetBody.innerHTML = t.join("");

    el("btn-gacha-once").addEventListener("click", () => {
      gachaOnce();
      openSheet("ガチャ", renderGacha);
    });
  }

  function renderRealize() {
    const t = [];
    const list = state.realWishlist.slice();
    if (list.length === 0) {
      t.push("<div class='small'>候補がない。コレクションで候補にする。</div>");
    } else {
      t.push("<div class='small'>候補</div>");
      t.push("<div class='card' style='margin-top:12px;'>");
      list.forEach(id => {
        const name = itemNameById(id);
        t.push("<div class='kv'><div class='k'>" + esc(name) + "</div><div class='v'>候補</div></div>");
      });
      t.push("</div>");
    }
    t.push("<div class='card' style='margin-top:12px;'>");
    t.push("<div style='font-weight:900;'>つぎへ</div>");
    t.push("<div class='small'>2秒長押しでつぎへ（プロト）</div>");
    t.push("<button id='btn-real-next' class='btn btn-accent' style='width:100%; margin-top:10px;'>長押しエリア</button>");
    t.push("</div>");
    sheetBody.innerHTML = t.join("");

    const btn = el("btn-real-next");
    attachLongPress(btn, HOLD_MS, () => {
      openSheet("注文画面（プロト）", renderOrderDummy);
    });
  }

  function renderOrderDummy() {
    const t = [];
    t.push("<div class='card'>");
    t.push("<div style='font-weight:900; font-size:16px;'>注文画面（プロト）</div>");
    t.push("<div class='small' style='margin-top:10px;'>ここから先はこれから作る。いまは導線の確認用。</div>");
    t.push("</div>");
    sheetBody.innerHTML = t.join("");
  }

  function renderCollection() {
    ensureEquippedFallback();
    const equipped = state.equippedItemId;

    const t = [];
    t.push("<div class='kv'><div class='k'>装着中</div><div class='v'>" + esc(equippedName()) + "</div></div>");
    t.push("<div class='kv'><div class='k'>チケット</div><div class='v'>" + String(state.tickets) + "枚</div></div>");
    t.push("<div class='kv'><div class='k'>キラ粉</div><div class='v'>" + String(state.glitter) + "</div></div>");
    t.push("<div style='margin-top:12px;' class='item-grid' id='inv-grid'></div>");
    t.push("<div class='card' style='margin-top:12px;'>");
    t.push("<div style='font-weight:900;'>現物化候補</div>");
    t.push("<div class='small'>候補を選んで、あとで本物にできる（プロト）</div>");
    t.push("<button id='btn-open-real' class='btn btn-primary' style='width:100%; margin-top:10px;'>みる</button>");
    t.push("</div>");
    sheetBody.innerHTML = t.join("");

    const grid = el("inv-grid");
    grid.innerHTML = "";

    if (state.inventory.length === 0) {
      const d = document.createElement("div");
      d.className = "small";
      d.textContent = "まだない。ガチャでふやそう。";
      grid.appendChild(d);
    }

    state.inventory.forEach(it => {
      const card = document.createElement("div");
      card.className = "item-card";
      const isEq = it.itemId === equipped;
      const wish = state.realWishlist.indexOf(it.itemId) >= 0;

      const badge = isEq ? "<div class='badge'>装着中</div>" : "";
      const wishText = wish ? "候補" : "なし";

      card.innerHTML =
        "<div class='item-name'>" + esc(it.name) + "</div>" +
        "<div class='item-sub'>もってる " + String(it.ownedCount) + "</div>" +
        "<div class='item-sub'>色 " + esc(it.unlockedColors.join(" / ")) + "</div>" +
        "<div class='item-sub'>現物化候補 " + esc(wishText) + "</div>" +
        badge;

      const btnRow = document.createElement("div");
      btnRow.style.display = "grid";
      btnRow.style.gridTemplateColumns = "1fr 1fr";
      btnRow.style.gap = "10px";
      btnRow.style.marginTop = "10px";

      const b1 = document.createElement("button");
      b1.className = "btn btn-primary";
      b1.textContent = "つける";
      b1.disabled = isEq;
      b1.addEventListener("click", () => {
        equipItem(it.itemId);
        openSheet("コレクション", renderCollection);
      });

      const b2 = document.createElement("button");
      b2.className = "btn";
      b2.textContent = wish ? "候補を外す" : "候補にする";
      b2.addEventListener("click", () => {
        toggleWishlist(it.itemId);
        openSheet("コレクション", renderCollection);
      });

      btnRow.appendChild(b1);
      btnRow.appendChild(b2);
      card.appendChild(btnRow);

      const b3 = document.createElement("button");
      b3.className = "btn btn-accent";
      b3.style.width = "100%";
      b3.style.marginTop = "10px";
      b3.textContent = "色をふやす（キラ粉5）";
      b3.addEventListener("click", () => {
        unlockColor(it.itemId);
        openSheet("コレクション", renderCollection);
      });

      card.appendChild(b3);
      grid.appendChild(card);
    });

    el("btn-open-real").addEventListener("click", () => {
      openSheet("現物化（プロト）", renderRealize);
    });
  }

  function equippedName() {
    if (!state.equippedItemId) return "なし";
    const it = state.inventory.find(x => x.itemId === state.equippedItemId);
    return it ? it.name : "なし";
  }

  function itemNameById(id) {
    const inv = state.inventory.find(x => x.itemId === id);
    if (inv) return inv.name;
    const pool = getItemPool();
    const def = pool.find(x => x.itemId === id);
    return def ? def.name : id;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updatePanelStats() {
    el("panel-total").textContent = String(state.daily.totalHits) + "回";
    const windowHits = computeWindowHits();
    el("panel-window").textContent = String(windowHits) + "回";
    el("panel-level").textContent = "Lv" + String(state.daily.passionLevel);
  }

  function updateCheerUI() {
    el("total-hits").textContent = String(state.daily.totalHits) + "回";
    updateHeatDots(state.daily.passionLevel);
    updateFlame(state.daily.passionLevel);
    updatePanelStats();
  }

  function openOverlay() {
    overlay.classList.add("overlay-active");
    overlay.setAttribute("aria-hidden", "false");
  }

  function closeOverlay() {
    overlay.classList.remove("overlay-active");
    overlay.setAttribute("aria-hidden", "true");
    closeSheet();
  }

  function openSheet(title, renderer) {
    sheetTitle.textContent = title;
    sheet.classList.add("sheet-active");
    panel.style.display = "none";
    renderer();
  }

  function closeSheet() {
    sheet.classList.remove("sheet-active");
    sheetBody.innerHTML = "";
    panel.style.display = "block";
  }

  function openPanel() {
    updatePanelStats();
    openOverlay();
    panel.style.display = "block";
    closeSheet();
  }

  function closePanel() {
    closeOverlay();
  }

  function attachLongPress(target, ms, onDone) {
    let t = null;
    const clear = () => {
      if (t) {
        clearTimeout(t);
        t = null;
      }
    };
    target.addEventListener("pointerdown", () => {
      clear();
      t = setTimeout(() => {
        t = null;
        onDone();
      }, ms);
    });
    target.addEventListener("pointerup", clear);
    target.addEventListener("pointercancel", clear);
    target.addEventListener("pointerleave", clear);
  }

  async function requestDevice() {
    if (!("bluetooth" in navigator)) {
      showToast("Bluefyで開いてください");
      return;
    }
    try {
      setConnState("選択中…");
      const dev = await navigator.bluetooth.requestDevice({
        filters: [{ services: [UUID_SERVICE] }],
        optionalServices: [UUID_SERVICE]
      });
      btDevice = dev;
      el("device-name").textContent = dev.name || "名前なし";
      setConnState("未接続");
      btDevice.addEventListener("gattserverdisconnected", onDisconnected);
      showToast("デバイスを選んだ");
      updateConnectUI();
    } catch (e) {
      setConnState("未接続");
      showToast("キャンセル");
    }
  }

  async function connectGatt() {
    if (!btDevice) return;
    try {
      setConnState("接続中…");
      gattServer = await btDevice.gatt.connect();
      const service = await gattServer.getPrimaryService(UUID_SERVICE);

      hitChar = await service.getCharacteristic(UUID_HIT);
      vibChar = await service.getCharacteristic(UUID_VIB);

      await hitChar.startNotifications();
      hitChar.addEventListener("characteristicvaluechanged", onHitNotify);

      setConnState("接続できた！");
      showToast("接続できた");
      updateConnectUI();
    } catch (e) {
      setConnState("未接続");
      showToast("接続できない");
      hitChar = null;
      vibChar = null;
      updateConnectUI();
    }
  }

  function onDisconnected() {
    setConnState("切断");
    hitChar = null;
    vibChar = null;
    updateConnectUI();
    if (views.cheer.classList.contains("view-active")) {
      showToast("切れた。つなぎ直してね");
      openPanel();
    }
  }

  function onHitNotify(ev) {
    const dv = ev.target.value;
    let ok = true;
    try {
      dv.getUint32(0, true);
    } catch (e) {
      ok = false;
    }
    if (ok) onHit();
  }

  async function sendVibration(patternId, strength) {
    if (!vibChar) return;
    const s = Math.max(0, Math.min(100, Math.floor(strength)));
    const p = Math.max(0, Math.min(2, Math.floor(patternId)));
    const data = new Uint8Array([p, s]);
    try {
      await vibChar.writeValue(data);
    } catch (e) {
      showToast("送れない");
    }
  }

  function bindEvents() {
    setSupportHint();
    setConnState("未接続");

    el("btn-search").addEventListener("click", requestDevice);
    el("btn-connect").addEventListener("click", connectGatt);
    el("btn-start").addEventListener("click", () => {
      setView("cheer");
      updateCheerUI();
      showToast("応援スタート");
    });

    el("sens-slider").addEventListener("input", (e) => {
      state.settings.sensitivity = Number(e.target.value);
      el("sens-slider-2").value = String(state.settings.sensitivity);
      saveState();
    });
    el("vib-slider").addEventListener("input", (e) => {
      state.settings.vibration = Number(e.target.value);
      el("vib-slider-2").value = String(state.settings.vibration);
      saveState();
    });
    el("sens-slider-2").addEventListener("input", (e) => {
      state.settings.sensitivity = Number(e.target.value);
      el("sens-slider").value = String(state.settings.sensitivity);
      saveState();
    });
    el("vib-slider-2").addEventListener("input", (e) => {
      state.settings.vibration = Number(e.target.value);
      el("vib-slider").value = String(state.settings.vibration);
      saveState();
    });

    el("btn-close-panel").addEventListener("click", closePanel);
    el("btn-close-sheet").addEventListener("click", () => {
      closeSheet();
    });

    el("btn-missions").addEventListener("click", () => openSheet("ミッション", renderMissions));
    el("btn-gacha").addEventListener("click", () => openSheet("ガチャ", renderGacha));
    el("btn-collection").addEventListener("click", () => openSheet("コレクション", renderCollection));

    el("btn-vib-score").addEventListener("click", () => sendVibration(0, state.settings.vibration));
    el("btn-vib-chance").addEventListener("click", () => sendVibration(1, state.settings.vibration));
    el("btn-vib-pinch").addEventListener("click", () => sendVibration(2, state.settings.vibration));

    el("btn-pause").addEventListener("click", () => {
      isPaused = !isPaused;
      el("btn-pause").textContent = isPaused ? "再開" : "いったん止める";
      showToast(isPaused ? "止めた" : "再開");
    });

    el("btn-end").addEventListener("click", () => {
      isPaused = false;
      setView("connect");
      closePanel();
      showToast("おわり");
      updateConnectUI();
    });

    const hotspot = el("parent-hotspot");
    attachLongPress(hotspot, HOLD_MS, () => {
      openPanel();
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closePanel();
    });
  }

  function init() {
    updateMissionsProgress();
    updateConnectUI();
    updateCheerUI();
    bindEvents();
  }

  init();
})();