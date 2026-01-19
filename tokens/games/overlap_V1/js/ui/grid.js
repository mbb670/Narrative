/*
 * File Overview
 * Purpose: Grid renderer and DOM builder.
 * Controls: Creates grid structure and attaches cell references.
 * How: Builds HTML from model and computed data and caches cells.
 * Key interactions: Uses core/model, core/dom, and cell-ui.
 */
// Grid rendering helpers for puzzles and FTUE boards.
import { paletteColorForWord } from "../core/palette.js";

export function createGridRenderer({
  els,
  getPlay,
  getPuzzles,
  getPuzzleIndex,
  resetRangeClueHints,
  ensureRangeFocusEl,
  cellAriaLabel,
} = {}) {
  const getPlaySafe = typeof getPlay === "function" ? getPlay : () => null;
  const getPuzzlesSafe = typeof getPuzzles === "function" ? getPuzzles : () => [];
  const getPuzzleIndexSafe = typeof getPuzzleIndex === "function" ? getPuzzleIndex : () => 0;
  const resetHints = typeof resetRangeClueHints === "function" ? resetRangeClueHints : () => {};
  const ensureFocusEl = typeof ensureRangeFocusEl === "function" ? ensureRangeFocusEl : () => null;
  const makeAriaLabel = typeof cellAriaLabel === "function" ? cellAriaLabel : () => "";

  // Render the range overlays, clues, and per-cell buttons.
  function renderGrid(target, model, clickable, puzzleForPalette) {
    if (!target || !model) return;
    if (target === els?.grid) resetHints();
    target.innerHTML = "";

    // Track which entries cover each cell (for ARIA + sizing).
    const cellWords = Array.from({ length: model.total }, () => []);

    // Ranges (explicit grid placement). These paint the colored bands behind cells.
    for (const e of model.entries) {
      const d = document.createElement("div");

      const h = e.h || "full";
      d.className = `range range-${h}`;
      d.dataset.e = String(e.eIdx);

      // keep existing vars (safe if other CSS uses them)
      d.style.setProperty("--start", e.start);
      d.style.setProperty("--len", e.len);

      for (let i = e.start; i < e.start + e.len && i < model.total; i++) {
        cellWords[i].push(e);
      }

      // NEW: grid lines are 1-based
      d.style.setProperty("--gs", String(e.start + 1));
      d.style.setProperty("--ge", String(e.start + e.len + 1));

      d.style.setProperty("--color", e.color || "var(--c-red)");
      d.style.setProperty("--f", getComputedStyle(document.documentElement).getPropertyValue("--fill") || ".08");

      target.appendChild(d);

      // Range clue rendered directly in grid; includes a hint button.
      const rc = document.createElement("div");
      rc.className = "rangeClue";
      rc.dataset.e = String(e.eIdx);
      rc.style.setProperty("--gs", String(e.start + 1));
      rc.style.setProperty("--ge", String(e.start + e.len + 1));
      rc.style.setProperty("--color", e.color || "var(--c-red)");

      const row =
        h === "full" ? "1 / 2" :
        h === "mid" ? "2 / 3" :
        h === "inner" ? "3 / 4" : "1 / 2";
      rc.style.gridRow = row;

      const rcContent = document.createElement("div");
      rcContent.className = "rangeClue-content";

      const clueBtn = document.createElement("button");
      clueBtn.type = "button";
      clueBtn.className = "rangeClue-string text-uppercase-semibold-md elevation-active";
      clueBtn.dataset.e = String(e.eIdx);
      clueBtn.textContent = e.clue || "";
      clueBtn.setAttribute("aria-label", `${e.clue || "Clue"} (${e.len} letters)`);

      const hintBtn = document.createElement("button");
      hintBtn.type = "button";
      hintBtn.className = "rangeClue-hint text-uppercase-semibold-md elevation-active";
      hintBtn.dataset.e = String(e.eIdx);
      hintBtn.textContent = "Hint";
      hintBtn.setAttribute("aria-label", `Get a hint for ${e.clue || "this word"}`);

      rcContent.append(clueBtn, hintBtn);
      rc.appendChild(rcContent);
      target.appendChild(rc);
    }

    if (target === els?.grid) {
      const focus = ensureFocusEl();
      if (focus) {
        focus.hidden = true;
        focus.style.removeProperty("--gs");
        focus.style.removeProperty("--ge");
        focus.style.removeProperty("--color");
        focus.classList.remove("range-full", "range-mid", "range-inner");
        focus.classList.remove("is-active");
        focus.style.gridRow = "";
        // Focus overlay sits above ranges and below cells.
        target.appendChild(focus);
      }
    }

    // Cells (MUST explicitly place into columns so they don't get auto-placed after ranges).
    for (let i = 0; i < model.total; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cell text-display-semibold-lg";
      b.dataset.i = i;
      b.disabled = !clickable;
      b.innerHTML = '<span class="num text-uppercase-semibold-md"></span><span class="letter"></span>';
      b.setAttribute("aria-label", makeAriaLabel(i, cellWords[i]));

      // Explicit column placement (1-based)
      b.style.gridColumnStart = String(i + 1);

      target.appendChild(b);
    }

    if (target === els?.grid) {
      const play = getPlaySafe();
      if (play) play.cellWords = cellWords;
    }

    // Ensure ranges always have a color (robust against missing inline vars)
    const ensureColor = (rangeEl) => {
      const existing = (rangeEl?.style?.getPropertyValue("--color") || "").trim();
      if (existing) return;
      const eIdx = Number(rangeEl?.dataset?.e);
      const entry = Number.isFinite(eIdx) ? model.entries.find((e) => e.eIdx === eIdx) : null;
      const puzzles = getPuzzlesSafe();
      const pIdx = getPuzzleIndexSafe();
      const fallbackPuzzle = puzzleForPalette || puzzles[pIdx];
      const fallbackColor = paletteColorForWord(fallbackPuzzle, entry?.rawIdx ?? entry?.eIdx ?? 0);
      rangeEl.style.setProperty("--color", fallbackColor);
    };
    target.querySelectorAll(".range").forEach(ensureColor);
  }

  return { renderGrid };
}
