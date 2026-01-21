/*
 * File Overview
 * Purpose: Chain progress and stats persistence.
 * Controls: Daily chain completions, streaks, and summary stats.
 * How: Stores and updates records in localStorage with date keys.
 * Key interactions: Used by chain core, chain results, and app.js.
 */
// Chain progress + stats persistence for per-puzzle storage.
import { KEY, MODE } from "../core/config.js";
import {
  isDateId,
  normalizePuzzleId,
  puzzleWordSignature,
  toDateKey,
} from "../utils/index.js";

const CHAIN_PROGRESS_KEY = `${KEY}__chain_progress_v2`;
const CHAIN_STATS_KEY = `${KEY}__chain_stats_v2`;

const clearLegacyChainStorage = () => {
  const legacy = [`${KEY}__chain_progress_v1`, `${KEY}__chain_stats_v1`];
  try {
    legacy.forEach((k) => localStorage.removeItem(k));
  } catch {}
};

export const todayKey = () => toDateKey(new Date());

// Use puzzle ID + word signature to create a stable key even if ordering changes.
export function chainPuzzleKey(p) {
  if (!p) return null;
  const wordSig = puzzleWordSignature(p);
  const id = normalizePuzzleId(p).id || "no-id";
  return `${MODE.CHAIN}||${id}||${wordSig || "words"}`;
}

// Load progress store and normalize its shape.
export function loadChainProgressStore() {
  clearLegacyChainStorage();
  try {
    const raw = JSON.parse(localStorage.getItem(CHAIN_PROGRESS_KEY) || "{}");
    const base = raw && typeof raw === "object" ? raw : {};
    base.puzzles = base.puzzles && typeof base.puzzles === "object" ? base.puzzles : {};
    return base;
  } catch {
    return { puzzles: {} };
  }
}

export function saveChainProgressStore(store) {
  try {
    localStorage.setItem(CHAIN_PROGRESS_KEY, JSON.stringify(store));
  } catch {}
}

// Daily puzzles expire when a new day starts; remove stale entries.
export function pruneStaleChainProgress() {
  const store = loadChainProgressStore();
  const t = todayKey();
  let changed = false;
  Object.keys(store.puzzles || {}).forEach((k) => {
    const v = store.puzzles[k];
    const savedDay = v?.savedDayKey;
    const id = String(v?.puzzleId || v?.id || "").trim();
    const type = v?.puzzleType || v?.type || null;
    const daily =
      !!v?.puzzleIdIsDate ||
      (String(type || MODE.PUZZLE) === MODE.CHAIN && isDateId(id));
    const isCurrentDaily = daily && t && id === t;
    if (isCurrentDaily && savedDay && savedDay !== t) {
      delete store.puzzles[k];
      changed = true;
    }
  });
  if (changed) saveChainProgressStore(store);
}

// Remove progress for a single puzzle.
export function clearChainProgressForPuzzle(p) {
  const key = chainPuzzleKey(p);
  if (!key) return;
  const store = loadChainProgressStore();
  if (store.puzzles?.[key]) {
    delete store.puzzles[key];
    saveChainProgressStore(store);
  }
}

// Remove all chain progress (used by the clear stats action).
export function clearAllChainProgress() {
  try {
    localStorage.removeItem(CHAIN_PROGRESS_KEY);
  } catch {}
}

// ---- Chain stats (completed games only) ----
// Aggregates completed chain games for the splash screen summary.
function loadChainStatsStore() {
  clearLegacyChainStorage();
  try {
    const raw = JSON.parse(localStorage.getItem(CHAIN_STATS_KEY) || "{}");
    if (!raw || typeof raw !== "object") throw 0;
    raw.puzzles = raw.puzzles && typeof raw.puzzles === "object" ? raw.puzzles : {};
    raw.games = Number.isFinite(raw.games) ? raw.games : 0;
    raw.totalSec = Number.isFinite(raw.totalSec) ? raw.totalSec : 0;
    return raw;
  } catch {
    return { games: 0, totalSec: 0, puzzles: {} };
  }
}

function saveChainStatsStore(store) {
  try {
    localStorage.setItem(CHAIN_STATS_KEY, JSON.stringify(store));
  } catch {}
}

export function clearChainStats() {
  try {
    localStorage.removeItem(CHAIN_STATS_KEY);
  } catch {}
}

// Record completion once per puzzle key (prevents double counting).
export function recordChainCompletionIfNeeded(puzzle, playMode, elapsedSec) {
  const key = chainPuzzleKey(puzzle);
  if (!key || playMode !== MODE.CHAIN) return;
  const store = loadChainStatsStore();
  if (store.puzzles[key]?.done) return;
  const time = Math.max(0, Math.floor(elapsedSec || 0));
  store.puzzles[key] = { done: true, timeSec: time };
  store.games = Math.max(0, (store.games || 0) + 1);
  store.totalSec = Math.max(0, (store.totalSec || 0) + time);
  saveChainStatsStore(store);
}

// Summary used on splash: total games and average time.
export function chainStatsSummary() {
  const store = loadChainStatsStore();
  const games = Math.max(0, store.games || 0);
  const totalSec = Math.max(0, store.totalSec || 0);
  const avgSec = games > 0 ? totalSec / games : 0;
  return { games, totalSec, avgSec };
}
