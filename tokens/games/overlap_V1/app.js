/*
 * File Overview
 * Purpose: Application bootstrap for Overlap V1 and the composition root for the modular build.
 * Controls: Initializes shared state, wires module factories, and triggers the initial render.
 * How: Imports config, utils, model/data helpers, and UI factories, then binds events and kicks off startup flows.
 * Key interactions: Touches most modules and is the entry point referenced by index.html.
 */
// Overlap V1 app bootstrap.
// Wires modules, shared state, and global event bindings.
import "../../docs/token_switcher/switcher.js";
import {
  MODE,
} from "./js/core/config.js";
import {
  clamp,
  isEditable,
  toDateKey,
  setLastPlayedChain,
  setLastArchivePlayed,
  puzzleDateLabel,
  isDailyChainPuzzle,
} from "./js/utils/index.js";
import { applyPaletteToDom } from "./js/core/palette.js";
import { loadDefaultPuzzles } from "./js/data/defaults.js";
import { createStore } from "./js/data/store.js";
import {
  clearChainProgressForPuzzle,
  clearAllChainProgress,
  clearChainStats,
  chainStatsSummary,
  recordChainCompletionIfNeeded,
} from "./js/data/chain-progress.js";
import { els } from "./js/core/dom.js";
import { computed, normPuzzle, setCols } from "./js/core/model.js";
import { createSlider } from "./js/ui/slider.js";
import { createSettingsUI } from "./js/ui/settings.js";
import { createArchiveUI } from "./js/ui/archive.js";
import { createSplash } from "./js/ui/splash.js";
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
import { createShareUI } from "./js/ui/share.js";
import { createChainResults } from "./js/ui/chain-results.js";
import { createChainHud } from "./js/ui/chain-hud.js";
import { createCellUI } from "./js/ui/cell-ui.js";
import { createChainLocks } from "./js/chain/locks.js";
import { createChainCore } from "./js/chain/core.js";
import { createChainClues } from "./js/chain/clues.js";
import { createChainTiming } from "./js/chain/timing.js";
import { createChainAutoAdvance } from "./js/chain/auto-advance.js";
import { createPlayActions } from "./js/play/actions.js";
import { createStatusUI } from "./js/ui/status.js";
import { createEnterKeyHandler } from "./js/ui/enter-key.js";
import { bindGlobalEvents } from "./js/ui/events.js";
import { bindControlEvents } from "./js/ui/controls.js";
import { createWarningToasts } from "./js/ui/warnings.js";
import { createTabs } from "./js/ui/tabs.js";
import { createFtue } from "./js/ui/ftue.js";
import { createChainPersistence } from "./js/data/chain-persistence.js";
import { createTabState, loadLastView } from "./js/core/view-state.js";

// ---- Palettes ---- (js/core/palette.js)

// ---- Slider (scroll surrogate, squish-style) ---- (js/ui/slider.js)

// ---- Defaults loading ---- (js/data/defaults.js)
const DEF = await loadDefaultPuzzles();


// ---- DOM ---- (js/core/dom.js)

const NAV_DEBUG = false;
const logNav = () => {};

// ---- Cross-module refs ----
const { setTab, setTabManager } = createTabState();

const chainCoreRef = {
  chainStartNow: () => {},
  isWordAttempted: () => false,
  isWordCorrect: () => false,
  scoreChain: () => ({ correct: 0, attempted: 0 }),
  chainFinish: () => {},
  chainMaybeFinishIfSolved: () => {},
  chainInputAllowed: () => true,
};
const chainStartNow = (...args) => chainCoreRef.chainStartNow(...args);
const isWordAttempted = (...args) => chainCoreRef.isWordAttempted(...args);
const isWordCorrect = (...args) => chainCoreRef.isWordCorrect(...args);
const scoreChain = (...args) => chainCoreRef.scoreChain(...args);
const chainFinish = (...args) => chainCoreRef.chainFinish(...args);
const chainMaybeFinishIfSolved = (...args) => chainCoreRef.chainMaybeFinishIfSolved(...args);
const chainInputAllowed = (...args) => chainCoreRef.chainInputAllowed(...args);

const autoCheckRef = { current: () => true };
const isAutoCheckEnabled = () => autoCheckRef.current();

