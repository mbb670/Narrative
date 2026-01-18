// Overlap V1 game runtime.
// Single-file implementation that handles puzzle loading, UI, input, chain timing,
// persistence, and all modal flows. Comments below are intended to guide future modularization.
import "../../docs/token_switcher/switcher.js";
import {
  MODE,
  VIEW,
  LAST_VIEW_KEY,
  ARCHIVE_RETURN_TIMEOUT_MS,
  SUPPRESS_SPLASH,
  DEV_DISABLE_AUTOPAUSE,
  FORCE_FTUE,
  IS_IOS,
  FTUE_SEEN_KEY,
} from "./js/config.js";
import {
  clamp,
  isEditable,
  isChainPuzzle,
  toDateKey,
  getLastPlayedChain,
  setLastPlayedChain,
  normalizePuzzleId,
  puzzleDateLabel,
  puzzleLabel,
  isDailyChainPuzzle,
} from "./js/utils.js";
import { applyPaletteToDom } from "./js/palette.js";
import { loadDefaultPuzzles } from "./js/data/defaults.js";
import { createStore } from "./js/data/store.js";
import {
  chainPuzzleKey,
  todayKey,
  loadChainProgressStore,
  saveChainProgressStore,
  pruneStaleChainProgress,
  clearChainProgressForPuzzle,
  clearAllChainProgress,
  clearChainStats,
  chainStatsSummary,
  recordChainCompletionIfNeeded,
} from "./js/data/chain-progress.js";
import { els } from "./js/dom.js";
import { computed, normPuzzle, setCols } from "./js/model.js";
import { createSlider } from "./js/ui/slider.js";
import { createSettingsUI } from "./js/ui/settings.js";
import { createArchiveUI } from "./js/ui/archive.js";
import { createHints } from "./js/ui/hints.js";
import { createScrollHelpers } from "./js/ui/scroll.js";
import { createNavigation } from "./js/ui/navigation.js";
import { createGridRenderer } from "./js/ui/grid.js";
import { createGridInteractions } from "./js/ui/grid-interactions.js";
import { createSelectionUI } from "./js/ui/selection.js";
import { createPlayControls } from "./js/ui/play-controls.js";
import { createGiveUpModal } from "./js/ui/give-up.js";
import { createNavControls } from "./js/ui/nav-controls.js";
import { createViewHelpers } from "./js/ui/view.js";
import { createKeyboard } from "./js/ui/keyboard.js";
import { createToasts } from "./js/ui/toasts.js";
import { createResultsUI } from "./js/ui/results.js";

// Reads last open tab from storage with a safe fallback.
function loadLastView() {
  try {
    const v = localStorage.getItem(LAST_VIEW_KEY);
    return v === VIEW.PLAY || v === VIEW.CHAIN ? v : VIEW.CHAIN;
  } catch {
    return VIEW.CHAIN;
  }
}


// ---- Palettes ----
// (moved to ./js/palette.js)

// ---- Slider (scroll surrogate, squish-style) ----
// (moved to ./js/ui/slider.js)

// ---- Defaults loading ----
// (moved to ./js/data/defaults.js)
const DEF = await loadDefaultPuzzles();


// ---- DOM ----
// (moved to ./js/dom.js)

const NAV_DEBUG = false;
const logNav = () => {};

// ---- Toasts ----
// (moved to ./js/ui/toasts.js)
const toasts = createToasts({
  els,
  getPlay: () => play,
  isWordCorrect,
});
let lastPlayWarningKey = "";
let lastChainWarningKey = "";
const HINT_PENALTY_SEC = 10;
const CHAIN_UI = { IDLE: "idle", RUNNING: "running", PAUSED: "paused", DONE: "done" };

const settingsUI = createSettingsUI({ els });

const {
  closeSuccess,
  setResultsInert,
  shareResult,
} = createResultsUI({
  els,
  getPuzzles: () => puzzles,
  getPuzzleIndex: () => pIdx,
  getChain: () => chain,
  fmtTime,
  toasts,
});

const archiveUI = createArchiveUI({
  els,
  getPuzzles: () => puzzles,
  addPuzzle: (puzzle) => {
    puzzles.push(normPuzzle(puzzle));
    return puzzles.length - 1;
  },
  closeSplash,
  openSplash,
  getSplashState: () => splashState(),
  setTab,
  loadPuzzle,
  getPlay: () => play,
  getChain: () => chain,
  chainStartNow,
  chainResume,
  fmtTime,
});
const { openArchiveModal, isArchiveDailyPuzzle } = archiveUI;

const userKey = () => (Array.isArray(play.usr) ? play.usr.join("") : "");

function resetToastGuards() {
  lastPlayWarningKey = "";
  lastChainWarningKey = "";
}

// ---- Time penalties ----
// Chain mode uses time penalties for hints and "give up" reveals.
function addTimePenalty(seconds, type = "") {
  if (play.mode !== MODE.CHAIN) return;
  const sec = Math.max(0, Math.round(seconds || 0));
  if (!sec) return;
  if (type === "hint") chain.hintPenaltySecTotal = Math.max(0, (chain.hintPenaltySecTotal || 0) + sec);
  if (type === "word") chain.wordPenaltySecTotal = Math.max(0, (chain.wordPenaltySecTotal || 0) + sec);

  if (chain.running) {
    // Move start backward so elapsed includes penalty immediately
    chain.startAt -= sec * 1000;
    const ui = ensureChainUI();
    const elapsed = (Date.now() - chain.startAt) / 1000;
    chain.elapsed = elapsed;
    if (ui.timer) ui.timer.textContent = fmtTime(elapsed);
  } else {
    chain.elapsed = Math.max(0, (chain.elapsed || 0) + sec);
    const ui = ensureChainUI();
    if (ui.timer) ui.timer.textContent = fmtTime(chain.elapsed);
  }

  if (type === "hint" && els.toastHint) {
    const txt = String(sec);
    toasts.showToast("hint", txt);
  }
}

// ---- FTUE ----
// First-time user experience is a scripted demo board with timed typing animations.
const FTUE_STEPS = [
  {
    title: "Solve each clue to fill a block",
    desc: "Type in a block to fill the answer. Once correct, the letters are locked in.",
    tip: "Tip: Start anywhere in the puzzle.",
  },
  {
    title: "Neighboring blocks share letters",
    desc: "Stuck? Try a nearby block. Shared letters will help fill in the gaps.",
    tip: "Tip: Tap a clue to reveal a hint.",
  },
  {
    title: "Complete the chain to finish the puzzle",
    desc: "Solve every word to complete the chain. Speed counts!",
    tip: "Tip: A new puzzle drops every day.",
  },
];

let ftueStep = 0;
let ftueDialogTimer = null;
let ftueShowTimer = null;
let ftueNavBlockedUntil = 0;
let ftueTouchStart = null;
// FTUE demo state is independent from the real play state.
const ftueDemo = {
  puzzle: null,
  model: null,
  usr: [],
  at: 0,
  timers: [],
  lockedEntries: new Set(),
  paused: false,
  solvedCells: new Set(),
};
const FTUE_DIALOG_DELAY = 500;
const FTUE_NAV_COOLDOWN = 10;
const FTUE_SWIPE_THRESHOLD = 40;
const FTUE_TIMING = {
  typeStep: 600,
  stepStartDelay: [1000, 300, 1200], // per-step start delays (0,1,2)
  stepEndDelay: [7000, 5000, 10000], // per-step end delays (0,1,2)
  step3MidPause: 2000,
};

// Modal state helpers for FTUE.
const ftueIsOpen = () => !!els.ftueModal?.classList.contains("is-open");
let _ftuePrevOverflow = "";
// Prevent interaction with the live board while FTUE is open.
function ftueDisableInteractions() {
  _ftuePrevOverflow = document.body.style.overflow;
  if (!IS_IOS) document.body.style.overflow = "hidden";
  if (els.stage) els.stage.style.pointerEvents = "none";
  if (els.gridScroll) els.gridScroll.style.pointerEvents = "none";
  if (els.keyboard) els.keyboard.style.pointerEvents = "none";
}
function ftueEnableInteractions() {
  document.body.style.overflow = _ftuePrevOverflow || "";
  if (els.stage) els.stage.style.pointerEvents = "";
  if (els.gridScroll) els.gridScroll.style.pointerEvents = "";
  if (els.keyboard) els.keyboard.style.pointerEvents = "";
}

// FTUE persistence flags (localStorage).
const hasSeenFtue = () => {
  try {
    return localStorage.getItem(FTUE_SEEN_KEY) === "1";
  } catch {
    return false;
  }
};
const markFtueSeen = () => {
  try {
    localStorage.setItem(FTUE_SEEN_KEY, "1");
  } catch {}
};

// Render labels and kick off the step animation.
function renderFtueStep() {
  const step = Math.max(0, Math.min(FTUE_STEPS.length - 1, ftueStep));
  const data = FTUE_STEPS[step] || FTUE_STEPS[0];
  if (els.ftueTitle) els.ftueTitle.textContent = data.title || "";
  if (els.ftueDesc) els.ftueDesc.textContent = data.desc || "";
  if (els.ftueTip) els.ftueTip.textContent = data.tip || "";
  if (els.ftueStepLabel) els.ftueStepLabel.textContent = `${step + 1}/${FTUE_STEPS.length}`;
  if (els.ftuePrev) {
    // Keep back enabled so users can return to splash on step 0
    els.ftuePrev.disabled = false;
    els.ftuePrev.classList.remove("is-disabled");
  }
  if (els.ftueNext) {
    const summary = chainProgressSummary();
    const solved = summary.solved || 0;
    const total = summary.total || play.entries.length || 0;
    let label = "Next";
    if (step === FTUE_STEPS.length - 1) {
      label =
        summary.state === "complete"
          ? "Admire puzzle"
          : summary.state === "paused"
          ? `Continue puzzle (${solved}/${total})`
          : "Let's Play";
    }
    els.ftueNext.textContent = label;
  }
  if (els.ftueDots && els.ftueDots.forEach) {
    els.ftueDots.forEach((dot, idx) => dot.classList.toggle("is-active", idx === step));
  }

  // reset any in-flight timers/scroll freeze before re-running animation
  clearFtueTimers();
  ftueDemo.freezeScroll = false;
  requestAnimationFrame(() => runFtueAnimation(step));
}

// Open the FTUE modal and pause any live chain progress underneath.
function openFtue(startStep = 0, opts = {}) {
  if (!els.ftueModal) return;
  clearTimeout(ftueDialogTimer);
  if (els.ftueDialog) els.ftueDialog.classList.remove("is-open");
  ftueNavBlockedUntil = 0;
  ftueStep = Math.max(0, Math.min(FTUE_STEPS.length - 1, startStep));
  ftueDemo.paused = false;
  ftueUpdatePlayPauseUI();

  // Ensure chain isn't running underneath the FTUE
  if (play.mode === MODE.CHAIN) {
    // snapshot elapsed if running
    if (chain.running) {
      const elapsed = Math.max(0, (Date.now() - chain.startAt) / 1000);
      chain.elapsed = elapsed;
    }
    chain.running = false;
    if (chain.tickId) {
      clearInterval(chain.tickId);
      chain.tickId = 0;
    }
    const anyProgress = chain.started || play.usr.some(Boolean);
    chainSetUIState(play.done ? CHAIN_UI.DONE : anyProgress ? CHAIN_UI.PAUSED : CHAIN_UI.IDLE);
  }

  ensureFtueBoard();
  renderFtueStep();
  els.ftueModal.classList.remove("is-open");
  els.ftueModal.setAttribute("aria-hidden", "false");
  els.ftueModal.removeAttribute("hidden");
  // document.body.classList.add("is-ftue-open");
  ftueDisableInteractions();
  const noAnim = opts.noAnim === true;
  const applyNoAnim = () => {
    [els.ftueModal, els.ftueDialog].forEach((el) => {
      if (!el) return;
      el.dataset.ftuePrevTransition = el.style.transition || "";
      el.dataset.ftuePrevAnim = el.style.animationDuration || "";
      el.style.transition = "none";
      el.style.animationDuration = "0ms";
    });
  };
  const restoreNoAnim = () => {
    [els.ftueModal, els.ftueDialog].forEach((el) => {
      if (!el) return;
      if (el.dataset.ftuePrevTransition != null) {
        el.style.transition = el.dataset.ftuePrevTransition;
        delete el.dataset.ftuePrevTransition;
      } else {
        el.style.transition = "";
      }
      if (el.dataset.ftuePrevAnim != null) {
        el.style.animationDuration = el.dataset.ftuePrevAnim;
        delete el.dataset.ftuePrevAnim;
      } else {
        el.style.animationDuration = "";
      }
    });
  };

  if (noAnim) applyNoAnim();

  const finishOpen = () => {
    els.ftueModal?.classList.add("is-open");
    if (els.ftueDialog && ftueIsOpen()) {
      els.ftueDialog.classList.add("is-open");
    }
    if (noAnim) {
      // restore styles after paint so future opens animate
      setTimeout(restoreNoAnim, 50);
    }
  };

  if (opts.instant || noAnim) {
    finishOpen();
  } else {
    requestAnimationFrame(finishOpen);
    ftueDialogTimer = window.setTimeout(() => {
      if (els.ftueDialog && ftueIsOpen()) {
        els.ftueDialog.classList.add("is-open");
      }
    }, FTUE_DIALOG_DELAY);
  }
}

