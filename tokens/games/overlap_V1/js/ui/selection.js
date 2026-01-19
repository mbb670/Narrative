/*
 * File Overview
 * Purpose: Selection state and highlighting.
 * Controls: Active cell or word, selection classes, and focus.
 * How: Stores selection state and updates DOM classes.
 * Key interactions: Used by navigation, grid interactions, keyboard, and hints.
 */
// Range selection + select-all helpers for the grid.
import { MODE } from "../core/config.js";

export function createSelectionUI({
  els,
  getPlay,
  isCellLocked,
  entryContainsIndex,
} = {}) {
  const getPlaySafe = typeof getPlay === "function" ? getPlay : () => null;
  const isLocked = typeof isCellLocked === "function" ? isCellLocked : () => false;
  const containsIndex =
    typeof entryContainsIndex === "function"
      ? entryContainsIndex
      : (e, i) => i >= e.start && i < e.start + e.len;

  let selectedEntry = null;
  let selectAllUnlocked = false;

  // Toggle selected range highlight.
  function updateSelectedWordUI() {
    const grid = els?.grid;
    if (!grid) return;
    grid.querySelectorAll(".range").forEach((r) => {
      r.classList.toggle("is-selected", selectedEntry != null && r.dataset.e === String(selectedEntry));
    });
  }

  // Select-all is a visual state; it does not lock cells.
  function updateSelectAllUI() {
    const play = getPlaySafe();
    if (!play || !els?.grid) return;
    els.grid.querySelectorAll(".cell").forEach((c) => {
      const i = +c.dataset.i;
      const locked = play.mode === MODE.CHAIN && isLocked(i);
      c.classList.toggle("is-select-all", selectAllUnlocked && !locked);
    });
  }

  function selectEntry(eIdx) {
    selectedEntry = eIdx;
    updateSelectedWordUI();
  }

  function clearSelection() {
    selectedEntry = null;
    updateSelectedWordUI();
  }

  function clearSelectAll() {
    if (!selectAllUnlocked) return;
    selectAllUnlocked = false;
    updateSelectAllUI();
  }

  function selectAllUnlockedCells() {
    selectAllUnlocked = true;
    updateSelectAllUI();
  }

  function maybeClearSelectionOnCursorMove() {
    if (selectedEntry == null) return;
    const play = getPlaySafe();
    if (!play) return;
    const e = play.entries.find((x) => x.eIdx === selectedEntry);
    if (!e) return clearSelection();

    const isLockedEntry = play.mode === MODE.CHAIN && play.lockedEntries.has(selectedEntry);
    if (isLockedEntry) return;

    if (!containsIndex(e, play.at)) clearSelection();
  }

  const getSelectedEntry = () => selectedEntry;
  const isSelectAllUnlocked = () => selectAllUnlocked;

  return {
    updateSelectedWordUI,
    updateSelectAllUI,
    selectEntry,
    clearSelection,
    clearSelectAll,
    selectAllUnlockedCells,
    maybeClearSelectionOnCursorMove,
    getSelectedEntry,
    isSelectAllUnlocked,
  };
}
