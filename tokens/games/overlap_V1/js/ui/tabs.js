/*
 * File Overview
 * Purpose: Tab switching controller.
 * Controls: Active tab state and panel visibility.
 * How: Binds tab buttons and persists state via view-state.
 * Key interactions: Uses view-state and dom cache.
 */
// Tab switching helpers (single unified view).
import { VIEW } from "../core/config.js";

export function createTabs({
  els,
  getPlay,
  getChain,
  setCurrentView,
  updateKeyboardVisibility,
  ensureCurrentPuzzleMatchesView,
  sliderUI,
  focusForTyping,
  updateResetRevealVisibility,
  updatePlayControlsVisibility,
  updatePuzzleActionsVisibility,
  chainSetUIState,
  ensureChainTick,
  chainUiStates,
} = {}) {
  const getPlaySafe = typeof getPlay === "function" ? getPlay : () => null;
  const getChainSafe = typeof getChain === "function" ? getChain : () => null;
  const setViewSafe = typeof setCurrentView === "function" ? setCurrentView : () => {};
  const updateKeyboard = typeof updateKeyboardVisibility === "function" ? updateKeyboardVisibility : () => {};
  const ensurePuzzleView =
    typeof ensureCurrentPuzzleMatchesView === "function" ? ensureCurrentPuzzleMatchesView : () => {};
  const focusForTypingSafe = typeof focusForTyping === "function" ? focusForTyping : () => {};
  const updateResetReveal =
    typeof updateResetRevealVisibility === "function" ? updateResetRevealVisibility : () => {};
  const updatePlayControls =
    typeof updatePlayControlsVisibility === "function" ? updatePlayControlsVisibility : () => {};
  const updatePuzzleActions =
    typeof updatePuzzleActionsVisibility === "function" ? updatePuzzleActionsVisibility : () => {};
  const setChainUI = typeof chainSetUIState === "function" ? chainSetUIState : () => {};
  const ensureTick = typeof ensureChainTick === "function" ? ensureChainTick : () => {};
  const chainStates = chainUiStates || { IDLE: "idle", RUNNING: "running", PAUSED: "paused", DONE: "done" };

  // Single view: always set play view for layout hooks.
  function setTab(which) {
    const next = VIEW.PLAY;
    setViewSafe(next);

    // "view" controls which puzzle list is active and which UI elements are visible.
    // Global hook for CSS
    if (document?.body) document.body.dataset.view = next;

    els?.panelPlay?.classList.toggle("is-active", true);

    updateKeyboard();

    ensurePuzzleView();
    sliderUI?.updateSliderUI?.();
    focusForTypingSafe();

    updateResetReveal();
    updatePlayControls();
    updatePuzzleActions();

    // Keep chain HUD in sync without resetting state.
    const play = getPlaySafe();
    const chain = getChainSafe();
    const uiState =
      play?.done
        ? chainStates.DONE
        : chain?.running
        ? chainStates.RUNNING
        : chain?.started
        ? chainStates.PAUSED
        : chainStates.IDLE;
    setChainUI(uiState);
    if (chain?.running) ensureTick();
  }

  return { setTab };
}