// Close FTUE, restore body state, and mark as seen.
function closeFtue() {
  if (!els.ftueModal) return;
  clearFtueTimers();
  clearTimeout(ftueDialogTimer);
  ftueDialogTimer = null;
  ftueDemo.paused = true;
  if (els.ftueDialog) els.ftueDialog.classList.remove("is-open");
  els.ftueModal.classList.remove("is-open");
  [els.ftueModal, els.ftueDialog].forEach((el) => {
    if (!el) return;
    el.style.transition = "";
    el.style.animationDuration = "";
    delete el.dataset.ftuePrevTransition;
    delete el.dataset.ftuePrevAnim;
  });
  els.ftueModal.setAttribute("aria-hidden", "true");
  els.ftueModal.setAttribute("hidden", "true");
  // document.body.classList.remove("is-ftue-open");
  markFtueSeen();
  ftueEnableInteractions();
}

const nextFtue = () => {
  const now = Date.now();
  if (now < ftueNavBlockedUntil) return;
  ftueNavBlockedUntil = now + FTUE_NAV_COOLDOWN;
  if (ftueStep >= FTUE_STEPS.length - 1) {
    closeFtue();
    return;
  }
  ftueStep = Math.min(ftueStep + 1, FTUE_STEPS.length - 1);
  renderFtueStep();
};

const prevFtue = () => {
  const now = Date.now();
  if (now < ftueNavBlockedUntil) return;
  ftueNavBlockedUntil = now + FTUE_NAV_COOLDOWN;
  ftueStep = Math.max(ftueStep - 1, 0);
  renderFtueStep();
};

// Show FTUE automatically if not seen or forced.
function maybeShowFtue() {
  if (!els.ftueModal) return;
  clearTimeout(ftueShowTimer);
  if (FORCE_FTUE || !hasSeenFtue()) {
    ftueShowTimer = window.setTimeout(() => openFtue(0), FTUE_DIALOG_DELAY);
  }
}

// All FTUE animations are timer-driven; reset between steps.
function clearFtueTimers() {
  ftueDemo.timers.forEach((t) => clearTimeout(t));
  ftueDemo.timers = [];
}

// Swipe navigation between FTUE steps (touch only).
function onFtueTouchStart(e) {
  if (!ftueIsOpen()) return;
  const t = e.touches && e.touches[0];
  if (!t) return;
  ftueTouchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
}

function onFtueTouchEnd(e) {
  if (!ftueIsOpen() || !ftueTouchStart) return;
  const t = e.changedTouches && e.changedTouches[0];
  if (!t) {
    ftueTouchStart = null;
    return;
  }
  const dx = t.clientX - ftueTouchStart.x;
  const dy = t.clientY - ftueTouchStart.y;
  const dt = Date.now() - ftueTouchStart.time;
  ftueTouchStart = null;
  if (Math.abs(dx) < FTUE_SWIPE_THRESHOLD) return;
  if (Math.abs(dx) <= Math.abs(dy)) return;
  if (dt > 800) return;
  if (dx < 0) nextFtue();
  else prevFtue();
}

// FTUE animation can be paused; update the toggle UI.
function ftueUpdatePlayPauseUI() {
  if (!els.ftuePlayPause) return;
  const isPaused = !!ftueDemo.paused;
  els.ftuePlayPause.setAttribute("aria-pressed", isPaused ? "true" : "false");
  if (els.ftuePlayPauseIcon) {
    els.ftuePlayPauseIcon.textContent = isPaused ? "▶" : "⏸";
  }
  els.ftuePlayPause.title = isPaused ? "Play animation" : "Pause animation";
}

function ftuePause() {
  ftueDemo.paused = true;
  clearFtueTimers();
  ftueUpdatePlayPauseUI();
}

function ftuePlay() {
  ftueDemo.paused = false;
  clearFtueTimers();
  ftueUpdatePlayPauseUI();
  runFtueAnimation(ftueStep);
}

// Build a synthetic board for the FTUE demo puzzle.
function ensureFtueBoard() {
  if (!els.ftueGrid) return null;
  const ftuePuzzle = puzzles.find(
    (p) => String(p.id || p.title || "").trim().toLowerCase() === "ftue"
  );
  if (!ftuePuzzle) return null;
  const model = computed(ftuePuzzle);
  ftueDemo.puzzle = ftuePuzzle;
  ftueDemo.model = model;
  ftueDemo.usr = Array.from({ length: model.total }, () => "");
  ftueDemo.at = 0;
  ftueDemo.lockedEntries = new Set();
  renderGrid(els.ftueGrid, model, false, ftuePuzzle);
  ftueRenderState();
  return ftueDemo;
}

// Render FTUE board state (letters, active cell, solved/locked styling).
function ftueRenderState() {
  if (!ftueDemo.model || !els.ftueGrid) return;
  const cells = els.ftueGrid.querySelectorAll(".cell");
  cells.forEach((c) => {
    const i = +c.dataset.i;
    const letterEl = c.querySelector(".letter");
    if (letterEl) letterEl.textContent = ftueDemo.usr[i] || "";
    c.classList.toggle("is-active", i === ftueDemo.at);

    // solved state only when a covering entry is solved
    const solved = ftueDemo.solvedCells.has(i);
    c.classList.toggle("cell-solved", solved);
  });
  // range lock styling
  els.ftueGrid.querySelectorAll(".range").forEach((r) => {
    const eIdx = Number(r.dataset.e);
    r.classList.toggle("is-locked", ftueDemo.lockedEntries.has(eIdx));
  });
  ftueKeepActiveInView(ftueDemo.lastScrollBehavior || "smooth");
}

// Move the demo cursor and keep it in view.
function ftueSetAt(idx, opts = {}) {
  if (!ftueDemo.model) return;
  ftueDemo.at = clamp(idx, 0, ftueDemo.model.total - 1);
  ftueDemo.lastScrollBehavior = opts.smooth ? "smooth" : "auto";
  ftueRenderState();
}

function ftueSetLetter(idx, ch) {
  if (!ftueDemo.model) return;
  if (idx == null || idx < 0 || idx >= ftueDemo.usr.length) return;
  ftueDemo.usr[idx] = (ch || "").toUpperCase();
  ftueRenderState();
}

// FTUE uses its own "solved" check separate from live play.
function ftueIsEntrySolved(entry) {
  if (!entry) return false;
  for (let i = 0; i < entry.len; i++) {
    if (ftueDemo.usr[entry.start + i] !== entry.ans[i]) return false;
  }
  return true;
}

// function ftueIsCellSolved(i) {
//   if (ftueDemo.solvedCells?.size) return ftueDemo.solvedCells.has(i);
//   const covering = ftueDemo.model?.entries?.filter((e) => entryContainsIndex(e, i)) || [];
//   if (!covering.length) return false;
//   return covering.every((e) => ftueDemo.lockedEntries.has(e.eIdx) && ftueIsEntrySolved(e));
// }

// Add cells to the "solved" styling set (used in demo visuals).
function ftueAddSolvedCells(entry, count = null) {
  if (!entry || !ftueDemo.solvedCells) return;
  const n = count == null ? entry.len : Math.min(count, entry.len);
  for (let i = 0; i < n; i++) {
    ftueDemo.solvedCells.add(entry.start + i);
  }
}

// Maintain FTUE cursor in view; can freeze during animations.
function ftueKeepActiveInView(behavior = "smooth") {
  if (ftueDemo.freezeScroll) return;
  if (ftueStep === 0) {
    if (els.ftueGridScroll) els.ftueGridScroll.scrollTo({ left: 0, behavior: "smooth" });
    return; // slide 1 stays static
  }
  const sc = els.ftueGridScroll;
  if (!sc || !els.ftueGrid) return;
  const cell = els.ftueGrid.querySelector(`.cell[data-i="${ftueDemo.at}"]`);
  if (!cell) return;
  const rect = cell.getBoundingClientRect();
  const scRect = sc.getBoundingClientRect();
  const target =
    sc.scrollLeft + (rect.left - scRect.left) - (sc.clientWidth - rect.width) / 2;
  const max = Math.max(0, sc.scrollWidth - sc.clientWidth);
  const clamped = Math.max(0, Math.min(max, target));
  sc.scrollTo({ left: clamped, behavior });
  if (clamped >= max - 1) {
    ftueDemo.freezeScroll = true;
  }
}

// Lock a demo entry and play its solve animation.
function ftueLockEntry(entry) {
  if (!entry) return;
  if (!ftueDemo.lockedEntries) ftueDemo.lockedEntries = new Set();
  ftueDemo.lockedEntries.add(entry.eIdx);
  const rangeEl = els.ftueGrid?.querySelector(`.range[data-e="${entry.eIdx}"]`);
  if (rangeEl) {
    rangeEl.classList.add("range-solve-anim");
    rangeEl.addEventListener(
      "animationend",
      () => rangeEl.classList.remove("range-solve-anim"),
      { once: true }
    );
  }
  ftueRenderState();
}

// function ftueEntry(ans) {
//   if (!ftueDemo.model) return null;
//   return ftueDemo.model.entries.find((e) => e.ans.toUpperCase() === ans.toUpperCase()) || null;
// }

function ftueFillEntryInstant(entry) {
  if (!entry) return;
  const letters = entry.ans.split("");
  letters.forEach((ch, idx) => {
    ftueSetLetter(entry.start + idx, ch);
  });
}

// Stepwise typing animation for the FTUE demo.
function ftueTypeLetters(startIdx, letters, opts = {}) {
  let delay = opts.delayBefore ?? 0;
  const step = opts.step ?? 180;
  const smoothScroll = opts.smoothScroll !== false; // default true
  const freezeDuring = opts.freezeDuringType === true; // default false
  const centerAfter = opts.centerAfter !== false; // default true
  const onDone = opts.onDone;
  const touched = [];
  letters.toUpperCase().split("").forEach((ch, offset) => {
    ftueDemo.timers.push(
      setTimeout(() => {
        const idx = startIdx + offset;
        touched.push(idx);
        ftueSetLetter(idx, ch);
        ftueSetAt(idx, { smooth: smoothScroll });
      }, delay)
    );
    delay += step;
  });
  if (onDone) {
    ftueDemo.timers.push(
      setTimeout(() => {
        if (freezeDuring) ftueDemo.freezeScroll = false;
        if (centerAfter && touched.length) ftueSetAt(touched[touched.length - 1], { smooth: true });
        onDone();
      }, delay + (opts.afterDone ?? 0))
    );
  }
}

// Trigger the same solve animations used in the live board.
function ftueTriggerSolveAnimation(entry) {
  if (!entry || !els.ftueGrid) return;
  const letters = [];
  for (let i = entry.start; i < entry.start + entry.len; i++) {
    const cell = els.ftueGrid.querySelector(`.cell[data-i="${i}"]`);
    const letter = cell?.querySelector(".letter");
    if (letter) letters.push(letter);
  }
  letters.forEach((letter, idx) => {
    letter.classList.remove("solve-anim");
    letter.style.setProperty("--solve-delay", `${idx * 80}ms`);
    void letter.offsetWidth;
    letter.classList.add("solve-anim");
    letter.addEventListener(
      "animationend",
      () => {
        letter.classList.remove("solve-anim");
        letter.style.removeProperty("--solve-delay");
      },
      { once: true }
    );
  });

  const rangeEl = els.ftueGrid.querySelector(`.range[data-e="${entry.eIdx}"]`);
  if (rangeEl) {
    rangeEl.classList.remove("range-solve-anim");
    void rangeEl.offsetWidth;
    rangeEl.classList.add("range-solve-anim");
    rangeEl.addEventListener(
      "animationend",
      () => rangeEl.classList.remove("range-solve-anim"),
      { once: true }
    );
  }
}

// Reset FTUE board to a blank state between loops.
function ftueResetBoard() {
  if (!ftueDemo.model) return;
  if (els.ftueGrid) {
    els.ftueGrid.querySelectorAll(".solve-anim").forEach((el) => {
      el.classList.remove("solve-anim");
      el.style.removeProperty("--solve-delay");
    });
    els.ftueGrid.querySelectorAll(".range-solve-anim").forEach((el) => el.classList.remove("range-solve-anim"));
    els.ftueGrid.querySelectorAll(".cell-solved").forEach((el) => el.classList.remove("cell-solved"));
    els.ftueGrid.querySelectorAll(".range.is-locked").forEach((el) => el.classList.remove("is-locked"));
  }
  ftueDemo.usr = Array.from({ length: ftueDemo.model.total }, () => "");
  ftueDemo.lockedEntries = new Set();
  ftueDemo.solvedCells = new Set();
  ftueDemo.freezeScroll = false;
  ftueSetAt(0, { smooth: true });
  ftueRenderState();
}

