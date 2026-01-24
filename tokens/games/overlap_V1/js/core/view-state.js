/*
 * File Overview
 * Purpose: Persisted view state wrapper.
 * Controls: Last view, active tab selection, and related UI flags.
 * How: Reads and writes localStorage keys and exposes getters and setters.
 * Key interactions: Used by tabs, view controls, and app.js wiring.
 */
// View selection + tab state helpers.
import { VIEW } from "./config.js";

// Reads last open tab from storage with a safe fallback.
export function loadLastView() {
  return VIEW.PLAY;
}

export function createTabState() {
  let tabManager = null;
  return {
    setTabManager: (manager) => {
      tabManager = manager;
    },
    setTab: (which, opts) => {
      tabManager?.setTab(which, opts);
    },
  };
}
