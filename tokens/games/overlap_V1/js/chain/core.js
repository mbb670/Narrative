/*
 * File Overview
 * Purpose: Chain mode orchestration.
 * Controls: Chain lifecycle, scoring, gating, and completion flow.
 * How: Coordinates model updates, persistence, HUD updates, and results.
 * Key interactions: Uses chain-progress, chain-persistence, locks, timing, and UI modules.
 */
// Core chain mode helpers (start/finish/scoring/input gating).
import { MODE } from "../core/config.js";

export function createChainCore({
  getPlay,
  getChain,
  getPuzzles,
  getPuzzleIndex,
  chainUiStates,
  ensureChainUI,
  chainSetUIState,
  ensureChainTick,
  chainResume,
  setInlineCluesHiddenUntilChainStart,
  pulseRangeHintIntro,
  focusForTyping,
  findNextEditable,
  setAt,
  requestPersistChainProgress,
  recordChainCompletionIfNeeded,
  openChainResults,
  persistChainProgressImmediate,
  updatePlayUI,
  blurKeyboardInput,
} = {}) {
  const getPlayState = () => (typeof getPlay === "function" ? getPlay() : null);
  const getChainState = () => (typeof getChain === "function" ? getChain() : null);
  const getPuzzleList = () => (typeof getPuzzles === "function" ? (getPuzzles() || []) : []);
  const getPuzzleIndexSafe = () => (typeof getPuzzleIndex === "function" ? getPuzzleIndex() : 0);
  const states = chainUiStates || { IDLE: "idle", RUNNING: "running", PAUSED: "paused", DONE: "done" };

  // Start chain mode (first editable cell, timer, and clue visibility).
  function chainStartNow() {
    const play = getPlayState();
    const chain = getChainState();
    if (!play || !chain) return;
    if (play.mode !== MODE.CHAIN) return;
    if (play.done) return;

    const ui = typeof ensureChainUI === "function" ? ensureChainUI() : null;

    // jump to first editable cell (usually 0)
    const first =
      typeof findNextEditable === "function" ? findNextEditable(0, +1) : 0;
    if (typeof setAt === "function") {
      setAt(first == null ? 0 : first, { behavior: "auto" });
    }
    if (typeof focusForTyping === "function") focusForTyping();

    if (chain.started) return;

    chain.started = true;
    chain.running = true;
    chain.isTimed = false;

    if (typeof setInlineCluesHiddenUntilChainStart === "function") {
      setInlineCluesHiddenUntilChainStart();
    }
    if (typeof chainSetUIState === "function") chainSetUIState(states.RUNNING, ui);
    if (typeof pulseRangeHintIntro === "function") pulseRangeHintIntro();

    chain.startAt = Date.now();

    if (typeof ensureChainTick === "function") ensureChainTick();
    if (typeof requestPersistChainProgress === "function") requestPersistChainProgress();
  }

  function isWordAttempted(e) {
    const play = getPlayState();
    if (!play || !e) return false;
    for (let i = e.start; i < e.start + e.len; i++) if (play.usr[i]) return true;
    return false;
  }

  function isWordCorrect(e) {
    const play = getPlayState();
    if (!play || !e) return false;
    for (let i = 0; i < e.len; i++) {
      const idx = e.start + i;
      if (!play.usr[idx]) return false;
      if (play.usr[idx] !== e.ans[i]) return false;
    }
    return true;
  }

  // Compute solved/attempted counts for results.
  function scoreChain() {
    const play = getPlayState();
    const entries = play?.entries || [];
    const correct = entries.filter(isWordCorrect).length;
    const attempted = entries.filter(isWordAttempted).length;
    return { correct, attempted };
  }

  // Finalize a chain run and persist completion stats.
  function chainFinish(reason = "time", opts = {}) {
    const play = getPlayState();
    const chain = getChainState();
    if (!play || !chain) return;
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
    const hardModeComplete = reason === "solved" && play.autoCheckEverOn === false;
    play.hardModeComplete = hardModeComplete;
    chain.hardModeComplete = hardModeComplete;
    if (typeof chainSetUIState === "function") chainSetUIState(states.DONE);
    if (typeof updatePlayUI === "function") updatePlayUI();

    if (typeof blurKeyboardInput === "function") blurKeyboardInput();

    const puzzles = getPuzzleList();
    const pIdx = getPuzzleIndexSafe();
    if (typeof recordChainCompletionIfNeeded === "function" && puzzles[pIdx]) {
      recordChainCompletionIfNeeded(puzzles[pIdx], play.mode, chain.lastFinishElapsedSec);
    }
    if (typeof openChainResults === "function") openChainResults(scoreChain(), reason);
    if (typeof persistChainProgressImmediate === "function") persistChainProgressImmediate();
  }

  // Check for full solve and trigger chainFinish.
  function chainMaybeFinishIfSolved() {
    const play = getPlayState();
    const chain = getChainState();
    if (!play || !chain) return;
    if (play.mode !== MODE.CHAIN || play.done) return;
    if (!chain.started) return;

    for (let i = 0; i < play.n; i++) {
      if (!play.usr[i]) return;
      if (play.usr[i] !== play.exp[i]) return;
    }
    chainFinish("solved");
  }

  // Chain input is gated behind start/resume.
  function chainInputAllowed() {
    const play = getPlayState();
    const chain = getChainState();
    if (!play || !chain) return false;
    if (play.mode !== MODE.CHAIN) return true;
    if (!chain.started && !play.done) chainStartNow();
    else if (chain.started && !chain.running && !play.done && typeof chainResume === "function") {
      chainResume();
    }
    return chain.started;
  }

  return {
    chainStartNow,
    isWordAttempted,
    isWordCorrect,
    scoreChain,
    chainFinish,
    chainMaybeFinishIfSolved,
    chainInputAllowed,
  };
}