const chainAutoRef = {
  findNextEditable: () => null,
  chooseAutoAdvanceTarget: () => ({ target: null, suppress: false }),
  markLockedAutoAdvanceSuppression: () => {},
  consumeLockedAutoAdvanceSuppression: () => false,
  clearLockedAutoAdvanceSuppressionIfMoved: () => {},
};
const findNextEditable = (...args) => chainAutoRef.findNextEditable(...args);
const chooseAutoAdvanceTarget = (...args) => chainAutoRef.chooseAutoAdvanceTarget(...args);
const markLockedAutoAdvanceSuppression = (...args) => chainAutoRef.markLockedAutoAdvanceSuppression(...args);
const consumeLockedAutoAdvanceSuppression = (...args) => chainAutoRef.consumeLockedAutoAdvanceSuppression(...args);
const clearLockedAutoAdvanceSuppressionIfMoved = (...args) =>
  chainAutoRef.clearLockedAutoAdvanceSuppressionIfMoved(...args);

const playActionsRef = {
  updateArchiveDateBanner: () => {},
  setAt: () => {},
  jumpToEntry: () => {},
  checkSolvedOverlapOnly: () => {},
  write: () => {},
  back: () => {},
  clearAllUnlockedCells: () => {},
  countUnsolvedWords: () => 0,
  countUnsolvedLetters: () => 0,
  move: () => {},
  resetPlay: () => {},
  revealPlay: () => {},
  loadPuzzle: () => {},
};
const updateArchiveDateBanner = (...args) => playActionsRef.updateArchiveDateBanner(...args);
const setAt = (...args) => playActionsRef.setAt(...args);
const jumpToEntry = (...args) => playActionsRef.jumpToEntry(...args);
const checkSolvedOverlapOnly = (...args) => playActionsRef.checkSolvedOverlapOnly(...args);
const write = (...args) => playActionsRef.write(...args);
const back = (...args) => playActionsRef.back(...args);
const clearAllUnlockedCells = (...args) => playActionsRef.clearAllUnlockedCells(...args);
const countUnsolvedWords = (...args) => playActionsRef.countUnsolvedWords(...args);
const countUnsolvedLetters = (...args) => playActionsRef.countUnsolvedLetters(...args);
const move = (...args) => playActionsRef.move(...args);
const resetPlay = (...args) => playActionsRef.resetPlay(...args);
const revealPlay = (...args) => playActionsRef.revealPlay(...args);
const loadPuzzle = (...args) => playActionsRef.loadPuzzle(...args);

// ---- Toasts ---- (js/ui/toasts.js)
const toasts = createToasts({
  els,
  getPlay: () => play,
  isWordCorrect,
  isAutoCheckEnabled,
});
let updatePlayUIImpl = () => {};
const updatePlayUI = (...args) => updatePlayUIImpl(...args);
const chainLockRef = {
  isCellLocked: () => false,
  rebuildLockedCells: () => {},
  updateLockedWordUI: () => {},
  triggerSolveAnimation: () => {},
  triggerFullSolveAnimation: () => {},
  chainApplyLocksIfEnabled: () => {},
};
const isCellLocked = (...args) => chainLockRef.isCellLocked(...args);
const rebuildLockedCells = (...args) => chainLockRef.rebuildLockedCells(...args);
const updateLockedWordUI = (...args) => chainLockRef.updateLockedWordUI(...args);
const triggerSolveAnimation = (...args) => chainLockRef.triggerSolveAnimation(...args);
const triggerFullSolveAnimation = (...args) => chainLockRef.triggerFullSolveAnimation(...args);
const chainApplyLocksIfEnabled = (...args) => chainLockRef.chainApplyLocksIfEnabled(...args);
let lastPlayWarningKey = "";
let lastChainWarningKey = "";
const CHAIN_UI = { IDLE: "idle", RUNNING: "running", PAUSED: "paused", DONE: "done" };
const chainHudRef = {
  chainSetUIState: () => {},
  ensureChainTick: () => {},
  chainPauseWithOpts: () => {},
  chainPause: () => {},
  chainPauseIfBackgrounded: () => {},
  chainResume: () => {},
  chainResetFromHud: () => {},
  ensureChainUI: () => null,
  getChainUI: () => null,
  chainStopTimer: () => {},
  chainResetTimer: () => {},
  chainForceIdleZero: () => {},
  chainShowResetWithClues: () => {},
};
const chainSetUIState = (...args) => chainHudRef.chainSetUIState(...args);
const ensureChainTick = (...args) => chainHudRef.ensureChainTick(...args);
const chainPauseWithOpts = (...args) => chainHudRef.chainPauseWithOpts(...args);
const chainPause = (...args) => chainHudRef.chainPause(...args);
const chainPauseIfBackgrounded = (...args) => chainHudRef.chainPauseIfBackgrounded(...args);
const chainResume = (...args) => chainHudRef.chainResume(...args);
const chainResetFromHud = (...args) => chainHudRef.chainResetFromHud(...args);
const ensureChainUI = (...args) => chainHudRef.ensureChainUI(...args);
const getChainUI = (...args) => chainHudRef.getChainUI(...args);
const chainStopTimer = (...args) => chainHudRef.chainStopTimer(...args);
const chainResetTimer = (...args) => chainHudRef.chainResetTimer(...args);
const chainForceIdleZero = (...args) => chainHudRef.chainForceIdleZero(...args);
const chainShowResetWithClues = (...args) => chainHudRef.chainShowResetWithClues(...args);