// Orchestrate the scripted typing demo per FTUE step.
function runFtueAnimation(step) {
  if (!ensureFtueBoard()) return;
  clearFtueTimers();
  if (ftueDemo.paused) return;

  const startDelay = Array.isArray(FTUE_TIMING.stepStartDelay)
    ? FTUE_TIMING.stepStartDelay[step] ?? 0
    : 0;
  const endDelay = Array.isArray(FTUE_TIMING.stepEndDelay)
    ? FTUE_TIMING.stepEndDelay[step] ?? 0
    : 0;

  const entries = ftueDemo.model?.entries || [];
  const first = entries[0];
  const second = entries[1];
  const third = entries[2];
  const fourth = entries[3];
  const earthEntry =
    entries.find((e) => e.ans?.toUpperCase() === "EARTH") || third || second || entries[0];
  const loveEntry = entries.find((e) => e.ans?.toUpperCase() === "LOVE") || second;

  // Reset board
  ftueResetBoard();

  if (step === 0) {
    ftueSetAt(first ? first.start : 0, { smooth: true });
    ftueRenderState();
    if (first) {
      ftueDemo.timers.push(
        setTimeout(() => {
          ftueTypeLetters(first.start, first.ans, {
            step: FTUE_TIMING.typeStep,
            smoothScroll: true,
            onDone: () => {
              ftueTriggerSolveAnimation(first);
              ftueLockEntry(first);
              // Only mark H,E,L as "solved" for demo
              ftueAddSolvedCells(first, 3);
              ftueRenderState();
              ftueSetAt(first.start + first.len - 1);
            },
          });
        }, startDelay)
      );
      ftueDemo.timers.push(
        setTimeout(() => {
          if (ftueStep === step) runFtueAnimation(step);
        }, endDelay)
      );
    }
    return;
  }

  if (step === 1) {
    // Prefill first word
    if (first) {
      ftueFillEntryInstant(first);
      ftueLockEntry(first);
      ftueAddSolvedCells(first, 3); // keep HEL marked
    }
    const startAfterFirst = first ? first.start + first.len : 0;
    ftueSetAt(startAfterFirst, { smooth: true });
    ftueRenderState();

    if (loveEntry) {
      ftueDemo.timers.push(
        setTimeout(() => {
          // Type next two letters (e.g., V, E) without extra movement
          const startIdx = loveEntry.start + 2; // positions for V and E in LOVE
          // prefill first two letters so VE completes the word
          ftueSetLetter(loveEntry.start, loveEntry.ans[0] || "L");
          ftueSetLetter(loveEntry.start + 1, loveEntry.ans[1] || "O");
          ftueSetAt(startIdx, { smooth: true });
          ftueDemo.timers.push(
            setTimeout(() => {
              ftueTypeLetters(startIdx, (loveEntry.ans || "VE").slice(2, 4) || "VE", {
                step: FTUE_TIMING.typeStep,
                smoothScroll: true,
                onDone: () => {
                  if (ftueIsEntrySolved(loveEntry)) {
                    ftueTriggerSolveAnimation(loveEntry);
                    ftueLockEntry(loveEntry);
                  }
                  // mark L,O,V as solved demo cells
                  ftueAddSolvedCells(loveEntry, 3);
                  ftueRenderState();
                  ftueSetAt(startIdx + 1, { smooth: true });
                },
              });
            }, startDelay)
          );
        }, startDelay)
      );
      ftueDemo.timers.push(
        setTimeout(() => {
          if (ftueStep === step) runFtueAnimation(step);
        }, endDelay)
      );
    }
    return;
  }

  if (step === 2) {
    if (first) {
      ftueFillEntryInstant(first);
      ftueLockEntry(first);
      ftueAddSolvedCells(first); // HELLO should already be solved
    }
    if (second) {
      ftueFillEntryInstant(second);
      ftueLockEntry(second);
      ftueAddSolvedCells(second, 3); // LOV persists
    }
    const earthStart = earthEntry ? earthEntry.start + 1 : 0; // continue after existing E
    ftueSetAt(earthStart, { smooth: true });
    ftueRenderState();

    // Type ARTH
    ftueDemo.timers.push(
      setTimeout(() => {
        ftueTypeLetters(earthStart, "ARTH", {
          step: FTUE_TIMING.typeStep,
          smoothScroll: true,
          centerAfter: true,
          onDone: () => {
            if (earthEntry && ftueIsEntrySolved(earthEntry)) {
              ftueTriggerSolveAnimation(earthEntry);
              ftueLockEntry(earthEntry);
            }
            // mark E,A,R as solved demo cells
            for (let i = 0; i < Math.min(3, earthEntry?.len || 0); i++) {
              ftueDemo.solvedCells.add((earthEntry?.start || 0) + i);
            }
            ftueRenderState();
            // Pause, then type RONE in the fourth entry if available
            ftueDemo.timers.push(
              setTimeout(() => {
                if (fourth) {
                  const roneStart = fourth.start + 2; // start at R in THRONE
                  ftueDemo.freezeScroll = false; // allow scroll while finishing
                  ftueSetAt(roneStart, { smooth: true });
                  ftueTypeLetters(roneStart, "RONE", {
                    step: FTUE_TIMING.typeStep,
                    smoothScroll: true,
                    centerAfter: false,
                    onDone: () => {
                      if (ftueIsEntrySolved(fourth)) {
                        ftueTriggerSolveAnimation(fourth);
                        ftueLockEntry(fourth);
                      }
                      for (let i = 0; i < fourth.len; i++) {
                        ftueDemo.solvedCells.add(fourth.start + i);
                      }
                      ftueRenderState();
                      if (els.ftueToast) {
                        els.ftueToast.classList.add("is-showing");
                        setTimeout(() => els.ftueToast?.classList.remove("is-showing"), 2000);
                      }
                      ftueDemo.freezeScroll = true; // keep board stable at end
                      ftueSetAt(fourth.start + fourth.len - 1, { smooth: false });
                    },
                  });
                }
              }, FTUE_TIMING.step3MidPause)
            );
          },
        });
      }, startDelay)
    );
    ftueDemo.timers.push(
      setTimeout(() => {
        if (ftueStep === step) runFtueAnimation(step);
      }, endDelay)
    );
  }
}

// Clear all editable cells (used for select-all delete and reset behaviors).
function clearAllUnlockedCells() {
  if (play.done) return;
  if (play.mode === MODE.CHAIN && !chainInputAllowed()) return;

  let changed = false;
  const isLocked = (i) => play.mode === MODE.CHAIN && isCellLocked(i);
  for (let i = 0; i < play.n; i++) {
    if (isLocked(i)) continue;
    if (play.usr[i]) {
      play.usr[i] = "";
      changed = true;
    }
  }
  clearSelectAll();

  const target =
    play.mode === MODE.CHAIN ? findNextEditable(0, +1) ?? 0 : 0;
  setAt(target, { behavior: "smooth" });

  if (changed) {
    if (play.mode === MODE.CHAIN) {
      updatePlayUI();
      requestChainClues();
    } else {
      updatePlayUI();
      checkSolvedOverlapOnly();
    }
    updateResetRevealVisibility();
    updatePlayControlsVisibility();
    updatePuzzleActionsVisibility();
  } else {
    updatePlayUI();
  }
}

// Warnings shown when the board is fully filled but incorrect.
function maybeToastPlayFilledWrong() {
  if (play.mode !== MODE.PUZZLE || play.done) return;
  const filled = play.usr.every(Boolean);
  if (!filled) {
    lastPlayWarningKey = "";
    return;
  }
  const key = userKey();
  const allCorrect = play.usr.every((ch, i) => ch === play.exp[i]);
  if (allCorrect) return;
  if (key !== lastPlayWarningKey) {
    toasts.showToast("warning", "Not quite: Some or all words are incorrect");
    lastPlayWarningKey = key;
  }
}

function maybeToastChainFilledWrong() {
  if (play.mode !== MODE.CHAIN || play.done) return;
  const filled = play.usr.every(Boolean);
  if (!filled) {
    lastChainWarningKey = "";
    return;
  }
  const key = userKey();
  const unsolved = countUnsolvedWords();
  if (unsolved <= 0) return;
  if (key !== lastChainWarningKey) {
    toasts.showToast("warning", `Not quite: ${unsolved} words are incomplete or incorrect`);
    lastChainWarningKey = key;
  }
}

// Grid scroll should cancel smooth-follow so dragging feels direct.
// (moved to slider module)

// ---- Storage ----
// Puzzles are stored in localStorage; defaults are merged so shipped updates appear.
const store = createStore({
  getDefaults: () => DEF,
  getPuzzles: () => puzzles,
});

// ---- Per-puzzle chain progress persistence ----
// (store helpers moved to ./js/data/chain-progress.js)
let _persistChainRaf = 0;
let _persistTickLastTs = 0;
let _restoredFromStorage = false;
let _restoredAt = 0;
let _splashShown = false;
let _ftueNoAnimRestore = null;

// ---- Splash modal ----
// Splash summarizes chain progress and exposes quick actions (play/continue/admire).
function chainSummaryFromLive() {
  if (play.mode !== MODE.CHAIN) return null;
  const total = play.entries?.length || 0;
  const solved = total ? play.entries.filter(isWordCorrect).length : 0;
  const state = play.done ? "complete" : chain.started && !chain.running ? "paused" : "default";
  return { state, solved, total };
}

// When not on chain view, infer summary from stored progress.
function chainSummaryFromStore() {
  // Use today's chain puzzle (if available) to infer state when not in chain view
  const idx = findTodayChainIndex();
  const p = idx != null ? puzzles[idx] : null;
  if (!p || !isChainPuzzle(p)) return null;
  const key = chainPuzzleKey(p);
  if (!key) return null;
  const store = loadChainProgressStore();
  const data = store.puzzles?.[key];
  const today = todayKey();
  const puzzleId = normalizePuzzleId(p).id;
  const isCurrentDaily = isDailyChainPuzzle(p) && today && puzzleId === today;
  if (isCurrentDaily && data?.savedDayKey && data.savedDayKey !== today) {
    return { state: "default", solved: 0, total: computed(p).entries?.length || 0 };
  }
  if (!data) return { state: "default", solved: 0, total: computed(p).entries?.length || 0 };

  const model = computed(p);
  const total = model.entries?.length || 0;
  const usr = Array.isArray(data.usr) ? data.usr : [];
  const solved = (model.entries || []).filter((e) => {
    for (let i = 0; i < e.len; i++) {
      const idx = e.start + i;
      if (!usr[idx]) return false;
      if (usr[idx] !== model.exp[idx]) return false;
    }
    return true;
  }).length;

  const anyInput = usr.some(Boolean);
  const state = data.done
    ? "complete"
    : data.started || anyInput
    ? "paused"
    : "default";

  return { state, solved, total };
}

function chainProgressSummary() {
  return chainSummaryFromLive() || chainSummaryFromStore() || { state: "default", solved: 0, total: 0 };
}

function splashState() {
  return chainProgressSummary().state;
}

function splashSolvedText() {
  const { solved, total } = chainProgressSummary();
  return { solved, total };
}

