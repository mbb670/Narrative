// Puzzle storage helpers (defaults + localStorage merge).
import { KEY } from "../config.js";
import { DEFAULTS_VERSION, DEFAULTS_VER_KEY } from "./defaults.js";

// Remove derived height fields before persisting puzzles (keeps storage stable across layouts).
const stripHeightsFromPuzzles = (arr = []) =>
  arr.map((p) => {
    const { words = [], height, h, dateKey, title, ...restPuzzle } = p || {};
    return {
      ...restPuzzle,
      words: words.map((w) => {
        const { height: wHeight, h: wH, ...rest } = w || {};
        return { ...rest };
      }),
    };
  });

// Create a storage helper bound to current defaults and puzzle state.
export function createStore({ getDefaults, getPuzzles } = {}) {
  return {
    // Merge saved puzzles with shipped defaults; defaults fill any missing items.
    load() {
      const defaultsRaw = typeof getDefaults === "function" ? getDefaults() : [];
      const defaults = structuredClone(defaultsRaw || []);
      try {
        const url = new URL(location.href);
        const forceReset = url.searchParams.has("reset") || url.searchParams.has("fresh");

        const savedDefaultsVer = localStorage.getItem(DEFAULTS_VER_KEY);

        // If defaults changed (or you force reset), discard saved puzzles so you get fresh data files.
        if (forceReset || savedDefaultsVer !== DEFAULTS_VERSION) {
          localStorage.setItem(DEFAULTS_VER_KEY, DEFAULTS_VERSION);
          localStorage.removeItem(KEY);
        }

        const raw = localStorage.getItem(KEY);
        const v = raw ? JSON.parse(raw) : null;

        if (Array.isArray(v) && v.length) {
          const byId = new Map();
          const add = (p, allowOverwrite = true) => {
            const id = String(p?.id || "").trim() || `__noid__${byId.size}`;
            if (!byId.has(id) || allowOverwrite) byId.set(id, p);
          };
          v.forEach((p) => add(p, true));        // saved takes priority
          defaults.forEach((p) => add(p, false)); // fill in any new defaults
          return Array.from(byId.values());
        }

        // No saved puzzles => use shipped defaults
        localStorage.setItem(DEFAULTS_VER_KEY, DEFAULTS_VERSION);
        return defaults;
      } catch {
        return defaults;
      }
    },
    // Persist puzzles (without layout-only data) and the defaults version.
    save() {
      const puzzles = typeof getPuzzles === "function" ? getPuzzles() : [];
      localStorage.setItem(DEFAULTS_VER_KEY, DEFAULTS_VERSION);
      localStorage.setItem(KEY, JSON.stringify(stripHeightsFromPuzzles(puzzles || [])));
    },
  };
}
