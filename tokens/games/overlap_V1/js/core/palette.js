/*
 * File Overview
 * Purpose: Palette lookup and CSS variable application.
 * Controls: Theme colors applied to the document.
 * How: Selects palette values and sets CSS variables on root elements.
 * Key interactions: Used by app.js and settings or theme controls.
 */
// Palette discovery and helpers for puzzle rendering.
import { dateFromKey, isDateId } from "../utils/index.js";

// Palettes are defined in CSS via [data-puzzle-palette="..."] selectors and
// --puzzle-color-<n> variables. JS only selects the active palette id.
const PALETTE_SIZE = 5;
const DOW_PALETTE_IDS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export const paletteIdForPuzzle = (puzzle) => {
  const rawId = typeof puzzle === "string" ? puzzle : puzzle?.id;
  if (!isDateId(rawId)) return null;
  const dt = dateFromKey(rawId);
  if (!dt) return null;
  return DOW_PALETTE_IDS[dt.getUTCDay()] || null;
};

// Pick a palette color by index using CSS variables.
export const paletteColorForWord = (_puzzle, wordIdx) => {
  const idx = ((Number.isFinite(wordIdx) ? wordIdx : 0) % PALETTE_SIZE + PALETTE_SIZE) % PALETTE_SIZE;
  return `var(--puzzle-color-${idx + 1})`;
};

// Apply palette selection to the root element for CSS to consume.
export const applyPaletteToDom = (paletteId) => {
  const target = document.body || document.documentElement;
  const next = String(paletteId || "").trim();
  if (!next) {
    target.removeAttribute("data-puzzle-palette");
    return;
  }
  target.setAttribute("data-puzzle-palette", next);
};
