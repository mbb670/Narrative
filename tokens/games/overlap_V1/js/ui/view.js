/*
 * File Overview
 * Purpose: View mode controls.
 * Controls: Grid view mode toggles and CSS classes.
 * How: Applies view-state or config-based classes to the DOM.
 * Key interactions: Uses view-state, dom cache, and selection or hints.
 */
// View filtering helpers for play vs chain puzzle lists.
import { VIEW } from "../core/config.js";

export function createViewHelpers({
  getPuzzles,
  getPuzzleIndex,
  getCurrentView,
  loadPuzzle,
  isChainPuzzle,
  isDailyChainPuzzle,
  toDateKey,
} = {}) {
  const getList = () => (typeof getPuzzles === "function" ? (getPuzzles() || []) : []);
  const getIdx = () => (typeof getPuzzleIndex === "function" ? getPuzzleIndex() : 0);
  const getView = () => (typeof getCurrentView === "function" ? getCurrentView() : VIEW.CHAIN);

  // "Play" shows overlap puzzles; "Chain" shows chain puzzles (daily and custom).
  function indicesForView(v = getView()) {
    const wantChain = v === VIEW.CHAIN;
    const out = [];
    const puzzles = getList();
    for (let i = 0; i < puzzles.length; i++) {
      const p = puzzles[i];
      const isCh = isChainPuzzle(p);
      if (wantChain ? isCh : !isCh) out.push(i);
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
    const list = indicesForView(getView());
    if (!list.length) return;

    const pos = list.indexOf(getIdx());
    const at = pos >= 0 ? pos : 0;
    const nextPos = (at + delta + list.length) % list.length;
    loadPuzzle(list[nextPos]);
  }

  // Ensure the currently loaded puzzle aligns with the selected tab.
  function ensureCurrentPuzzleMatchesView() {
    const list = indicesForView(getView());
    if (!list.length) return false;
    if (getView() === VIEW.CHAIN) {
      const todayIdx = findTodayChainIndex();
      if (todayIdx != null) {
        if (getIdx() !== todayIdx) {
          loadPuzzle(todayIdx);
          return true;
        }
        return true;
      }
    }
    if (list.includes(getIdx())) return true;
    if (getView() === VIEW.CHAIN) {
      const todayIdx = findTodayChainIndex();
      if (todayIdx != null) {
        loadPuzzle(todayIdx);
        return true;
      }
    }
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
