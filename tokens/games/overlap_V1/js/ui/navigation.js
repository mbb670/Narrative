/*
 * File Overview
 * Purpose: Navigation logic for moving through the grid.
 * Controls: Computes next or prev positions for word or cell.
 * How: Uses model and computed data to select valid targets.
 * Key interactions: Used by nav-controls, keyboard, and grid interactions.
 */
// Cursor/word navigation helpers.
import { MODE } from "../core/config.js";

export function createNavigation({
  getPlay,
  isCellLocked,
  isWordCorrect,
  setAt,
  showRangeFocusForEntry,
  clamp,
  logNav,
  isAutoCheckEnabled,
} = {}) {
  const log = typeof logNav === "function" ? logNav : () => {};
  const autoCheckEnabled =
    typeof isAutoCheckEnabled === "function" ? isAutoCheckEnabled : () => true;

  function entryContainsIndex(e, i) {
    return i >= e.start && i < e.start + e.len;
  }

  function entryAtIndex(i) {
    const play = typeof getPlay === "function" ? getPlay() : null;
    const entries = play?.entries || [];
    const candidates = entries.filter((e) => entryContainsIndex(e, i));
    if (!candidates.length) return null;
    candidates.sort((a, b) => (i - a.start) - (i - b.start) || a.start - b.start);
    return candidates[0];
  }

  function isCellUnresolved(i) {
    const play = typeof getPlay === "function" ? getPlay() : null;
    if (!play) return false;
    if (play.done) return false;
    if (play.mode === MODE.CHAIN) {
      return !isCellLocked(i);
    }
    const exp = play.exp?.[i] || "";
    const usr = play.usr?.[i] || "";
    return exp !== usr;
  }

  // Walk in a direction to find the next editable/incorrect cell.
  function findUnresolvedCell(from, dir) {
    const play = typeof getPlay === "function" ? getPlay() : null;
    if (!play?.exp?.length) return null;
    let i = clamp(from + dir, 0, play.n - 1);
    while (i >= 0 && i < play.n) {
      if (isCellUnresolved(i)) {
        log("findUnresolvedCell hit", { from, dir, i });
        return i;
      }
      i += dir;
    }
    log("findUnresolvedCell none", { from, dir });
    return null;
  }

  function unresolvedEntries() {
    const play = typeof getPlay === "function" ? getPlay() : null;
    return (play?.entries || []).filter((e) => !isWordCorrect(e));
  }

  function firstUnresolvedCellInEntry(e) {
    if (!e) return null;
    for (let i = 0; i < e.len; i++) {
      const idx = e.start + i;
      if (isCellUnresolved(idx)) return idx;
    }
    return e.start; // fallback
  }

  // Word-level navigation; logic differs between overlap vs chain mode.
  function jumpToUnresolvedWord(delta) {
    const play = typeof getPlay === "function" ? getPlay() : null;
    if (!play) return;

    log("jumpToUnresolvedWord start", {
      delta,
      at: play.at,
      currentEntry: entryAtIndex(play.at),
      usr: play.usr?.join(""),
      locked: [...(play.lockedEntries || [])],
    });

    // Overlap mode: always jump by word starts, ignoring correctness/locks (done or not).
    if (play.mode === MODE.PUZZLE) {
      const entries = (play.entries || []).slice().sort((a, b) => a.start - b.start);
      if (!entries.length) return;
      const idx = play.at;
      const containing = entryAtIndex(idx);
      const before = entries.filter((e) => e.start <= idx);
      const cur = containing || (before.length ? before[before.length - 1] : entries[0]);

      let targetEntry = null;
      if (delta > 0) {
        targetEntry = entries.find((e) => e.start > idx) || entries[0];
      } else {
        if (idx !== cur.start) {
          targetEntry = cur;
        } else {
          const prev = [...entries].reverse().find((e) => e.start < idx);
          targetEntry = prev || entries[entries.length - 1];
        }
      }

      const targetCell = targetEntry.start;
      const deltaCells = Math.abs(targetCell - play.at) || 1;
      log("jumpToUnresolvedWord overlap-target", {
        targetCell,
        deltaCells,
        curStart: cur.start,
        targetStart: targetEntry.start,
      });
      setAt(targetCell, { behavior: { behavior: "smooth", delta: deltaCells } });
      showRangeFocusForEntry(targetEntry);
      return;
    }

    // In a finished puzzle, allow word navigation across all entries, including locked/solved.
    if (play.done) {
      const entries = (play.entries || []).slice().sort((a, b) => a.start - b.start);
      if (!entries.length) return;
      const idx = play.at;
      const cur = entryAtIndex(idx) || entries[0];
      const curIdx = entries.findIndex((e) => e === cur);
      const targetEntry =
        delta > 0
          ? entries[(curIdx + 1) % entries.length]
          : entries[(curIdx - 1 + entries.length) % entries.length];

      const targetCell = targetEntry.start;
      const deltaCells = Math.abs(targetCell - play.at) || 1;
      log("jumpToUnresolvedWord done-target", {
        targetCell,
        deltaCells,
        playAt: play.at,
        curStart: cur.start,
        targetStart: targetEntry.start,
      });
      setAt(targetCell, { behavior: { behavior: "smooth", delta: deltaCells } });
      showRangeFocusForEntry(targetEntry);
      return;
    }

    // Chain mode: pick the nearest unresolved word and jump to its first unresolved cell.
    const unsolved = unresolvedEntries().sort((a, b) => a.start - b.start);
    if (!unsolved.length) return;
    const idx = play.at;
    const current = entryAtIndex(idx);

    const targets = unsolved
      .map((entry) => ({ entry, cell: firstUnresolvedCellInEntry(entry) }))
      .filter((t) => t.cell != null)
      .sort((a, b) => a.cell - b.cell);

    if (!targets.length) return;

    const curIdx =
      current && !isWordCorrect(current)
        ? targets.findIndex((t) => t.entry.eIdx === current.eIdx)
        : -1;
    const curFirst = curIdx >= 0 ? targets[curIdx].cell : null;

    log("jumpToUnresolvedWord map", {
      targets: targets.map((t) => ({ eIdx: t.entry.eIdx, start: t.entry.start, cell: t.cell })),
      curIdx,
      curFirst,
    });

    let targetCell = null;
    let targetEntry = null;
    const len = targets.length;

    if (delta > 0) {
      // Always move to the first unresolved cell of the next unresolved word
      const next = targets.find((t) => t.cell > idx);
      const tgt = next || targets[0];
      targetCell = tgt.cell;
      targetEntry = tgt.entry;
    } else {
      // Backward: if we're mid-word, go to this word's first unresolved; otherwise go to previous unresolved word
      if (curIdx >= 0 && idx !== curFirst) {
        targetCell = curFirst;
        targetEntry = targets[curIdx].entry;
      } else {
        const prev = [...targets].reverse().find((t) => t.cell < idx);
        const tgt = prev || targets[len - 1];
        targetCell = tgt.cell;
        targetEntry = tgt.entry;
      }
    }

    if (targetCell == null) return;
    if (targetCell === play.at) return;
    const deltaCells = Math.abs(targetCell - play.at) || 1;
    log("jumpToUnresolvedWord target", {
      targetCell,
      deltaCells,
      curFirst,
      targets: targets.map((t) => ({ eIdx: t.entry.eIdx, start: t.entry.start, cell: t.cell })),
      playAt: play.at,
    });
    setAt(targetCell, { behavior: { behavior: "smooth", delta: deltaCells } });
    if (targetEntry) showRangeFocusForEntry(targetEntry);
  }

  function cellAriaLabel(idx, words = []) {
    const play = typeof getPlay === "function" ? getPlay() : null;
    if (!words || !words.length || !play) return `Cell ${idx + 1}`;

    const sorted = [...words].sort((a, b) => a.start - b.start || a.eIdx - b.eIdx);
    const parts = [];

    for (const w of sorted) {
      const pos = idx - w.start + 1;
      const status =
        play.mode === MODE.CHAIN && autoCheckEnabled()
          ? (play.lockedEntries?.has(w.eIdx) ? "solved" : "unsolved")
          : "";
      const clue = w.clue || "Clue";
      parts.push(`${clue}, cell ${pos} of ${w.len}${status ? `, ${status}` : ""}`);
    }

    return parts.join("; ");
  }

  return {
    entryContainsIndex,
    entryAtIndex,
    isCellUnresolved,
    findUnresolvedCell,
    unresolvedEntries,
    firstUnresolvedCellInEntry,
    jumpToUnresolvedWord,
    cellAriaLabel,
  };
}