// Populate splash labels and stats based on current progress.
function updateSplashContent(forceState) {
  if (!els.splash) return;
  const summary = chainProgressSummary();
  const state = forceState || summary.state;
  const solved = summary.solved || 0;
  const total = summary.total || play.entries.length || 0;

  if (els.splashDate) {
    const now = new Date();
    els.splashDate.textContent = now.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  const primaryLabel =
    state === "complete"
      ? "Admire puzzle"
      : state === "paused"
      ? `Continue puzzle (${solved}/${total || play.entries.length || 0})`
      : "Play";

  if (els.splashPrimary) els.splashPrimary.textContent = primaryLabel;
  if (els.splashSubtitle) {
    els.splashSubtitle.textContent =
      state === "complete"
        ? "You finished today’s chain"
        : state === "paused"
        ? "Pick up where you left off"
        : "Daily word chain";
  }
  const stats = chainStatsSummary();
  if (els.splashGamesPlayed) {
    els.splashGamesPlayed.textContent = stats.games > 0 ? String(stats.games) : "--";
  }
  if (els.splashAvgTime) {
    if (stats.games > 0) {
      const sec = Math.max(0, Math.round(stats.avgSec));
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      els.splashAvgTime.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    } else {
      els.splashAvgTime.textContent = "--";
    }
  }
  if (els.splashVersion) {
    const txt = els.splashVersion.textContent || "";
    els.splashVersion.textContent = txt || "V3.6";
  }
}

// ---- Archive modal ----
// (moved to ./js/ui/archive.js)

// ---- Settings ----
// (moved to ./js/ui/settings.js)

function openSplash(forceState) {
  if (!els.splash) return;
  updateSplashContent(forceState);
  els.splash.hidden = false;
  els.splash.setAttribute("aria-hidden", "false");
  document.documentElement.classList.add("is-modal-open");
  if (!IS_IOS) {
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
  }
  requestAnimationFrame(() => els.splash?.classList.add("is-open"));
}

function closeSplash() {
  if (!els.splash) return;
  els.splash.classList.remove("is-open");
  els.splash.setAttribute("aria-hidden", "true");
  els.splash.hidden = true;
  settingsUI.closeSettingsPanel();
  document.documentElement.classList.remove("is-modal-open");
  if (!IS_IOS) {
    document.body.style.overflow = "";
    document.body.style.touchAction = "";
  }
}

// Primary CTA handles FTUE gating and resumes/starts the chain.
function handleSplashPrimary() {
  if (!hasSeenFtue()) {
    // First-time: move to chain view in an idle state, then show FTUE (chain must not start yet)
    setTab(VIEW.CHAIN);
    chainForceIdleZero();
    chain.started = false;
    chain.running = false;
    chain.elapsed = 0;
    chainSetUIState(CHAIN_UI.IDLE);
    closeSplash();
    openFtue(0);
    return;
  }

  const state = splashState();
  setTab(VIEW.CHAIN);
  if (state === "complete") {
    closeSplash();
    return;
  }
  if (state === "paused") {
    closeSplash();
    if (play.done) return;
    if (chain.started) chainResume();
    else chainStartNow();
    return;
  }
  closeSplash();
  if (!chain.started) chainStartNow();
  else if (!chain.running) chainResume();
}

// Decide whether to show splash or jump to the archive after a recent return.
function maybeShowSplashOnLoad() {
  if (_splashShown || SUPPRESS_SPLASH) return;
  _splashShown = true;
  const last = getLastPlayedChain();
  const today = todayKey();
  const lastAt = Number.isFinite(last?.at) ? last.at : null;
  const withinArchiveWindow =
    lastAt == null ? true : Date.now() - lastAt <= ARCHIVE_RETURN_TIMEOUT_MS;
  // If the user last played a previous daily puzzle recently, jump into the archive.
  if (last?.isDate && last.id && today && last.id !== today && withinArchiveWindow) {
    openArchiveModal({ dateKey: last.id });
    return;
  }
  openSplash();
}

// Serialize the current chain state for persistence (including penalties + locks).
function chainProgressSnapshot(p) {
  if (play.mode !== MODE.CHAIN) return null;
  const key = chainPuzzleKey(p);
  if (!key) return null;
  const normalizedId = normalizePuzzleId(p);
  const puzzleType = MODE.CHAIN;
  const hasInput = Array.isArray(play.usr) && play.usr.some(Boolean);
  const elapsed = chain.running ? (Date.now() - chain.startAt) / 1000 : chain.elapsed || 0;
  const score = scoreChain();
  // Snapshot includes enough data to restore timing, locks, and hint penalties.
  const snap = {
    puzzleKey: key,
    puzzleId: normalizedId.id || null,
    puzzleType,
    puzzleIdIsDate: !!normalizedId.isDate,
    savedDayKey: todayKey(), // used to invalidate daily puzzles on date change
    usr: (play.usr || []).slice(0, play.n),
    at: clamp(play.at ?? 0, 0, Math.max(0, play.n - 1)),
    started: !!(chain.started || play.done || hasInput),
    done: !!play.done,
    revealed: !!play.revealed,
    lockedEntries: [...play.lockedEntries], // word-level locks
    lockedCells: Array.isArray(play.lockedCells) ? play.lockedCells.slice(0, play.n) : [], // per-cell locks (hints)
    hintsUsed: chain.hintsUsed || 0,
    hintPenaltySecTotal: chain.hintPenaltySecTotal || 0,
    wordPenaltySecTotal: chain.wordPenaltySecTotal || 0,
    elapsed: Math.max(0, +elapsed || 0),
    lastFinishElapsedSec: Math.max(0, chain.lastFinishElapsedSec || (play.done ? elapsed : 0)),
    unsolvedCount: chain.unsolvedCount || 0,
  };

  if (play.done) {
    snap.stats = {
      timeSec: snap.lastFinishElapsedSec,
      solved: score.correct,
      total: play.entries?.length || 0,
      hintsUsed: snap.hintsUsed,
    };
  }

  return snap;
}

// Save chain progress now (used after major events).
function persistChainProgressImmediate() {
  if (play.mode !== MODE.CHAIN) return;
  const p = puzzles[pIdx];
  const snap = chainProgressSnapshot(p);
  if (!snap) return;
  pruneStaleChainProgress();
  const store = loadChainProgressStore();
  store.puzzles[snap.puzzleKey] = snap;
  saveChainProgressStore(store);
  setLastPlayedChain(p);
  _persistTickLastTs = performance.now ? performance.now() : Date.now();
}

// Throttle persistence to animation frame to avoid excessive writes.
function requestPersistChainProgress() {
  if (play.mode !== MODE.CHAIN) return;
  if (_persistChainRaf) return;
  _persistChainRaf = requestAnimationFrame(() => {
    _persistChainRaf = 0;
    persistChainProgressImmediate();
  });
}

// Restore persisted progress for the current chain puzzle (if it matches).
function restoreChainProgressForCurrentPuzzle() {
  if (play.mode !== MODE.CHAIN) return false;
  _restoredFromStorage = false;
  const p = puzzles[pIdx];
  const key = chainPuzzleKey(p);
  if (!key) return false;

  // Remove stale daily data before attempting to restore.
  pruneStaleChainProgress();
  const store = loadChainProgressStore();
  const data = store.puzzles?.[key];
  const today = todayKey();
  const isDaily = isDailyChainPuzzle(p);
  const puzzleId = normalizePuzzleId(p).id;
  const isCurrentDaily = isDaily && today && puzzleId === today;
  // Daily puzzles should not carry progress across days.
  const stale = data && isCurrentDaily && data.savedDayKey && data.savedDayKey !== today;

  if (stale) {
    delete store.puzzles[key];
    saveChainProgressStore(store);
  }
  if (!data || stale) return false;

  const ui = ensureChainUI();

  // Restore user input and cursor position.
  play.usr = Array.from({ length: play.n }, (_, i) => data.usr?.[i] || "");
  play.at = clamp(data.at ?? 0, 0, Math.max(0, play.n - 1));
  play.done = !!data.done;
  play.revealed = !!data.revealed;

  chain.started = !!(data.started || play.done || play.usr.some(Boolean));
  chain.running = false;
  chain.elapsed = Math.max(0, +data.elapsed || 0);
  chain.startAt = 0;
  chain.left = 0;
  chain.lastFinishElapsedSec = Math.max(0, +data.lastFinishElapsedSec || 0);
  chain.unsolvedCount = Math.max(0, +data.unsolvedCount || 0);
  chain.hintsUsed = Math.max(0, +data.hintsUsed || 0);
  chain.hintPenaltySecTotal = Math.max(0, +data.hintPenaltySecTotal || chain.hintsUsed * HINT_PENALTY_SEC || 0);
  chain.wordPenaltySecTotal = Math.max(0, +data.wordPenaltySecTotal || 0);

  // Rebuild locks so hints and solved words preserve non-editable state.
  play.lockedEntries = new Set(Array.isArray(data.lockedEntries) ? data.lockedEntries : []);
  const prevLocked = Array.isArray(data.lockedCells) ? data.lockedCells.slice(0, play.n) : [];
  play.lockedCells = prevLocked.concat(Array.from({ length: Math.max(0, play.n - prevLocked.length) }, () => false));
  rebuildLockedCells();

  ui.timer.textContent = fmtTime(chain.elapsed);
  const state = play.done ? CHAIN_UI.DONE : chain.started ? CHAIN_UI.PAUSED : CHAIN_UI.IDLE;
  chainSetUIState(state, ui);
  setInlineCluesHiddenUntilChainStart();
  updateLockedWordUI();
  updatePlayUI();
  setAt(play.at, { behavior: "none", noScroll: true });
  scrollActiveCellAfterRestore(play.at);
  _restoredFromStorage = true;
  _restoredAt = play.at;

  return true;
}


// ---- Utils ----
// (moved to ./js/utils.js)

// (normPuzzle moved to ./js/model.js)

// ---- State ----
// Shared runtime state for the current puzzle and UI.
let puzzles = store.load().map(normPuzzle);
let pIdx = 0;

let currentView = loadLastView(); // play | chain

// Current puzzle state for the active board.
const play = {
  mode: MODE.PUZZLE,
  entries: [],
  exp: [],
  usr: [],
  n: 0,
  at: 0,
  done: false,
  revealed: false,
  fullSolveAnimated: false,

  lockedCells: [],
  lockedEntries: new Set(), // eIdx
};

const sliderUI = createSlider({
  els,
  getPlay: () => play,
  getPuzzles: () => puzzles,
  getPuzzleIndex: () => pIdx,
  getCurrentView: () => currentView,
  isWordCorrect,
  isUserPanning: () => _isUserPanning,
});

// When we intentionally keep the cursor on a newly locked cell, pause letter-triggered auto-advance.
const lockedAutoAdvanceSuppression = { idx: null, remaining: 0 };

function markLockedAutoAdvanceSuppression(idx, count = 2) {
  lockedAutoAdvanceSuppression.idx = idx;
  lockedAutoAdvanceSuppression.remaining = Math.max(0, count);
}

function consumeLockedAutoAdvanceSuppression(idx) {
  if (
    lockedAutoAdvanceSuppression.remaining > 0 &&
    lockedAutoAdvanceSuppression.idx === idx &&
    isCellLocked(idx)
  ) {
    lockedAutoAdvanceSuppression.remaining -= 1;
    return true;
  }
  return false;
}

function clearLockedAutoAdvanceSuppressionIfMoved(newIdx) {
  if (lockedAutoAdvanceSuppression.idx != null && lockedAutoAdvanceSuppression.idx !== newIdx) {
    lockedAutoAdvanceSuppression.idx = null;
    lockedAutoAdvanceSuppression.remaining = 0;
  }
}

// ---- Touch + on-screen keyboard ----
// Handles hidden input for mobile typing and a custom on-screen keyboard on touch.
const IS_TOUCH = "ontouchstart" in window || navigator.maxTouchPoints > 0;
const keyboardUI = createKeyboard({
  els,
  isEditable,
  write,
  back,
  move,
  getCurrentView: () => currentView,
  isTouch: IS_TOUCH,
});
const {
  markInteracted,
  focusForTyping,
  initOnScreenKeyboard,
  updateKeyboardVisibility,
  maybeDemoteHardwareKeyboard,
  noteHardwareKeyboard,
  hasHardwareKeyboard,
  isKeyboardInputTarget,
  blurKeyboardInput,
} = keyboardUI;

// ---- Model ----
// (moved to ./js/model.js)

// ---- Horizontal keep-in-view ----
// Keeps the active cell centered without fighting user panning.
// ---- Touch pan protection (iOS horizontal scroll) ----
let _isUserPanning = false;
let _panPointerId = null;
let _panMoved = false;
const gridClickGuard = { value: 0 };

const PAN_SLOP_PX = 8;
let _panStartX = 0;
let _panStartY = 0;
// Smooth scroll-follow moved to ./js/ui/slider.js
const {
  keepCellInView,
  keepActiveCellInView,
  requestKeepActiveCellInView,
  scrollActiveCellAfterRestore,
  scrollToWordStart,
} = createScrollHelpers({
  els,
  getPlay: () => play,
  sliderUI,
  isTouch: IS_TOUCH,
  isUserPanning: () => _isUserPanning,
});


// ---- Selection highlight ----
const selectionUI = createSelectionUI({
  els,
  getPlay: () => play,
  isCellLocked,
});

const {
  updateSelectedWordUI,
  updateSelectAllUI,
  selectEntry,
  clearSelection,
  clearSelectAll,
  selectAllUnlockedCells,
  maybeClearSelectionOnCursorMove,
  getSelectedEntry,
  isSelectAllUnlocked,
} = selectionUI;

const playControls = createPlayControls({
  els,
  getPlay: () => play,
  getCurrentView: () => currentView,
  chainUiStates: CHAIN_UI,
});

const {
  updatePlayControlsVisibility,
  updateResetRevealVisibility,
  updatePuzzleActionsVisibility,
} = playControls;

// ---- Hints ----
// (moved to ./js/ui/hints.js)
const {
  ensureRangeFocusEl,
  resetRangeClueHints,
  isCellInFocusedRange,
  firstEditableCellInEntry,
  showRangeClueHint,
  hideAllRangeClueHints,
  hideRangeFocus,
  showRangeFocusForEntry,
  onRangeClueContentOver,
  onRangeClueContentOut,
  scheduleHideRangeClueHint,
  pulseRangeHintIntro,
  queueInitialHintIntro,
  applyHintForEntry,
  pinRangeClueHint,
} = createHints({
  els,
  getPlay: () => play,
  getChain: () => chain,
  isCellLocked,
  isWordCorrect,
  clearSelectAll,
  addTimePenalty,
  rebuildLockedCells,
  updateLockedWordUI,
  updatePlayUI,
  triggerSolveAnimation,
  requestChainClues,
  chainMaybeFinishIfSolved,
  requestPersistChainProgress,
  updateResetRevealVisibility,
  updatePlayControlsVisibility,
  updatePuzzleActionsVisibility,
  checkSolvedOverlapOnly,
  chainStartNow,
  hintPenaltySec: HINT_PENALTY_SEC,
  isTouch: IS_TOUCH,
});

// Navigation helpers for unresolved cells and word-based jumps.
const {
  entryContainsIndex,
  entryAtIndex,
  findUnresolvedCell,
  unresolvedEntries,
  jumpToUnresolvedWord,
  cellAriaLabel,
} = createNavigation({
  getPlay: () => play,
  isCellLocked,
  isWordCorrect,
  setAt,
  showRangeFocusForEntry,
  clamp,
  logNav,
});

const { renderGrid } = createGridRenderer({
  els,
  getPlay: () => play,
  getPuzzles: () => puzzles,
  getPuzzleIndex: () => pIdx,
  resetRangeClueHints,
  ensureRangeFocusEl,
  cellAriaLabel,
});

const gridInteractions = createGridInteractions({
  els,
  getPlay: () => play,
  getChain: () => chain,
  chainStartNow,
  chainResume,
  clearSelectAll,
  markInteracted,
  focusForTyping,
  applyHintForEntry,
  showRangeClueHint,
  pinRangeClueHint,
  showRangeFocusForEntry,
  firstEditableCellInEntry,
  setAt,
  hideAllRangeClueHints,
  hideRangeFocus,
  isCellInFocusedRange,
  scheduleHideRangeClueHint,
  isTouch: IS_TOUCH,
  ignoreGridClickUntil: gridClickGuard,
});

const {
  onGridCellClick,
  onGridPointerUpTouch,
  onGridRangeCluePointerOut,
  onGlobalPointerDownForRangeClues,
} = gridInteractions;

const navControls = createNavControls({
  els,
  getPlay: () => play,
  setAt,
  findUnresolvedCell,
  jumpToUnresolvedWord,
  clamp,
});

const { initNavButtons } = navControls;

const giveUpUI = createGiveUpModal({
  els,
  fmtTime,
  getUnsolvedWords: countUnsolvedWords,
  getUnsolvedLetters: countUnsolvedLetters,
  hintPenaltySec: HINT_PENALTY_SEC,
});

const { openGiveUpModal, closeGiveUpModal } = giveUpUI;

// ---- View filtering ----
// (moved to ./js/ui/view.js)
const {
  indicesForView,
  findTodayChainIndex,
  loadByViewOffset,
  ensureCurrentPuzzleMatchesView,
} = createViewHelpers({
  getPuzzles: () => puzzles,
  getPuzzleIndex: () => pIdx,
  getCurrentView: () => currentView,
  loadPuzzle,
  isChainPuzzle,
  isDailyChainPuzzle,
  toDateKey,
});

// ---- Word Chain HUD & results ----
// Chain mode is an untimed "speed" run with pause/resume and results modal.
const chain = {
  running: false,
  started: false,
  endsAt: 0,              // used in timed mode
  startAt: 0,             // used in untimed mode
  left: 0,                // timed: seconds remaining
  elapsed: 0,             // untimed: seconds elapsed
  tickId: 0,
  lastFinishLeftSec: 0,   // timed bonus calc
  lastFinishElapsedSec: 0, // untimed results
  unsolvedCount: 0,
  lastFinishReason: "idle",
  hintsUsed: 0,
  hintPenaltySecTotal: 0,
  wordPenaltySecTotal: 0,
};


// Lazily created UI references for the chain HUD and results modal.
let chainUI = null;
let chainResults = null;

// Update global chain state and HUD labels/timer visibility.
function chainSetUIState(state, ui = ensureChainUI()) {
  // global hook for CSS
  document.body.dataset.chainState = state;

  // button hook for CSS
  ui.startBtn.dataset.state = state;

  const visibleLabel =
    state === CHAIN_UI.IDLE ? "Start" :
    state === CHAIN_UI.DONE ? "View results" :
    "";
  const ariaLabel =
    state === CHAIN_UI.IDLE ? "Start" :
    state === CHAIN_UI.RUNNING ? "Pause" :
    state === CHAIN_UI.PAUSED ? "Resume" :
    "View results";
  if (ui.label) ui.label.textContent = visibleLabel;
  else ui.startBtn.textContent = visibleLabel;
  ui.startBtn.setAttribute("aria-label", ariaLabel);

  const showTimer = state === CHAIN_UI.RUNNING || state === CHAIN_UI.PAUSED;
  if (ui.timer) {
    ui.timer.hidden = !showTimer;
    const current = Number.isFinite(chain.elapsed) ? chain.elapsed : 0;
    ui.timer.textContent = fmtTime(current);
  }

  // toggle reset/reveal visibility in chain mode
  updateResetRevealVisibility(state);
  updatePuzzleActionsVisibility(state);
}

function chainPause() {
  return chainPauseWithOpts({});
}

// Pause and optionally show the splash/archive.
function chainPauseWithOpts(opts = {}) {
  if (!chain.started || !chain.running) return;

  const ui = ensureChainUI();

  // snapshot time so resume is accurate
  const elapsed = Math.max(0, (Date.now() - chain.startAt) / 1000);
  chain.elapsed = elapsed;
  if (ui.timer) ui.timer.textContent = fmtTime(elapsed);

  chain.running = false;
  chainSetUIState(CHAIN_UI.PAUSED, ui);
  if (opts.showSplash) {
    const p = puzzles[pIdx];
    if (isArchiveDailyPuzzle(p)) {
      openArchiveModal({ dateKey: normalizePuzzleId(p).id });
    } else {
      openSplash("paused");
    }
  }
  requestPersistChainProgress();
}

function chainPauseIfBackgrounded() {
  if (DEV_DISABLE_AUTOPAUSE) return;
  if (play.mode !== MODE.CHAIN) return;
  if (!chain.started || !chain.running) return;
  if (play.done) return;
  chainPauseWithOpts({ showSplash: true });
}

// Resume from a paused chain; preserves elapsed time.
function chainResume() {
  if (!chain.started || chain.running) return;

  const ui = ensureChainUI();

  const elapsed = Math.max(0, +chain.elapsed || 0);
  // Resume by setting startAt so elapsed math stays consistent.
  chain.startAt = Date.now() - elapsed * 1000;

  chain.running = true;
  chainSetUIState(CHAIN_UI.RUNNING, ui);
  ensureChainTick();
  focusForTyping();
}

// Reset handler triggered from the HUD reset action.
function chainResetFromHud() {
  // optional: stop the tick if it's still running
  if (chain.tickId) {
    clearInterval(chain.tickId);
    chain.tickId = null;
  }

  // your existing reset behavior
  resetPlay();
  chainSetUIState(CHAIN_UI.IDLE);
  focusForTyping();
}



// Ensure chain HUD exists in the DOM and wire its click handler.
function ensureChainUI() {
  if (chainUI) return chainUI;

  const hud = document.querySelector(".chainHud");

  const host = els.helper || els.meta?.parentElement || document.body;
  // Ensure the HUD lives near the meta/helper region for consistent layout.
  if (hud && host && hud.parentElement !== host) host.appendChild(hud);

  const startBtn = hud.querySelector("#chainStartBtn");

startBtn.addEventListener("click", () => {
  markInteracted();

  if (play.mode !== MODE.CHAIN) return;

  // If completed, button becomes "View results"
  if (play.done) {
    openChainResults(scoreChain(), chain.lastFinishReason || "solved");
    return;
  }

  if (!chain.started) chainStartNow();
  else if (chain.running) chainPauseWithOpts({ showSplash: true });
  else chainResume();
});



  chainUI = {
    hud,
    startBtn,
    timer: startBtn.querySelector(".chainTimerLabel"),
    label: startBtn.querySelector(".chainStartLabel"),
  };
chainSetUIState(
  play?.done
    ? CHAIN_UI.DONE
    : (chain.started ? (chain.running ? CHAIN_UI.RUNNING : CHAIN_UI.PAUSED) : CHAIN_UI.IDLE),
  chainUI
);


  return chainUI;
}

// Ensure results modal references and wire share/close events.
function ensureChainResults() {
  if (chainResults) return chainResults;

  const wrap = els.resultsModal;
  if (!wrap) return null;

  const cClose = els.resultsClose;
  const cShare = els.resultsShare;

  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeChainResults();
  });
  cClose?.addEventListener("click", closeChainResults);
  cShare?.addEventListener("click", () => {
    shareResult({ mode: MODE.CHAIN });
  });

  chainResults = {
    wrap,
    title: wrap.querySelector(".resultsTitle"),
    subtitle: wrap.querySelector(".resultsSubtitle"),
    statTime: wrap.querySelector(".resultsStatTimeVal"),
    statSolved: wrap.querySelector(".resultsStatSolvedVal"),
    statHints: wrap.querySelector(".resultsStatHintsVal"),
    pluralHints: wrap.querySelector("#pluralHints"),
    cClose,
    cShare,
  };
  return chainResults;
}

