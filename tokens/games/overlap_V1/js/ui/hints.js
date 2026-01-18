// Range clue hints + focus overlay helpers.
import { MODE } from "../config.js";

export function createHints({
  els,
  getPlay,
  getChain,
  isCellLocked,
  isWordCorrect,
  clearSelectAll,
  addTimePenalty,
  rebuildLockedCells,
  updateLockedWordUI,
  updatePlayUI,
  triggerSolveAnimation,
  requestChainClues,
  chainMaybeFinishIfSolved,
  requestPersistChainProgress,
  updateResetRevealVisibility,
  updatePlayControlsVisibility,
  updatePuzzleActionsVisibility,
  checkSolvedOverlapOnly,
  chainStartNow,
  hintPenaltySec,
  isTouch,
} = {}) {
  // Range clue tooltips and hint application (fills one correct letter).
  let _rangeHintOpen = null;
  let _rangeHintHideTimer = 0;
  let _rangeHintIntroTimer = 0;
  let _rangeHintIntroClearTimer = 0;
  let rangeFocusEl = null;
  const HINT_OUT_MS = 180;
  let _initialHintIntroQueued = false;
  let _rangeHintPinned = null;

  const isTouchDevice = () => (typeof isTouch === "function" ? !!isTouch() : !!isTouch);

  const focusedRangeEntry = () => {
    const play = getPlay();
    const eIdx = Number(rangeFocusEl?.dataset.e);
    if (Number.isNaN(eIdx)) return null;
    return play.entries.find((x) => x.eIdx === eIdx) || null;
  };

  const isCellInFocusedRange = (i) => {
    const e = focusedRangeEntry();
    if (!e) return false;
    return i >= e.start && i < e.start + e.len;
  };

  function setHintDisplay(rc, visible) {
    const hint = rc?.querySelector(".rangeClue-hint");
    if (!hint) return;
    hint.style.display = visible ? "inline-flex" : "none";
  }

  function scheduleHintDisplayNone(rc, delay = HINT_OUT_MS) {
    if (!rc) return;
    const hint = rc.querySelector(".rangeClue-hint");
    if (!hint) return;
    if (rc.classList.contains("is-hint-visible") || rc.classList.contains("is-hint-intro")) return;
    window.setTimeout(() => {
      if (rc.classList.contains("is-hint-visible") || rc.classList.contains("is-hint-intro")) return;
      hint.style.display = "none";
    }, delay);
  }

  function firstEditableCellInEntry(entry) {
    const play = getPlay();
    if (!entry) return null;
    for (let i = entry.start; i < entry.start + entry.len; i++) {
      if (play.mode === MODE.CHAIN && isCellLocked(i)) continue;
      return i;
    }
    return entry.start;
  }

  function clearRangeHintHideTimer() {
    if (_rangeHintHideTimer) clearTimeout(_rangeHintHideTimer);
    _rangeHintHideTimer = 0;
  }

  function rangeClueEl(eIdx) {
    return els.grid?.querySelector(`.rangeClue[data-e="${eIdx}"]`);
  }

  function hideRangeClueHint(eIdx = _rangeHintOpen) {
    if (eIdx == null) return;
    clearRangeHintHideTimer();
    const rc = rangeClueEl(eIdx);
    if (rc) {
      rc.classList.remove("is-hint-visible");
      scheduleHintDisplayNone(rc);
    }
    if (_rangeHintOpen === eIdx) _rangeHintOpen = null;
    if (_rangeHintPinned === eIdx) _rangeHintPinned = null;
  }

  function hideAllRangeClueHints() {
    clearRangeHintHideTimer();
    _rangeHintOpen = null;
    _rangeHintPinned = null;
    els.grid?.querySelectorAll(".rangeClue").forEach((rc) => {
      rc.classList.remove("is-hint-visible");
      scheduleHintDisplayNone(rc);
    });
  }

  // Show the hint button for a specific range clue.
  function showRangeClueHint(eIdx) {
    const rc = rangeClueEl(eIdx);
    if (!rc || rc.classList.contains("is-hidden")) return;

    hideAllRangeClueHints();

    clearRangeHintHideTimer();
    const hint = rc.querySelector(".rangeClue-hint");
    if (hint) {
      hint.style.display = "inline-flex";
      rc.classList.remove("is-hint-visible", "is-hint-intro");
      void hint.offsetWidth; // ensure transition starts from hidden state
      requestAnimationFrame(() => rc.classList.add("is-hint-visible"));
    }
    _rangeHintOpen = eIdx;
  }

  function scheduleHideRangeClueHint(eIdx, delay = 2200) {
    clearRangeHintHideTimer();
    _rangeHintHideTimer = window.setTimeout(() => hideRangeClueHint(eIdx), delay);
  }

  function ensureRangeFocusEl() {
    if (!rangeFocusEl) {
      rangeFocusEl = document.createElement("div");
      rangeFocusEl.className = "range range-focus";
      rangeFocusEl.hidden = true;
    }
    return rangeFocusEl;
  }

  function hideRangeFocus() {
    if (!rangeFocusEl) return;
    rangeFocusEl.hidden = true;
    rangeFocusEl.style.display = "none";
    rangeFocusEl.dataset.e = "";
    rangeFocusEl.classList.remove("is-active");
  }

  // Highlight the selected word range with a focus overlay.
  function showRangeFocusForEntry(entry) {
    if (!entry) return;
    const el = ensureRangeFocusEl();
    const rangeEl = els.grid?.querySelector(`.range[data-e="${entry.eIdx}"]`);
    const color = entry.color || rangeEl?.style.getPropertyValue("--color") || "var(--c-red)";
    el.hidden = false;
    el.style.display = "grid";
    el.dataset.e = String(entry.eIdx);
    el.style.setProperty("--gs", String(entry.start + 1));
    el.style.setProperty("--ge", String(entry.start + entry.len + 1));
    el.classList.remove("range-full", "range-mid", "range-inner");
    el.classList.add(`range-${entry.h || "full"}`);
    el.style.setProperty("--color", color);
    el.classList.add("is-active");
  }

  function onRangeClueContentOver(e) {
    if (isTouchDevice() || e.pointerType === "touch") return;
    const content = e.target.closest(".rangeClue-content");
    if (!content) return;
    const rc = content.closest(".rangeClue");
    const eIdx = Number(rc?.dataset.e);
    if (Number.isNaN(eIdx)) return;
    setHintDisplay(rc, true);
    clearRangeHintHideTimer();
    if (_rangeHintOpen === eIdx) rc.classList.add("is-hint-visible");
  }

  function onRangeClueContentOut(e) {
    if (isTouchDevice() || e.pointerType === "touch") return;
    const content = e.target.closest(".rangeClue-content");
    if (!content) return;
    const rc = content.closest(".rangeClue");
    const related = e.relatedTarget;
    if (related && related.closest(".rangeClue-content") === content) return;
    const eIdx = Number(rc?.dataset.e);
    if (Number.isNaN(eIdx)) return;
    if (_rangeHintPinned === eIdx) return;
    scheduleHideRangeClueHint(eIdx, 1000);
    scheduleHintDisplayNone(rc, HINT_OUT_MS);
  }

  function resetRangeClueHints() {
    clearRangeHintHideTimer();
    if (_rangeHintIntroTimer) clearTimeout(_rangeHintIntroTimer);
    if (_rangeHintIntroClearTimer) clearTimeout(_rangeHintIntroClearTimer);
    _rangeHintIntroTimer = 0;
    _rangeHintIntroClearTimer = 0;
    hideAllRangeClueHints();
    hideRangeFocus();
  }

  // Intro animation that briefly reveals hint buttons.
  function pulseRangeHintIntro({ delay = 300, duration = 1400 } = {}) {
    const play = getPlay();
    const chain = getChain();
    if (play.mode === MODE.CHAIN && !chain.started) return;
    const clues = els.grid?.querySelectorAll(".rangeClue:not(.is-hidden)") || [];
    if (!clues.length || document.documentElement.classList.contains("chain-prestart")) return;

    if (_rangeHintIntroTimer) clearTimeout(_rangeHintIntroTimer);
    if (_rangeHintIntroClearTimer) clearTimeout(_rangeHintIntroClearTimer);

    _rangeHintIntroTimer = window.setTimeout(() => {
      clues.forEach((rc) => {
        setHintDisplay(rc, true);
        rc.classList.remove("is-hint-visible", "is-hint-intro");
        // force reflow so transition can start from opacity 0
        void rc.offsetWidth;
      });
      requestAnimationFrame(() => {
        clues.forEach((rc) => rc.classList.add("is-hint-intro", "is-hint-visible"));
        _rangeHintIntroClearTimer = window.setTimeout(() => {
          clues.forEach((rc) => {
            rc.classList.remove("is-hint-visible", "is-hint-intro");
            scheduleHintDisplayNone(rc, HINT_OUT_MS);
          });
          _rangeHintOpen = null;
        }, duration);
      });
    }, delay);
  }

  function queueInitialHintIntro(delay = 900) {
    if (_initialHintIntroQueued) return;
    _initialHintIntroQueued = true;
    window.setTimeout(() => pulseRangeHintIntro({ delay: 0 }), delay);
  }

  function firstHintIndex(entry) {
    const play = getPlay();
    if (!entry) return null;
    for (let i = entry.start; i < entry.start + entry.len && i < play.n; i++) {
      if (play.mode === MODE.CHAIN) {
        if (!isCellLocked(i)) return i;
      } else {
        if ((play.usr[i] || "") !== (play.exp[i] || "")) return i;
      }
    }
    return null;
  }

  // Fill one correct cell in a word and apply penalties in chain mode.
  function applyHintForEntry(eIdx) {
    const play = getPlay();
    const chain = getChain();
    clearSelectAll();
    const entry = play.entries.find((x) => x.eIdx === eIdx);
    if (!entry) return;
    const idx = firstHintIndex(entry);
    if (idx == null) return;

    const expected = play.exp[idx] || "";
    const hadCorrectLetter = (play.usr[idx] || "") === expected;
    play.usr[idx] = expected;

    if (play.mode === MODE.CHAIN) {
      if (!chain.started && !play.done) chainStartNow();
      chain.hintsUsed += 1;
      play.lockedCells[idx] = true;
      const penalty = Number.isFinite(+hintPenaltySec) ? +hintPenaltySec : 0;
      const hintPenalty = hadCorrectLetter ? penalty / 2 : penalty;
      addTimePenalty(hintPenalty, "hint");

      let lockedByHint = false;
      if (isWordCorrect(entry)) {
        lockedByHint = !play.lockedEntries.has(entry.eIdx);
        play.lockedEntries.add(entry.eIdx);
        rebuildLockedCells();
      }

      updateLockedWordUI();
      updatePlayUI();
      if (lockedByHint) requestAnimationFrame(() => requestAnimationFrame(() => triggerSolveAnimation(entry)));
      requestChainClues();
      chainMaybeFinishIfSolved();
      requestPersistChainProgress();
    } else {
      updatePlayUI();
      checkSolvedOverlapOnly();
    }

    updateResetRevealVisibility();
    updatePlayControlsVisibility();
    updatePuzzleActionsVisibility();
  }

  function pinRangeClueHint(eIdx) {
    _rangeHintPinned = eIdx;
  }

  return {
    ensureRangeFocusEl,
    resetRangeClueHints,
    isCellInFocusedRange,
    firstEditableCellInEntry,
    showRangeClueHint,
    hideAllRangeClueHints,
    hideRangeFocus,
    showRangeFocusForEntry,
    onRangeClueContentOver,
    onRangeClueContentOut,
    scheduleHideRangeClueHint,
    pulseRangeHintIntro,
    queueInitialHintIntro,
    applyHintForEntry,
    pinRangeClueHint,
  };
}
