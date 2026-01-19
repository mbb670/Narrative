/*
 * File Overview
 * Purpose: Puzzle model normalization and computed helpers.
 * Controls: Grid dimensions, word and cell lookup, and derived puzzle data.
 * How: Normalizes puzzle input and exposes computed utilities and setters.
 * Key interactions: Used by renderers, play actions, navigation, and chain logic.
 */
// Model + normalization helpers for puzzles and grid layout.
import { HEIGHT_CYCLE, MODE } from "./config.js";
import { cleanA, insets, tr, normalizePuzzleId } from "../utils/index.js";
import { normalizePaletteId, paletteColorForWord } from "./palette.js";

// Normalize word objects from data files.
export const normWord = (w, pType, opts = {}) => {
  const out = {
    clue: String(w?.clue || ""),
    answer: String(w?.answer || ""),
    start: +w?.start || 1,
  };

  return out;
};

// Normalize puzzle records (type, palette, and word list).
export const normPuzzle = (p) => {
  let type = String(p?.type || MODE.PUZZLE).toLowerCase();
  if (type === "overlap") type = MODE.PUZZLE;
  const wordsRaw = Array.isArray(p?.words) ? p.words : [];
  const fallback = { clue: "Clue", answer: "WORD", start: 1 };
  const timed = type === MODE.CHAIN ? false : true;
  const words = (wordsRaw.length ? wordsRaw : [fallback]).map((w) => normWord(w, type, { timed }));
  const { id } = normalizePuzzleId({ ...p, type });

  const out = {
    id,
    // legacy title retained in memory only; UI uses id instead
    title: String(p?.title || ""),
    type,
    palette: normalizePaletteId(p?.palette),
    words,
  };
  return out;
};

// Build a normalized, sortable view of words and the expected letter array.
export function computed(p) {
  let type = String(p?.type || MODE.PUZZLE).toLowerCase();
  if (type === "overlap") type = MODE.PUZZLE;

  // Normalize words into entries with calculated layout + color metadata.
  const entries = (p.words || [])
    .map((w, rawIdx) => {
      const ans = cleanA(w.answer);
      const start = Math.max(0, Math.floor(+w.start || 1) - 1);
      const h = HEIGHT_CYCLE[rawIdx % HEIGHT_CYCLE.length] || "full";
      const [t, b] = insets(h);

      let diff = null;
      const color = paletteColorForWord(p, rawIdx);

      return {
        clue: w.clue || "",
        ans,
        start,
        len: ans.length,
        color,
        t,
        b,
        h,
        r: tr(w),
        rawIdx,
        diff,
      };
    })
    .filter((e) => e.len)
    // Sort by start position, then a stable random tie-breaker to avoid flicker.
    .sort((a, b) => a.start - b.start || a.r - b.r);

  entries.forEach((e, i) => (e.eIdx = i));

  const total = Math.max(1, ...entries.map((e) => e.start + e.len));
  // exp holds the expected letter per cell (null until covered by a word).
  const exp = Array.from({ length: total }, () => null);

  for (const e of entries) {
    for (let i = 0; i < e.len; i++) {
      const idx = e.start + i;
      const ch = e.ans[i];
      // If two words conflict on a letter, mark the puzzle invalid.
      if (exp[idx] && exp[idx] !== ch) {
        return { ok: false, total, exp, entries, conf: { idx, a: exp[idx], b: ch } };
      }
      exp[idx] = ch;
    }
  }

  // Any null positions are gaps (no word covers that column).
  const gaps = exp.map((c, i) => (c ? null : i)).filter((v) => v !== null);
  return { ok: true, total, exp, entries, gaps };
}

// Update CSS grid column count to match puzzle width.
export function setCols(n) {
  document.documentElement.style.setProperty("--cols", String(n));
}