// ---- Chain timing/penalties ---- (js/chain/timing.js)
const { addTimePenalty, fmtTime, hintPenaltySec: HINT_PENALTY_SEC } = createChainTiming({
  els,
  getPlay: () => play,
  getChain: () => chain,
  ensureChainUI,
  toasts,
});

const statusUI = createStatusUI({ els });
const { setStatus } = statusUI;

const setLastPlayWarningKey = (key) => {
  lastPlayWarningKey = key;
};
const setLastChainWarningKey = (key) => {
  lastChainWarningKey = key;
};
const getLastPlayWarningKey = () => lastPlayWarningKey;
const getLastChainWarningKey = () => lastChainWarningKey;

const settingsUI = createSettingsUI({
  els,
  onAutoCheckChange: (enabled) => {
    if (!play || play.done) return;
    if (enabled) {
      play.autoCheckEverOn = true;
      play.hardModeComplete = false;
      requestPersistChainProgress?.();
    }
  },
});
autoCheckRef.current = () => settingsUI.isAutoCheckEnabled?.() ?? true;

// ---- Splash ---- (js/ui/splash.js)
let splashUI = null;
const chainProgressSummary = () =>
  splashUI?.chainProgressSummary?.() ?? { state: "default", solved: 0, total: 0 };
const splashState = () => splashUI?.splashState?.() ?? "default";
const openSplash = (forceState) => splashUI?.openSplash?.(forceState);
const closeSplash = () => splashUI?.closeSplash?.();
const handleSplashPrimary = () => splashUI?.handleSplashPrimary?.();
const maybeShowSplashOnLoad = () => splashUI?.maybeShowSplashOnLoad?.();

const { closeSuccess, setResultsInert } = createResultsUI({ els });

const { shareResult } = createShareUI({
  getPuzzles: () => puzzles,
  getPuzzleIndex: () => pIdx,
  getPlay: () => play,
  getChain: () => chain,
  fmtTime,
  toasts,
});

const { openChainResults, closeChainResults } = createChainResults({
  els,
  getPlay: () => play,
  getChain: () => chain,
  getPuzzles: () => puzzles,
  getPuzzleIndex: () => pIdx,
  fmtTime,
  setResultsInert,
  shareResult,
  onOverlayClose: () => {
    markInteracted();
    focusForTyping();
  },
});

// ---- FTUE ---- (js/ui/ftue.js)
let ftueUI = null;
const ftueIsOpen = () => ftueUI?.ftueIsOpen?.() ?? false;
const openFtue = (startStep = 0, opts = {}) => ftueUI?.openFtue?.(startStep, opts);
const closeFtue = () => ftueUI?.closeFtue?.();
const nextFtue = () => ftueUI?.nextFtue?.();
const prevFtue = () => ftueUI?.prevFtue?.();
const renderFtueStep = () => ftueUI?.renderFtueStep?.();
const maybeShowFtue = () => ftueUI?.maybeShowFtue?.();
const hasSeenFtue = () => ftueUI?.hasSeenFtue?.() ?? false;
const setFtueStep = (step) => ftueUI?.setFtueStep?.(step);
const getFtueStep = () => ftueUI?.getFtueStep?.() ?? 0;
const getFtueStepCount = () => ftueUI?.getFtueStepCount?.() ?? 0;
const onFtueTouchStart = (e) => ftueUI?.onFtueTouchStart?.(e);
const onFtueTouchEnd = (e) => ftueUI?.onFtueTouchEnd?.(e);
const ftuePlay = () => ftueUI?.ftuePlay?.();
const ftuePause = () => ftueUI?.ftuePause?.();
const ftueIsPaused = () => ftueUI?.isPaused?.() ?? false;

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
  hasSeenFtue,
  openFtue,
  fmtTime,
  isAutoCheckEnabled,
});
const { openArchiveModal, isArchiveDailyPuzzle } = archiveUI;

