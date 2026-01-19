// View selection + tab state helpers.
import { LAST_VIEW_KEY, VIEW } from "./config.js";

// Reads last open tab from storage with a safe fallback.
export function loadLastView() {
  try {
    const v = localStorage.getItem(LAST_VIEW_KEY);
    return v === VIEW.PLAY || v === VIEW.CHAIN ? v : VIEW.CHAIN;
  } catch {
    return VIEW.CHAIN;
  }
}

export function createTabState() {
  let tabManager = null;
  return {
    setTabManager: (manager) => {
      tabManager = manager;
    },
    setTab: (which) => {
      tabManager?.setTab(which);
    },
  };
}
