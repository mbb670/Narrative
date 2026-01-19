/*
 * File Overview
 * Purpose: Central configuration and constants for the game.
 * Controls: Modes, thresholds, sizes, timing values, and feature flags.
 * How: Exports constant values referenced across core, chain, play, and UI modules.
 * Key interactions: Imported by app.js and most core and UI modules.
 */
// Shared configuration and environment flags for Overlap V1.
// Keep this file DOM-safe; only simple reads from location/navigator.

export const KEY = "overlap_puzzles_v1";
export const SHARE_URL_OVERRIDE = ""; // leave blank to use current page URL; update if you want a fixed share link

// Legacy/default color names mapped to CSS variables (palette-driven colors are preferred).
export const COLORS = [
  ["Red", "--c-red"],
  ["Yellow", "--c-yellow"],
  ["Green", "--c-green"],
  ["Blue", "--c-blue"],
  ["Purple", "--c-purple"],
];

// Height cycle gives each word a stacking height for the layered "overlap" layout.
export const HEIGHT_CYCLE = ["full", "mid", "inner"];

// Game mode is per puzzle; view is the tab selection.
export const MODE = { PUZZLE: "puzzle", CHAIN: "chain" };
export const VIEW = { PLAY: "play", CHAIN: "chain" };

// ---- Remember last tab/view ----
export const LAST_VIEW_KEY = `${KEY}__last_view`;
export const ARCHIVE_RETURN_TIMEOUT_MS = 45 * 60 * 1000;

// URL flags used for debug, FTUE forcing, and splash suppression.
export const DEV_MODE = (() => {
  try {
    const url = new URL(location.href);
    return url.searchParams.has("dev") || url.searchParams.has("devmode");
  } catch {
    return false;
  }
})();

export const SUPPRESS_SPLASH = (() => {
  try {
    const url = new URL(location.href);
    return url.searchParams.get("splash") === "1";
  } catch {
    return false;
  }
})();

export const DEV_DISABLE_AUTOPAUSE = DEV_MODE;

export const FORCE_FTUE = (() => {
  try {
    const url = new URL(location.href);
    return url.searchParams.has("ftue");
  } catch {
    return false;
  }
})();

// iOS detection is used to avoid scroll/overflow changes that Safari dislikes.
export const IS_IOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent || "") ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const FTUE_SEEN_KEY = `${KEY}__ftue_seen`;
export const LAST_PLAYED_CHAIN_KEY = `${KEY}__last_chain_played`;