function closeChainResults() {
  if (!chainResults) return;
  chainResults.wrap.classList.remove("is-open");
  setResultsInert(false);
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Fully reset chain timer state (used on load/reset).
function chainStopTimer() {
  chain.running = false;
  chain.started = false;
  chain.endsAt = 0;
    chain.startAt = 0;
  chain.elapsed = 0;
  chain.lastFinishElapsedSec = 0;

  chain.left = 0;
  chain.lastFinishLeftSec = 0;
  chain.unsolvedCount = 0;
  chain.lastFinishReason = "idle";
  chain.hintsUsed = 0;
  if (chain.tickId) {
    clearInterval(chain.tickId);
    chain.tickId = 0;
  }
  _persistTickLastTs = 0;
}

// Start the interval that drives the timer display and persistence throttle.
function ensureChainTick() {
  if (chain.tickId) return;
  const ui = ensureChainUI();
  // Short interval keeps the timer smooth without excessive work.
  chain.tickId = setInterval(() => {
    if (!chain.running) return;
    const elapsed = (Date.now() - chain.startAt) / 1000;
    chain.elapsed = elapsed;
    if (ui.timer) ui.timer.textContent = fmtTime(elapsed);

    // Throttle persistence so the latest time is saved even without typing
    const now = performance.now ? performance.now() : Date.now();
    if (!_persistTickLastTs || now - _persistTickLastTs > 900) {
      requestPersistChainProgress();
      _persistTickLastTs = now;
    }
  }, 120);
}

function chainResetTimer() {
  const p = puzzles[pIdx];
  const ui = ensureChainUI();

  chainStopTimer();

  chain.elapsed = 0;
  chain.hintsUsed = 0;
  chain.hintPenaltySecTotal = 0;
  chain.wordPenaltySecTotal = 0;
  if (ui.timer) ui.timer.textContent = fmtTime(0);
}

function chainForceIdleZero() {
  if (play.mode !== MODE.CHAIN) return;
  chainStopTimer();
  chain.started = false;
  chain.running = false;
  chain.left = 0;
  chain.elapsed = 0;
  const ui = ensureChainUI();
  if (ui.timer) ui.timer.textContent = fmtTime(0);
  chainSetUIState(CHAIN_UI.IDLE, ui);
  setInlineCluesHiddenUntilChainStart();
  resetRangeClueHints();
}

function chainShowResetWithClues() {
  if (play.mode !== MODE.CHAIN) return;
  chainStopTimer();
  chain.started = true; // mark started so clues render
  chain.running = false;
  chain.left = 0;
  chain.elapsed = 0;
  const ui = ensureChainUI();
  if (ui.timer) ui.timer.textContent = fmtTime(0);
  chainSetUIState(CHAIN_UI.DONE, ui);
  setInlineCluesHiddenUntilChainStart(); // will unhide since started=true
}


// Start chain mode (first editable cell, timer, and clue visibility).
function chainStartNow() {
  if (play.mode !== MODE.CHAIN) return;
  if (play.done) return;

  const ui = ensureChainUI();

  // jump to first editable cell (usually 0)
  const first = findNextEditable(0, +1);
  setAt(first == null ? 0 : first, { behavior: "auto" });
  focusForTyping();

  if (chain.started) return;

  chain.started = true;

  chain.running = true;
  setInlineCluesHiddenUntilChainStart();
  chain.isTimed = false;
  chainSetUIState(CHAIN_UI.RUNNING, ui);
  pulseRangeHintIntro();

  chain.startAt = Date.now();

  ensureChainTick();
  requestPersistChainProgress();
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

// Compute solved/attempted counts for results.
function scoreChain() {
  const entries = play.entries || [];
  const correct = entries.filter(isWordCorrect).length;
  const attempted = entries.filter(isWordAttempted).length;
  return { correct, attempted };
}

// Populate and display the results modal.
function openChainResults(stats, reason) {
  const r = ensureChainResults();
  if (!r) return;
  r.wrap.classList.add("is-open");
  setResultsInert(true);
  const tSec = Math.max(0, Math.floor(chain.lastFinishElapsedSec || 0));
  const total = play.entries?.length || 0;
  const solved = Math.max(0, total - Math.max(0, chain.unsolvedCount || 0));
  const allSolved = chain.unsolvedCount === 0;

  r.wrap.setAttribute("data-result", allSolved ? "solved" : "partial");
  r.title.textContent = allSolved ? "Success!" : "Overlap";

  const p = puzzles[pIdx];
  const label =
    puzzleDateLabel(p) ||
    puzzleLabel(p) ||
    new Date().toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  r.subtitle.textContent = label;

  r.statTime.textContent = fmtTime(tSec);
  r.statSolved.textContent = `${solved}/${total}`;
  const hintCount = Math.max(0, chain.hintsUsed || 0);
  r.statHints.textContent = String(hintCount);
  if (r.pluralHints) r.pluralHints.style.display = hintCount === 1 ? "none" : "";
  const hintPenalty = Math.max(0, chain.hintPenaltySecTotal || 0);
  const wordPenalty = Math.max(0, chain.wordPenaltySecTotal || 0);
  if (els.totalHintPenalty) {
    els.totalHintPenalty.textContent = fmtTime(hintPenalty);
    els.totalHintPenalty.parentElement.style.display = hintPenalty > 0 ? "" : "none";
  }
  if (els.totalWordPenalty) {
    els.totalWordPenalty.textContent = fmtTime(wordPenalty);
    els.totalWordPenalty.parentElement.style.display = wordPenalty > 0 ? "" : "none";
  }

}

// Finalize a chain run and persist completion stats.
function chainFinish(reason = "time", opts = {}) {
  if (play.mode !== MODE.CHAIN) return;
  if (play.done) return;
  const unsolved = Math.max(0, opts.unsolved ?? 0);
  chain.lastFinishLeftSec = 0;

  // elapsed already includes any hint/word penalties (startAt is adjusted when penalties are added).
  const elapsed = (() => {
    // If actively running, derive from startAt; otherwise trust accumulated elapsed (penalties included).
    if (chain.running && chain.startAt) return (Date.now() - chain.startAt) / 1000;
    if (Number.isFinite(chain.elapsed)) return chain.elapsed;
    if (chain.startAt) return (Date.now() - chain.startAt) / 1000;
    return 0;
  })();

  chain.lastFinishElapsedSec = Math.max(0, elapsed);

  chain.running = false;
  if (chain.tickId) {
    clearInterval(chain.tickId);
    chain.tickId = 0;
  }

  play.done = true;
  chain.unsolvedCount = unsolved;
  chain.lastFinishReason = reason;
  chainSetUIState(CHAIN_UI.DONE);
  updatePlayUI();

  blurKeyboardInput();

  recordChainCompletionIfNeeded(puzzles[pIdx], play.mode, chain.lastFinishElapsedSec);
  openChainResults(scoreChain(), reason);
  persistChainProgressImmediate();
}

// Check for full solve and trigger chainFinish.
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
// In chain mode, correct words lock and become non-editable.
function isCellLocked(i) {
  return !!play.lockedCells[i];
}

// Rebuild lockedCells array from lockedEntries (plus any hint-locked cells).
function rebuildLockedCells() {
  const prev = Array.isArray(play.lockedCells) ? play.lockedCells.slice() : [];
  play.lockedCells = Array.from({ length: play.n }, () => false);
  if (play.mode !== MODE.CHAIN) {
    for (let i = 0; i < Math.min(play.n, prev.length); i++) {
      if (prev[i]) play.lockedCells[i] = true;
    }
    return;
  }
  for (const eIdx of play.lockedEntries) {
    const e = play.entries.find((x) => x.eIdx === eIdx);
    if (!e) continue;
    for (let i = e.start; i < e.start + e.len; i++) play.lockedCells[i] = true;
  }
  // preserve individually locked cells (e.g., via hints)
  for (let i = 0; i < Math.min(play.n, prev.length); i++) {
    if (prev[i]) play.lockedCells[i] = true;
  }
}

// Animate a word's letters and range when it becomes locked.
function triggerSolveAnimation(entry) {
  if (!entry || play.mode !== MODE.CHAIN || !els.grid) return;
  const letters = [];
  for (let i = entry.start; i < entry.start + entry.len; i++) {
    const cell = els.grid.querySelector(`.cell[data-i="${i}"]`);
    const letter = cell?.querySelector(".letter");
    if (letter) letters.push(letter);
  }
  letters.forEach((letter, idx) => {
    letter.classList.remove("solve-anim");
    letter.style.setProperty("--solve-delay", `${idx * 80}ms`);
    // force reflow to restart animation
    void letter.offsetWidth;
    letter.classList.add("solve-anim");
    letter.addEventListener(
      "animationend",
      () => {
        letter.classList.remove("solve-anim");
        letter.style.removeProperty("--solve-delay");
      },
      { once: true }
    );
  });

  const rangeEl = els.grid.querySelector(`.range[data-e="${entry.eIdx}"]`);
  if (rangeEl) {
    rangeEl.classList.remove("range-solve-anim");
    void rangeEl.offsetWidth;
    rangeEl.classList.add("range-solve-anim");
    rangeEl.addEventListener(
      "animationend",
      () => {
        rangeEl.classList.remove("range-solve-anim");
      },
      { once: true }
    );
  }
}

function triggerFullSolveAnimation() {
  if (play.mode !== MODE.PUZZLE || !els.grid || play.fullSolveAnimated) return;
  const letters = Array.from(els.grid.querySelectorAll(".cell .letter")).sort((a, b) => {
    const pa = a.closest(".cell");
    const pb = b.closest(".cell");
    const ia = pa ? +pa.dataset.i : 0;
    const ib = pb ? +pb.dataset.i : 0;
    return ia - ib;
  });
  letters.forEach((letter, idx) => {
    letter.classList.remove("solve-anim");
    letter.style.setProperty("--solve-delay", `${idx * 80}ms`);
    void letter.offsetWidth;
    letter.classList.add("solve-anim");
    letter.addEventListener(
      "animationend",
      () => {
        letter.classList.remove("solve-anim");
        letter.style.removeProperty("--solve-delay");
      },
      { once: true }
    );
  });
  play.fullSolveAnimated = true;
}

// Toggle locked styling for ranges and refresh slider segments.
function updateLockedWordUI() {
  els.grid.querySelectorAll(".range").forEach((r) => {
    const eIdx = +r.dataset.e;
    const locked = play.mode === MODE.CHAIN && play.lockedEntries.has(eIdx);
    r.classList.toggle("is-locked", locked);
  });
  sliderUI.updateSliderUI();
}

// Lock any newly correct words and trigger solve animations.
function chainApplyLocksIfEnabled() {
  const p = puzzles[pIdx];
  if (play.mode !== MODE.CHAIN) return;

  let changed = false;
  const newlyLocked = [];

  for (const e of play.entries) {
    if (play.lockedEntries.has(e.eIdx)) continue;
    if (isWordCorrect(e)) {
      play.lockedEntries.add(e.eIdx);
      changed = true;
      newlyLocked.push(e);
    }
  }

  if (changed) {
    rebuildLockedCells();
    updateLockedWordUI();
    const selected = getSelectedEntry();
    if (selected != null && play.lockedEntries.has(selected)) clearSelection();
    if (newlyLocked.length) {
      // Delay animations so the DOM has updated locked classes.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => newlyLocked.forEach((e) => {
          triggerSolveAnimation(e);
          const solved = play.lockedEntries.size;
          const total = play.entries.length;
          toasts.showToast("wordSolved", `${solved} of ${total}`);
        }))
      );
    }
    requestPersistChainProgress();
  }
}