const userKey = () => (Array.isArray(play.usr) ? play.usr.join("") : "");

const warningToasts = createWarningToasts({
  getPlay: () => play,
  getUserKey: userKey,
  getLastPlayWarningKey,
  getLastChainWarningKey,
  setLastPlayWarningKey,
  setLastChainWarningKey,
  countUnsolvedWords,
  toasts,
});

const { maybeToastPlayFilledWrong, maybeToastChainFilledWrong, resetToastGuards } = warningToasts;

// ---- Chain clues ---- (js/chain/clues.js)
const { setInlineCluesHiddenUntilChainStart, requestChainClues } = createChainClues({
  els,
  getPlay: () => play,
  getChain: () => chain,
});

// ---- Clear-all ---- (js/play/actions.js)

// ---- Scroll behavior ---- (js/ui/slider.js)

// ---- Storage ----
// Puzzles are stored in localStorage; defaults are merged so shipped updates appear.
const store = createStore({
  getDefaults: () => DEF,
  getPuzzles: () => puzzles,
});

// ---- Chain progress persistence ---- (js/data/chain-persistence.js)

// ---- Archive modal ---- (js/ui/archive.js)

// ---- Settings ---- (js/ui/settings.js)

// ---- Utils ---- (js/utils/index.js)

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
  autoCheckEverOn: false,
  hardModeComplete: false,

  lockedCells: [],
  lockedEntries: new Set(), // eIdx
};

const panState = {
  isUserPanning: false,
  pointerId: null,
  moved: false,
  startX: 0,
  startY: 0,
};
const gridClickGuard = { value: 0 };
const PAN_SLOP_PX = 8;

const sliderUI = createSlider({
  els,
  getPlay: () => play,
  getPuzzles: () => puzzles,
  getPuzzleIndex: () => pIdx,
  getCurrentView: () => currentView,
  isWordCorrect,
  isUserPanning: () => panState.isUserPanning,
  isAutoCheckEnabled,
});

const chainSessionRef = { markSessionActive: () => {} };

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
  markInteracted: markInteractedRaw,
  focusForTyping,
  initOnScreenKeyboard,
  updateKeyboardVisibility,
  maybeDemoteHardwareKeyboard,
  noteHardwareKeyboard,
  hasHardwareKeyboard,
  isKeyboardInputTarget,
  blurKeyboardInput,
} = keyboardUI;
const markInteracted = (...args) => {
  markInteractedRaw(...args);
  chainSessionRef.markSessionActive();
};

// ---- Model ---- (js/core/model.js)

// ---- Horizontal keep-in-view ---- (js/ui/scroll.js)
// Keeps the active cell centered without fighting user panning.
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
  isUserPanning: () => panState.isUserPanning,
});

const {
  persistChainProgressImmediate,
  requestPersistChainProgress,
  restoreChainProgressForCurrentPuzzle,
  resetPersistTick,
  maybePersistFromTick,
  clearRestoreState,
  getRestoreState,
  markSessionActive,
} = createChainPersistence({
  getPlay: () => play,
  getChain: () => chain,
  getPuzzles: () => puzzles,
  getPuzzleIndex: () => pIdx,
  setLastPlayedChain,
  scoreChain,
  rebuildLockedCells,
  ensureChainUI: (...args) => chainHudRef.ensureChainUI(...args),
  fmtTime,
  chainSetUIState: (...args) => chainHudRef.chainSetUIState(...args),
  chainUiStates: CHAIN_UI,
  setInlineCluesHiddenUntilChainStart,
  updateLockedWordUI,
  updatePlayUI: () => updatePlayUI(),
  setAt,
  scrollActiveCellAfterRestore,
  hintPenaltySec: HINT_PENALTY_SEC,
  isAutoCheckEnabled,
});
chainSessionRef.markSessionActive = markSessionActive;


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

const chainLocks = createChainLocks({
  els,
  getPlay: () => play,
  sliderUI,
  toasts,
  isWordCorrect,
  getSelectedEntry,
  clearSelection,
  requestPersistChainProgress,
  isAutoCheckEnabled,
});
Object.assign(chainLockRef, chainLocks);

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

// ---- Hints ---- (js/ui/hints.js)
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
  isAutoCheckEnabled,
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
  isAutoCheckEnabled,
});

