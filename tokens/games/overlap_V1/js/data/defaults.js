// Default puzzle loading + JSON fetch helper.
import { KEY } from "../config.js";

export const DEFAULTS_VERSION = "2026-01-26"; // <-- bump this any time you edit puzzle data layout
export const DEFAULTS_VER_KEY = `${KEY}__defaults_version`;

const JSON_FETCH_OPTS = { cache: "no-store" };

// Fetch JSON with a safe fallback (no caching so daily updates show up immediately).
export async function fetchJson(url, fallback = null) {
  try {
    const res = await fetch(url, JSON_FETCH_OPTS);
    if (!res?.ok) throw new Error(`Failed ${url}`);
    return await res.json();
  } catch {
    return fallback;
  }
}

// Given a list of JSON file paths, return a single flattened array.
async function loadJsonArraysFromList(baseUrl, paths = []) {
  const results = await Promise.all(
    paths.map(async (p) => {
      const url = new URL(p, baseUrl);
      const data = await fetchJson(url, []);
      return Array.isArray(data) ? data : [];
    })
  );
  return results.flat();
}

// Non-chain puzzles (overlap mode) are loaded from the puzzles data folder.
async function loadPuzzleModeDefaults() {
  const base = new URL("../../data/puzzles/", import.meta.url);
  const manifest = await fetchJson(new URL("../../data/puzzles/index.json", import.meta.url), null);
  const list =
    Array.isArray(manifest?.files) ? manifest.files :
    Array.isArray(manifest) ? manifest :
    ["Initial_group/initial.json"];
  return loadJsonArraysFromList(base, list);
}

// Non-daily chain content (FTUE, custom packs, etc).
async function loadChainOtherDefaults() {
  const base = new URL("../../data/chain/other/", import.meta.url);
  const manifest = await fetchJson(new URL("../../data/chain/other/index.json", import.meta.url), null);
  const list =
    Array.isArray(manifest?.files) ? manifest.files :
    Array.isArray(manifest) ? manifest :
    ["util/ftue.json", "custom/personal.json"];
  return loadJsonArraysFromList(base, list);
}

// Daily chain puzzles are grouped by month for smaller fetches.
async function loadDailyChainDefaults(date = new Date()) {
  const base = new URL("../../data/chain/daily/", import.meta.url);
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const monthPath = `${y}/${String(m).padStart(2, "0")}.json`;
  return loadJsonArraysFromList(base, [monthPath]);
}

// Load all default puzzle sources in parallel.
export async function loadDefaultPuzzles() {
  const [daily, chainOther, puzzleModes] = await Promise.all([
    loadDailyChainDefaults(),
    loadChainOtherDefaults(),
    loadPuzzleModeDefaults(),
  ]);
  return [...daily, ...chainOther, ...puzzleModes];
}
