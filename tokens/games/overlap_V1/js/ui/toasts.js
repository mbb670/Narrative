/*
 * File Overview
 * Purpose: Toast notification system.
 * Controls: Toast container, timing, and dismissal.
 * How: Creates DOM nodes and manages hide and show timers.
 * Key interactions: Used by share, warnings, results, and settings.
 */
// Toast helpers for game feedback.
import { MODE } from "../core/config.js";

export function createToasts({ els, getPlay, isWordCorrect, isAutoCheckEnabled }) {
  // Toasts are timed UI messages; we track timers per type to avoid overlap flicker.
  const toastTimers = { success: 0, warning: 0, error: 0, hint: 0 };
  let resultsToastTimer = 0;
  const inlineToastTimers = new WeakMap();
  const autoCheckEnabled =
    typeof isAutoCheckEnabled === "function" ? isAutoCheckEnabled : () => true;

  // Parse CSS custom properties that store durations (ms).
  function parseMsVar(val, fallback) {
    if (!val) return fallback;
    const n = parseInt(String(val).trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  // Duration per toast type; driven by CSS variables with sensible defaults.
  function toastDuration(type) {
    const css = getComputedStyle(document.documentElement);
    const raw =
      css.getPropertyValue(`--toast-${type}-duration`) ||
      css.getPropertyValue(`--toast-${type}-duration-ms`);
    return parseMsVar(raw, type === "error" ? 2200 : 2600);
  }

  // Update inline counters for solved words; called by toasts and UI refreshes.
  function updateWordSolvedCount(message) {
    const targets = document.querySelectorAll(".word-solved-count");
    if (!targets.length) return;
    if (!autoCheckEnabled()) {
      targets.forEach((el) => {
        el.textContent = "Hard mode";
      });
      return;
    }
    const play = getPlay();
    let text = message;
    if (!text) {
      if (play.mode === MODE.CHAIN && Array.isArray(play.entries) && play.entries.length) {
        const total = play.entries.length;
        const solved = play.lockedEntries ? play.lockedEntries.size : play.entries.filter(isWordCorrect).length;
        text = `${solved} of ${total}`;
      } else {
        text = "";
      }
    }
    targets.forEach((el) => {
      el.textContent = text;
    });
  }

  // Show a toast and reset its animation by toggling the class.
  function showToast(type, message, duration) {
    const map = {
      success: els.toastSuccess,
      warning: els.toastWarning,
      error: els.toastError,
      wordSolved: els.toastWordSolved,
      hint: els.toastHint,
    };
    const el = map[type];
    if (!el) return;
    if (type === "wordSolved") {
      if (!autoCheckEnabled()) return;
      updateWordSolvedCount(message);
    } else if (type === "hint") {
      const penaltyEl = el.querySelector("#hintPenalty");
      if (penaltyEl && message != null) penaltyEl.textContent = message;
    } else if (message) {
      el.textContent = message;
    }
    const dur = duration ?? toastDuration(type);
    if (toastTimers[type]) clearTimeout(toastTimers[type]);
    el.classList.remove("is-showing");
    void el.offsetWidth; // restart transition
    el.classList.add("is-showing");
    toastTimers[type] = setTimeout(() => el.classList.remove("is-showing"), dur);
  }

  // Inline toast is used in small UI areas (share, results, etc).
  function showInlineToast(el, message) {
    if (!el) return;
    el.textContent = message || "";
    const dur = toastDuration("success");
    const prev = inlineToastTimers.get(el);
    if (prev) clearTimeout(prev);
    el.classList.remove("is-showing");
    void el.offsetWidth;
    el.classList.add("is-showing");
    inlineToastTimers.set(el, setTimeout(() => el.classList.remove("is-showing"), dur));
  }

  // Share feedback prefers inline toasts if a target is provided or results modal is open.
  function showShareToast(message, targetEl) {
    if (targetEl) {
      showInlineToast(targetEl, message);
      return;
    }
    const t = els.resultsModal?.querySelector(".resultsShareToast");
    const resultsOpen = t && els.resultsModal?.classList.contains("is-open");
    if (resultsOpen && t) {
      t.textContent = message;
      const dur = toastDuration("success");
      if (resultsToastTimer) clearTimeout(resultsToastTimer);
      t.classList.remove("is-showing");
      void t.offsetWidth;
      t.classList.add("is-showing");
      resultsToastTimer = setTimeout(() => t.classList.remove("is-showing"), dur);
      return;
    }
    showToast("success", message);
  }

  // Clear all current toasts and timers (useful on reset).
  function clearToasts() {
    ["success", "warning", "error", "wordSolved", "hint"].forEach((type) => {
      if (toastTimers[type]) {
        clearTimeout(toastTimers[type]);
        toastTimers[type] = 0;
      }
      const el =
        type === "success" ? els.toastSuccess :
        type === "warning" ? els.toastWarning :
        type === "error" ? els.toastError :
        type === "wordSolved" ? els.toastWordSolved :
        els.toastHint;
      if (el) el.classList.remove("is-showing");
    });
  }

  return {
    showToast,
    showShareToast,
    clearToasts,
    updateWordSolvedCount,
  };
}
