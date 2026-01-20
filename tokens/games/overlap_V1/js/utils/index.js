/*
 * File Overview
 * Purpose: Shared utility helpers used throughout the app.
 * Controls: Date formatting, labels, clamps, ids, and type checks.
 * How: Exports small pure functions reused across core, data, and UI modules.
 * Key interactions: Imported across most modules and app.js.
 */
// Shared helpers for string normalization, bounds, IDs, and date parsing.
import { MODE, LAST_PLAYED_CHAIN_KEY } from "../core/config.js";

export const cleanA = (s) => (s || "").toUpperCase().replace(/[^A-Z]/g, "");
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const insets = (h) => (h === "mid" ? [12.5, 12.5] : h === "inner" ? [25, 25] : [0, 0]);
export const isEditable = (el) =>
  !!(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));

// Stable random tie-breaker for entries with the same start position.
const tieR = new WeakMap();
export const tr = (w) => {
  let v = tieR.get(w);
  if (v == null) {
    v = Math.random();
    tieR.set(w, v);
  }
  return v;
};

export const isChainPuzzle = (p) => String(p?.type || MODE.PUZZLE) === MODE.CHAIN;

const DATE_ID_RE = /^\d{4}-\d{2}-\d{2}$/;

// Convert Date to YYYY-MM-DD (UTC-insensitive for labels).
export const toDateKey = (d) => {
  if (!(d instanceof Date) || Number.isNaN(+d)) return null;
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const pad = (n) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(day)}`;
};

export const normalizeDateKey = (val) => {
  const raw = String(val || "").trim();
  if (!raw) return { dateKey: null };

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const y = +iso[1];
    const m = +iso[2];
    const d = +iso[3];
    if (y >= 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return { dateKey: `${iso[1]}-${iso[2]}-${iso[3]}` };
    }
  }

  const mmddyyyy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mmddyyyy) {
    const m = +mmddyyyy[1];
    const d = +mmddyyyy[2];
    const y = +mmddyyyy[3];
    const dt = new Date(y, m - 1, d);
    if (dt && dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) {
      const pad = (n) => String(n).padStart(2, "0");
      return { dateKey: `${y}-${pad(m)}-${pad(d)}` };
    }
  }

  const parsed = new Date(raw);
  const key = toDateKey(parsed);
  return { dateKey: key };
};

export const dateFromKey = (key) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt && dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) return dt;
  return null;
};

export const datePartsFromKey = (key) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { year: y, month: mo, day: d };
};

// Normalize any ID candidate to either a date or a stable string key.
const normalizeIdCandidate = (val) => {
  const raw = String(val ?? "").trim();
  if (!raw) return { id: null, isDate: false };
  const { dateKey } = normalizeDateKey(raw);
  if (dateKey) return { id: dateKey, isDate: true };
  return { id: raw, isDate: DATE_ID_RE.test(raw) };
};

export const getLastPlayedChain = () => {
  try {
    const raw = localStorage.getItem(LAST_PLAYED_CHAIN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const id = String(data.id || "").trim();
    if (!id) return null;
    const at = Number.isFinite(+data.at) ? +data.at : null;
    return { id, isDate: !!data.isDate, at };
  } catch {
    return null;
  }
};

export const setLastPlayedChain = (puzzle) => {
  const norm = normalizePuzzleId(puzzle);
  if (!norm.id) return;
  try {
    localStorage.setItem(
      LAST_PLAYED_CHAIN_KEY,
      JSON.stringify({ id: norm.id, isDate: !!norm.isDate, at: Date.now() })
    );
  } catch {}
};

// Signature used to disambiguate puzzles without explicit IDs.
export const puzzleWordSignature = (p) =>
  (p?.words || [])
    .map((w) => `${cleanA(w.answer)}@${Math.max(1, Math.floor(+w.start || 1))}`)
    .join(";");

// Pick a stable puzzle identifier (prefers explicit ID/date/title).
export const normalizePuzzleId = (p) => {
  const candidates = [p?.id, p?.dateKey, p?.date, p?.title];
  for (const cand of candidates) {
    const norm = normalizeIdCandidate(cand);
    if (norm.id) return norm;
  }
  const sig = puzzleWordSignature(p);
  const fallback = sig || "puzzle";
  return { id: fallback, isDate: DATE_ID_RE.test(fallback) };
};

export const isDateId = (id) => DATE_ID_RE.test(String(id || "").trim());

// Format a date-based puzzle ID for display.
export const puzzleDateLabel = (p) => {
  const raw = typeof p === "string" ? p : p?.id;
  const id = String(raw || "").trim();
  if (!isDateId(id)) return null;
  const dt = dateFromKey(id);
  if (!dt || Number.isNaN(+dt)) return null;
  return dt.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
};

export const puzzleLabel = (p) => {
  const id = String(p?.id || "").trim();
  return id || "Untitled";
};

export const isDailyChainPuzzle = (p) => isChainPuzzle(p) && isDateId(p?.id);
export const isCustomChainPuzzle = (p) => isChainPuzzle(p) && !isDateId(p?.id);
