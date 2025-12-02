import "../../docs/token_switcher/switcher.js";

const KEY = "overlap_puzzles_v1";

const COLORS = [
  ["Red", "--c-red"],
  ["Orange", "--c-orange"],
  ["Yellow", "--c-yellow"],
  ["Green", "--c-green"],
  ["Mint", "--c-mint"],
  ["Cyan", "--c-cyan"],
  ["Blue", "--c-blue"],
  ["Purple", "--c-purple"],
  ["Pink", "--c-pink"],
];

const HEIGHTS = [
  ["Full", "full"],
  ["Mid", "mid"],
  ["Inner", "inner"],
];

const MODE = { OVERLAP: "overlap", CHAIN: "chain" };
const VIEW = { PLAY: "play", CHAIN: "chain", BUILD: "build" };

// ---- Remember last tab/view ----
const LAST_VIEW_KEY = `${KEY}__last_view`;
const VALID_VIEWS = new Set(Object.values(VIEW));

function loadLastView() {
  try {
    const v = localStorage.getItem(LAST_VIEW_KEY);
    return VALID_VIEWS.has(v) ? v : VIEW.PLAY;
  } catch {
    return VIEW.PLAY;
  }
}


const DIFFS = [
  ["Easy", "easy"],
  ["Medium", "medium"],
  ["Hard", "hard"],
];

// Difficulty-to-color mapping (edit freely)
const DIFF_COLORS = {
  easy: ["--c-green", "--c-mint", "--c-cyan"],
  medium: ["--c-yellow", "--c-orange", "--c-blue"],
  hard: ["--c-red", "--c-pink", "--c-purple"],
};

// Points per correct word by difficulty (edit freely)
const DIFF_POINTS = { easy: 1, medium: 2, hard: 3 };

// Word Chain defaults
const DEFAULT_CHAIN_TIME = 60;

// ✅ Time bonus config (edit freely)
// bonusPoints = floor(remainingSeconds * TIME_BONUS_FACTOR)
const TIME_BONUS_FACTOR = 0.5;
const TIME_BONUS_ROUND = "floor"; // "floor" | "round" | "ceil"
const CHAIN_CLUE_CAP = 6;

// ---- Defaults loading (robust + cache-bust) ----
const DEFAULTS_VERSION = "2025-12-02"; // <-- bump this any time you edit examples.json
const DEFAULTS_VER_KEY = `${KEY}__defaults_version`;

// Cache-bust + bypass browser HTTP cache differences
const defaultsURL = new URL("./examples.json", import.meta.url);
defaultsURL.searchParams.set("v", DEFAULTS_VERSION);

// "no-store" helps with browser cache; the ?v= param helps across browsers + SW caches
const DEF = await (await fetch(defaultsURL, { cache: "no-store" })).json();


// ---- DOM ----
const $ = (s) => document.querySelector(s);
const els = {
  tabPlay: $("#tabPlay"),
  tabChain: $("#tabChain"),
  tabBuild: $("#tabBuild"),
  panelPlay: $("#panelPlay"),
  panelBuild: $("#panelBuild"),
  stage: $("#stage"),
  gridScroll: $("#gridScroll"),
  grid: $("#grid"),
  legend: $("#legend"),
  meta: $("#meta"),
  prev: $("#prev"),
  next: $("#next"),
  reset: $("#reset"),
  reveal: $("#reveal"),
  success: $("#success"),
  sClose: $("#sClose"),
  sAgain: $("#sAgain"),
  sNext: $("#sNext"),
  pSel: $("#pSel"),
  pNew: $("#pNew"),
  pDel: $("#pDel"),
  pSave: $("#pSave"),
  pTitle: $("#pTitle"),
  rows: $("#rows"),
  wAdd: $("#wAdd"),
  ioTxt: $("#ioTxt"),
  ioExp: $("#ioExp"),
  ioImp: $("#ioImp"),
  bGrid: $("#bGrid"),
  status: $("#status"),
  solution: $("#solution"),
  helper: document.querySelector(".helper"),
};

// ---- Storage ----
const store = {
  load() {
    try {
      const url = new URL(location.href);
      const forceReset = url.searchParams.has("reset") || url.searchParams.has("fresh");

      const savedDefaultsVer = localStorage.getItem(DEFAULTS_VER_KEY);

      // If defaults changed (or you force reset), discard saved puzzles so you get fresh examples.json
      if (forceReset || savedDefaultsVer !== DEFAULTS_VERSION) {
        localStorage.setItem(DEFAULTS_VER_KEY, DEFAULTS_VERSION);
        localStorage.removeItem(KEY);
      }

      const raw = localStorage.getItem(KEY);
      const v = raw ? JSON.parse(raw) : null;

      if (Array.isArray(v) && v.length) return v;

      // No saved puzzles => use shipped defaults
      localStorage.setItem(DEFAULTS_VER_KEY, DEFAULTS_VERSION);
      return structuredClone(DEF);
    } catch {
      return structuredClone(DEF);
    }
  },
  save() {
    localStorage.setItem(DEFAULTS_VER_KEY, DEFAULTS_VERSION);
    localStorage.setItem(KEY, JSON.stringify(puzzles));
  },
};


// ---- Utils ----
const uid = () =>
  `p-${Math.random().toString(16).slice(2, 8)}-${Date.now().toString(16)}`;
const cleanA = (s) => (s || "").toUpperCase().replace(/[^A-Z]/g, "");
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const insets = (h) => (h === "mid" ? [12.5, 12.5] : h === "inner" ? [25, 25] : [0, 0]);

let dirty = false;
const setDirty = (v = true) => {
  dirty = !!v;
  els.pSave && els.pSave.classList.toggle("is-hot", dirty);
};

const tieR = new WeakMap();
const tr = (w) => {
  let v = tieR.get(w);
  if (v == null) {
    v = Math.random();
    tieR.set(w, v);
  }
  return v;
};

const COLOR_LABEL = Object.fromEntries(COLORS.map(([lab, val]) => [val, lab]));
const isChainPuzzle = (p) => String(p?.type || MODE.OVERLAP) === MODE.CHAIN;
function chainIsTimed(p) {
  const v = p?.chainTimed ?? p?.timed ?? p?.timedMode ?? p?.isTimed; // supports common names
  return v == null ? true : !!v;
}

const inferDiffFromColor = (color) => {
  for (const d of Object.keys(DIFF_COLORS)) {
    if ((DIFF_COLORS[d] || []).includes(color)) return d;
  }
  return "easy";
};

const normWord = (w, pType, opts = {}) => {
  const out = {
    clue: String(w?.clue || ""),
    answer: String(w?.answer || ""),
    start: +w?.start || 1,
    height: String(w?.height || "full"),
    color: String(w?.color || "--c-red"),
  };

  if (pType === MODE.CHAIN) {
    // keep diff around (harmless), but only *enforce* DIFF_COLORS when timed
    out.diff = String(w?.diff || inferDiffFromColor(out.color) || "easy");

    const timed = opts.timed !== false; // default true
    if (timed) {
      const allowed = DIFF_COLORS[out.diff] || DIFF_COLORS.easy;
      if (!allowed.includes(out.color)) out.color = allowed[0];
    }
  }

  return out;
};


const normPuzzle = (p) => {
  const type = String(p?.type || MODE.OVERLAP);
  const wordsRaw = Array.isArray(p?.words) ? p.words : [];
  const fallback = { clue: "Clue", answer: "WORD", start: 1, color: "--c-red", height: "full" };
const timed = type === MODE.CHAIN ? chainIsTimed(p) : true;
const words = (wordsRaw.length ? wordsRaw : [fallback]).map((w) => normWord(w, type, { timed }));


  const out = {
    id: String(p?.id || uid()),
    title: String(p?.title || "Untitled"),
    type,
    words,
  };

  if (type === MODE.CHAIN) {
    out.timeLimit = Math.max(10, Math.floor(+p?.timeLimit || DEFAULT_CHAIN_TIME));

    out.lockCorrectWords = !!(p?.lockCorrectWords ?? true);
    out.timedMode = !!(p?.timedMode ?? true);
  }
  return out;
};