// Find the next editable cell in a given direction.
function findNextEditable(from, dir) {
  let i = from;
  while (i >= 0 && i < play.n) {
    if (!isCellLocked(i)) return i;
    i += dir;
  }
  return null;
}

// Decide where to move after a cell becomes locked (chain mode).
function chooseAutoAdvanceTarget(prevIdx) {
  // Strategy: prefer forward progress, but avoid jumping into locked/solved words.
  const currentEntry = entryAtIndex(prevIdx);
  const ordered = (play.entries || []).slice().sort((a, b) => a.start - b.start);
  const curPos = currentEntry ? ordered.findIndex((e) => e.eIdx === currentEntry.eIdx) : -1;
  const prevEntry = curPos > 0 ? ordered[curPos - 1] : null;
  const nextEntry = curPos >= 0 && curPos < ordered.length - 1 ? ordered[curPos + 1] : null;

  const prevSolved = prevEntry == null ? null : isWordCorrect(prevEntry);
  const nextSolved = nextEntry == null ? null : isWordCorrect(nextEntry);

  const nextUnresolvedRight = findUnresolvedCell(prevIdx, +1);
  const unsolved = unresolvedEntries().sort((a, b) => a.start - b.start);
  const editableRight = findNextEditable(prevIdx + 1, +1);
  const editableLeft = findNextEditable(prevIdx - 1, -1);

  let firstUnsolvedRight = unsolved.find((e) => e.start > (currentEntry?.start ?? -Infinity));
  let firstUnsolvedLeft = [...unsolved].reverse().find((e) => e.start < (currentEntry?.start ?? Infinity));

  // Fallback: if we didn't find an unsolved entry but there is an editable cell right/left, treat its entry as unsolved.
  if (!firstUnsolvedRight && editableRight != null && editableRight > prevIdx) {
    const e = entryAtIndex(editableRight);
    if (e && !isWordCorrect(e)) firstUnsolvedRight = e;
  }
  if (!firstUnsolvedLeft && editableLeft != null && editableLeft < prevIdx) {
    const e = entryAtIndex(editableLeft);
    if (e && !isWordCorrect(e)) firstUnsolvedLeft = e;
  }

  // If the word on the right is solved, decide whether and where to jump.
  if (nextSolved) {
    if (firstUnsolvedRight) {
      // Unsovled exists to the right
      if (prevSolved !== false) {
        // Case: prev solved + next solved + unsolved to the right -> jump right.
        const tgt =
          nextUnresolvedRight != null ? nextUnresolvedRight :
          firstEditableCellInEntry(firstUnsolvedRight);
        return { target: tgt, suppress: false };
      }
      // Case: prev unsolved + next solved -> stay put.
      return { target: null, suppress: true };
    }

    // No unsolved to the right; if any unsolved to the left, jump left (regardless of prev solved).
    if (!firstUnsolvedRight && firstUnsolvedLeft) {
      // But if there is an editable cell to the right, honor it instead of jumping left.
      if (nextUnresolvedRight != null && nextUnresolvedRight > prevIdx) {
        return { target: nextUnresolvedRight, suppress: false };
      }
      if (editableRight != null && editableRight > prevIdx) {
        return { target: editableRight, suppress: false };
      }
      return { target: firstEditableCellInEntry(firstUnsolvedLeft), suppress: false };
    }
  }

  // If there is no word to the right (end of chain) but unsolved remains to the left, jump left.
  if (!nextEntry && firstUnsolvedLeft) {
    // But if there is an editable cell to the right, prefer it.
    if (editableRight != null && editableRight > prevIdx) {
      return { target: editableRight, suppress: false };
    }
    return { target: firstEditableCellInEntry(firstUnsolvedLeft), suppress: false };
  }

  // Default behavior: step forward to the next editable cell if available.
  const fallback = findNextEditable(prevIdx + 1, +1);
  return { target: fallback != null ? fallback : prevIdx, suppress: false };
}

// Chain input is gated behind start/resume.
function chainInputAllowed() {
  if (play.mode !== MODE.CHAIN) return true;
  if (!chain.started && !play.done) chainStartNow();
  else if (chain.started && !chain.running && !play.done) chainResume();
  return chain.started;
}
// Hide range clues until chain is started (prevents early peeking).
function setInlineCluesHiddenUntilChainStart() {
  const preStart = play.mode === MODE.CHAIN && !chain.started;

  // toggle a class so you can also handle with CSS if you want
  document.documentElement.classList.toggle("chain-prestart", preStart);

  // hard-hide inline clues during pre-start (covers common selectors)
  els.grid?.querySelectorAll(
    ".rangeClue"
  ).forEach((el) => {
    el.classList.toggle("is-hidden", preStart);
  });
}


// ---- Word Chain clues (current word first + adjacent unsolved) ----
// This block is intended to manage a dynamic clue list; updateChainClues is a stub for now.
let _cluesRaf = 0;

function requestChainClues() {
  if (_cluesRaf) return;
  _cluesRaf = requestAnimationFrame(() => {
    _cluesRaf = 0;
    updateChainClues();
  });
}

