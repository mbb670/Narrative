/*
 * File Overview
 * Purpose: Play control visibility and state.
 * Controls: Shows or hides reset and reveal controls based on game state.
 * How: Toggles DOM classes and disabled states.
 * Key interactions: Used by app.js and controls module.
 */
// Play/chain control visibility helpers.
import { MODE, VIEW } from "../core/config.js";

export function createPlayControls({ els, getPlay, getCurrentView, chainUiStates } = {}) {
  const getPlaySafe = typeof getPlay === "function" ? getPlay : () => null;
  const getView = typeof getCurrentView === "function" ? getCurrentView : () => null;
  const chainStates = chainUiStates || { IDLE: "idle", RUNNING: "running", PAUSED: "paused", DONE: "done" };

  // Centralize visibility toggles for play/chain controls.
  function updatePlayControlsVisibility() {
    const play = getPlaySafe();
    const currentView = getView();
    if (!els?.reset || !els?.reveal || !play) return;

    // Only gate in play/overlap mode; otherwise leave visible.
    if (play.mode !== MODE.PUZZLE || currentView !== VIEW.PLAY) {
      els.reset.style.display = "";
      els.reveal.style.display = "";
      if (els.nextPuzzleBtn) els.nextPuzzleBtn.style.display = "none";
      if (els.shareInline) els.shareInline.style.display = "none";
      return;
    }

    const hasInput = Array.isArray(play.usr) && play.usr.some(Boolean);
    const solved = !!play.done;

    els.reveal.style.display = solved ? "none" : "";
    els.reset.style.display = solved || (hasInput && !solved) ? "" : "none";
    if (els.nextPuzzleBtn) {
      els.nextPuzzleBtn.style.display = solved ? "" : "none";
    }
    if (els.shareInline) {
      const showShare = solved && !play.revealed;
      els.shareInline.style.display = showShare ? "inline-flex" : "none";
    }
  }

  // Button/controls visibility for chain mode.
  function updateResetRevealVisibility(stateOverride) {
    const play = getPlaySafe();
    if (!els?.reset || !els?.reveal || !play) return;
    if (play.mode !== MODE.CHAIN) {
      els.reset.style.display = "";
      els.reveal.style.display = "";
      return;
    }
    const state = stateOverride || document.body.dataset.chainState || chainStates.IDLE;
    const show = state === chainStates.RUNNING || state === chainStates.PAUSED;
    els.reset.style.display = show ? "" : "none";
    els.reveal.style.display = show ? "" : "none";
  }

  function updatePuzzleActionsVisibility(stateOverride) {
    const play = getPlaySafe();
    const wrap = els?.puzzleActions;
    if (!wrap || !play) return;
    if (play.mode !== MODE.CHAIN) {
      wrap.style.display = "";
      return;
    }

    // turn this back on to set the give up to only show once the puzzle is started
    const state = stateOverride || document.body.dataset.chainState || chainStates.IDLE;
    const show = state === chainStates.RUNNING || state === chainStates.PAUSED;
    wrap.style.display = show ? "" : "none";
  }

  return {
    updatePlayControlsVisibility,
    updateResetRevealVisibility,
    updatePuzzleActionsVisibility,
  };
}
