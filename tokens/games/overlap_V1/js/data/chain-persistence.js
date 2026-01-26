/*
 * File Overview
 * Purpose: In-progress chain state persistence.
 * Controls: Saving and restoring chain grid, timer, and status.
 * How: Serializes chain state to storage and hydrates it on load.
 * Key interactions: Used by chain core and play/actions.
 */
// Chain progress persistence and restore helpers.
import { MODE } from "../core/config.js";
import { clamp, normalizePuzzleId, isDailyChainPuzzle } from "../utils/index.js";
import {
  chainPuzzleKey,
  loadChainProgressStore,
  saveChainProgressStore,
  pruneStaleChainProgress,
  todayKey,
} from "./chain-progress.js";

export function createChainPersistence({
  getPlay,
  getChain,
  getPuzzles,
  getPuzzleIndex,
  setLastPlayedChain,
  scoreChain,
  rebuildLockedCells,
  ensureChainUI,
  fmtTime,
  chainSetUIState,
  chainUiStates,
  setInlineCluesHiddenUntilChainStart,
  updateLockedWordUI,
  updatePlayUI,
  setAt,
  scrollActiveCellAfterRestore,
  hintPenaltySec,
  isAutoCheckEnabled,
} = {}) {
  let persistChainRaf = 0;
  let persistTickLastTs = 0;
  let restoredFromStorage = false;
  let restoredAt = 0;
  let sessionActive = false;

  const formatTime = typeof fmtTime === "function"
    ? fmtTime
    : (sec) => {
        const s = Math.max(0, Math.floor(sec || 0));
        const m = Math.floor(s / 60);
        const rem = s % 60;
        return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
      };

  const getPlayState = () => (typeof getPlay === "function" ? getPlay() : null);
  const getChainState = () => (typeof getChain === "function" ? getChain() : null);
  const getPuzzleList = () => (typeof getPuzzles === "function" ? getPuzzles() : []);
  const getPuzzleIndexSafe = () => (typeof getPuzzleIndex === "function" ? getPuzzleIndex() : 0);
  const autoCheckEnabled =
    typeof isAutoCheckEnabled === "function" ? isAutoCheckEnabled : () => true;

  // Serialize the current chain state for persistence (including penalties + locks).
  function chainProgressSnapshot(p) {
    const play = getPlayState();
    const chain = getChainState();
    if (!play || !chain || play.mode !== MODE.CHAIN) return null;
    const key = chainPuzzleKey(p);
    if (!key) return null;
    const normalizedId = normalizePuzzleId(p);
    const puzzleType = MODE.CHAIN;
    const hasInput = Array.isArray(play.usr) && play.usr.some(Boolean);
    const elapsed = chain.running ? (Date.now() - chain.startAt) / 1000 : chain.elapsed || 0;
    const score = typeof scoreChain === "function" ? scoreChain() : { correct: 0 };
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
      autoCheckEverOn: !!play.autoCheckEverOn,
      hardModeComplete: !!play.hardModeComplete,
      lockedEntries: [...play.lockedEntries], // word-level locks
      lockedCells: Array.isArray(play.lockedCells) ? play.lockedCells.slice(0, play.n) : [], // per-cell locks (hints)
      hintsUsed: chain.hintsUsed || 0,
      checksUsed: chain.checksUsed || 0,
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
        checksUsed: snap.checksUsed,
      };
    }

    return snap;
  }

  // Save chain progress now (used after major events).
  function persistChainProgressImmediate() {
    const play = getPlayState();
    if (!play || play.mode !== MODE.CHAIN) return;
    const puzzles = getPuzzleList();
    const pIdx = getPuzzleIndexSafe();
    const p = puzzles[pIdx];
    const snap = chainProgressSnapshot(p);
    if (!snap) return;
    pruneStaleChainProgress();
    const store = loadChainProgressStore();
    store.puzzles[snap.puzzleKey] = snap;
    saveChainProgressStore(store);
    if (snap.started && sessionActive && typeof setLastPlayedChain === "function") setLastPlayedChain(p);
    persistTickLastTs = performance.now ? performance.now() : Date.now();
  }

  // Throttle persistence to animation frame to avoid excessive writes.
  function requestPersistChainProgress() {
    const play = getPlayState();
    if (!play || play.mode !== MODE.CHAIN) return;
    if (persistChainRaf) return;
    persistChainRaf = requestAnimationFrame(() => {
      persistChainRaf = 0;
      persistChainProgressImmediate();
    });
  }

  // Restore persisted progress for the current chain puzzle (if it matches).
  function restoreChainProgressForCurrentPuzzle() {
    const play = getPlayState();
    const chain = getChainState();
    if (!play || !chain || play.mode !== MODE.CHAIN) return false;
    restoredFromStorage = false;
    const puzzles = getPuzzleList();
    const pIdx = getPuzzleIndexSafe();
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

    const ui = typeof ensureChainUI === "function" ? ensureChainUI() : null;

    // Restore user input and cursor position.
    play.usr = Array.from({ length: play.n }, (_, i) => data.usr?.[i] || "");
    play.at = clamp(data.at ?? 0, 0, Math.max(0, play.n - 1));
    play.done = !!data.done;
    play.revealed = !!data.revealed;
    const restoredAutoCheckEverOn = data.autoCheckEverOn != null ? !!data.autoCheckEverOn : true;
    play.autoCheckEverOn = restoredAutoCheckEverOn || autoCheckEnabled();
    play.hardModeComplete = !!data.hardModeComplete;

    chain.started = !!(data.started || play.done || play.usr.some(Boolean));
    chain.running = false;
    chain.elapsed = Math.max(0, +data.elapsed || 0);
    chain.startAt = 0;
    chain.left = 0;
    chain.lastFinishElapsedSec = Math.max(0, +data.lastFinishElapsedSec || 0);
    chain.unsolvedCount = Math.max(0, +data.unsolvedCount || 0);
    chain.hardModeComplete = !!data.hardModeComplete;
    chain.hintsUsed = Math.max(0, +data.hintsUsed || 0);
    chain.checksUsed = Math.max(0, +data.checksUsed || 0);
    chain.hintPenaltySecTotal = Math.max(
      0,
      +data.hintPenaltySecTotal || chain.hintsUsed * (hintPenaltySec || 0) || 0
    );
    chain.wordPenaltySecTotal = Math.max(0, +data.wordPenaltySecTotal || 0);

    // Rebuild locks so hints and solved words preserve non-editable state.
    play.lockedEntries = new Set(Array.isArray(data.lockedEntries) ? data.lockedEntries : []);
    const prevLocked = Array.isArray(data.lockedCells) ? data.lockedCells.slice(0, play.n) : [];
    play.lockedCells = prevLocked.concat(
      Array.from({ length: Math.max(0, play.n - prevLocked.length) }, () => false)
    );
    if (typeof rebuildLockedCells === "function") rebuildLockedCells();

    if (ui?.timer) ui.timer.textContent = formatTime(chain.elapsed);
    const state =
      play.done ? chainUiStates?.DONE || "done" : chain.started ? chainUiStates?.PAUSED || "paused" : chainUiStates?.IDLE || "idle";
    if (typeof chainSetUIState === "function") chainSetUIState(state, ui);
    if (typeof setInlineCluesHiddenUntilChainStart === "function") {
      setInlineCluesHiddenUntilChainStart();
    }
    if (typeof updateLockedWordUI === "function") updateLockedWordUI();
    if (typeof updatePlayUI === "function") updatePlayUI();
    if (typeof setAt === "function") setAt(play.at, { behavior: "none", noScroll: true });
    if (typeof scrollActiveCellAfterRestore === "function") {
      scrollActiveCellAfterRestore(play.at);
    }
    restoredFromStorage = true;
    restoredAt = play.at;

    return true;
  }

  function resetPersistTick() {
    persistTickLastTs = 0;
  }

  function maybePersistFromTick(now, thresholdMs = 900) {
    if (!persistTickLastTs || now - persistTickLastTs > thresholdMs) {
      requestPersistChainProgress();
      persistTickLastTs = now;
      return true;
    }
    return false;
  }

  function clearRestoreState() {
    restoredFromStorage = false;
    restoredAt = 0;
  }

  function getRestoreState() {
    return { restored: restoredFromStorage, at: restoredAt };
  }

  return {
    persistChainProgressImmediate,
    requestPersistChainProgress,
    restoreChainProgressForCurrentPuzzle,
    resetPersistTick,
    maybePersistFromTick,
    clearRestoreState,
    getRestoreState,
    markSessionActive: () => {
      sessionActive = true;
    },
  };
}