function isEntryUnsolvedForClues(e) {
  // Lock is always on in chain mode; unsolved == not locked
  return !play.lockedEntries.has(e.eIdx);
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

// Placeholder for chain-specific clue ordering/visibility logic.
function updateChainClues() {
  // TODO: determine which clues to show based on cursor position and unsolved entries.
}

// Show a banner when viewing an archived daily puzzle.
function updateArchiveDateBanner(p = puzzles[pIdx]) {
  if (!els.archiveDate) return;
  const show = isArchiveDailyPuzzle(p);
  if (!show) {
    els.archiveDate.hidden = true;
    els.archiveDate.textContent = "";
    return;
  }
  const label = puzzleDateLabel(p);
  if (!label) {
    els.archiveDate.hidden = true;
    els.archiveDate.textContent = "";
    return;
  }
  els.archiveDate.textContent = label;
  els.archiveDate.hidden = false;
}


// ---- Play UI ----
// Render letters, active state, and cell classes based on current play state.
function updatePlayUI() {
  const cells = els.grid.querySelectorAll(".cell");
  cells.forEach((c) => {
    const i = +c.dataset.i;
    c.querySelector(".num").textContent = i + 1;
    c.querySelector(".letter").textContent = play.usr[i] || "";
    c.classList.toggle("is-active", i === play.at && !play.done);
    const wordsHere = play.cellWords?.[i] || [];
    // In chain mode, "solved" cells are those fully covered by correct words; locked cells
    // are still correct but visually distinct while a word finishes locking in.
    const fullySolved = play.mode === MODE.CHAIN && wordsHere.length > 0 && wordsHere.every((w) => isWordCorrect(w));
    const locked = play.mode === MODE.CHAIN && isCellLocked(i) && !fullySolved;
    c.classList.toggle("cell-solved", fullySolved);
    c.classList.toggle("cell-locked", locked);
    // apply class for largest height covering this cell
    // Cell height classes are derived from the tallest covering range.
    c.classList.remove("cell-height-full", "cell-height-mid", "cell-height-inner", "cell-range-start", "cell-range-end");
    if (wordsHere.length) {
      const priority = { full: 3, mid: 2, inner: 1 };
      const ranked = wordsHere.map((w) => {
        const h = w.h || w.height || "full";
        return { w, h, score: priority[h] || 0 };
      });
      ranked.sort((a, b) => b.score - a.score);
      const topScore = ranked[0]?.score || 0;
      const topHeights = ranked.filter((r) => r.score === topScore);
      const topHeight = topHeights[0]?.h;
      if (topHeight) c.classList.add(`cell-height-${topHeight}`);

      // range start/end flags only if that range shares the top height
      topHeights.forEach(({ w }) => {
        const startIdx = w.start;
        const endIdx = w.start + w.len - 1;
        if (i === startIdx) c.classList.add("cell-range-start");
        if (i === endIdx) c.classList.add("cell-range-end");
      });
    }
    c.setAttribute("aria-label", cellAriaLabel(i, wordsHere));
  });
  updateSelectedWordUI();
  sliderUI.updateSliderUI();
  updatePlayControlsVisibility();
  updateSelectAllUI();
  toasts.updateWordSolvedCount();
}

// Update cursor position and keep it visible.
function setAt(i, { behavior, noScroll } = {}) {
  clearSelectAll();
  const target = clamp(i, 0, play.n - 1);
  if (target !== play.at) clearLockedAutoAdvanceSuppressionIfMoved(target);
  play.at = target;
  // setAt is the main cursor setter; it also triggers UI refresh and persistence.
  updatePlayUI();
  if (!noScroll) {
    const bh = behavior || (IS_TOUCH ? "smooth" : "auto");
    keepActiveCellInView(
      typeof bh === "object" ? bh :
      bh === "smooth" ? { behavior: "smooth", delta: 1 } : bh
    );
  }

  maybeClearSelectionOnCursorMove();
  if (play.mode === MODE.CHAIN) requestChainClues();
  if (play.mode === MODE.CHAIN) requestPersistChainProgress();
}

// Jump to the first empty cell in a word and select it.
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

// Only overlap (non-chain) puzzles use full-board correctness checks.
function checkSolvedOverlapOnly() {
  if (play.mode === MODE.CHAIN) return;
  if (!play.usr.every(Boolean)) return;
  if (play.usr.every((ch, i) => ch === play.exp[i])) {
    play.done = true;
    play.revealed = false;
    triggerFullSolveAnimation();
    toasts.showToast("success", "Success! You solved the puzzle!");
    updatePlayControlsVisibility();
  }
}

// Write a letter into the active cell and advance according to mode rules.
function write(ch) {
  if (play.done) return;
  if (!chainInputAllowed()) return; // require Start for word chain

  if (play.mode === MODE.CHAIN && isCellLocked(play.at)) {
    // Skip over locked cells; if we just locked one, suppression may hold position briefly.
    if (consumeLockedAutoAdvanceSuppression(play.at)) return;
    const next = findNextEditable(play.at, +1);
    if (next == null) return;
    play.at = next;
  }

  const prevAt = play.at;
  const wasLocked = isCellLocked(prevAt);
  play.usr[play.at] = ch;

  // Auto-advance differs by mode; chain mode can jump across solved words.
  let nextAt = play.at < play.n - 1 ? play.at + 1 : play.at;

  if (play.mode === MODE.CHAIN) {
    chainApplyLocksIfEnabled();
    const lockedNow = isCellLocked(prevAt);
    if (lockedNow && !wasLocked) {
      // Newly locked word may force a jump to the next unresolved word.
      const decision = chooseAutoAdvanceTarget(prevAt);
      if (decision.suppress) {
        nextAt = prevAt;
        markLockedAutoAdvanceSuppression(prevAt, 2);
      } else if (decision.target != null) {
        nextAt = decision.target;
      } else {
        nextAt = prevAt;
      }
    } else {
      // advance one step; if the next cell is locked, stay put and keep overwriting
      const step = Math.min(play.n - 1, prevAt + 1);
      nextAt = isCellLocked(step) ? prevAt : step;
    }

    play.at = nextAt;
    updatePlayUI();
    maybeToastChainFilledWrong();
    requestKeepActiveCellInView({ behavior: "smooth", delta: Math.abs(nextAt - prevAt) || 1 });
    requestChainClues();
    chainMaybeFinishIfSolved();
    requestPersistChainProgress();
    return;
  }

  play.at = nextAt;
  updatePlayUI();
  maybeToastPlayFilledWrong();
  requestKeepActiveCellInView({ behavior: "smooth", delta: Math.abs(nextAt - prevAt) || 1 });
  checkSolvedOverlapOnly();
}

// Backspace behavior supports chain locks and select-all delete.
function back() {
  if (play.done) return;
  if (!chainInputAllowed()) return; // require Start for word chain

  if (play.mode === MODE.CHAIN && isCellLocked(play.at)) {
    // In chain mode, backspace skips locked cells instead of clearing them.
    const prev = findNextEditable(play.at, -1);
    if (prev != null) play.at = prev;
    updatePlayUI();
    requestKeepActiveCellInView({ behavior: "smooth", delta: 1 });
    return;
  }

  const prevAt = play.at;
  if (play.usr[play.at]) {
    play.usr[play.at] = "";
  } else {
    let prevAt = play.at > 0 ? play.at - 1 : 0;
    if (play.mode === MODE.CHAIN) {
      // If the next cell back is locked, stay on current cell and overwrite it
      if (isCellLocked(prevAt)) {
        prevAt = play.at;
      } else {
        const prev = findNextEditable(prevAt, -1);
        if (prev == null) prevAt = play.at;
        else prevAt = prev;
      }
    }
    play.at = prevAt;
    if (play.mode !== MODE.CHAIN || !isCellLocked(play.at)) play.usr[play.at] = "";
  }

  if (play.mode === MODE.CHAIN) {
    updatePlayUI();
    maybeToastChainFilledWrong();
    requestKeepActiveCellInView({ behavior: "smooth", delta: Math.abs(play.at - prevAt) || 1 });
    requestChainClues();
    requestPersistChainProgress();
    return;
  }

  updatePlayUI();
  maybeToastPlayFilledWrong();
  requestKeepActiveCellInView({ behavior: "smooth", delta: Math.abs(play.at - prevAt) || 1 });
}

function countUnsolvedWords() {
  if (!play.entries?.length) return 0;
  return play.entries.filter((e) => !isWordCorrect(e)).length;
}

function countUnsolvedLetters() {
  if (!play.exp?.length || !play.usr?.length) return 0;
  let c = 0;
  for (let i = 0; i < play.exp.length; i++) {
    if ((play.usr[i] || "") !== (play.exp[i] || "")) c++;
  }
  return c;
}

// Cursor navigation with chain-mode lock skipping.
function move(d, opts = {}) {
  if (!chainInputAllowed()) return;

  let target = clamp(play.at + d, 0, play.n - 1);

  if (play.mode === MODE.CHAIN && !play.done) {
    const dir = d >= 0 ? +1 : -1;
    const nxt = findNextEditable(target, dir);
    if (nxt != null) target = nxt;
  }

  const delta = Math.abs(target - play.at) || 1;
  const bh = opts.behavior || { behavior: "smooth", delta };
  setAt(target, { behavior: bh });
}

// ---- Modals (Overlap) ----
// (moved to ./js/ui/results.js)

// ---- Reset / reveal ----
// Reset clears board and state; reveal fills expected answers (with penalties in chain).
function resetPlay(opts = {}) {
  const { clearPersist = true } = opts;
  play.usr = Array.from({ length: play.n }, () => "");
  play.at = 0;
  play.done = false;
  play.revealed = false;
  play.fullSolveAnimated = false;
  resetToastGuards();
  toasts.clearToasts();
  clearSelectAll();
  resetRangeClueHints();

  play.lockedEntries.clear();
  play.lockedCells = Array.from({ length: play.n }, () => false);

  updateLockedWordUI();
  clearSelection();

  updatePlayUI();
  closeSuccess();
  closeChainResults();

  if (play.mode === MODE.CHAIN) {
    // Clearing persistence here prevents immediate restore on the same puzzle.
    if (clearPersist) clearChainProgressForPuzzle(puzzles[pIdx]);
    const ui = ensureChainUI();
    ui.startBtn.style.display = "";
    chainResetTimer();
    setInlineCluesHiddenUntilChainStart();
  } else {
    setInlineCluesHiddenUntilChainStart(); // ensure clues un-hidden when leaving chain mode
  }

  sliderUI.cancelSmoothFollow();
  if (els.gridScroll) els.gridScroll.scrollLeft = 0;
  setAt(0, { behavior: "none", noScroll: true });
}

function revealPlay() {
  if (play.mode === MODE.CHAIN) {
    const unsolved = countUnsolvedWords();
    const unsolvedLetters = countUnsolvedLetters();
    if (unsolvedLetters > 0) addTimePenalty(unsolvedLetters * HINT_PENALTY_SEC, "word");
    play.usr = play.exp.slice();
    chainFinish("reveal", { unsolved });
    persistChainProgressImmediate();
    return;
  }

  play.usr = play.exp.slice();
  play.done = true;
  play.revealed = true;
  updatePlayUI();
  updatePlayControlsVisibility();
}

// ---- Load puzzle ----
// Reset state, build model/grid, and restore progress if available.
function loadPuzzle(i) {
  closeSuccess();
  closeChainResults();
  chainStopTimer();
  sliderUI.bindGridScrollCancels();
  sliderUI.cancelSmoothFollow();

  if (!puzzles.length) return;

  pIdx = ((i % puzzles.length) + puzzles.length) % puzzles.length;
  puzzles[pIdx] = normPuzzle(puzzles[pIdx]);

  const p = puzzles[pIdx];
  applyPaletteToDom(p.palette);
  const m = computed(p);
  setStatus(m);

  play.mode = isChainPuzzle(p) ? MODE.CHAIN : MODE.PUZZLE;
  play.entries = m.entries;

  setCols(m.total);

  play.exp = m.exp.map((c) => c || "");
  play.n = m.total;
  play.usr = Array.from({ length: play.n }, () => "");
  play.at = 0;
  play.done = false;
  play.revealed = false;
  play.fullSolveAnimated = false;
  resetToastGuards();
  toasts.clearToasts();
  clearSelectAll();
  hideRangeFocus();

  play.lockedEntries.clear();
  play.lockedCells = Array.from({ length: play.n }, () => false);
  clearSelection();

  renderGrid(els.grid, m, true, puzzles[pIdx]);
  sliderUI.updateSliderUI();


  if (play.mode === MODE.CHAIN) {
    const ui = ensureChainUI();
    ui.hud.hidden = false;
    ui.startBtn.style.display = ""; // show Start

    chainResetTimer();
    setInlineCluesHiddenUntilChainStart();

  } else {
    if (chainUI) chainUI.hud.hidden = true;
    if (els.reveal) els.reveal.style.display = "";

    setInlineCluesHiddenUntilChainStart(); // clears chain-prestart class when not in chain mode
    pulseRangeHintIntro();
  }
  updateResetRevealVisibility();

  // meta count should reflect current view list
  const list = indicesForView(currentView);
  const pos = list.indexOf(pIdx);
  const posText = list.length ? `${(pos >= 0 ? pos : 0) + 1} / ${list.length}` : `1 / ${puzzles.length}`;

  els.meta.replaceChildren(
    document.createTextNode(puzzleLabel(p)),
    document.createTextNode(" "),
    Object.assign(document.createElement("span"), { textContent: `• ${posText}` })
  );

  updateArchiveDateBanner(p);
  updatePlayUI();
  updatePlayControlsVisibility();
  updatePuzzleActionsVisibility();

  if (els.gridScroll) els.gridScroll.scrollLeft = 0;

  // Restore saved chain progress after the DOM is ready.
  const restored = play.mode === MODE.CHAIN ? restoreChainProgressForCurrentPuzzle() : false;
  if (!restored) {
    _restoredFromStorage = false;
    _restoredAt = 0;
    setAt(0, { behavior: "none", noScroll: true });
  }
}

// ---- Tabs ----
// Switch between play and chain views (affects puzzle list and UI).
function setTab(which) {
  if (which !== VIEW.PLAY && which !== VIEW.CHAIN) which = VIEW.CHAIN;
  currentView = which;
  try { localStorage.setItem(LAST_VIEW_KEY, currentView); } catch {}

  // "view" controls which puzzle list is active and which UI elements are visible.
  // Global hook for CSS
  document.body.dataset.view = which; // "play" | "chain"

  els.panelPlay?.classList.toggle("is-active", true);

  updateKeyboardVisibility();

  ensureCurrentPuzzleMatchesView();
  sliderUI.updateSliderUI();
  focusForTyping();

  updateResetRevealVisibility();
  updatePlayControlsVisibility();
  updatePuzzleActionsVisibility();

  // Keep chain HUD in sync without resetting state.
  const uiState =
    play.done
      ? CHAIN_UI.DONE
      : chain.running
      ? CHAIN_UI.RUNNING
      : chain.started
      ? CHAIN_UI.PAUSED
      : CHAIN_UI.IDLE;
  chainSetUIState(uiState);
  if (chain.running) ensureChainTick();
}


// ---- Escaping ----
// Safe text/attribute helpers for any HTML injection.
function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
}

