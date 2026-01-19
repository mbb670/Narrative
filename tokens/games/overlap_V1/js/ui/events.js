// Global event wiring (keyboard, grid, visibility, touch pan).
import { MODE } from "../config.js";

export function bindGlobalEvents({
  els,
  isTouch,
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
  getPlay,
  gridClickGuard,
  panState,
  panSlopPx,
} = {}) {
  function onKey(e) {
    if (ftueIsOpen()) {
      e.preventDefault();
      e.stopImmediatePropagation?.();
      return;
    }
    if (els.resultsModal?.classList.contains("is-open")) return;
    if (e.metaKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      selectAllUnlockedCells();
      return;
    }
    if (e.metaKey || e.ctrlKey) return;

    if (
      isTouch &&
      isKeyboardInputTarget(e.target) &&
      (e.key === "Backspace" || e.key === "ArrowLeft" || e.key === "ArrowRight")
    ) {
      return;
    }

    const t = e.target;
    if (!isKeyboardInputTarget(t) && isEditable(t)) return;

    if (isSelectAllUnlocked() && e.key !== "Backspace" && e.key !== "Delete") {
      clearSelectAll();
    }

    if (e.key === "Backspace") {
      e.preventDefault();
      if (isSelectAllUnlocked()) {
        clearAllUnlockedCells();
        return;
      }
      back();
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      if (isSelectAllUnlocked()) {
        clearAllUnlockedCells();
        return;
      }
      back();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      handleEnterKey();
      return;
    }
    if (e.key === "ArrowLeft") {
      if (e.shiftKey) {
        e.preventDefault();
        jumpToUnresolvedWord(-1);
        return;
      }
      e.preventDefault();
      move(-1, { behavior: { behavior: "smooth", delta: 1 } });
      return;
    }
    if (e.key === "ArrowRight") {
      if (e.shiftKey) {
        e.preventDefault();
        jumpToUnresolvedWord(1);
        return;
      }
      e.preventDefault();
      move(1, { behavior: { behavior: "smooth", delta: 1 } });
      return;
    }
    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      move(1, { behavior: { behavior: "smooth", delta: 1 } });
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const dir = e.shiftKey ? -1 : 1;
      move(dir, { behavior: { behavior: "smooth", delta: 1 } });
      return;
    }
    if (/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      write(e.key.toUpperCase());
    }
  }

  // Keyboard (physical detection + input)
  document.addEventListener(
    "keydown",
    (e) => {
      if (!isTouch || hasHardwareKeyboard()) return;
      if (isKeyboardInputTarget(e.target)) return;
      if (isEditable(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Backspace" || e.key === "ArrowLeft" || e.key === "ArrowRight" || /^[a-zA-Z]$/.test(e.key)) {
        noteHardwareKeyboard();
      }
    },
    true
  );
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "touch") {
        maybeDemoteHardwareKeyboard();
        markInteracted();
      }
    },
    { passive: true }
  );
  document.addEventListener("pointerdown", onGlobalPointerDownForRangeClues, { passive: true });
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", () => sliderUI.updateSliderUI());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) chainPauseIfBackgrounded();
  });
  window.addEventListener("pagehide", chainPauseIfBackgrounded);
  window.addEventListener("blur", chainPauseIfBackgrounded);

  // Focus gate
  els.stage.addEventListener("pointerdown", (e) => {
    markInteracted();
    if (isTouch && e.target.closest("#gridScroll")) return;
    focusForTyping();
  });

  // Grid click
  els.grid.addEventListener("click", onGridCellClick);
  els.grid.addEventListener("pointerover", onRangeClueContentOver);
  els.grid.addEventListener("pointerout", onRangeClueContentOut);
  els.grid.addEventListener("pointerup", onGridPointerUpTouch);

  // Chain clue updates on scroll
  els.gridScroll?.addEventListener(
    "scroll",
    () => {
      const play = getPlay();
      if (play.mode === MODE.CHAIN) requestChainClues();
      sliderUI.updateThumbFromScroll();
    },
    { passive: true }
  );

  // Touch pan detection: prevents follow-scroll + focus from fighting drag.
  if (els.gridScroll) {
    els.gridScroll.addEventListener(
      "pointerdown",
      (e) => {
        if (e.pointerType !== "touch") return;

        panState.isUserPanning = true;
        panState.pointerId = e.pointerId;
        panState.moved = false;
        panState.startX = e.clientX;
        panState.startY = e.clientY;

        sliderUI.cancelSmoothFollow();
      },
      { passive: true }
    );

    els.gridScroll.addEventListener(
      "pointermove",
      (e) => {
        if (!panState.isUserPanning || e.pointerId !== panState.pointerId) return;
        if (panState.moved) return;

        const dx = Math.abs(e.clientX - panState.startX);
        const dy = Math.abs(e.clientY - panState.startY);
        if (dx >= panSlopPx || dy >= panSlopPx) panState.moved = true;
      },
      { passive: true }
    );

    const endPan = (e) => {
      if (e.pointerType !== "touch") return;
      if (e.pointerId !== panState.pointerId) return;

      if (panState.moved) gridClickGuard.value = performance.now() + 250;

      panState.isUserPanning = false;
      panState.pointerId = null;
      panState.moved = false;
    };

    window.addEventListener("pointerup", endPan, { passive: true });
    window.addEventListener("pointercancel", endPan, { passive: true });
  }
}
