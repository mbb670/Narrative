/*
 * File Overview
 * Purpose: Chain word locking rules.
 * Controls: Lock state for words and cells and their UI classes.
 * How: Tracks locked positions and updates grid and selection visuals.
 * Key interactions: Used by chain core, grid UI, and selection.
 */
// Chain locking + solve animation helpers.
import { MODE } from "../core/config.js";

export function createChainLocks({
  els,
  getPlay,
  sliderUI,
  toasts,
  isWordCorrect,
  getSelectedEntry,
  clearSelection,
  requestPersistChainProgress,
} = {}) {
  const getPlayState = () => (typeof getPlay === "function" ? getPlay() : null);

  // In chain mode, correct words lock and become non-editable.
  function isCellLocked(i) {
    const play = getPlayState();
    if (!play || !Array.isArray(play.lockedCells)) return false;
    return !!play.lockedCells[i];
  }

  // Rebuild lockedCells array from lockedEntries (plus any hint-locked cells).
  function rebuildLockedCells() {
    const play = getPlayState();
    if (!play) return;
    const prev = Array.isArray(play.lockedCells) ? play.lockedCells.slice() : [];
    play.lockedCells = Array.from({ length: play.n }, () => false);
    if (play.mode !== MODE.CHAIN) {
      for (let i = 0; i < Math.min(play.n, prev.length); i++) {
        if (prev[i]) play.lockedCells[i] = true;
      }
      return;
    }
    for (const eIdx of play.lockedEntries) {
      const e = play.entries.find((x) => x.eIdx === eIdx);
      if (!e) continue;
      for (let i = e.start; i < e.start + e.len; i++) play.lockedCells[i] = true;
    }
    // preserve individually locked cells (e.g., via hints)
    for (let i = 0; i < Math.min(play.n, prev.length); i++) {
      if (prev[i]) play.lockedCells[i] = true;
    }
  }

  // Animate a word's letters and range when it becomes locked.
  function triggerSolveAnimation(entry) {
    const play = getPlayState();
    if (!entry || !play || play.mode !== MODE.CHAIN || !els?.grid) return;
    const letters = [];
    for (let i = entry.start; i < entry.start + entry.len; i++) {
      const cell = els.grid.querySelector(`.cell[data-i="${i}"]`);
      const letter = cell?.querySelector(".letter");
      if (letter) letters.push(letter);
    }
    letters.forEach((letter, idx) => {
      letter.classList.remove("solve-anim");
      letter.style.setProperty("--solve-delay", `${idx * 80}ms`);
      // force reflow to restart animation
      void letter.offsetWidth;
      letter.classList.add("solve-anim");
      letter.addEventListener(
        "animationend",
        () => {
          letter.classList.remove("solve-anim");
          letter.style.removeProperty("--solve-delay");
        },
        { once: true }
      );
    });

    const rangeEl = els.grid.querySelector(`.range[data-e="${entry.eIdx}"]`);
    if (rangeEl) {
      rangeEl.classList.remove("range-solve-anim");
      void rangeEl.offsetWidth;
      rangeEl.classList.add("range-solve-anim");
      rangeEl.addEventListener(
        "animationend",
        () => {
          rangeEl.classList.remove("range-solve-anim");
        },
        { once: true }
      );
    }
  }

  function triggerFullSolveAnimation() {
    const play = getPlayState();
    if (!play || play.mode !== MODE.PUZZLE || !els?.grid || play.fullSolveAnimated) return;
    const letters = Array.from(els.grid.querySelectorAll(".cell .letter")).sort((a, b) => {
      const pa = a.closest(".cell");
      const pb = b.closest(".cell");
      const ia = pa ? +pa.dataset.i : 0;
      const ib = pb ? +pb.dataset.i : 0;
      return ia - ib;
    });
    letters.forEach((letter, idx) => {
      letter.classList.remove("solve-anim");
      letter.style.setProperty("--solve-delay", `${idx * 80}ms`);
      void letter.offsetWidth;
      letter.classList.add("solve-anim");
      letter.addEventListener(
        "animationend",
        () => {
          letter.classList.remove("solve-anim");
          letter.style.removeProperty("--solve-delay");
        },
        { once: true }
      );
    });
    play.fullSolveAnimated = true;
  }

  // Toggle locked styling for ranges and refresh slider segments.
  function updateLockedWordUI() {
    const play = getPlayState();
    if (!play || !els?.grid) return;
    els.grid.querySelectorAll(".range").forEach((r) => {
      const eIdx = +r.dataset.e;
      const locked = play.mode === MODE.CHAIN && play.lockedEntries.has(eIdx);
      r.classList.toggle("is-locked", locked);
    });
    sliderUI?.updateSliderUI?.();
  }

  // Lock any newly correct words and trigger solve animations.
  function chainApplyLocksIfEnabled() {
    const play = getPlayState();
    if (!play || play.mode !== MODE.CHAIN) return;

    let changed = false;
    const newlyLocked = [];

    for (const e of play.entries) {
      if (play.lockedEntries.has(e.eIdx)) continue;
      if (typeof isWordCorrect === "function" && isWordCorrect(e)) {
        play.lockedEntries.add(e.eIdx);
        changed = true;
        newlyLocked.push(e);
      }
    }

    if (changed) {
      rebuildLockedCells();
      updateLockedWordUI();
      const selected = typeof getSelectedEntry === "function" ? getSelectedEntry() : null;
      if (selected != null && play.lockedEntries.has(selected) && typeof clearSelection === "function") {
        clearSelection();
      }
      if (newlyLocked.length) {
        // Delay animations so the DOM has updated locked classes.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => newlyLocked.forEach((entry) => {
            triggerSolveAnimation(entry);
            const solved = play.lockedEntries.size;
            const total = play.entries.length;
            toasts?.showToast?.("wordSolved", `${solved} of ${total}`);
          }))
        );
      }
      if (typeof requestPersistChainProgress === "function") requestPersistChainProgress();
    }
  }

  return {
    isCellLocked,
    rebuildLockedCells,
    updateLockedWordUI,
    triggerSolveAnimation,
    triggerFullSolveAnimation,
    chainApplyLocksIfEnabled,
  };
}