const chainAuto = createChainAutoAdvance({
  getPlay: () => play,
  isCellLocked,
  isWordCorrect,
  entryAtIndex,
  unresolvedEntries,
  findUnresolvedCell,
  firstEditableCellInEntry,
});
Object.assign(chainAutoRef, chainAuto);

const cellUI = createCellUI({
  els,
  getPlay: () => play,
  isWordCorrect,
  isCellLocked,
  cellAriaLabel,
  updateSelectedWordUI,
  sliderUI,
  updatePlayControlsVisibility,
  updateSelectAllUI,
  toasts,
  isAutoCheckEnabled,
});
updatePlayUIImpl = cellUI.updatePlayUI;

const { renderGrid } = createGridRenderer({
  els,
  getPlay: () => play,
  getPuzzles: () => puzzles,
  getPuzzleIndex: () => pIdx,
  resetRangeClueHints,
  ensureRangeFocusEl,
  cellAriaLabel,
});

ftueUI = createFtue({
  els,
  getPuzzles: () => puzzles,
  computed,
  renderGrid,
  clamp,
  getPlay: () => play,
  getChain: () => chain,
  chainSetUIState,
  chainUiStates: CHAIN_UI,
  chainProgressSummary,
  isAutoCheckEnabled,
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
  isAutoCheckEnabled,
});

const { openGiveUpModal, closeGiveUpModal } = giveUpUI;

// ---- View filtering ---- (js/ui/view.js)
const {
  indicesForView,
  findTodayChainIndex,
  ensureCurrentPuzzleMatchesView,
} = createViewHelpers({
  getPuzzles: () => puzzles,
  getPuzzleIndex: () => pIdx,
  loadPuzzle,
  isDailyChainPuzzle,
  toDateKey,
});

const playActions = createPlayActions({
  els,
  isTouch: IS_TOUCH,
  getPlay: () => play,
  getPuzzles: () => puzzles,
  getPuzzleIndex: () => pIdx,
  setPuzzleIndex: (idx) => {
    pIdx = idx;
  },
  clamp,
  applyPaletteToDom,
  computed,
  normPuzzle,
  setStatus,
  setCols,
  puzzleDateLabel,
  isArchiveDailyPuzzle,
  updatePlayUI,
  updatePlayControlsVisibility,
  updatePuzzleActionsVisibility,
  updateResetRevealVisibility,
  updateLockedWordUI,
  clearSelectAll,
  clearSelection,
  selectEntry,
  maybeClearSelectionOnCursorMove,
  hideRangeFocus,
  resetRangeClueHints,
  triggerFullSolveAnimation,
  toasts,
  sliderUI,
  keepActiveCellInView,
  requestKeepActiveCellInView,
  scrollToWordStart,
  isCellLocked,
  isWordCorrect,
  chainInputAllowed,
  chainApplyLocksIfEnabled,
  chainMaybeFinishIfSolved,
  chainFinish,
  findNextEditable,
  chooseAutoAdvanceTarget,
  markLockedAutoAdvanceSuppression,
  consumeLockedAutoAdvanceSuppression,
  clearLockedAutoAdvanceSuppressionIfMoved,
  requestChainClues,
  requestPersistChainProgress,
  persistChainProgressImmediate,
  clearChainProgressForPuzzle,
  restoreChainProgressForCurrentPuzzle,
  clearRestoreState,
  chainResetTimer,
  chainStopTimer,
  ensureChainUI,
  getChainUI,
  addTimePenalty,
  hintPenaltySec: HINT_PENALTY_SEC,
  pulseRangeHintIntro,
  closeSuccess,
  closeChainResults,
  resetToastGuards,
  maybeToastChainFilledWrong,
  maybeToastPlayFilledWrong,
  setInlineCluesHiddenUntilChainStart,
  renderGrid,
  isAutoCheckEnabled,
});
Object.assign(playActionsRef, playActions);

splashUI = createSplash({
  els,
  getPlay: () => play,
  getChain: () => chain,
  getPuzzles: () => puzzles,
  getPuzzleIndex: () => pIdx,
  loadPuzzle,
  findTodayChainIndex,
  isWordCorrect,
  chainStatsSummary,
  closeSettingsPanel: () => settingsUI.closeSettingsPanel(),
  setTab,
  chainForceIdleZero,
  chainSetUIState,
  chainUiStates: CHAIN_UI,
  hasSeenFtue,
  openFtue,
  chainStartNow,
  chainResume,
  openArchiveModal,
  isAutoCheckEnabled,
});

