/*
 * File Overview
 * Purpose: Chain HUD status UI.
 * Controls: Timer, penalty, and chain progress indicators.
 * How: Updates DOM elements based on chain state and timing.
 * Key interactions: Uses chain core and timing with the dom cache.
 */
// Chain HUD + timer helpers.
import { DEV_DISABLE_AUTOPAUSE, MODE } from "../core/config.js";
import { normalizePuzzleId } from "../utils/index.js";

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

  function chainActionLabel(state) {
    if (state === states.RUNNING) return "Pause";
    return "Play";
  }

  function updatePauseButtonUI(state, ui, timeSec) {
    if (!ui?.startBtn) return;
    const timeText = formatTime(timeSec || 0);
    ui.startBtn.textContent = timeText;
    const action = chainActionLabel(state);
    ui.startBtn.setAttribute("aria-label", `${action} (${timeText})`);
  }

  // Update global chain state and HUD labels/timer visibility.
  function chainSetUIState(state, ui = ensureChainUI()) {
    if (!ui) return;
    const chain = getChainState();
    if (!chain) return;

    // global hook for CSS
    document.body.dataset.gameState = state;

    // button hook for CSS
    ui.startBtn.dataset.state = state;

    const current = Number.isFinite(chain.elapsed) ? chain.elapsed : 0;
    updatePauseButtonUI(state, ui, current);

    // toggle reveal visibility in chain mode
    if (typeof updateResetRevealVisibility === "function") updateResetRevealVisibility(state);
    if (typeof updatePuzzleActionsVisibility === "function") updatePuzzleActionsVisibility(state);
  }

  // Ensure chain HUD exists in the DOM and wire its click handler.
  function ensureChainUI() {
    if (chainUI) return chainUI;

    const startBtn = document.querySelector("#pause");
    if (!startBtn) return null;
    const hud = startBtn.closest(".chainHud") || startBtn;

    const host = els?.helper || document.body;
    // Ensure the HUD lives near the helper region for consistent layout.
    if (hud !== startBtn && host && hud.parentElement !== host) host.appendChild(hud);
    startBtn?.addEventListener("click", () => {
      if (typeof markInteracted === "function") markInteracted();
      const play = getPlayState();
      const chain = getChainState();
      if (!play || !chain || play.mode !== MODE.CHAIN) return;
      if (play.done) return;

      if (!chain.started) {
        if (typeof chainStartNow === "function") chainStartNow();
      } else if (chain.running) {
        chainPauseWithOpts({ showSplash: true });
      } else {
        chainResume();
      }
    });

    const viewResultsBtn = els?.viewResultsBtn;
    viewResultsBtn?.addEventListener("click", () => {
      if (typeof markInteracted === "function") markInteracted();
      const play = getPlayState();
      const chain = getChainState();
      if (!play || !chain || play.mode !== MODE.CHAIN) return;
      if (!play.done) return;
      if (typeof openChainResults === "function") {
        const stats = typeof scoreChain === "function" ? scoreChain() : {};
        openChainResults(stats, chain.lastFinishReason || "solved");
      }
    });

    chainUI = {
      hud,
      startBtn,
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
    updatePauseButtonUI(states.PAUSED, ui, elapsed);

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
    chain.hardModeComplete = false;
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
      updatePauseButtonUI(states.RUNNING, ui, elapsed);

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
    updatePauseButtonUI(states.IDLE, ui, 0);
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
    if (ui) updatePauseButtonUI(states.IDLE, ui, 0);
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
    if (ui) updatePauseButtonUI(states.DONE, ui, 0);
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
