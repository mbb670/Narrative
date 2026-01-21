/*
 * File Overview
 * Purpose: View mode controls.
 * Controls: Grid view mode toggles and CSS classes.
 * How: Applies view-state or config-based classes to the DOM.
 * Key interactions: Uses view-state, dom cache, and selection or hints.
 */
// View filtering helpers for play vs chain puzzle lists.

export function createViewHelpers({
  getPuzzles,
  getPuzzleIndex,
  loadPuzzle,
  isDailyChainPuzzle,
  toDateKey,
} = {}) {
  const getList = () => (typeof getPuzzles === "function" ? (getPuzzles() || []) : []);
  const getIdx = () => (typeof getPuzzleIndex === "function" ? getPuzzleIndex() : 0);

  // Single unified view: return all puzzles in order.
  function indicesForView() {
    const puzzles = getList();
    const todayKey = toDateKey(new Date());
    const out = [];
    for (let i = 0; i < puzzles.length; i++) {
      const p = puzzles[i];
      if (isDailyChainPuzzle(p)) {
        if (todayKey && p?.id === todayKey) out.push(i);
      } else {
        out.push(i);
      }
    }
    return out;
  }

  // Locate today's daily chain puzzle if present.
  function findTodayChainIndex() {
    const todayKey = toDateKey(new Date());
    if (!todayKey) return null;
    const puzzles = getList();
    for (let i = 0; i < puzzles.length; i++) {
      const p = puzzles[i];
      if (isDailyChainPuzzle(p) && p.id === todayKey) return i;
    }
    return null;
  }

  function loadByViewOffset(delta) {
    const list = indicesForView();
    if (!list.length) return;

    const pos = list.indexOf(getIdx());
    const at = pos >= 0 ? pos : 0;
    const nextPos = (at + delta + list.length) % list.length;
    loadPuzzle(list[nextPos]);
  }

  // Ensure the currently loaded puzzle aligns with the selected tab.
  function ensureCurrentPuzzleMatchesView() {
    const list = indicesForView();
    if (!list.length) return false;
    if (list.includes(getIdx())) return true;
    loadPuzzle(list[0]);
    return true;
  }

  return {
    indicesForView,
    findTodayChainIndex,
    loadByViewOffset,
    ensureCurrentPuzzleMatchesView,
  };
}