const tabManager = createTabs({
  els,
  getPlay: () => play,
  getChain: () => chain,
  setCurrentView: (view) => {
    currentView = view;
  },
  updateKeyboardVisibility,
  ensureCurrentPuzzleMatchesView,
  sliderUI,
  focusForTyping,
  updateResetRevealVisibility,
  updatePlayControlsVisibility,
  updatePuzzleActionsVisibility,
  chainSetUIState,
  ensureChainTick,
  chainUiStates: CHAIN_UI,
});
setTabManager(tabManager);

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
  hardModeComplete: false,
};


const chainHud = createChainHud({
  els,
  getPlay: () => play,
  getChain: () => chain,
  getPuzzles: () => puzzles,
  getPuzzleIndex: () => pIdx,
  chainUiStates: CHAIN_UI,
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
});
Object.assign(chainHudRef, chainHud);

const chainCore = createChainCore({
  getPlay: () => play,
  getChain: () => chain,
  getPuzzles: () => puzzles,
  getPuzzleIndex: () => pIdx,
  chainUiStates: CHAIN_UI,
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
});
Object.assign(chainCoreRef, chainCore);

// ---- Chain helpers ---- (js/chain/core.js, js/chain/locks.js, js/chain/clues.js, js/chain/auto-advance.js)
// ---- Play actions ---- (js/play/actions.js)
// ---- Escaping ---- (js/utils/escape.js)

const { handleEnterKey } = createEnterKeyHandler({
  getPlay: () => play,
  getUserKey: userKey,
  setLastPlayWarningKey,
  setLastChainWarningKey,
  toasts,
  checkSolvedOverlapOnly,
  countUnsolvedWords,
  chainMaybeFinishIfSolved,
});

bindGlobalEvents({
  els,
  isTouch: IS_TOUCH,
  isEditable,
  ftueIsOpen,
  selectAllUnlockedCells,
  clearAllUnlockedCells,
  clearSelectAll,
  isSelectAllUnlocked,
  back,
  move,
  jumpToUnresolvedWord,
  write,
  handleEnterKey,
  isKeyboardInputTarget,
  hasHardwareKeyboard,
  noteHardwareKeyboard,
  maybeDemoteHardwareKeyboard,
  markInteracted,
  onGlobalPointerDownForRangeClues,
  onGridCellClick,
  onRangeClueContentOver,
  onRangeClueContentOut,
  onGridPointerUpTouch,
  sliderUI,
  chainPauseIfBackgrounded,
  focusForTyping,
  requestChainClues,
  getPlay: () => play,
  gridClickGuard,
  panState,
  panSlopPx: PAN_SLOP_PX,
});

bindControlEvents({
  els,
  play,
  chain,
  settingsUI,
  archiveUI,
  handleSplashPrimary,
  openSplash,
  closeSplash,
  splashState,
  openArchiveModal,
  setTab,
  loadPuzzle,
  findTodayChainIndex,
  chainForceIdleZero,
  resetPlay,
  revealPlay,
  markInteracted,
  focusForTyping,
  openGiveUpModal,
  closeGiveUpModal,
  chainPauseWithOpts,
  chainResume,
  chainStartNow,
  chainSetUIState,
  chainUiStates: CHAIN_UI,
  updatePlayUI,
  chainProgressSummary,
  openFtue,
  closeFtue,
  nextFtue,
  prevFtue,
  getFtueStep,
  getFtueStepCount,
  setFtueStep,
  renderFtueStep,
  onFtueTouchStart,
  onFtueTouchEnd,
  ftueIsPaused,
  ftuePlay,
  ftuePause,
  shareResult,
  initNavButtons,
  clearAllChainProgress,
  clearChainStats,
});

// ---- Start ----
// Initialize UI and load the initial puzzle/view.
initOnScreenKeyboard();
sliderUI.initSlider();
const todayIdx = findTodayChainIndex();
loadPuzzle(todayIdx != null ? todayIdx : 0, { skipLastPlayed: true });
setTab(currentView);
queueInitialHintIntro();
maybeShowFtue();
maybeShowSplashOnLoad();
const currentPuzzle = puzzles[pIdx];
setLastPlayedChain(currentPuzzle);
if (typeof isArchiveDailyPuzzle === "function" && isArchiveDailyPuzzle(currentPuzzle)) {
  setLastArchivePlayed(currentPuzzle);
}

requestAnimationFrame(() => {
  const restoreState = getRestoreState();
  if (restoreState.restored) {
    setAt(restoreState.at, { behavior: "none", noScroll: true });
  } else {
    setAt(0);
  }
  focusForTyping();
});
