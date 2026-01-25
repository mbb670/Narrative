/*
 * File Overview
 * Purpose: Play control visibility and state.
 * Controls: Shows or hides reveal controls based on game state.
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
    if (!els?.reveal || !play) return;

    // Only gate in play/overlap mode; otherwise leave visible.
    if (play.mode !== MODE.PUZZLE || currentView !== VIEW.PLAY) {
      els.reveal.style.display = "";
      return;
    }

    els.reveal.style.display = "";
  }

  // Button/controls visibility for chain mode.
  function updateResetRevealVisibility(stateOverride) {
    const play = getPlaySafe();
    if (!els?.reveal || !play) return;
    if (play.mode !== MODE.CHAIN) {
      els.reveal.style.display = "";
      return;
    }
    const state = stateOverride || document.body.dataset.gameState || chainStates.IDLE;
    const show = state === chainStates.RUNNING || state === chainStates.PAUSED;
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
    const state = stateOverride || document.body.dataset.gameState || chainStates.IDLE;
    const show = state === chainStates.RUNNING || state === chainStates.PAUSED;
    wrap.style.display = show ? "" : "none";
  }

  return {
    updatePlayControlsVisibility,
    updateResetRevealVisibility,
    updatePuzzleActionsVisibility,
  };
}