const roundBonus = (n) => {
  const v = Math.max(0, n);
  if (TIME_BONUS_ROUND === "ceil") return Math.ceil(v);
  if (TIME_BONUS_ROUND === "round") return Math.round(v);
  return Math.floor(v);
};

// ---- State ----
let puzzles = store.load().map(normPuzzle);
let pIdx = 0;

let currentView = loadLastView(); // play | chain | build

const play = {
  mode: MODE.OVERLAP,
  entries: [],
  exp: [],
  usr: [],
  n: 0,
  at: 0,
  done: false,

  lockedCells: [],
  lockedEntries: new Set(), // eIdx
};

let selectedEntry = null;

// ---- Touch keyboard shim ----
let hasInteracted = true;
const markInteracted = () => {
  hasInteracted = true;
};

const IS_TOUCH = "ontouchstart" in window || navigator.maxTouchPoints > 0;

const kb = document.createElement("input");
kb.type = "text";
kb.value = "";
kb.autocomplete = "off";
kb.autocapitalize = "none";
kb.setAttribute("autocapitalize", "none");
kb.spellcheck = false;
kb.setAttribute("autocorrect", "off");
kb.setAttribute("autocomplete", "off");
kb.inputMode = "text";
kb.setAttribute("aria-hidden", "true");
kb.tabIndex = -1;
kb.style.cssText =
  "position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;font-size:16px;";
(document.body || document.documentElement).appendChild(kb);

const KB_SENTINEL = "\u200B";
const kbReset = () => {
  kb.value = KB_SENTINEL;
  try {
    kb.setSelectionRange(1, 1);
  } catch {}
};
kbReset();

const focusForTyping = () => {
  if (!hasInteracted) return;
  if (!els.panelPlay || !els.panelPlay.classList.contains("is-active")) return;
  if (!document.hasFocus()) return;

  const a = document.activeElement;
  if (
    a &&
    a !== kb &&
    (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable)
  )
    return;

  if (IS_TOUCH) {
    try {
      kb.focus({ preventScroll: true });
    } catch {
      kb.focus();
    }
    kbReset();
  } else {
    try {
      els.stage.focus({ preventScroll: true });
    } catch {
      els.stage.focus();
    }
  }
};

kb.addEventListener("input", () => {
  const v = kb.value || "";
  if (!v) return;
  for (const ch of v) {
    if (/^[a-zA-Z]$/.test(ch)) write(ch.toUpperCase());
  }
  kbReset();
});

kb.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey) return;

  if (e.key === "Backspace") {
    e.preventDefault();
    back();
    kbReset();
    return;
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    move(-1);
    kbReset();
    return;
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    move(1);
    kbReset();
    return;
  }
});

// ---- Model ----
function computed(p) {
  const type = String(p?.type || MODE.OVERLAP);
  const timedChain = type === MODE.CHAIN && chainIsTimed(p);

  const entries = (p.words || [])
    .map((w, rawIdx) => {
      const ans = cleanA(w.answer);
      const start = Math.max(0, Math.floor(+w.start || 1) - 1);
      const [t, b] = insets(w.height || "full");

      let diff = type === MODE.CHAIN ? String(w.diff || inferDiffFromColor(w.color) || "easy") : null;
      let color = String(w.color || "--c-red");

     if (type === MODE.CHAIN && timedChain) {
  const allowed = DIFF_COLORS[diff] || DIFF_COLORS.easy;
  if (!allowed.includes(color)) color = allowed[0];
}


      return { clue: w.clue || "", ans, start, len: ans.length, color, t, b, r: tr(w), rawIdx, diff };
    })
    .filter((e) => e.len)
    .sort((a, b) => a.start - b.start || a.r - b.r);

  entries.forEach((e, i) => (e.eIdx = i));

  const total = Math.max(1, ...entries.map((e) => e.start + e.len));
  const exp = Array.from({ length: total }, () => null);

  for (const e of entries) {
    for (let i = 0; i < e.len; i++) {
      const idx = e.start + i;
      const ch = e.ans[i];
      if (exp[idx] && exp[idx] !== ch) {
        return { ok: false, total, exp, entries, conf: { idx, a: exp[idx], b: ch } };
      }
      exp[idx] = ch;
    }
  }

  const gaps = exp.map((c, i) => (c ? null : i)).filter((v) => v !== null);
  return { ok: true, total, exp, entries, gaps };
}

function setCols(n) {
  document.documentElement.style.setProperty("--cols", String(n));
}

function renderGrid(target, model, clickable) {
  target.innerHTML = "";

  for (const e of model.entries) {
    const d = document.createElement("div");
    d.className = "range";
    d.dataset.e = String(e.eIdx);
    d.style.setProperty("--start", e.start);
    d.style.setProperty("--len", e.len);
    d.style.setProperty("--t", e.t);
    d.style.setProperty("--b", e.b);
    d.style.setProperty("--color", `var(${e.color})`);
    d.style.setProperty("--f", getComputedStyle(document.documentElement).getPropertyValue("--fill") || ".08");
    target.appendChild(d);
  }

  for (let i = 0; i < model.total; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cell text-display-semibold-lg";
    b.dataset.i = i;
    b.disabled = !clickable;
    b.innerHTML = '<span class="num"></span><span class="letter"></span>';
    target.appendChild(b);
  }
}

// ---- Horizontal keep-in-view ----
let _keepInViewRaf = 0;
// ---- Touch pan protection (iOS horizontal scroll) ----
let _isUserPanning = false;
let _panPointerId = null;
let _panMoved = false;
let _ignoreGridClickUntil = 0;

const PAN_SLOP_PX = 8;
let _panStartX = 0;
let _panStartY = 0;

function stopScrollFollow() {
  if (_scrollFollowRaf) cancelAnimationFrame(_scrollFollowRaf);
  _scrollFollowRaf = 0;
  _scrollFollowEl = null;
}


// ---- Smooth scroll-follow (prevents native smooth jitter on rapid updates) ----
const SCROLL_FOLLOW_K = 0.28;   // 0..1 (higher = faster, lower = smoother)
const SCROLL_FOLLOW_EPS = 0.75; // stop threshold (px)

let _scrollFollowRaf = 0;
let _scrollFollowEl = null;
let _scrollFollowTarget = 0;


function smoothFollowScrollLeft(sc, target) {
  _scrollFollowEl = sc;
  _scrollFollowTarget = target;

  if (_scrollFollowRaf) return;

  const tick = () => {
    const el = _scrollFollowEl;
    if (_isUserPanning) { _scrollFollowRaf = 0; return; }
    if (!el) { _scrollFollowRaf = 0; return; }

    const cur = el.scrollLeft;
    const delta = _scrollFollowTarget - cur;

    // close enough: snap + stop
    if (Math.abs(delta) <= SCROLL_FOLLOW_EPS) {
      el.scrollLeft = _scrollFollowTarget;
      _scrollFollowRaf = 0;
      return;
    }

    // critically-damped-ish follow
    el.scrollLeft = cur + delta * SCROLL_FOLLOW_K;
    _scrollFollowRaf = requestAnimationFrame(tick);
  };

  _scrollFollowRaf = requestAnimationFrame(tick);
}


function keepCellInView(idx, behavior = IS_TOUCH ? "smooth" : "auto") {
  const sc = els.gridScroll;
  if (!sc || sc.scrollWidth <= sc.clientWidth) return;
  if (IS_TOUCH && _isUserPanning) return;


  const cell = els.grid.querySelector(`.cell[data-i="${idx}"]`);
  if (!cell) return;

  // Center-seeking scroll
  const cellCenter = cell.offsetLeft + cell.offsetWidth / 2;
  let target = cellCenter - sc.clientWidth / 2;

  const max = sc.scrollWidth - sc.clientWidth;
  target = Math.max(0, Math.min(target, max));

  // tiny deadzone to prevent micro updates
  if (Math.abs(sc.scrollLeft - target) < 1.5) return;

  // Avoid native smooth jitter on rapid calls
  if (behavior === "smooth") {
    smoothFollowScrollLeft(sc, target);
  } else {
    sc.scrollLeft = target;
  }
}



