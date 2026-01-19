// Chain HUD + timer helpers.
import { DEV_DISABLE_AUTOPAUSE, MODE } from "../config.js";
import { normalizePuzzleId } from "../utils.js";

export function createChainHud({
  els,
  getPlay,
  getChain,
  getPuzzles,
  getPuzzleIndex,
  chainUiStates,
  fmtTime,
  updateResetRevealVisibility,
  updatePuzzleActionsVisibility,
  setInlineCluesHiddenUntilChainStart,
  resetRangeClueHints,
  focusForTyping,
  markInteracted,
  isArchiveDailyPuzzle,
  openArchiveModal,
  openSplash,
  requestPersistChainProgress,
  maybePersistFromTick,
  resetPersistTick,
  chainStartNow,
  scoreChain,
  openChainResults,
  resetPlay,
} = {}) {
  let chainUI = null;

  const getPlayState = () => (typeof getPlay === "function" ? getPlay() : null);
  const getChainState = () => (typeof getChain === "function" ? getChain() : null);
  const getPuzzleList = () => (typeof getPuzzles === "function" ? getPuzzles() : []);
  const getPuzzleIndexSafe = () => (typeof getPuzzleIndex === "function" ? getPuzzleIndex() : 0);
  const formatTime = typeof fmtTime === "function"
    ? fmtTime
    : (sec) => {
        const s = Math.max(0, Math.floor(sec || 0));
        const m = Math.floor(s / 60);
        const rem = s % 60;
        return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
      };
  const states = chainUiStates || { IDLE: "idle", RUNNING: "running", PAUSED: "paused", DONE: "done" };

  // Update global chain state and HUD labels/timer visibility.
  function chainSetUIState(state, ui = ensureChainUI()) {
    if (!ui) return;
    const chain = getChainState();
    if (!chain) return;

    // global hook for CSS
    document.body.dataset.chainState = state;

    // button hook for CSS
    ui.startBtn.dataset.state = state;

    const visibleLabel =
      state === states.IDLE ? "Start" :
      state === states.DONE ? "View results" :
      "";
    const ariaLabel =
      state === states.IDLE ? "Start" :
      state === states.RUNNING ? "Pause" :
      state === states.PAUSED ? "Resume" :
      "View results";
    if (ui.label) ui.label.textContent = visibleLabel;
    else ui.startBtn.textContent = visibleLabel;
    ui.startBtn.setAttribute("aria-label", ariaLabel);

    const showTimer = state === states.RUNNING || state === states.PAUSED;
    if (ui.timer) {
      ui.timer.hidden = !showTimer;
      const current = Number.isFinite(chain.elapsed) ? chain.elapsed : 0;
      ui.timer.textContent = formatTime(current);
    }

    // toggle reset/reveal visibility in chain mode
    if (typeof updateResetRevealVisibility === "function") updateResetRevealVisibility(state);
    if (typeof updatePuzzleActionsVisibility === "function") updatePuzzleActionsVisibility(state);
  }

  // Ensure chain HUD exists in the DOM and wire its click handler.
  function ensureChainUI() {
    if (chainUI) return chainUI;

    const hud = document.querySelector(".chainHud");
    if (!hud) return null;

    const host = els?.helper || els?.meta?.parentElement || document.body;
    // Ensure the HUD lives near the meta/helper region for consistent layout.
    if (host && hud.parentElement !== host) host.appendChild(hud);

    const startBtn = hud.querySelector("#chainStartBtn");
    startBtn?.addEventListener("click", () => {
      if (typeof markInteracted === "function") markInteracted();
      const play = getPlayState();
      const chain = getChainState();
      if (!play || !chain || play.mode !== MODE.CHAIN) return;

      // If completed, button becomes "View results"
      if (play.done) {
        if (typeof openChainResults === "function") {
          const stats = typeof scoreChain === "function" ? scoreChain() : {};
          openChainResults(stats, chain.lastFinishReason || "solved");
        }
        return;
      }

      if (!chain.started) {
        if (typeof chainStartNow === "function") chainStartNow();
      } else if (chain.running) {
        chainPauseWithOpts({ showSplash: true });
      } else {
        chainResume();
      }
    });

    chainUI = {
      hud,
      startBtn,
      timer: startBtn?.querySelector(".chainTimerLabel"),
      label: startBtn?.querySelector(".chainStartLabel"),
    };

    const play = getPlayState();
    const chain = getChainState();
    if (play && chain) {
      chainSetUIState(
        play?.done
          ? states.DONE
          : (chain.started ? (chain.running ? states.RUNNING : states.PAUSED) : states.IDLE),
        chainUI
      );
    }

    return chainUI;
  }

  function getChainUI() {
    return chainUI;
  }

  function chainPause() {
    return chainPauseWithOpts({});
  }

  // Pause and optionally show the splash/archive.
  function chainPauseWithOpts(opts = {}) {
    const play = getPlayState();
    const chain = getChainState();
    if (!play || !chain) return;
    if (!chain.started || !chain.running) return;

    const ui = ensureChainUI();
    if (!ui) return;

    // snapshot time so resume is accurate
    const elapsed = Math.max(0, (Date.now() - chain.startAt) / 1000);
    chain.elapsed = elapsed;
    if (ui.timer) ui.timer.textContent = formatTime(elapsed);

    chain.running = false;
    chainSetUIState(states.PAUSED, ui);
    if (opts.showSplash) {
      const puzzles = getPuzzleList();
      const pIdx = getPuzzleIndexSafe();
      const p = puzzles[pIdx];
      if (typeof isArchiveDailyPuzzle === "function" && isArchiveDailyPuzzle(p)) {
        if (typeof openArchiveModal === "function") {
          openArchiveModal({ dateKey: normalizePuzzleId(p).id });
        }
      } else if (typeof openSplash === "function") {
        openSplash("paused");
      }
    }
    if (typeof requestPersistChainProgress === "function") requestPersistChainProgress();
  }

  function chainPauseIfBackgrounded() {
    if (DEV_DISABLE_AUTOPAUSE) return;
    const play = getPlayState();
    const chain = getChainState();
    if (!play || !chain) return;
    if (play.mode !== MODE.CHAIN) return;
    if (!chain.started || !chain.running) return;
    if (play.done) return;
    chainPauseWithOpts({ showSplash: true });
  }

  // Resume from a paused chain; preserves elapsed time.
  function chainResume() {
    const play = getPlayState();
    const chain = getChainState();
    if (!play || !chain) return;
    if (!chain.started || chain.running) return;

    const ui = ensureChainUI();
    if (!ui) return;

    const elapsed = Math.max(0, +chain.elapsed || 0);
    // Resume by setting startAt so elapsed math stays consistent.
    chain.startAt = Date.now() - elapsed * 1000;

    chain.running = true;
    chainSetUIState(states.RUNNING, ui);
    ensureChainTick();
    if (typeof focusForTyping === "function") focusForTyping();
  }

  // Reset handler triggered from the HUD reset action.
  function chainResetFromHud() {
    const chain = getChainState();
    if (!chain) return;
    // optional: stop the tick if it's still running
    if (chain.tickId) {
      clearInterval(chain.tickId);
      chain.tickId = null;
    }

    if (typeof resetPlay === "function") resetPlay();
    chainSetUIState(states.IDLE);
    if (typeof focusForTyping === "function") focusForTyping();
  }

  // Fully reset chain timer state (used on load/reset).
  function chainStopTimer() {
    const chain = getChainState();
    if (!chain) return;
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
    if (typeof resetPersistTick === "function") resetPersistTick();
  }

  // Start the interval that drives the timer display and persistence throttle.
  function ensureChainTick() {
    const chain = getChainState();
    if (!chain) return;
    if (chain.tickId) return;
    const ui = ensureChainUI();
    if (!ui) return;
    // Short interval keeps the timer smooth without excessive work.
    chain.tickId = setInterval(() => {
      if (!chain.running) return;
      const elapsed = (Date.now() - chain.startAt) / 1000;
      chain.elapsed = elapsed;
      if (ui.timer) ui.timer.textContent = formatTime(elapsed);

      // Throttle persistence so the latest time is saved even without typing.
      const now = performance.now ? performance.now() : Date.now();
      if (typeof maybePersistFromTick === "function") maybePersistFromTick(now, 900);
    }, 120);
  }

  function chainResetTimer() {
    const ui = ensureChainUI();
    if (!ui) return;

    chainStopTimer();

    const chain = getChainState();
    if (!chain) return;
    chain.elapsed = 0;
    chain.hintsUsed = 0;
    chain.hintPenaltySecTotal = 0;
    chain.wordPenaltySecTotal = 0;
    if (ui.timer) ui.timer.textContent = formatTime(0);
  }

  function chainForceIdleZero() {
    const play = getPlayState();
    const chain = getChainState();
    if (!play || !chain) return;
    if (play.mode !== MODE.CHAIN) return;
    chainStopTimer();
    chain.started = false;
    chain.running = false;
    chain.left = 0;
    chain.elapsed = 0;
    const ui = ensureChainUI();
    if (ui?.timer) ui.timer.textContent = formatTime(0);
    chainSetUIState(states.IDLE, ui);
    if (typeof setInlineCluesHiddenUntilChainStart === "function") {
      setInlineCluesHiddenUntilChainStart();
    }
    if (typeof resetRangeClueHints === "function") resetRangeClueHints();
  }

  function chainShowResetWithClues() {
    const play = getPlayState();
    const chain = getChainState();
    if (!play || !chain) return;
    if (play.mode !== MODE.CHAIN) return;
    chainStopTimer();
    chain.started = true; // mark started so clues render
    chain.running = false;
    chain.left = 0;
    chain.elapsed = 0;
    const ui = ensureChainUI();
    if (ui?.timer) ui.timer.textContent = formatTime(0);
    chainSetUIState(states.DONE, ui);
    if (typeof setInlineCluesHiddenUntilChainStart === "function") {
      setInlineCluesHiddenUntilChainStart(); // will unhide since started=true
    }
  }

  return {
    chainSetUIState,
    chainPause,
    chainPauseWithOpts,
    chainPauseIfBackgrounded,
    chainResume,
    chainResetFromHud,
    ensureChainUI,
    getChainUI,
    chainStopTimer,
    ensureChainTick,
    chainResetTimer,
    chainForceIdleZero,
    chainShowResetWithClues,
  };
}
