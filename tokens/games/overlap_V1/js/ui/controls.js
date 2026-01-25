/*
 * File Overview
 * Purpose: Main control buttons binding.
 * Controls: Reset, reveal, give up, and other top-level controls.
 * How: Binds DOM events to play actions and modal toggles.
 * Key interactions: Uses play/actions, give-up, and penalties modules.
 */
// UI control bindings (buttons, modals, FTUE).
import { MODE, VIEW } from "../core/config.js";

export function bindControlEvents({
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
  chainUiStates,
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
} = {}) {
  // Reveal
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
    const todayIdx =
      typeof findTodayChainIndex === "function" ? findTodayChainIndex() : null;
    if (todayIdx != null && typeof loadPuzzle === "function") {
      loadPuzzle(todayIdx, { skipLastPlayed: true });
    }
    openFtue(0, { instant: true, noAnim: true });
  });
  els.shareBtn?.addEventListener("click", () => {
    markInteracted();
    shareResult({ mode: play.mode, linkOnly: true, toastEl: els.splashShareToast });
  });
  initNavButtons();

  // FTUE events
  els.ftuePrev?.addEventListener("click", (e) => {
    e.preventDefault();
    if (getFtueStep() === 0) {
      closeFtue();
      openSplash(splashState());
    } else {
      prevFtue();
    }
  });
  els.ftueNext?.addEventListener("click", (e) => {
    e.preventDefault();
    const stepCount = getFtueStepCount();
    const atLast = stepCount > 0 && getFtueStep() >= stepCount - 1;
    if (atLast) {
      // Always jump into chain play on final CTA
      const summary = chainProgressSummary();
      closeFtue();
      setTab(VIEW.PLAY, { skipEnsure: true });
      if (summary.state === "complete" || play.done) {
        chain.running = false;
        chain.started = true;
        chainSetUIState(chainUiStates.DONE);
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
    setTab(VIEW.PLAY, { skipEnsure: true });
    const summary = chainProgressSummary();
    if (summary.state === "complete" || play.done) {
      chain.running = false;
      chain.started = true;
      chainSetUIState(chainUiStates.DONE);
      updatePlayUI();
    } else if (!chain.started) chainStartNow();
    else if (!chain.running) chainResume();
  });
  els.ftueDots?.forEach?.((dot, idx) =>
    dot.addEventListener("click", (e) => {
      e.preventDefault();
      setFtueStep(idx);
      renderFtueStep();
    })
  );
  els.ftueModal?.addEventListener("touchstart", onFtueTouchStart, { passive: true });
  els.ftueModal?.addEventListener("touchend", onFtueTouchEnd, { passive: true });
  els.ftuePlayPause?.addEventListener("click", (e) => {
    e.preventDefault();
    if (ftueIsPaused()) ftuePlay();
    else ftuePause();
  });

  // Clear stats/progress
  els.pClear?.addEventListener("click", () => {
    clearAllChainProgress();
    clearChainStats();
    resetPlay({ clearPersist: false });
    chainForceIdleZero();
  });
}
