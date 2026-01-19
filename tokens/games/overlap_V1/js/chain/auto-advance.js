/*
 * File Overview
 * Purpose: Auto-advance behavior for chain input.
 * Controls: Moves active cell or word after input and respects locks.
 * How: Computes next positions and suppresses advances when needed.
 * Key interactions: Used by play/actions and selection or navigation.
 */
// Chain auto-advance helpers (lock suppression + target selection).

export function createChainAutoAdvance({
  getPlay,
  isCellLocked,
  isWordCorrect,
  entryAtIndex,
  unresolvedEntries,
  findUnresolvedCell,
  firstEditableCellInEntry,
} = {}) {
  const getPlayState = () => (typeof getPlay === "function" ? getPlay() : null);
  const isCorrect = typeof isWordCorrect === "function" ? isWordCorrect : () => false;
  const entryAt = typeof entryAtIndex === "function" ? entryAtIndex : () => null;
  const unresolved = typeof unresolvedEntries === "function"
    ? unresolvedEntries
    : () => {
        const play = getPlayState();
        return (play?.entries || []).filter((e) => !isCorrect(e));
      };
  const findUnresolved =
    typeof findUnresolvedCell === "function" ? findUnresolvedCell : () => null;
  const firstEditable =
    typeof firstEditableCellInEntry === "function"
      ? firstEditableCellInEntry
      : (entry) => (entry ? entry.start : null);

  const lockedAutoAdvanceSuppression = { idx: null, remaining: 0 };

  function markLockedAutoAdvanceSuppression(idx, count = 2) {
    lockedAutoAdvanceSuppression.idx = idx;
    lockedAutoAdvanceSuppression.remaining = Math.max(0, count);
  }

  function consumeLockedAutoAdvanceSuppression(idx) {
    if (
      lockedAutoAdvanceSuppression.remaining > 0 &&
      lockedAutoAdvanceSuppression.idx === idx &&
      (typeof isCellLocked === "function" ? isCellLocked(idx) : false)
    ) {
      lockedAutoAdvanceSuppression.remaining -= 1;
      return true;
    }
    return false;
  }

  function clearLockedAutoAdvanceSuppressionIfMoved(newIdx) {
    if (lockedAutoAdvanceSuppression.idx != null && lockedAutoAdvanceSuppression.idx !== newIdx) {
      lockedAutoAdvanceSuppression.idx = null;
      lockedAutoAdvanceSuppression.remaining = 0;
    }
  }

  // Find the next editable cell in a given direction.
  function findNextEditable(from, dir) {
    const play = getPlayState();
    if (!play) return null;
    let i = from;
    while (i >= 0 && i < play.n) {
      if (!(typeof isCellLocked === "function" ? isCellLocked(i) : false)) return i;
      i += dir;
    }
    return null;
  }

  // Decide where to move after a cell becomes locked (chain mode).
  function chooseAutoAdvanceTarget(prevIdx) {
    const play = getPlayState();
    if (!play) return { target: prevIdx, suppress: false };

    // Strategy: prefer forward progress, but avoid jumping into locked/solved words.
    const currentEntry = entryAt(prevIdx);
    const ordered = (play.entries || []).slice().sort((a, b) => a.start - b.start);
    const curPos = currentEntry ? ordered.findIndex((e) => e.eIdx === currentEntry.eIdx) : -1;
    const prevEntry = curPos > 0 ? ordered[curPos - 1] : null;
    const nextEntry = curPos >= 0 && curPos < ordered.length - 1 ? ordered[curPos + 1] : null;

    const prevSolved = prevEntry == null ? null : isCorrect(prevEntry);
    const nextSolved = nextEntry == null ? null : isCorrect(nextEntry);

    const nextUnresolvedRight = findUnresolved(prevIdx, +1);
    const unsolved = unresolved().sort((a, b) => a.start - b.start);
    const editableRight = findNextEditable(prevIdx + 1, +1);
    const editableLeft = findNextEditable(prevIdx - 1, -1);

    let firstUnsolvedRight = unsolved.find((e) => e.start > (currentEntry?.start ?? -Infinity));
    let firstUnsolvedLeft = [...unsolved].reverse().find((e) => e.start < (currentEntry?.start ?? Infinity));

    // Fallback: if we didn't find an unsolved entry but there is an editable cell right/left, treat its entry as unsolved.
    if (!firstUnsolvedRight && editableRight != null && editableRight > prevIdx) {
      const e = entryAt(editableRight);
      if (e && !isCorrect(e)) firstUnsolvedRight = e;
    }
    if (!firstUnsolvedLeft && editableLeft != null && editableLeft < prevIdx) {
      const e = entryAt(editableLeft);
      if (e && !isCorrect(e)) firstUnsolvedLeft = e;
    }

    // If the word on the right is solved, decide whether and where to jump.
    if (nextSolved) {
      if (firstUnsolvedRight) {
        // Unsovled exists to the right
        if (prevSolved !== false) {
          // Case: prev solved + next solved + unsolved to the right -> jump right.
          const tgt =
            nextUnresolvedRight != null ? nextUnresolvedRight :
            firstEditable(firstUnsolvedRight);
          return { target: tgt, suppress: false };
        }
        // Case: prev unsolved + next solved -> stay put.
        return { target: null, suppress: true };
      }

      // No unsolved to the right; if any unsolved to the left, jump left (regardless of prev solved).
      if (!firstUnsolvedRight && firstUnsolvedLeft) {
        // But if there is an editable cell to the right, honor it instead of jumping left.
        if (nextUnresolvedRight != null && nextUnresolvedRight > prevIdx) {
          return { target: nextUnresolvedRight, suppress: false };
        }
        if (editableRight != null && editableRight > prevIdx) {
          return { target: editableRight, suppress: false };
        }
        return { target: firstEditable(firstUnsolvedLeft), suppress: false };
      }
    }

    // If there is no word to the right (end of chain) but unsolved remains to the left, jump left.
    if (!nextEntry && firstUnsolvedLeft) {
      // But if there is an editable cell to the right, prefer it.
      if (editableRight != null && editableRight > prevIdx) {
        return { target: editableRight, suppress: false };
      }
      return { target: firstEditable(firstUnsolvedLeft), suppress: false };
    }

    // Default behavior: step forward to the next editable cell if available.
    const fallback = findNextEditable(prevIdx + 1, +1);
    return { target: fallback != null ? fallback : prevIdx, suppress: false };
  }

  return {
    findNextEditable,
    chooseAutoAdvanceTarget,
    markLockedAutoAdvanceSuppression,
    consumeLockedAutoAdvanceSuppression,
    clearLockedAutoAdvanceSuppressionIfMoved,
  };
}