function escapeAttr(s) {
  return String(s).replace(
    /[&<>"']/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

// Enter key triggers solve checks or chain completion warnings.
function handleEnterKey() {
  if (play.mode === MODE.PUZZLE) {
    if (play.done) return;
    const filled = play.usr.every(Boolean);
    if (!filled) {
      toasts.showToast("error", "Puzzle not complete!");
      return;
    }
    const allCorrect = play.usr.every((ch, i) => ch === play.exp[i]);
    if (allCorrect) {
      checkSolvedOverlapOnly();
      toasts.showToast("success", "Success! You solved the puzzle!");
    } else {
      toasts.showToast("warning", "Not quite: Some or all words are incorrect");
      lastPlayWarningKey = userKey();
    }
    return;
  }

  // Word chain
  if (play.done) return;
  const hasInput = play.usr.some(Boolean);
  if (!hasInput) return;
  const unsolved = countUnsolvedWords();
  if (unsolved > 0) {
    toasts.showToast("warning", `Not quite: ${unsolved} words are incomplete or incorrect`);
    lastChainWarningKey = userKey();
  } else {
    chainMaybeFinishIfSolved();
  }
}

// ---- Global key handler (desktop) ----
// Central keyboard handler for navigation and typing.
function onKey(e) {
  if (ftueIsOpen()) {
    // FTUE captures all keys so the demo isn't interrupted.
    e.preventDefault();
    e.stopImmediatePropagation?.();
    return;
  }
  if (els.resultsModal?.classList.contains("is-open")) return;
  if (chainResults?.wrap?.classList.contains("is-open")) return;
  if (e.metaKey && e.key.toLowerCase() === "a") {
    e.preventDefault();
    selectAllUnlockedCells();
    return;
  }
  if (e.metaKey || e.ctrlKey) return;

  if (
    IS_TOUCH &&
    isKeyboardInputTarget(e.target) &&
    (e.key === "Backspace" || e.key === "ArrowLeft" || e.key === "ArrowRight")
  ) {
    return;
  }

  const t = e.target;
  if (!isKeyboardInputTarget(t) && isEditable(t)) return;

  if (isSelectAllUnlocked() && e.key !== "Backspace" && e.key !== "Delete") {
    clearSelectAll();
  }

  if (e.key === "Backspace") {
    e.preventDefault();
    if (isSelectAllUnlocked()) {
      clearAllUnlockedCells();
      return;
    }
    back();
    return;
  }
  if (e.key === "Delete") {
    e.preventDefault();
    if (isSelectAllUnlocked()) {
      clearAllUnlockedCells();
      return;
    }
    back();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    handleEnterKey();
    return;
  }
  if (e.key === "ArrowLeft") {
    if (e.shiftKey) {
      e.preventDefault();
      jumpToUnresolvedWord(-1);
      return;
    }
    e.preventDefault();
    move(-1, { behavior: { behavior: "smooth", delta: 1 } });
    return;
  }
  if (e.key === "ArrowRight") {
    if (e.shiftKey) {
      e.preventDefault();
      jumpToUnresolvedWord(1);
      return;
    }
    e.preventDefault();
    move(1, { behavior: { behavior: "smooth", delta: 1 } });
    return;
  }
  if (e.key === " " || e.code === "Space") {
    e.preventDefault();
    move(1, { behavior: { behavior: "smooth", delta: 1 } });
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    const dir = e.shiftKey ? -1 : 1;
    move(dir, { behavior: { behavior: "smooth", delta: 1 } });
    return;
  }
  if (/^[a-zA-Z]$/.test(e.key)) {
    e.preventDefault();
    write(e.key.toUpperCase());
  }
}

// Update status bar for conflicts/gaps when a puzzle is invalid.
function setStatus(m) {
  const gaps = m.gaps || [];
  const hasError = !m.ok || gaps.length;
  if (els.status) {
    if (!m.ok) {
      els.status.className = "status bad";
      els.status.textContent = `Conflict at column ${m.conf.idx + 1}: “${m.conf.a}” vs “${m.conf.b}”.`;
    } else if (gaps.length) {
      els.status.className = "status bad";
      els.status.textContent = `Uncovered columns: ${gaps.slice(0, 18).map((x) => x + 1).join(", ")}${gaps.length > 18 ? "…" : ""}`;
    } else {
      els.status.className = "status";
      els.status.innerHTML = `Total columns: <strong>${m.total}</strong> • Words: <strong>${m.entries.length}</strong>`;
    }
  }
  if (els.toastErrorPuzzle) {
    els.toastErrorPuzzle.classList.toggle("is-showing", hasError);
  }
}

// ---- Events ----
// Central event wiring for keyboard, touch, modals, and controls.
// Keyboard (physical detection + input)
document.addEventListener(
  "keydown",
  (e) => {
    if (!IS_TOUCH || hasHardwareKeyboard()) return;
    if (isKeyboardInputTarget(e.target)) return;
    if (isEditable(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Backspace" || e.key === "ArrowLeft" || e.key === "ArrowRight" || /^[a-zA-Z]$/.test(e.key)) {
      noteHardwareKeyboard();
    }
  },
  true
);
document.addEventListener(
  "pointerdown",
  (e) => {
    if (e.pointerType === "touch") {
      maybeDemoteHardwareKeyboard();
      markInteracted();
    }
  },
  { passive: true }
);
document.addEventListener("pointerdown", onGlobalPointerDownForRangeClues, { passive: true });
document.addEventListener("keydown", onKey, true);
window.addEventListener("resize", () => sliderUI.updateSliderUI());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) chainPauseIfBackgrounded();
});
window.addEventListener("pagehide", chainPauseIfBackgrounded);
window.addEventListener("blur", chainPauseIfBackgrounded);

// Focus gate
els.stage.addEventListener("pointerdown", (e) => {
  markInteracted();
  if (IS_TOUCH && e.target.closest("#gridScroll")) return;

  focusForTyping();
});


// Grid click
els.grid.addEventListener("click", onGridCellClick);
els.grid.addEventListener("pointerover", onRangeClueContentOver);
els.grid.addEventListener("pointerout", onRangeClueContentOut);
els.grid.addEventListener("pointerup", onGridPointerUpTouch);

// Chain clue updates on scroll
els.gridScroll?.addEventListener(
  "scroll",
  () => {
    if (play.mode === MODE.CHAIN) requestChainClues();
    sliderUI.updateThumbFromScroll();
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

      sliderUI.cancelSmoothFollow();
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

    if (_panMoved) gridClickGuard.value = performance.now() + 250;

    _isUserPanning = false;
    _panPointerId = null;
    _panMoved = false;
  };

  window.addEventListener("pointerup", endPan, { passive: true });
  window.addEventListener("pointercancel", endPan, { passive: true });
}


// Prev/Next
els.prev.addEventListener("click", () => {
  if (play.mode === MODE.CHAIN) chainForceIdleZero();
  loadByViewOffset(-1);
});

els.next.addEventListener("click", () => {
  if (play.mode === MODE.CHAIN) chainForceIdleZero();
  loadByViewOffset(1);
});


// Reset / Reveal
els.reset.addEventListener("click", () => {
  resetPlay();
  if (play.mode === MODE.CHAIN) chainForceIdleZero();
});
els.reveal.addEventListener("click", () => {
  markInteracted();
  if (play.mode === MODE.CHAIN && !play.done) {
    chainPauseWithOpts({ showSplash: false });
    openGiveUpModal();
    return;
  }
  revealPlay();
  focusForTyping();
});
settingsUI.init();
els.splashPrimary?.addEventListener("click", (e) => {
  e.preventDefault();
  handleSplashPrimary();
});
els.splashArchiveBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  closeSplash();
  openArchiveModal();
});
archiveUI.init();
els.giveUpConfirm?.addEventListener("click", () => {
  markInteracted();
  closeGiveUpModal();
  revealPlay();
});
els.giveUpCancel?.addEventListener("click", () => {
  markInteracted();
  closeGiveUpModal();
  if (play.mode === MODE.CHAIN && chain.started && !play.done) chainResume();
  focusForTyping();
});
els.logo?.addEventListener("click", () => {
  markInteracted();
  if (play.mode === MODE.CHAIN && chain.running && !play.done) {
    chainPauseWithOpts({ showSplash: true });
  } else {
    openSplash(splashState());
  }
});
els.splashPuzzleBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  closeSplash();
  setTab(VIEW.PLAY);
});
els.splashTutorialBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  // Update splash content to tutorial context then open FTUE
  closeSplash();
  openFtue(0, { instant: true, noAnim: true });
});
els.nextPuzzleBtn?.addEventListener("click", () => {
  markInteracted();
  loadByViewOffset(1);
});
els.shareInline?.addEventListener("click", () => {
  markInteracted();
  shareResult({ mode: play.mode });
});
els.shareBtn?.addEventListener("click", () => {
  markInteracted();
  shareResult({ mode: play.mode, linkOnly: true, toastEl: els.splashShareToast });
});
initNavButtons();

// FTUE events
els.ftuePrev?.addEventListener("click", (e) => {
  e.preventDefault();
  if (ftueStep === 0) {
    closeFtue();
    openSplash(splashState());
  } else {
    prevFtue();
  }
});
els.ftueNext?.addEventListener("click", (e) => {
  e.preventDefault();
  const atLast = ftueStep >= FTUE_STEPS.length - 1;
  if (atLast) {
    // Always jump into chain play on final CTA
    const summary = chainProgressSummary();
    closeFtue();
    setTab(VIEW.CHAIN);
    if (summary.state === "complete" || play.done) {
      chain.running = false;
      chain.started = true;
      chainSetUIState(CHAIN_UI.DONE);
      updatePlayUI();
    } else if (!chain.started) chainStartNow();
    else if (!chain.running) chainResume();
  } else {
    nextFtue();
  }
});
els.ftueSkip?.addEventListener("click", (e) => {
  e.preventDefault();
  closeFtue();
  setTab(VIEW.CHAIN);
  const summary = chainProgressSummary();
  if (summary.state === "complete" || play.done) {
    chain.running = false;
    chain.started = true;
    chainSetUIState(CHAIN_UI.DONE);
    updatePlayUI();
  } else if (!chain.started) chainStartNow();
  else if (!chain.running) chainResume();
});
els.ftueDots?.forEach?.((dot, idx) =>
  dot.addEventListener("click", (e) => {
    e.preventDefault();
    ftueStep = idx;
    renderFtueStep();
  })
);
els.ftueModal?.addEventListener("touchstart", onFtueTouchStart, { passive: true });
els.ftueModal?.addEventListener("touchend", onFtueTouchEnd, { passive: true });
els.ftuePlayPause?.addEventListener("click", (e) => {
  e.preventDefault();
  if (ftueDemo.paused) ftuePlay();
  else ftuePause();
});

// Results modal overlay click to close
els.resultsModal?.addEventListener("click", (e) => {
  if (e.target === els.resultsModal) {
    markInteracted();
    closeChainResults();
    focusForTyping();
  }
});

// Clear stats/progress
els.pClear?.addEventListener("click", () => {
  clearAllChainProgress();
  clearChainStats();
  resetPlay({ clearPersist: false });
  chainForceIdleZero();
});

// ---- Start ----
// Initialize UI and load the initial puzzle/view.
initOnScreenKeyboard();
sliderUI.initSlider();
loadPuzzle(0);
setTab(currentView);
queueInitialHintIntro();
maybeShowFtue();
maybeShowSplashOnLoad();

requestAnimationFrame(() => {
  if (_restoredFromStorage) {
    setAt(_restoredAt, { behavior: "none", noScroll: true });
  } else {
    setAt(0);
  }
  focusForTyping();
});
