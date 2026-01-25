/*
 * File Overview
 * Purpose: Splash screen modal.
 * Controls: Intro display and close or start actions.
 * How: Shows on load and hides based on user action.
 * Key interactions: Used by app.js and ftue or settings.
 */
// Splash modal helpers for chain progress and quick actions.
import {
  ARCHIVE_RETURN_TIMEOUT_MS,
  SUPPRESS_SPLASH,
  IS_IOS,
  MODE,
  VIEW,
} from "../core/config.js";
import {
  getLastPlayedChain,
  getLastScreen,
  setLastScreen,
  normalizePuzzleId,
  isDailyChainPuzzle,
} from "../utils/index.js";
import { computed } from "../core/model.js";
import {
  chainPuzzleKey,
  loadChainProgressStore,
  todayKey,
} from "../data/chain-progress.js";
import { bindDialogDismiss, setAppLock } from "./dialogs.js";

export function createSplash({
  els,
  getPlay,
  getChain,
  getPuzzles,
  getPuzzleIndex,
  loadPuzzle,
  findTodayChainIndex,
  isWordCorrect,
  chainStatsSummary,
  closeSettingsPanel,
  setTab,
  chainForceIdleZero,
  chainSetUIState,
  chainUiStates,
  hasSeenFtue,
  openFtue,
  chainStartNow,
  chainResume,
  openArchiveModal,
  isAutoCheckEnabled,
} = {}) {
  let splashShown = false;
  const autoCheckEnabled =
    typeof isAutoCheckEnabled === "function" ? isAutoCheckEnabled : () => true;

  bindDialogDismiss(els?.splash);

  const getPlayState = () => (typeof getPlay === "function" ? getPlay() : null);
  const getChainState = () => (typeof getChain === "function" ? getChain() : null);
  const getPuzzleList = () => (typeof getPuzzles === "function" ? getPuzzles() : []);
  const getPuzzleIndexSafe = () => (typeof getPuzzleIndex === "function" ? getPuzzleIndex() : null);
  const findTodayPuzzle = () => {
    const today = todayKey();
    if (!today) return null;
    const puzzles = getPuzzleList();
    const idx = typeof findTodayChainIndex === "function" ? findTodayChainIndex() : null;
    const fromIdx = idx != null ? puzzles[idx] : null;
    if (fromIdx) return fromIdx;
    return puzzles.find((p) => normalizePuzzleId(p).id === today) || null;
  };
  const ensureTodayPuzzleLoaded = () => {
    if (typeof loadPuzzle !== "function") return;
    const puzzles = getPuzzleList();
    const today = todayKey();
    if (!today || !puzzles.length) return;
    let idx = typeof findTodayChainIndex === "function" ? findTodayChainIndex() : null;
    if (idx == null) {
      idx = puzzles.findIndex((p) => normalizePuzzleId(p).id === today);
    }
    if (idx == null || idx < 0) return;
    const curIdx = getPuzzleIndexSafe();
    if (curIdx === idx) return;
    loadPuzzle(idx);
  };

  // Summary when we are actively in chain view.
  function chainSummaryFromLive() {
    const play = getPlayState();
    const chain = getChainState();
    if (!play || !chain || play.mode !== MODE.CHAIN) return null;
    const puzzles = getPuzzleList();
    const idx = getPuzzleIndexSafe();
    const p = idx != null ? puzzles[idx] : null;
    if (!p) return null;
    const today = todayKey();
    const puzzleId = normalizePuzzleId(p).id;
    const isCurrentDaily = isDailyChainPuzzle(p) && today && puzzleId === today;
    if (!isCurrentDaily) return null;

    const total = play.entries?.length || 0;
    const solved =
      total && typeof isWordCorrect === "function"
        ? play.entries.filter(isWordCorrect).length
        : 0;
    const state = play.done ? "complete" : chain.started && !chain.running ? "paused" : "default";
    return { state, solved, total };
  }

  // Summary from persisted chain progress when not in chain view.
  function chainSummaryFromStore() {
    const p = findTodayPuzzle();
    if (!p) return null;
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
    const total =
      Number.isFinite(data?.stats?.total) ? data.stats.total : (model.entries?.length || 0);
    const usr = Array.isArray(data.usr) ? data.usr : [];
    const solvedFromUsr = (model.entries || []).filter((e) => {
      for (let i = 0; i < e.len; i++) {
        const idx = e.start + i;
        if (!usr[idx]) return false;
        if (usr[idx] !== model.exp[idx]) return false;
      }
      return true;
    }).length;
    const lockedCount = Array.isArray(data.lockedEntries) ? data.lockedEntries.length : 0;
    const solved =
      Number.isFinite(data?.stats?.solved) ? data.stats.solved :
      solvedFromUsr || lockedCount;

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
    if (!els?.splash) return;
    const summary = chainProgressSummary();
    const state = forceState || summary.state;
    const solved = summary.solved || 0;
    const play = getPlayState();
    const total = summary.total || play?.entries?.length || 0;

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
        ? autoCheckEnabled()
          ? `Continue puzzle (${solved}/${total || play?.entries?.length || 0})`
          : "Continue puzzle"
        : "Play";

    if (els.splashPrimary) els.splashPrimary.textContent = primaryLabel;
    if (els.splashSubtitle) {
      els.splashSubtitle.textContent =
        state === "complete"
          ? "You finished today\u2019s chain"
          : state === "paused"
          ? "Pick up where you left off"
          : "Daily word chain";
    }
    const stats = typeof chainStatsSummary === "function" ? chainStatsSummary() : { games: 0, avgSec: 0 };
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

  function openSplash(forceState) {
    if (!els?.splash) return;
    setLastScreen("splash");
    updateSplashContent(forceState);
    const isOpen = !!els.splash.open || els.splash.hasAttribute("open");
    if (!isOpen) {
      if (typeof els.splash.showModal === "function") {
        els.splash.showModal();
      } else {
        els.splash.setAttribute("open", "");
      }
      setAppLock(true);
    }
    document.documentElement.classList.add("is-modal-open");
    if (!IS_IOS) {
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";
    }
  }

  function closeSplash() {
    if (!els?.splash) return;
    setLastScreen(null);
    const wasOpen = els.splash.open || els.splash.hasAttribute("open");
    if (wasOpen) {
      if (typeof els.splash.close === "function") {
        els.splash.close();
      } else {
        els.splash.removeAttribute("open");
      }
    }
    if (wasOpen) setAppLock(false);
    if (typeof closeSettingsPanel === "function") closeSettingsPanel();
    document.documentElement.classList.remove("is-modal-open");
    if (!IS_IOS) {
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
    }
  }

  // Primary CTA handles FTUE gating and resumes/starts the chain.
  function handleSplashPrimary() {
    const seen = typeof hasSeenFtue === "function" ? hasSeenFtue() : true;

    if (!seen) {
      // First-time: move to chain view in an idle state, then show FTUE (chain must not start yet)
      if (typeof setTab === "function") setTab(VIEW.PLAY);
      ensureTodayPuzzleLoaded();
      const play = getPlayState();
      const chain = getChainState();
      if (!play || !chain) return;
      if (typeof chainForceIdleZero === "function") chainForceIdleZero();
      chain.started = false;
      chain.running = false;
      chain.elapsed = 0;
      if (typeof chainSetUIState === "function") {
        chainSetUIState(chainUiStates?.IDLE || "idle");
      }
      closeSplash();
      if (typeof openFtue === "function") openFtue(0);
      return;
    }

    const state = splashState();
    if (typeof setTab === "function") setTab(VIEW.PLAY);
    ensureTodayPuzzleLoaded();
    const play = getPlayState();
    const chain = getChainState();
    if (!play || !chain) return;
    if (state === "complete") {
      closeSplash();
      return;
    }
    if (state === "paused") {
      closeSplash();
      if (play.done) return;
      if (chain.started && typeof chainResume === "function") chainResume();
      else if (!chain.started && typeof chainStartNow === "function") chainStartNow();
      return;
    }
    closeSplash();
    if (!chain.started && typeof chainStartNow === "function") chainStartNow();
    else if (!chain.running && typeof chainResume === "function") chainResume();
  }

  // Decide whether to show splash or jump to the archive after a recent return.
  function maybeShowSplashOnLoad() {
    if (splashShown || SUPPRESS_SPLASH) return;
    splashShown = true;
    const now = Date.now();
    const lastScreen = getLastScreen();
    if (lastScreen?.screen === "splash") {
      openSplash();
      return;
    }
    if (lastScreen?.screen === "archive") {
      const lastAt = Number.isFinite(lastScreen.at) ? lastScreen.at : null;
      const withinArchiveWindow =
        lastAt == null ? true : now - lastAt <= ARCHIVE_RETURN_TIMEOUT_MS;
      if (withinArchiveWindow) {
        if (typeof openArchiveModal === "function") {
          openArchiveModal();
          return;
        }
      } else {
        setLastScreen(null);
      }
    }
    const last = getLastPlayedChain();
    const today = todayKey();
    const lastAt = Number.isFinite(last?.at) ? last.at : null;
    const withinArchiveWindow =
      lastAt == null ? true : now - lastAt <= ARCHIVE_RETURN_TIMEOUT_MS;
    // If the user last played a previous daily puzzle recently, jump into the archive.
    if (last?.isDate && last.id && today && last.id !== today && withinArchiveWindow) {
      if (typeof openArchiveModal === "function") {
        openArchiveModal({ dateKey: last.id });
        return;
      }
    }
    openSplash();
  }

  return {
    chainProgressSummary,
    splashState,
    splashSolvedText,
    updateSplashContent,
    openSplash,
    closeSplash,
    handleSplashPrimary,
    maybeShowSplashOnLoad,
  };
}