function keepActiveCellInView(behavior = IS_TOUCH ? "smooth" : "auto") {
  keepCellInView(play.at, behavior);
}

function requestKeepActiveCellInView(behavior) {
  if (_keepInViewRaf) return;
  _keepInViewRaf = requestAnimationFrame(() => {
    _keepInViewRaf = 0;
    keepActiveCellInView(behavior);
  });
}

function scrollToWordStart(e, behavior = IS_TOUCH ? "smooth" : "auto") {
  if (!e) return;

  const sc = els.gridScroll;
  if (!sc || sc.scrollWidth <= sc.clientWidth) return;

  const cell = els.grid.querySelector(`.cell[data-i="${e.start}"]`);
  if (!cell) return;

  const pad = 24; // breathing room from left edge
  let target = cell.offsetLeft - pad;

  const max = sc.scrollWidth - sc.clientWidth;
  target = Math.max(0, Math.min(target, max));

  try {
    sc.scrollTo({ left: target, behavior });
  } catch {
    sc.scrollLeft = target;
  }
}


// ---- Selection highlight ----
function entryContainsIndex(e, i) {
  return i >= e.start && i < e.start + e.len;
}

function updateSelectedWordUI() {
  els.grid.querySelectorAll(".range").forEach((r) => {
    r.classList.toggle("is-selected", selectedEntry != null && r.dataset.e === String(selectedEntry));
  });
}

function selectEntry(eIdx) {
  selectedEntry = eIdx;
  updateSelectedWordUI();
}

function clearSelection() {
  selectedEntry = null;
  updateSelectedWordUI();
}

function maybeClearSelectionOnCursorMove() {
  if (selectedEntry == null) return;
  const e = play.entries.find((x) => x.eIdx === selectedEntry);
  if (!e) return clearSelection();

  const isLockedEntry = play.mode === MODE.CHAIN && play.lockedEntries.has(selectedEntry);
  if (isLockedEntry) return;

  if (!entryContainsIndex(e, play.at)) clearSelection();
}

function entryAtIndex(i) {
  const candidates = play.entries.filter((e) => entryContainsIndex(e, i));
  if (!candidates.length) return null;
  candidates.sort((a, b) => (i - a.start) - (i - b.start) || a.start - b.start);
  return candidates[0];
}

// ---- View filtering ----
function indicesForView(v = currentView) {
  const wantChain = v === VIEW.CHAIN;
  const out = [];
  for (let i = 0; i < puzzles.length; i++) {
    const p = puzzles[i];
    const isCh = isChainPuzzle(p);
    if (wantChain ? isCh : !isCh) out.push(i);
  }
  return out;
}

function loadByViewOffset(delta) {
  const list = indicesForView(currentView);
  if (!list.length) return;

  const pos = list.indexOf(pIdx);
  const at = pos >= 0 ? pos : 0;
  const nextPos = (at + delta + list.length) % list.length;
  loadPuzzle(list[nextPos]);
}

function ensureCurrentPuzzleMatchesView() {
  const list = indicesForView(currentView);
  if (!list.length) return false;
  if (list.includes(pIdx)) return true;
  loadPuzzle(list[0]);
  return true;
}

// ---- Word Chain HUD & results ----
const chain = {
  running: false,
  started: false,
  endsAt: 0,              // used in timed mode
  startAt: 0,             // used in untimed mode
  left: 0,                // timed: seconds remaining
  elapsed: 0,             // untimed: seconds elapsed
  tickId: 0,
  lastFinishLeftSec: 0,   // timed bonus calc
  lastFinishElapsedSec: 0 // untimed results
};


let chainUI = null;
let chainResults = null;

function ensureChainUI() {
  if (chainUI) return chainUI;

  const hud = document.createElement("div");
  hud.className = "chainHud";
  hud.hidden = true;
  hud.innerHTML = `
    <div class="chainHudRight">
      <button class="pill text-uppercase-semibold-md" id="chainStartBtn" type="button">Start</button>
      <div class="chainBar" aria-hidden="true"><i></i></div>
      <div class="chainTimer text-uppercase-semibold-lg">00:00</div>
    </div>
  `;
  els.meta.insertAdjacentElement("afterend", hud);

  const startBtn = hud.querySelector("#chainStartBtn");

  startBtn.addEventListener("click", () => {
    markInteracted();
    chainStartNow();
  });

  chainUI = {
    hud,
    startBtn,
    bar: hud.querySelector(".chainBar > i"),
    timer: hud.querySelector(".chainTimer"),
  };
  return chainUI;
}

