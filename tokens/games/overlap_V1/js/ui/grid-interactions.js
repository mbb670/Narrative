/*
 * File Overview
 * Purpose: Grid pointer and touch interactions.
 * Controls: Cell selection, focus, and tap behavior.
 * How: Attaches listeners to grid cells and calls selection or actions.
 * Key interactions: Uses selection, play/actions, and scroll helpers.
 */
// Grid interaction handlers (click/touch/hint/clue).
import { MODE } from "../core/config.js";

export function createGridInteractions({
  els,
  getPlay,
  getChain,
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
  isTouch,
  ignoreGridClickUntil,
} = {}) {
  const getPlaySafe = typeof getPlay === "function" ? getPlay : () => null;
  const getChainSafe = typeof getChain === "function" ? getChain : () => null;
  const startChain = typeof chainStartNow === "function" ? chainStartNow : () => {};
  const resumeChain = typeof chainResume === "function" ? chainResume : () => {};
  const clearSelectAllSafe = typeof clearSelectAll === "function" ? clearSelectAll : () => {};
  const markInteractedSafe = typeof markInteracted === "function" ? markInteracted : () => {};
  const focusForTypingSafe = typeof focusForTyping === "function" ? focusForTyping : () => {};
  const applyHintSafe = typeof applyHintForEntry === "function" ? applyHintForEntry : () => {};
  const showClueSafe = typeof showRangeClueHint === "function" ? showRangeClueHint : () => {};
  const pinClueSafe = typeof pinRangeClueHint === "function" ? pinRangeClueHint : () => {};
  const showFocusSafe = typeof showRangeFocusForEntry === "function" ? showRangeFocusForEntry : () => {};
  const firstEditableSafe = typeof firstEditableCellInEntry === "function" ? firstEditableCellInEntry : () => null;
  const setAtSafe = typeof setAt === "function" ? setAt : () => {};
  const hideHintsSafe = typeof hideAllRangeClueHints === "function" ? hideAllRangeClueHints : () => {};
  const hideFocusSafe = typeof hideRangeFocus === "function" ? hideRangeFocus : () => {};
  const isCellFocusedRange = typeof isCellInFocusedRange === "function" ? isCellInFocusedRange : () => false;
  const scheduleHideSafe =
    typeof scheduleHideRangeClueHint === "function" ? scheduleHideRangeClueHint : () => {};
  const isTouchDevice = !!isTouch;
  const guardRef = ignoreGridClickUntil || { value: 0 };

  const setIgnoreUntil = (ms) => {
    guardRef.value = ms;
  };

  // Main grid interaction handler (clue buttons + cell selection).
  function onGridCellClick(e) {
    if (isTouchDevice && performance.now() < guardRef.value) return;

    const play = getPlaySafe();
    if (!play) return;

    // Hint and clue buttons take precedence over cell clicks.
    const hintBtn = e.target.closest(".rangeClue-hint");
    if (hintBtn) {
      const eIdx = Number(hintBtn.dataset.e || hintBtn.closest(".rangeClue")?.dataset.e);
      if (!Number.isNaN(eIdx)) {
        markInteractedSafe();
        focusForTypingSafe();
        applyHintSafe(eIdx);
      }
      return;
    }

    const clueBtn = e.target.closest(".rangeClue-string");
    if (clueBtn) {
      const eIdx = Number(clueBtn.dataset.e || clueBtn.closest(".rangeClue")?.dataset.e);
      if (!Number.isNaN(eIdx)) {
        markInteractedSafe();
        focusForTypingSafe();
        showClueSafe(eIdx);
        pinClueSafe(eIdx);
        const entry = play.entries.find((x) => x.eIdx === eIdx);
        showFocusSafe(entry);
        const targetCell = firstEditableSafe(entry);
        if (targetCell != null) setAtSafe(targetCell, { behavior: "smooth" });
        if (isTouchDevice) setIgnoreUntil(performance.now() + 500);
      }
      return;
    }

    const cell = e.target.closest(".cell");
    if (!cell) {
      hideHintsSafe();
      hideFocusSafe();
      return;
    }

    clearSelectAllSafe();
    markInteractedSafe();
    focusForTypingSafe();

    const i = +cell.dataset.i;
    const chain = getChainSafe() || {};
    if (play.mode === MODE.CHAIN && !chain.started && !play.done) {
      // First interaction starts the chain timer.
      startChain();
    } else if (play.mode === MODE.CHAIN && chain.started && !chain.running && !play.done) {
      // Resume if the chain was paused.
      resumeChain();
    }

    hideHintsSafe();
    if (!isCellFocusedRange(i)) hideFocusSafe();
    setAtSafe(i, { behavior: "smooth" });
  }

  function onGridPointerUpTouch(e) {
    if (e.pointerType !== "touch") return;
    // Touch pointerup is used to avoid the delayed click on some mobile browsers.
    const hintBtn = e.target.closest(".rangeClue-hint");
    if (hintBtn) {
      e.preventDefault();
      const eIdx = Number(hintBtn.dataset.e || hintBtn.closest(".rangeClue")?.dataset.e);
      if (!Number.isNaN(eIdx)) {
        markInteractedSafe();
        focusForTypingSafe();
        applyHintSafe(eIdx);
        setIgnoreUntil(performance.now() + 500);
      }
      return;
    }

    const clueBtn = e.target.closest(".rangeClue-string");
    if (clueBtn) {
      e.preventDefault();
      const eIdx = Number(clueBtn.dataset.e || clueBtn.closest(".rangeClue")?.dataset.e);
      if (!Number.isNaN(eIdx)) {
        markInteractedSafe();
        focusForTypingSafe();
        showClueSafe(eIdx);
        pinClueSafe(eIdx);
        const play = getPlaySafe();
        const entry = play?.entries?.find((x) => x.eIdx === eIdx);
        showFocusSafe(entry);
        const targetCell = firstEditableSafe(entry);
        if (targetCell != null) setAtSafe(targetCell, { behavior: "smooth" });
        setIgnoreUntil(performance.now() + 500);
      }
      return;
    }
  }

  function onGridRangeCluePointerOut(e) {
    const rc = e.target.closest(".rangeClue");
    if (!rc) return;
    const related = e.relatedTarget;
    if (related && related.closest(".rangeClue") === rc) return;
    const eIdx = Number(rc.dataset.e);
    if (Number.isNaN(eIdx)) return;
    scheduleHideSafe(eIdx, 1000);
  }

  function onGlobalPointerDownForRangeClues(e) {
    // Click-away handler to dismiss hint popovers and focus overlays.
    if (e.target.closest(".puzzle-nav")) return;
    if (e.target.closest("#navWordPrev") || e.target.closest("#navWordNext")) return;
    if (e.target.closest(".rangeClue") || e.target.closest(".range-focus")) return;
    const cell = e.target.closest(".cell");
    if (cell && isCellFocusedRange(Number(cell.dataset.i))) return;
    hideHintsSafe();
    hideFocusSafe();
  }

  return {
    onGridCellClick,
    onGridPointerUpTouch,
    onGridRangeCluePointerOut,
    onGlobalPointerDownForRangeClues,
  };
}
