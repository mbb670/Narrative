/*
 * File Overview
 * Purpose: Core gameplay actions and state mutations.
 * Controls: Typing, cursor movement, reset or reveal, and puzzle load.
 * How: Mutates model state, triggers UI updates, and persists progress.
 * Key interactions: Used by keyboard, grid interactions, enter key, and chain core.
 */
// Core play actions (cursor movement, typing, reset/load).
import { MODE } from "../core/config.js";

export function createPlayActions({
  els,
  isTouch,
  getPlay,
  getPuzzles,
  getPuzzleIndex,
  setPuzzleIndex,
  getCurrentView,
  clamp,
  applyPaletteToDom,
  computed,
  normPuzzle,
  setStatus,
  setCols,
  isChainPuzzle,
  puzzleLabel,
  puzzleDateLabel,
  isArchiveDailyPuzzle,
  updatePlayUI,
  updatePlayControlsVisibility,
  updatePuzzleActionsVisibility,
  updateResetRevealVisibility,
  updateLockedWordUI,
  clearSelectAll,
  clearSelection,
  selectEntry,
  maybeClearSelectionOnCursorMove,
  hideRangeFocus,
  resetRangeClueHints,
  triggerFullSolveAnimation,
  toasts,
  sliderUI,
  keepActiveCellInView,
  requestKeepActiveCellInView,
  scrollToWordStart,
  isCellLocked,
  isWordCorrect,
  chainInputAllowed,
  chainApplyLocksIfEnabled,
  chainMaybeFinishIfSolved,
  chainFinish,
  findNextEditable,
  chooseAutoAdvanceTarget,
  markLockedAutoAdvanceSuppression,
  consumeLockedAutoAdvanceSuppression,
  clearLockedAutoAdvanceSuppressionIfMoved,
  requestChainClues,
  requestPersistChainProgress,
  persistChainProgressImmediate,
  clearChainProgressForPuzzle,
  restoreChainProgressForCurrentPuzzle,
  clearRestoreState,
  chainResetTimer,
  chainStopTimer,
  ensureChainUI,
  getChainUI,
  addTimePenalty,
  hintPenaltySec,
  pulseRangeHintIntro,
  indicesForView,
  closeSuccess,
  closeChainResults,
  resetToastGuards,
  maybeToastChainFilledWrong,
  maybeToastPlayFilledWrong,
  setInlineCluesHiddenUntilChainStart,
  renderGrid,
} = {}) {
  function updateArchiveDateBanner(p = getPuzzles()[getPuzzleIndex()]) {
    if (!els.archiveDate) return;
    const show = isArchiveDailyPuzzle(p);
    if (!show) {
      els.archiveDate.hidden = true;
      els.archiveDate.textContent = "";
      return;
    }
    const label = puzzleDateLabel(p);
    if (!label) {
      els.archiveDate.hidden = true;
      els.archiveDate.textContent = "";
      return;
    }
    els.archiveDate.textContent = label;
    els.archiveDate.hidden = false;
  }

  function setAt(i, { behavior, noScroll } = {}) {
    const play = getPlay();
    clearSelectAll();
    const target = clamp(i, 0, play.n - 1);
    if (target !== play.at) clearLockedAutoAdvanceSuppressionIfMoved(target);
    play.at = target;
    updatePlayUI();
    if (!noScroll) {
      const bh = behavior || (isTouch ? "smooth" : "auto");
      keepActiveCellInView(
        typeof bh === "object" ? bh :
        bh === "smooth" ? { behavior: "smooth", delta: 1 } : bh
      );
    }

    maybeClearSelectionOnCursorMove();
    if (play.mode === MODE.CHAIN) requestChainClues();
    if (play.mode === MODE.CHAIN) requestPersistChainProgress();
  }

  function jumpToEntry(eIdx) {
    const play = getPlay();
    const e = play.entries.find((x) => x.eIdx === eIdx);
    if (!e) return;

    let idx = e.start;
    for (let i = e.start; i < e.start + e.len; i++) {
      if (!play.usr[i]) {
        idx = i;
        break;
      }
    }

    selectEntry(e.eIdx);
    setAt(idx, { behavior: "smooth" });
    scrollToWordStart(e, "smooth");
  }

  function checkSolvedOverlapOnly() {
    const play = getPlay();
    if (play.mode === MODE.CHAIN) return;
    if (!play.usr.every(Boolean)) return;
    if (play.usr.every((ch, i) => ch === play.exp[i])) {
      play.done = true;
      play.revealed = false;
      triggerFullSolveAnimation();
      toasts.showToast("success", "Success! You solved the puzzle!");
      updatePlayControlsVisibility();
    }
  }

  function write(ch) {
    const play = getPlay();
    if (play.done) return;
    if (!chainInputAllowed()) return; // require Start for word chain

    if (play.mode === MODE.CHAIN && isCellLocked(play.at)) {
      // Skip over locked cells; if we just locked one, suppression may hold position briefly.
      if (consumeLockedAutoAdvanceSuppression(play.at)) return;
      const next = findNextEditable(play.at, +1);
      if (next == null) return;
      play.at = next;
    }

    const prevAt = play.at;
    const wasLocked = isCellLocked(prevAt);
    play.usr[play.at] = ch;

    let nextAt = play.at < play.n - 1 ? play.at + 1 : play.at;

    if (play.mode === MODE.CHAIN) {
      chainApplyLocksIfEnabled();
      const lockedNow = isCellLocked(prevAt);
      if (lockedNow && !wasLocked) {
        const decision = chooseAutoAdvanceTarget(prevAt);
        if (decision.suppress) {
          nextAt = prevAt;
          markLockedAutoAdvanceSuppression(prevAt, 2);
        } else if (decision.target != null) {
          nextAt = decision.target;
        } else {
          nextAt = prevAt;
        }
      } else {
        const step = Math.min(play.n - 1, prevAt + 1);
        nextAt = isCellLocked(step) ? prevAt : step;
      }

      play.at = nextAt;
      updatePlayUI();
      maybeToastChainFilledWrong();
      requestKeepActiveCellInView({ behavior: "smooth", delta: Math.abs(nextAt - prevAt) || 1 });
      requestChainClues();
      chainMaybeFinishIfSolved();
      requestPersistChainProgress();
      return;
    }

    play.at = nextAt;
    updatePlayUI();
    maybeToastPlayFilledWrong();
    requestKeepActiveCellInView({ behavior: "smooth", delta: Math.abs(nextAt - prevAt) || 1 });
    checkSolvedOverlapOnly();
  }

  function back() {
    const play = getPlay();
    if (play.done) return;
    if (!chainInputAllowed()) return; // require Start for word chain

    if (play.mode === MODE.CHAIN && isCellLocked(play.at)) {
      const prev = findNextEditable(play.at, -1);
      if (prev != null) play.at = prev;
      updatePlayUI();
      requestKeepActiveCellInView({ behavior: "smooth", delta: 1 });
      return;
    }

    const prevAt = play.at;
    if (play.usr[play.at]) {
      play.usr[play.at] = "";
    } else {
      let prevAt = play.at > 0 ? play.at - 1 : 0;
      if (play.mode === MODE.CHAIN) {
        if (isCellLocked(prevAt)) {
          prevAt = play.at;
        } else {
          const prev = findNextEditable(prevAt, -1);
          if (prev == null) prevAt = play.at;
          else prevAt = prev;
        }
      }
      play.at = prevAt;
      if (play.mode !== MODE.CHAIN || !isCellLocked(play.at)) play.usr[play.at] = "";
    }

    if (play.mode === MODE.CHAIN) {
      updatePlayUI();
      maybeToastChainFilledWrong();
      requestKeepActiveCellInView({ behavior: "smooth", delta: Math.abs(play.at - prevAt) || 1 });
      requestChainClues();
      requestPersistChainProgress();
      return;
    }

    updatePlayUI();
    maybeToastPlayFilledWrong();
    requestKeepActiveCellInView({ behavior: "smooth", delta: Math.abs(play.at - prevAt) || 1 });
  }

  function countUnsolvedWords() {
    const play = getPlay();
    if (!play.entries?.length) return 0;
    return play.entries.filter((e) => !isWordCorrect(e)).length;
  }

  function countUnsolvedLetters() {
    const play = getPlay();
    if (!play.exp?.length || !play.usr?.length) return 0;
    let c = 0;
    for (let i = 0; i < play.exp.length; i++) {
      if ((play.usr[i] || "") !== (play.exp[i] || "")) c++;
    }
    return c;
  }

  function clearAllUnlockedCells() {
    const play = getPlay();
    if (play.done) return;
    if (play.mode === MODE.CHAIN && !chainInputAllowed()) return;

    let changed = false;
    const isLocked = (i) => play.mode === MODE.CHAIN && isCellLocked(i);
    for (let i = 0; i < play.n; i++) {
      if (isLocked(i)) continue;
      if (play.usr[i]) {
        play.usr[i] = "";
        changed = true;
      }
    }
    clearSelectAll();

    const target =
      play.mode === MODE.CHAIN ? findNextEditable(0, +1) ?? 0 : 0;
    setAt(target, { behavior: "smooth" });

    if (changed) {
      if (play.mode === MODE.CHAIN) {
        updatePlayUI();
        requestChainClues();
      } else {
        updatePlayUI();
        checkSolvedOverlapOnly();
      }
      updateResetRevealVisibility();
      updatePlayControlsVisibility();
      updatePuzzleActionsVisibility();
    } else {
      updatePlayUI();
    }
  }

  function move(d, opts = {}) {
    const play = getPlay();
    if (!chainInputAllowed()) return;

    let target = clamp(play.at + d, 0, play.n - 1);

    if (play.mode === MODE.CHAIN && !play.done) {
      const dir = d >= 0 ? +1 : -1;
      const nxt = findNextEditable(target, dir);
      if (nxt != null) target = nxt;
    }

    const delta = Math.abs(target - play.at) || 1;
    const bh = opts.behavior || { behavior: "smooth", delta };
    setAt(target, { behavior: bh });
  }

  function resetPlay(opts = {}) {
    const play = getPlay();
    const puzzles = getPuzzles();
    const pIdx = getPuzzleIndex();
    const { clearPersist = true } = opts;
    play.usr = Array.from({ length: play.n }, () => "");
    play.at = 0;
    play.done = false;
    play.revealed = false;
    play.fullSolveAnimated = false;
    resetToastGuards();
    toasts.clearToasts();
    clearSelectAll();
    resetRangeClueHints();

    play.lockedEntries.clear();
    play.lockedCells = Array.from({ length: play.n }, () => false);

    updateLockedWordUI();
    clearSelection();

    updatePlayUI();
    closeSuccess();
    closeChainResults();

    if (play.mode === MODE.CHAIN) {
      if (clearPersist) clearChainProgressForPuzzle(puzzles[pIdx]);
      const ui = ensureChainUI();
      ui.startBtn.style.display = "";
      chainResetTimer();
      setInlineCluesHiddenUntilChainStart();
    } else {
      setInlineCluesHiddenUntilChainStart();
    }

    sliderUI.cancelSmoothFollow();
    if (els.gridScroll) els.gridScroll.scrollLeft = 0;
    setAt(0, { behavior: "none", noScroll: true });
  }

  function revealPlay() {
    const play = getPlay();
    if (play.mode === MODE.CHAIN) {
      const unsolved = countUnsolvedWords();
      const unsolvedLetters = countUnsolvedLetters();
      if (unsolvedLetters > 0) addTimePenalty(unsolvedLetters * hintPenaltySec, "word");
      play.usr = play.exp.slice();
      chainFinish("reveal", { unsolved });
      persistChainProgressImmediate();
      return;
    }

    play.usr = play.exp.slice();
    play.done = true;
    play.revealed = true;
    updatePlayUI();
    updatePlayControlsVisibility();
  }

  function loadPuzzle(i) {
    const play = getPlay();
    const puzzles = getPuzzles();
    closeSuccess();
    closeChainResults();
    chainStopTimer();
    sliderUI.bindGridScrollCancels();
    sliderUI.cancelSmoothFollow();

    if (!puzzles.length) return;

    const nextIdx = ((i % puzzles.length) + puzzles.length) % puzzles.length;
    setPuzzleIndex(nextIdx);
    puzzles[nextIdx] = normPuzzle(puzzles[nextIdx]);

    const p = puzzles[nextIdx];
    applyPaletteToDom(p.palette);
    const m = computed(p);
    setStatus(m);

    play.mode = isChainPuzzle(p) ? MODE.CHAIN : MODE.PUZZLE;
    play.entries = m.entries;

    setCols(m.total);

    play.exp = m.exp.map((c) => c || "");
    play.n = m.total;
    play.usr = Array.from({ length: play.n }, () => "");
    play.at = 0;
    play.done = false;
    play.revealed = false;
    play.fullSolveAnimated = false;
    resetToastGuards();
    toasts.clearToasts();
    clearSelectAll();
    hideRangeFocus();

    play.lockedEntries.clear();
    play.lockedCells = Array.from({ length: play.n }, () => false);
    clearSelection();

    renderGrid(els.grid, m, true, puzzles[nextIdx]);
    sliderUI.updateSliderUI();


    if (play.mode === MODE.CHAIN) {
      const ui = ensureChainUI();
      ui.hud.hidden = false;
      ui.startBtn.style.display = "";

      chainResetTimer();
      setInlineCluesHiddenUntilChainStart();

    } else {
      const ui = getChainUI();
      if (ui) ui.hud.hidden = true;
      if (els.reveal) els.reveal.style.display = "";

      setInlineCluesHiddenUntilChainStart();
      pulseRangeHintIntro();
    }
    updateResetRevealVisibility();

    const list = indicesForView(getCurrentView());
    const pos = list.indexOf(nextIdx);
    const posText = list.length ? `${(pos >= 0 ? pos : 0) + 1} / ${list.length}` : `1 / ${puzzles.length}`;

    els.meta.replaceChildren(
      document.createTextNode(puzzleLabel(p)),
      document.createTextNode(" "),
      Object.assign(document.createElement("span"), { textContent: `• ${posText}` })
    );

    updateArchiveDateBanner(p);
    updatePlayUI();
    updatePlayControlsVisibility();
    updatePuzzleActionsVisibility();

    if (els.gridScroll) els.gridScroll.scrollLeft = 0;

    const restored = play.mode === MODE.CHAIN ? restoreChainProgressForCurrentPuzzle() : false;
    if (!restored) {
      clearRestoreState();
      setAt(0, { behavior: "none", noScroll: true });
    }
  }

  return {
    updateArchiveDateBanner,
    setAt,
    jumpToEntry,
    checkSolvedOverlapOnly,
    write,
    back,
    clearAllUnlockedCells,
    countUnsolvedWords,
    countUnsolvedLetters,
    move,
    resetPlay,
    revealPlay,
    loadPuzzle,
  };
}
