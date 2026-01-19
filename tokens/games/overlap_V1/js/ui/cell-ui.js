// Grid cell rendering helpers.
import { MODE } from "../config.js";

export function createCellUI({
  els,
  getPlay,
  isWordCorrect,
  isCellLocked,
  cellAriaLabel,
  updateSelectedWordUI,
  sliderUI,
  updatePlayControlsVisibility,
  updateSelectAllUI,
  toasts,
} = {}) {
  const getPlayState = () => (typeof getPlay === "function" ? getPlay() : null);

  // Render letters, active state, and cell classes based on current play state.
  function updatePlayUI() {
    const play = getPlayState();
    if (!play || !els?.grid) return;
    const cells = els.grid.querySelectorAll(".cell");
    cells.forEach((c) => {
      const i = +c.dataset.i;
      c.querySelector(".num").textContent = i + 1;
      c.querySelector(".letter").textContent = play.usr[i] || "";
      c.classList.toggle("is-active", i === play.at && !play.done);
      const wordsHere = play.cellWords?.[i] || [];
      // In chain mode, "solved" cells are those fully covered by correct words; locked cells
      // are still correct but visually distinct while a word finishes locking in.
      const fullySolved =
        play.mode === MODE.CHAIN &&
        wordsHere.length > 0 &&
        typeof isWordCorrect === "function" &&
        wordsHere.every((w) => isWordCorrect(w));
      const locked =
        play.mode === MODE.CHAIN &&
        typeof isCellLocked === "function" &&
        isCellLocked(i) &&
        !fullySolved;
      c.classList.toggle("cell-solved", fullySolved);
      c.classList.toggle("cell-locked", locked);
      // apply class for largest height covering this cell
      // Cell height classes are derived from the tallest covering range.
      c.classList.remove(
        "cell-height-full",
        "cell-height-mid",
        "cell-height-inner",
        "cell-range-start",
        "cell-range-end"
      );
      if (wordsHere.length) {
        const priority = { full: 3, mid: 2, inner: 1 };
        const ranked = wordsHere.map((w) => {
          const h = w.h || w.height || "full";
          return { w, h, score: priority[h] || 0 };
        });
        ranked.sort((a, b) => b.score - a.score);
        const topScore = ranked[0]?.score || 0;
        const topHeights = ranked.filter((r) => r.score === topScore);
        const topHeight = topHeights[0]?.h;
        if (topHeight) c.classList.add(`cell-height-${topHeight}`);

        // range start/end flags only if that range shares the top height
        topHeights.forEach(({ w }) => {
          const startIdx = w.start;
          const endIdx = w.start + w.len - 1;
          if (i === startIdx) c.classList.add("cell-range-start");
          if (i === endIdx) c.classList.add("cell-range-end");
        });
      }
      if (typeof cellAriaLabel === "function") {
        c.setAttribute("aria-label", cellAriaLabel(i, wordsHere));
      }
    });
    if (typeof updateSelectedWordUI === "function") updateSelectedWordUI();
    sliderUI?.updateSliderUI?.();
    if (typeof updatePlayControlsVisibility === "function") updatePlayControlsVisibility();
    if (typeof updateSelectAllUI === "function") updateSelectAllUI();
    toasts?.updateWordSolvedCount?.();
  }

  return { updatePlayUI };
}