function ensureChainResults() {
  if (chainResults) return chainResults;

  const wrap = document.createElement("div");
  wrap.className = "success";
  wrap.id = "chainResults";
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.setAttribute("aria-label", "Results");

  wrap.innerHTML = `
    <div class="card">
      <h2 class="text-headline-semibold-sm" id="chainResultsTitle">Time!</h2>
      <p class="text-system-regular-md" id="chainScoreLine">Your results</p>
      <div class="note" id="chainBreakdown"></div>
      <div class="actions">
        <button class="btn" id="cClose" type="button">Close</button>
        <button class="btn" id="cAgain" type="button">Play again</button>
        <button class="btn primary" id="cNext" type="button">Next puzzle</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  const cClose = wrap.querySelector("#cClose");
  const cAgain = wrap.querySelector("#cAgain");
  const cNext = wrap.querySelector("#cNext");

  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeChainResults();
  });
  cClose.addEventListener("click", closeChainResults);
  cAgain.addEventListener("click", () => {
    closeChainResults();
    resetPlay();
    focusForTyping();
  });
  cNext.addEventListener("click", () => {
    closeChainResults();
    loadByViewOffset(1);
  });

  chainResults = {
    wrap,
    title: wrap.querySelector("#chainResultsTitle"),
    scoreLine: wrap.querySelector("#chainScoreLine"),
    breakdown: wrap.querySelector("#chainBreakdown"),
    cClose,
  };
  return chainResults;
}

function closeChainResults() {
  if (!chainResults) return;
  chainResults.wrap.classList.remove("is-open");
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function chainStopTimer() {
  chain.running = false;
  chain.started = false;
  chain.endsAt = 0;
    chain.startAt = 0;
  chain.elapsed = 0;
  chain.lastFinishElapsedSec = 0;

  chain.left = 0;
  chain.lastFinishLeftSec = 0;
  if (chain.tickId) {
    clearInterval(chain.tickId);
    chain.tickId = 0;
  }
}

function chainResetTimer() {
  const p = puzzles[pIdx];
  const ui = ensureChainUI();

  chainStopTimer();

  const isTimed = !!(p?.timedMode ?? true);

  if (isTimed) {
    const total = Math.max(10, Math.floor(+p?.timeLimit || DEFAULT_CHAIN_TIME));
    chain.left = total;
    ui.timer.textContent = fmtTime(chain.left);
    ui.bar.style.transform = "scaleX(1)";
  } else {
    chain.elapsed = 0;
    ui.timer.textContent = fmtTime(0);
    // bar has no meaning in untimed; keep it full so UI doesn’t look “empty”
    ui.bar.style.transform = "scaleX(1)";
  }
}


function chainStartNow() {
  if (play.mode !== MODE.CHAIN) return;
  if (play.done) return;

  const ui = ensureChainUI();
  const p = puzzles[pIdx];
  const total = Math.max(10, Math.floor(+p?.timeLimit || DEFAULT_CHAIN_TIME));

  // Show clues, hide start button, focus at first editable cell
  els.legend.hidden = false;
  ui.startBtn.style.display = "none";

  // jump to first editable cell (usually 0)
  const first = findNextEditable(0, +1);
  setAt(first == null ? 0 : first, { behavior: "auto" });
  focusForTyping();

  if (chain.started) return;

  chain.started = true;
  chain.running = true;
  const isTimed = !!(p?.timedMode ?? true);

  if (isTimed) {
    chain.endsAt = Date.now() + total * 1000;

    if (chain.tickId) clearInterval(chain.tickId);
    chain.tickId = setInterval(() => {
      if (!chain.running) return;

      const left = (chain.endsAt - Date.now()) / 1000;
      chain.left = left;

      ui.timer.textContent = fmtTime(left);
      const pct = Math.max(0, Math.min(1, left / total));
      ui.bar.style.transform = `scaleX(${pct})`;

      if (left <= 0) chainFinish("time");
    }, 120);
  } else {
    chain.startAt = Date.now();

    if (chain.tickId) clearInterval(chain.tickId);
    chain.tickId = setInterval(() => {
      if (!chain.running) return;

      const elapsed = (Date.now() - chain.startAt) / 1000;
      chain.elapsed = elapsed;

      ui.timer.textContent = fmtTime(elapsed);
      ui.bar.style.transform = "scaleX(1)"; // no progress meaning in untimed
    }, 120);
  }
}

function isWordAttempted(e) {
  for (let i = e.start; i < e.start + e.len; i++) if (play.usr[i]) return true;
  return false;
}

function isWordCorrect(e) {
  for (let i = 0; i < e.len; i++) {
    const idx = e.start + i;
    if (!play.usr[idx]) return false;
    if (play.usr[idx] !== e.ans[i]) return false;
  }
  return true;
}

function scoreChain() {
  const entries = play.entries || [];
  const correct = { easy: 0, medium: 0, hard: 0 };
  const attempted = { easy: 0, medium: 0, hard: 0 };

  for (const e of entries) {
    const d = e.diff || "easy";
    if (isWordAttempted(e)) attempted[d] = (attempted[d] || 0) + 1;
    if (isWordCorrect(e)) correct[d] = (correct[d] || 0) + 1;
  }

  const ptsEasy = (correct.easy || 0) * (DIFF_POINTS.easy || 0);
  const ptsMed = (correct.medium || 0) * (DIFF_POINTS.medium || 0);
  const ptsHard = (correct.hard || 0) * (DIFF_POINTS.hard || 0);

  return { correct, attempted, ptsEasy, ptsMed, ptsHard, baseScore: ptsEasy + ptsMed + ptsHard };
}

function openChainResults(stats, reason) {
  const r = ensureChainResults();
  r.wrap.classList.add("is-open");
  const p = puzzles[pIdx];
  const isTimed = !!(p?.timedMode ?? true);

  if (!isTimed) {
    const tSec = Math.max(0, Math.floor(chain.lastFinishElapsedSec || 0));
    r.title.textContent = "Solved!";
    r.scoreLine.textContent = `Time: ${fmtTime(tSec)}`;
    r.breakdown.innerHTML = "";
    r.cClose.focus();
    return;
  }


  const didSolve = reason === "solved";

  // time bonus only if solved early
  let bonusSec = 0;
  let bonusPts = 0;
  if (didSolve) {
    bonusSec = Math.max(0, Math.floor(chain.lastFinishLeftSec || 0));
    bonusPts = roundBonus(bonusSec * TIME_BONUS_FACTOR);
  }

  const totalScore = stats.baseScore + bonusPts;

  r.title.textContent = didSolve ? "Solved!" : "Time!";
  r.scoreLine.textContent = `Score: ${totalScore}pts`;

  // formatted “addition table” style
  // (uses your current DIFF_POINTS so it always matches reality)
  const lines = [
    `Easy: ${stats.correct.easy || 0} -- ${stats.ptsEasy}pts`,
    `Medium: ${stats.correct.medium || 0} -- ${stats.ptsMed}pts`,
    `Hard: ${stats.correct.hard || 0} -- ${stats.ptsHard}pts`,
  ];

  if (didSolve) {
    lines.push(`time bonus: -${bonusSec}s -- ${bonusPts}pts`);
  }

  lines.push(`---`);
  lines.push(`Total score: ${totalScore}pts`);

  r.breakdown.innerHTML = `<div style="white-space:pre-line">${lines.join("\n")}</div>`;
  r.cClose.focus();
}

function chainFinish(reason = "time") {
  if (play.mode !== MODE.CHAIN) return;
  if (play.done) return;
  const p = puzzles[pIdx];
  const isTimed = !!(p?.timedMode ?? true);


  // capture remaining time BEFORE stopping timer
  // capture stats BEFORE stopping timer
  if (reason === "solved" && chain.started) {
    if (isTimed) {
      chain.lastFinishLeftSec = Math.max(0, (chain.endsAt - Date.now()) / 1000);
      chain.lastFinishElapsedSec = 0;
    } else {
      chain.lastFinishElapsedSec = Math.max(0, (Date.now() - chain.startAt) / 1000);
      chain.lastFinishLeftSec = 0;
    }
  } else {
    chain.lastFinishLeftSec = 0;
    chain.lastFinishElapsedSec = 0;
  }

  chain.running = false;
  if (chain.tickId) {
    clearInterval(chain.tickId);
    chain.tickId = 0;
  }

  play.done = true;
  updatePlayUI();

  try {
    kb.blur();
  } catch {}

  openChainResults(scoreChain(), reason);
}

function chainMaybeFinishIfSolved() {
  if (play.mode !== MODE.CHAIN || play.done) return;
  if (!chain.started) return;

  for (let i = 0; i < play.n; i++) {
    if (!play.usr[i]) return;
    if (play.usr[i] !== play.exp[i]) return;
  }
  chainFinish("solved");
}

// ---- Word Chain locking behavior ----
function isCellLocked(i) {
  return !!play.lockedCells[i];
}

function rebuildLockedCells() {
  play.lockedCells = Array.from({ length: play.n }, () => false);
  if (play.mode !== MODE.CHAIN) return;

  for (const eIdx of play.lockedEntries) {
    const e = play.entries.find((x) => x.eIdx === eIdx);
    if (!e) continue;
    for (let i = e.start; i < e.start + e.len; i++) play.lockedCells[i] = true;
  }
}

function updateLockedWordUI() {
  els.grid.querySelectorAll(".range").forEach((r) => {
    const eIdx = +r.dataset.e;
    const locked = play.mode === MODE.CHAIN && play.lockedEntries.has(eIdx);
    r.classList.toggle("is-locked", locked);
  });
}

function chainApplyLocksIfEnabled() {
  const p = puzzles[pIdx];
  const lockOnCorrect = !!p.lockCorrectWords;

  if (play.mode !== MODE.CHAIN || !lockOnCorrect) return;

  let changed = false;

  for (const e of play.entries) {
    if (play.lockedEntries.has(e.eIdx)) continue;
    if (isWordCorrect(e)) {
      play.lockedEntries.add(e.eIdx);
      changed = true;
    }
  }

  if (changed) {
    rebuildLockedCells();
    updateLockedWordUI();
    if (selectedEntry != null && play.lockedEntries.has(selectedEntry)) clearSelection();
  }
}

function findNextEditable(from, dir) {
  let i = from;
  while (i >= 0 && i < play.n) {
    if (!isCellLocked(i)) return i;
    i += dir;
  }
  return null;
}

function chainInputAllowed() {
  // word chain should only accept typing once started via button
  return play.mode !== MODE.CHAIN || chain.started;
}

// ---- Word Chain clues (current word first + adjacent unsolved) ----
let _cluesRaf = 0;

function requestChainClues() {
  if (_cluesRaf) return;
  _cluesRaf = requestAnimationFrame(() => {
    _cluesRaf = 0;
    updateChainClues();
  });
}

function isEntryUnsolvedForClues(e) {
  const p = puzzles[pIdx];
  const lockOnCorrect = !!p.lockCorrectWords;
  // If lock behavior is on, “unsolved” == “not locked”
  if (lockOnCorrect) return !play.lockedEntries.has(e.eIdx);
  // Otherwise, “unsolved” means letters don’t match yet
  return !isWordCorrect(e);
}

// Candidates on current cursor cell, ordered:
// 1) earlier start first
// 2) if same start, random (uses e.r)
function entriesOnCursorCellSorted() {
  const i = play.at;
  return play.entries
    .filter((e) => entryContainsIndex(e, i))
    .sort((a, b) => a.start - b.start || a.r - b.r);
}

function entryDistanceToIndex(e, i) {
  const a = e.start;
  const b = e.start + e.len - 1;
  return Math.min(Math.abs(a - i), Math.abs(b - i));
}

function nearestUnsolvedEntryToCursor() {
  const i = play.at;
  const unsolved = play.entries.filter(isEntryUnsolvedForClues);
  if (!unsolved.length) return null;
  unsolved.sort((a, b) => {
    const da = entryDistanceToIndex(a, i);
    const db = entryDistanceToIndex(b, i);
    return da - db || a.start - b.start || a.r - b.r;
  });
  return unsolved[0];
}

function updateChainClues() {
  if (play.mode !== MODE.CHAIN) return;
  if (!chain.started) return; // intentionally hidden until Start

  const cap = Math.max(1, CHAIN_CLUE_CAP | 0);

  // 1) Top clue: word on the current cell (if unsolved / not locked)
  const onCell = entriesOnCursorCellSorted().filter(isEntryUnsolvedForClues);

  // If current cell word is locked/solved, we *don’t* show it at top.
  // In that case we pivot from nearest unsolved instead.
  const top = onCell.length ? onCell[0] : null;

  // pivot determines adjacency fill
  const pivot = top || nearestUnsolvedEntryToCursor();

  const picked = [];
  const pickedSet = new Set();

  const add = (e) => {
    if (!e) return false;
    if (!isEntryUnsolvedForClues(e)) return false;
    if (pickedSet.has(e.eIdx)) return false;
    picked.push(e);
    pickedSet.add(e.eIdx);
    return true;
  };

  // Add top (only if it’s the actual current-cell word & unsolved)
  if (top) add(top);

  // 2) Fill with adjacent unsolved clues around pivot (in chain order)
  if (pivot) {
    const ordered = play.entries; // already sorted by start, then r
    const baseIdx = ordered.indexOf(pivot);

    // If we didn’t add the top and pivot is different, include pivot first.
    if (!top) add(pivot);

    for (let step = 1; picked.length < cap && step < ordered.length; step++) {
      const right = ordered[baseIdx + step];
      const left = ordered[baseIdx - step];

      // Prefer forward then backward, alternating outward
      if (right) add(right);
      if (picked.length >= cap) break;
      if (left) add(left);
    }
  }

  // 3) If still not full (e.g., many locked), fill by nearest remaining unsolved
  if (picked.length < cap) {
    const i = play.at;
    const remaining = play.entries
      .filter((e) => isEntryUnsolvedForClues(e) && !pickedSet.has(e.eIdx))
      .sort((a, b) => {
        const da = entryDistanceToIndex(a, i);
        const db = entryDistanceToIndex(b, i);
        return da - db || a.start - b.start || a.r - b.r;
      });

    for (const e of remaining) {
      add(e);
      if (picked.length >= cap) break;
    }
  }

  const finalList = picked;

  // ---- Render (same animation approach you already had) ----
  const wrap = els.legend;

  const existing = new Map(
    [...wrap.querySelectorAll(".chainClue")].map((el) => [Number(el.dataset.e), el])
  );
  const nextKeys = new Set(finalList.map((e) => e.eIdx));

  for (const [k, el] of existing) {
    if (!nextKeys.has(k)) {
      el.classList.remove("is-in");
      el.classList.add("is-out");
      el.addEventListener(
        "transitionend",
        () => {
          if (el.parentNode) el.parentNode.removeChild(el);
        },
        { once: true }
      );
    }
  }

  finalList.forEach((e, pos) => {
    let el = existing.get(e.eIdx);

    const diffTag =
      e.diff === "easy" ? "E" : e.diff === "medium" ? "M" : e.diff === "hard" ? "H" : "";

    if (!el) {
      el = document.createElement("button");
      el.type = "button";
      el.className = "clue chainClue";
      el.dataset.e = String(e.eIdx);
      el.innerHTML = `
        <span class="sw" style="--color:var(${e.color})"></span>
        <span class="text-system-semibold-sm">${escapeHtml(e.clue)}</span>
        ${diffTag ? `<span class="diffTag">${diffTag}</span>` : ``}
      `;
      wrap.appendChild(el);
      requestAnimationFrame(() => el.classList.add("is-in"));
    } else {
      el.innerHTML = `
        <span class="sw" style="--color:var(${e.color})"></span>
        <span class="text-system-semibold-sm">${escapeHtml(e.clue)}</span>
        ${diffTag ? `<span class="diffTag">${diffTag}</span>` : ``}
      `;
    }

    const cur = wrap.children[pos];
    if (cur !== el) wrap.insertBefore(el, cur || null);
  });
}


// ---- Play UI ----
function updatePlayUI() {
  const cells = els.grid.querySelectorAll(".cell");
  cells.forEach((c) => {
    const i = +c.dataset.i;
    c.querySelector(".num").textContent = i + 1;
    c.querySelector(".letter").textContent = play.usr[i] || "";
    c.classList.toggle("is-active", i === play.at && !play.done);
  });
  updateSelectedWordUI();
}

function setAt(i, { behavior } = {}) {
  play.at = clamp(i, 0, play.n - 1);
  updatePlayUI();
  keepActiveCellInView(behavior || (IS_TOUCH ? "smooth" : "auto"));
  maybeClearSelectionOnCursorMove();
  if (play.mode === MODE.CHAIN) requestChainClues();
}

function jumpToEntry(eIdx) {
  const e = play.entries.find((x) => x.eIdx === eIdx);
  if (!e) return;

  let idx = e.start;
  for (let i = e.start; i < e.start + e.len; i++) {
    if (!play.usr[i]) {
      idx = i;
      break;
    }
  }

  selectEntry(e.eIdx);
  setAt(idx, { behavior: "smooth" });
  scrollToWordStart(e, "smooth");
}

function checkSolvedOverlapOnly() {
  if (play.mode === MODE.CHAIN) return;
  if (!play.usr.every(Boolean)) return;
  if (play.usr.every((ch, i) => ch === play.exp[i])) {
    play.done = true;
    openSuccess();
  }
}

function write(ch) {
  if (play.done) return;
  if (!chainInputAllowed()) return; // require Start for word chain

  if (play.mode === MODE.CHAIN && isCellLocked(play.at)) {
    const next = findNextEditable(play.at, +1);
    if (next == null) return;
    play.at = next;
  }

  play.usr[play.at] = ch;

  // auto-advance (skip locked)
  let nextAt = play.at < play.n - 1 ? play.at + 1 : play.at;
  if (play.mode === MODE.CHAIN) {
    const nxt = findNextEditable(nextAt, +1);
    if (nxt != null) nextAt = nxt;
  }
  play.at = nextAt;

  if (play.mode === MODE.CHAIN) {
    chainApplyLocksIfEnabled();
    updatePlayUI();
    requestKeepActiveCellInView();
    requestChainClues();
    chainMaybeFinishIfSolved();
    return;
  }

  updatePlayUI();
  requestKeepActiveCellInView();
  checkSolvedOverlapOnly();
}

function back() {
  if (play.done) return;
  if (!chainInputAllowed()) return; // require Start for word chain

  if (play.mode === MODE.CHAIN && isCellLocked(play.at)) {
    const prev = findNextEditable(play.at, -1);
    if (prev == null) return;
    play.at = prev;
  }

  if (play.usr[play.at]) {
    play.usr[play.at] = "";
  } else {
    let prevAt = play.at > 0 ? play.at - 1 : 0;
    if (play.mode === MODE.CHAIN) {
      const prev = findNextEditable(prevAt, -1);
      if (prev == null) prevAt = play.at;
      else prevAt = prev;
    }
    play.at = prevAt;
    if (play.mode !== MODE.CHAIN || !isCellLocked(play.at)) play.usr[play.at] = "";
  }

  if (play.mode === MODE.CHAIN) {
    updatePlayUI();
    requestKeepActiveCellInView();
    requestChainClues();
    return;
  }

  updatePlayUI();
  requestKeepActiveCellInView();
}

function move(d) {
  if (!chainInputAllowed()) return;

  let target = clamp(play.at + d, 0, play.n - 1);

  if (play.mode === MODE.CHAIN) {
    const dir = d >= 0 ? +1 : -1;
    const nxt = findNextEditable(target, dir);
    if (nxt != null) target = nxt;
  }

  setAt(target);
}

// ---- Modals (Overlap) ----
function openSuccess() {
  els.success.classList.add("is-open");
  els.sClose.focus();
}

function closeSuccess() {
  els.success.classList.remove("is-open");
}

// ---- Reset / reveal ----
function resetPlay() {
  play.usr = Array.from({ length: play.n }, () => "");
  play.at = 0;
  play.done = false;

  play.lockedEntries.clear();
  play.lockedCells = Array.from({ length: play.n }, () => false);

  updateLockedWordUI();
  clearSelection();

  updatePlayUI();
  closeSuccess();
  closeChainResults();

  if (play.mode === MODE.CHAIN) {
    const ui = ensureChainUI();
    ui.startBtn.style.display = "";
    els.legend.hidden = true;
    els.legend.innerHTML = "";
    chainResetTimer();
  }

  keepActiveCellInView("auto");
}

function revealPlay() {
  play.usr = play.exp.slice();
  play.done = true;
  updatePlayUI();
  closeSuccess();
}

// ---- Clue click behavior (both modes) ----
function onLegendClick(e) {
  const btn = e.target.closest(".clue");
  if (!btn) return;

  // chain clues hidden until start, so this should only fire after start
  const eIdx = +btn.dataset.e;
  const entry = play.entries.find((x) => x.eIdx === eIdx);
  if (!entry) return;

  markInteracted();
  focusForTyping();

  jumpToEntry(eIdx);
  selectEntry(eIdx);
  scrollToWordStart(entry, "smooth");
}

function onGridCellClick(e) {
  const cell = e.target.closest(".cell");
  if (!cell) return;
  if (IS_TOUCH && performance.now() < _ignoreGridClickUntil) return;


  markInteracted();
  focusForTyping();

  const i = +cell.dataset.i;
  setAt(i);

  // const maybe = entryAtIndex(i);
  // if (maybe) selectEntry(maybe.eIdx);
}

// ---- Load puzzle ----
function loadPuzzle(i) {
  closeSuccess();
  closeChainResults();
  chainStopTimer();

  if (!puzzles.length) return;

  pIdx = ((i % puzzles.length) + puzzles.length) % puzzles.length;
  puzzles[pIdx] = normPuzzle(puzzles[pIdx]);

  const p = puzzles[pIdx];
  const m = computed(p);

  play.mode = isChainPuzzle(p) ? MODE.CHAIN : MODE.OVERLAP;
  play.entries = m.entries;

  setCols(m.total);

  play.exp = m.exp.map((c) => c || "");
  play.n = m.total;
  play.usr = Array.from({ length: play.n }, () => "");
  play.at = 0;
  play.done = false;

  play.lockedEntries.clear();
  play.lockedCells = Array.from({ length: play.n }, () => false);
  clearSelection();

  renderGrid(els.grid, m, true);

  // Legend mode
  if (play.mode === MODE.CHAIN) {
    const ui = ensureChainUI();
    ui.hud.hidden = false;
    ui.startBtn.style.display = ""; // show Start

    els.legend.classList.add("chainLegend");
    els.legend.hidden = true; // ✅ hide clues by default
    els.legend.innerHTML = "";

    chainResetTimer();

    // hide reveal button in chain mode
    if (els.reveal) els.reveal.style.display = "none";
    if (els.helper) els.helper.style.display = "none";
    if (els.meta) els.meta.style.display = "none";

  } else {
    if (chainUI) chainUI.hud.hidden = true;
    if (els.reveal) els.reveal.style.display = "";
    if (els.helper) els.helper.style.display = "";
    if (els.meta) els.meta.style.display = "";


    els.legend.hidden = false;
    els.legend.classList.remove("chainLegend");
    els.legend.innerHTML = m.entries
      .map(
        (e) => `
        <button type="button" class="clue" data-e="${e.eIdx}">
          <span class="sw" style="--color:var(${e.color})"></span>
          <span class="text-system-semibold-sm">${escapeHtml(e.clue)}</span>
        </button>`
      )
      .join("");
  }

  // meta count should reflect current view list
  const viewForMeta = currentView === VIEW.BUILD ? (isChainPuzzle(p) ? VIEW.CHAIN : VIEW.PLAY) : currentView;
  const list = indicesForView(viewForMeta);
  const pos = list.indexOf(pIdx);
  const posText = list.length ? `${(pos >= 0 ? pos : 0) + 1} / ${list.length}` : `1 / ${puzzles.length}`;

  els.meta.textContent = `${p.title || "Untitled"} • ${posText}`;

  updatePlayUI();

  if (els.gridScroll) els.gridScroll.scrollLeft = 0;

  syncBuilder();
  setDirty(false);
}

// ---- Tabs ----
function setTab(which) {
  currentView = which;
  try { localStorage.setItem(LAST_VIEW_KEY, currentView); } catch {}


  const isBuild = which === VIEW.BUILD;
  const isChain = which === VIEW.CHAIN;
  const isPlay = which === VIEW.PLAY;

  els.tabPlay?.classList.toggle("is-active", isPlay);
  els.tabChain?.classList.toggle("is-active", isChain);
  els.tabBuild?.classList.toggle("is-active", isBuild);

  els.tabPlay?.setAttribute("aria-selected", isPlay ? "true" : "false");
  els.tabChain?.setAttribute("aria-selected", isChain ? "true" : "false");
  els.tabBuild?.setAttribute("aria-selected", isBuild ? "true" : "false");

  els.panelPlay?.classList.toggle("is-active", !isBuild);
  els.panelBuild?.classList.toggle("is-active", isBuild);

  if (!isBuild) {
    ensureCurrentPuzzleMatchesView();
    focusForTyping();
  } else {
    chainStopTimer();
  }
}

// ---- Escaping ----
function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
}

function escapeAttr(s) {
  return String(s).replace(
    /[&<>"']/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

// ---- Global key handler (desktop) ----
function onKey(e) {
  if (els.success.classList.contains("is-open")) return;
  if (chainResults?.wrap?.classList.contains("is-open")) return;
  if (e.metaKey || e.ctrlKey) return;

  if (IS_TOUCH && e.target === kb && (e.key === "Backspace" || e.key === "ArrowLeft" || e.key === "ArrowRight")) return;

  const t = e.target;
  if (
    t &&
    t !== kb &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
  )
    return;

  if (e.key === "Tab") return;

  if (e.key === "Backspace") {
    e.preventDefault();
    back();
    return;
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    move(-1);
    return;
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    move(1);
    return;
  }
  if (/^[a-zA-Z]$/.test(e.key)) {
    e.preventDefault();
    write(e.key.toUpperCase());
  }
}

// ---- Builder UI injection (mode + chain fields) ----
let bModeWrap = null;
let bModeSel = null;
let bTimeInp = null;
let bLockChk = null;
let bTimedChk = null;

function ensureBuilderModeUI() {
  if (bModeWrap) return;

  const box = document.querySelector(".puzzle_inputs");
  if (!box) return;

  const wrap = document.createElement("div");
  wrap.style.marginTop = "12px";
  wrap.innerHTML = `
    <label class="lab" for="pMode">Mode</label>
    <select class="sel" id="pMode">
      <option value="${MODE.OVERLAP}">Overlap</option>
      <option value="${MODE.CHAIN}">Word Chain</option>
    </select>

    <div id="chainFields" style="margin-top:10px">
      <label class="lab" for="pTimeLimit">Time limit (seconds)</label>
      <input class="ti" id="pTimeLimit" type="number" inputmode="numeric" min="10" step="5" />

      <div style="height:10px"></div>
      <label class="lab" style="display:flex;gap:10px;align-items:center">
        <input id="pLockCorrect" type="checkbox" />
        <span>Mark correct words (lock + fade + hide clue)</span>
      </label>
      <div style="height:10px"></div>
      <label class="lab" style="display:flex;gap:10px;align-items:center">
        <input id="pTimedMode" type="checkbox" />
        <span>Timed mode (countdown + score)</span>
      </label>

    </div>
  `;

  els.pTitle.insertAdjacentElement("afterend", wrap);

  bModeWrap = wrap;
  bModeSel = wrap.querySelector("#pMode");
  bTimeInp = wrap.querySelector("#pTimeLimit");
  bLockChk = wrap.querySelector("#pLockCorrect");
    bTimedChk = wrap.querySelector("#pTimedMode");

  const chainFields = wrap.querySelector("#chainFields");

  const setVis = (isChain) => {
    chainFields.style.display = isChain ? "" : "none";
  };
  wrap._setVis = setVis;

  bModeSel.addEventListener("change", () => {
    puzzles[pIdx].type = bModeSel.value;

    if (puzzles[pIdx].type === MODE.CHAIN) {
      puzzles[pIdx].timeLimit = Math.max(10, Math.floor(+puzzles[pIdx].timeLimit || DEFAULT_CHAIN_TIME));
      puzzles[pIdx].lockCorrectWords = !!(puzzles[pIdx].lockCorrectWords ?? true);
      puzzles[pIdx].timedMode = !!(puzzles[pIdx].timedMode ?? true);
      puzzles[pIdx].words = (puzzles[pIdx].words || []).map((w) => normWord(w, MODE.CHAIN));
    }

    setDirty(true);
    syncBuilder();
  });

  bTimeInp.addEventListener("input", () => {
    puzzles[pIdx].timeLimit = Math.max(10, Math.floor(+bTimeInp.value || DEFAULT_CHAIN_TIME));
    setDirty(true);
  });

  bLockChk.addEventListener("change", () => {
    puzzles[pIdx].lockCorrectWords = !!bLockChk.checked;
    setDirty(true);
  });

    bTimedChk.addEventListener("change", () => {
    puzzles[pIdx].timedMode = !!bTimedChk.checked;
    setDirty(true);
  });

}

// ---- Builder render ----
function syncBuilder() {
  ensureBuilderModeUI();

  els.pSel.innerHTML = puzzles
    .map((p, i) => {
      const tag = p.type === MODE.CHAIN ? " — Word Chain" : "";
      return `<option value="${i}" ${i === pIdx ? "selected" : ""}>${escapeHtml(p.title || "Untitled")}${tag}</option>`;
    })
    .join("");

  els.pTitle.value = puzzles[pIdx]?.title || "";

  const p = puzzles[pIdx];
  const chainMode = isChainPuzzle(p);

  if (bModeSel) bModeSel.value = p.type || MODE.OVERLAP;
  if (bTimeInp) bTimeInp.value = String(p.timeLimit || DEFAULT_CHAIN_TIME);
  if (bLockChk) bLockChk.checked = !!(p.lockCorrectWords ?? true);
 if (bTimedChk) bTimedChk.checked = !!(p.timedMode ?? true);
  if (bModeWrap && bModeWrap._setVis) bModeWrap._setVis(chainMode);

  renderRows();
  renderPreview();
}

function renderRows() {
  const p = puzzles[pIdx];
  const chainMode = isChainPuzzle(p);
  const timedChain = chainMode && chainIsTimed(p);


  const ws = p.words || [];
  const order = ws.map((w, i) => ({ i, s: +w.start || 1, r: tr(w) })).sort((a, b) => a.s - b.s || a.r - b.r);

  els.rows.innerHTML = order
    .map((o, pos) => {
      const i = o.i;
      const w = ws[i];

      if (timedChain) {
  w.diff = String(w.diff || inferDiffFromColor(w.color) || "easy");
  const allowedNow = DIFF_COLORS[w.diff] || DIFF_COLORS.easy;
  if (!allowedNow.includes(w.color)) w.color = allowedNow[0];
}


      const diff = timedChain ? String(w.diff || "easy") : null;
      const diffOpts = DIFFS.map(([lab, val]) => `<option value="${val}" ${diff === val ? "selected" : ""}>${lab}</option>`).join("");

const allowedColors = timedChain ? (DIFF_COLORS[diff] || DIFF_COLORS.easy) : COLORS.map((x) => x[1]);      const colorOpts = allowedColors
        .map((val) => {
          const lab = COLOR_LABEL[val] || val;
          return `<option value="${val}" ${String(w.color) === val ? "selected" : ""}>${lab}</option>`;
        })
        .join("");

      const heightOpts = HEIGHTS.map(([lab, val]) => `<option value="${val}" ${w.height === val ? "selected" : ""}>${lab}</option>`).join("");

      return `
        <div class="row" data-i="${i}">
          <div class="rowTop">
            <div class="left">
              <span class="sw" style="--color:var(${w.color || "--c-red"})"></span>
              <span>Word ${pos + 1}</span>
            </div>
            <div class="right"><button class="pill" type="button" data-act="rm">Remove</button></div>
          </div>
          <div class="grid5">
            <div class="full">
              <label class="lab">Clue</label>
              <input class="mi" data-f="clue" value="${escapeAttr(w.clue || "")}" />
            </div>
            <div class="full">
              <label class="lab">Answer</label>
              <input class="mi" data-f="answer" value="${escapeAttr(w.answer || "")}" />
            </div>
            <div>
              <label class="lab">Start</label>
              <input class="mi" data-f="start" inputmode="numeric" value="${escapeAttr(String(w.start ?? 1))}" />
            </div>

            ${timedChain ? `
  <div>
    <label class="lab">Difficulty</label>
    <select class="ms" data-f="diff">${diffOpts}</select>
  </div>
` : ""}


            <div>
              <label class="lab">Color</label>
              <select class="ms" data-f="color">${colorOpts}</select>
            </div>
            <div>
              <label class="lab">Height</label>
              <select class="ms" data-f="height">${heightOpts}</select>
            </div>
          </div>
        </div>`;
    })
    .join("");

  const m = computed(puzzles[pIdx]);
  if (!m.ok) {
    els.status.className = "status bad";
    els.status.textContent = `Conflict at column ${m.conf.idx + 1}: “${m.conf.a}” vs “${m.conf.b}”.`;
  } else if (m.gaps.length) {
    els.status.className = "status bad";
    els.status.textContent = `Uncovered columns: ${m.gaps.slice(0, 18).map((x) => x + 1).join(", ")}${m.gaps.length > 18 ? "…" : ""}`;
  } else {
    els.status.className = "status";
    els.status.innerHTML = `Total columns: <strong>${m.total}</strong> • Words: <strong>${m.entries.length}</strong> • ${dirty ? "Unsaved changes" : "Saved"}`;
  }
}

function renderPreview() {
  const m = computed(puzzles[pIdx]);
  setCols(m.total);
  renderGrid(els.bGrid, m, false);
  els.bGrid.classList.add("showNums");

  const bad = m.ok ? null : m.conf?.idx;

  els.bGrid.querySelectorAll(".cell").forEach((c) => {
    const i = +c.dataset.i;
    c.querySelector(".num").textContent = i + 1;
    c.querySelector(".letter").textContent = m.exp[i] || "";
    c.classList.toggle("is-bad", bad === i);
  });

  els.solution.textContent = `Solution row: ${m.exp.map((c) => c || "·").join("")}`;

  if (!m.ok) {
    els.status.className = "status bad";
    els.status.textContent = `Conflict at column ${m.conf.idx + 1}: “${m.conf.a}” vs “${m.conf.b}”.`;
  } else if (m.gaps?.length) {
    els.status.className = "status bad";
    els.status.textContent = `Uncovered columns: ${m.gaps.slice(0, 18).map((x) => x + 1).join(", ")}${m.gaps.length > 18 ? "…" : ""}`;
  } else {
    els.status.className = "status";
    els.status.innerHTML = `Total columns: <strong>${m.total}</strong> • Words: <strong>${m.entries.length}</strong> • ${dirty ? "Unsaved changes" : "Saved"}`;
  }
}

function saveAndReRender() {
  setDirty(true);
  renderRows();
  renderPreview();
}

// ---- Events ----
// Save
els.pSave.addEventListener("click", () => {
  const m = computed(puzzles[pIdx]);
  if (!m.ok) return alert("Fix conflicts before saving.");
  if (m.gaps?.length) return alert("Cover every column (no gaps) before saving.");
  store.save();
  setDirty(false);
  loadPuzzle(pIdx);
});

// Export
els.ioExp.addEventListener("click", async () => {
  const t = JSON.stringify(puzzles, null, 2);
  els.ioTxt.value = t;
  try {
    await navigator.clipboard.writeText(t);
  } catch {}
});

// Import
els.ioImp.addEventListener("click", () => {
  try {
    const arr = JSON.parse(els.ioTxt.value || "");
    if (!Array.isArray(arr)) throw 0;
    puzzles = arr.map((p) => normPuzzle(p));
    store.save();
    els.ioTxt.value = "";
    loadPuzzle(0);
    setTab(VIEW.BUILD);
  } catch {
    alert("Invalid JSON. Paste the exported puzzles JSON and try again.");
  }
});

// Tabs
els.tabPlay?.addEventListener("click", () => setTab(VIEW.PLAY));
els.tabChain?.addEventListener("click", () => setTab(VIEW.CHAIN));
els.tabBuild?.addEventListener("click", () => setTab(VIEW.BUILD));

// Keyboard (desktop)
if (!IS_TOUCH) document.addEventListener("keydown", onKey, true);

// Focus gate
els.stage.addEventListener("pointerdown", (e) => {
  markInteracted();
  if (IS_TOUCH && e.target.closest("#gridScroll")) return;

  focusForTyping();
});


// Grid click
els.grid.addEventListener("click", onGridCellClick);

// Legend click
els.legend.addEventListener("click", onLegendClick);

// Chain clue updates on scroll
els.gridScroll?.addEventListener(
  "scroll",
  () => {
    if (play.mode === MODE.CHAIN) requestChainClues();
  },
  { passive: true }
);

// ---- Touch pan detection: prevents follow-scroll + focus from fighting drag ----
if (els.gridScroll) {
  els.gridScroll.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "touch") return;

      _isUserPanning = true;
      _panPointerId = e.pointerId;
      _panMoved = false;
      _panStartX = e.clientX;
      _panStartY = e.clientY;

      stopScrollFollow();
    },
    { passive: true }
  );

  els.gridScroll.addEventListener(
    "pointermove",
    (e) => {
      if (!_isUserPanning || e.pointerId !== _panPointerId) return;
      if (_panMoved) return;

      const dx = Math.abs(e.clientX - _panStartX);
      const dy = Math.abs(e.clientY - _panStartY);
      if (dx >= PAN_SLOP_PX || dy >= PAN_SLOP_PX) _panMoved = true;
    },
    { passive: true }
  );

  const endPan = (e) => {
    if (e.pointerType !== "touch") return;
    if (e.pointerId !== _panPointerId) return;

    if (_panMoved) _ignoreGridClickUntil = performance.now() + 250;

    _isUserPanning = false;
    _panPointerId = null;
    _panMoved = false;
  };

  window.addEventListener("pointerup", endPan, { passive: true });
  window.addEventListener("pointercancel", endPan, { passive: true });
}


// Prev/Next
els.prev.addEventListener("click", () => {
  if (play.mode === MODE.CHAIN) return;
  loadByViewOffset(-1);
});

els.next.addEventListener("click", () => {
  if (play.mode === MODE.CHAIN) return;
  loadByViewOffset(1);
});


// Reset / Reveal
els.reset.addEventListener("click", resetPlay);
els.reveal.addEventListener("click", () => {
  markInteracted();
  revealPlay();
  focusForTyping();
});

// Success modal (Overlap)
els.success.addEventListener("click", (e) => {
  if (e.target === els.success) {
    markInteracted();
    closeSuccess();
    focusForTyping();
  }
});
els.sClose.addEventListener("click", () => {
  markInteracted();
  closeSuccess();
  focusForTyping();
});
els.sAgain.addEventListener("click", () => {
  markInteracted();
  resetPlay();
  focusForTyping();
});
els.sNext.addEventListener("click", () => {
  markInteracted();
  loadByViewOffset(1);
});

// Builder
els.pSel.addEventListener("change", () => {
  pIdx = +els.pSel.value || 0;
  loadPuzzle(pIdx);
});

els.pTitle.addEventListener("input", () => {
  puzzles[pIdx].title = els.pTitle.value;
  if (els.pSel.options[pIdx]) {
    const tag = puzzles[pIdx].type === MODE.CHAIN ? " — Word Chain" : "";
    els.pSel.options[pIdx].text = (els.pTitle.value || "Untitled") + tag;
  }
  setDirty(true);
  renderPreview();
});

els.pNew.addEventListener("click", () => {
  puzzles.push(
    normPuzzle({
      id: uid(),
      title: "Untitled",
      type: MODE.OVERLAP,
      words: [{ clue: "Clue", answer: "WORD", start: 1, color: "--c-red", height: "full" }],
    })
  );
  store.save();
  loadPuzzle(puzzles.length - 1);
  setTab(VIEW.BUILD);
});

els.pDel.addEventListener("click", () => {
  if (puzzles.length <= 1) return;
  if (!confirm("Delete this puzzle?")) return;
  puzzles.splice(pIdx, 1);
  store.save();
  loadPuzzle(Math.max(0, pIdx - 1));
});

els.wAdd.addEventListener("click", () => {
  const p = puzzles[pIdx];
  p.words = p.words || [];

  const maxEnd = p.words.reduce((m, w) => {
    const s = Math.max(1, Math.floor(+w.start || 1));
    const len = cleanA(w.answer).length || 4;
    return Math.max(m, s + len - 1);
  }, 0);

  const nextStart = Math.max(1, maxEnd + 1);
  const chainMode = isChainPuzzle(p);

  p.words.push({
    clue: "Clue",
    answer: "WORD",
    start: nextStart,
    color: chainMode ? DIFF_COLORS.easy[0] : "--c-red",
    height: "full",
    ...(chainMode ? { diff: "easy" } : {}),
  });

  saveAndReRender();
});

els.rows.addEventListener("click", (e) => {
  const row = e.target.closest(".row");
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!row || !act) return;

  const i = +row.dataset.i;
  const ws = puzzles[pIdx].words || [];

  if (act === "rm") {
    ws.splice(i, 1);
    saveAndReRender();
  }
});

els.rows.addEventListener("input", (e) => {
  const row = e.target.closest(".row");
  const f = e.target.dataset.f;
  if (!row || !f) return;

  const i = +row.dataset.i;
  const w = (puzzles[pIdx].words || [])[i];
  if (!w) return;

  if (f === "start") w.start = +e.target.value || 1;
  else w[f] = e.target.value;

  setDirty(true);
  renderPreview();
});

els.rows.addEventListener("change", (e) => {
  const row = e.target.closest(".row");
  const f = e.target.dataset.f;
  if (!row || !f) return;

  const i = +row.dataset.i;
  const w = (puzzles[pIdx].words || [])[i];
  if (!w) return;

  w[f] = e.target.value;

 if (isChainPuzzle(puzzles[pIdx]) && chainIsTimed(puzzles[pIdx]) && f === "diff") {
  const allowed = DIFF_COLORS[w.diff] || DIFF_COLORS.easy;
  if (!allowed.includes(w.color)) w.color = allowed[0];
}


  setDirty(true);
  renderRows();
  renderPreview();
});

// ---- Start ----
loadPuzzle(0);
setTab(currentView);

requestAnimationFrame(() => {
  setAt(0);
  focusForTyping();
});
