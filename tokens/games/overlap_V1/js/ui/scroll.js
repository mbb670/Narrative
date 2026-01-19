/*
 * File Overview
 * Purpose: Scroll helpers for keeping the active cell in view.
 * Controls: Scroll position adjustments for the grid container.
 * How: Measures bounding boxes and scrolls to keep selection visible.
 * Key interactions: Used by selection and grid interactions.
 */
// Grid scroll helpers for keeping the active cell in view.
export function createScrollHelpers({
  els,
  getPlay,
  sliderUI,
  isTouch,
  isUserPanning,
} = {}) {
  let _keepInViewRaf = 0;

  const isTouchDevice = () => (typeof isTouch === "function" ? !!isTouch() : !!isTouch);
  const defaultBehavior = () => (isTouchDevice() ? "smooth" : "auto");
  const userPanning = () => (typeof isUserPanning === "function" ? !!isUserPanning() : !!isUserPanning);

  // Center a specific cell in the scroll view.
  function keepCellInView(idx, behavior = defaultBehavior()) {
    const sc = els?.gridScroll;
    if (!sc || sc.scrollWidth <= sc.clientWidth) return;
    if (isTouchDevice() && userPanning()) return;

    let beh = behavior;
    let delta = 1;
    if (typeof behavior === "object") {
      beh = behavior.behavior ?? defaultBehavior();
      delta = behavior.delta ?? 1;
    }

    const cell = els?.grid?.querySelector?.(`.cell[data-i="${idx}"]`);
    if (!cell) return;

    // Center-seeking scroll
    const cellCenter = cell.offsetLeft + cell.offsetWidth / 2;
    let target = cellCenter - sc.clientWidth / 2;

    const max = sc.scrollWidth - sc.clientWidth;
    target = Math.max(0, Math.min(target, max));

    // Tiny deadzone to prevent micro updates from jittering the scroll position.
    if (Math.abs(sc.scrollLeft - target) < 1.5) return;

    // Avoid native smooth jitter on rapid calls
    if (beh === "smooth" && sliderUI?.smoothFollowScrollLeft) {
      const k = delta > 1 ? 0.1 : 0.18; // slower ease on single and multi
      const eps = delta > 1 ? 0.5 : 0.75;
      sliderUI.smoothFollowScrollLeft(sc, target, { k, eps });
    } else {
      sc.scrollLeft = target;
    }
  }

  function keepActiveCellInView(behavior = defaultBehavior()) {
    const play = typeof getPlay === "function" ? getPlay() : null;
    if (!play) return;
    keepCellInView(play.at, behavior);
  }

  function requestKeepActiveCellInView(behavior) {
    if (_keepInViewRaf) return;
    _keepInViewRaf = requestAnimationFrame(() => {
      _keepInViewRaf = 0;
      keepActiveCellInView(behavior);
    });
  }

  // After restore, keep retrying until layout is ready.
  function scrollActiveCellAfterRestore(idx) {
    const play = typeof getPlay === "function" ? getPlay() : null;
    const targetIdx = idx ?? play?.at ?? 0;
    let attempts = 0;
    const MAX_ATTEMPTS = 14;
    const tryScroll = () => {
      const sc = els?.gridScroll;
      const cell = els?.grid?.querySelector?.(`.cell[data-i="${targetIdx}"]`);
      if (!sc || !cell) {
        if (attempts++ < MAX_ATTEMPTS) requestAnimationFrame(tryScroll);
        return;
      }
      const overflow = sc.scrollWidth - sc.clientWidth;
      if (overflow <= 2 && attempts++ < MAX_ATTEMPTS) {
        requestAnimationFrame(tryScroll);
        return;
      }
      keepCellInView(targetIdx, { behavior: "auto", delta: 1 });
      sliderUI?.updateThumbFromScroll?.(true);
    };
    requestAnimationFrame(tryScroll);
  }

  function scrollToWordStart(entry, behavior = defaultBehavior()) {
    if (!entry) return;

    const sc = els?.gridScroll;
    if (!sc || sc.scrollWidth <= sc.clientWidth) return;

    const cell = els?.grid?.querySelector?.(`.cell[data-i="${entry.start}"]`);
    if (!cell) return;

    const pad = 24; // breathing room from left edge
    let target = cell.offsetLeft - pad;

    const max = sc.scrollWidth - sc.clientWidth;
    target = Math.max(0, Math.min(target, max));

    try {
      sc.scrollTo({ left: target, behavior });
    } catch {
      sc.scrollLeft = target;
    }
  }

  return {
    keepCellInView,
    keepActiveCellInView,
    requestKeepActiveCellInView,
    scrollActiveCellAfterRestore,
    scrollToWordStart,
  };
}
