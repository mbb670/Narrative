// Share helpers for puzzle/chain results.
import { MODE, SHARE_URL_OVERRIDE } from "../config.js";
import { dateFromKey, puzzleLabel } from "../utils.js";

export function createShareUI({
  getPuzzles,
  getPuzzleIndex,
  getChain,
  fmtTime,
  toasts,
} = {}) {
  const formatTime = typeof fmtTime === "function"
    ? fmtTime
    : (sec) => {
        const s = Math.max(0, Math.floor(sec || 0));
        const m = Math.floor(s / 60);
        const rem = s % 60;
        return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
      };

  // Share text and link for either puzzle or chain mode.
  function shareResult({ mode, linkOnly = false, toastEl = null }) {
    const puzzles = typeof getPuzzles === "function" ? (getPuzzles() || []) : [];
    const pIdx = typeof getPuzzleIndex === "function" ? getPuzzleIndex() : 0;
    const chain = typeof getChain === "function" ? (getChain() || {}) : {};
    const puzzle = puzzles[pIdx];

    const formatShareDate = (dt) =>
      dt.toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
    const shareDateLabel = linkOnly
      ? ""
      : (() => {
          const id = typeof puzzle === "string" ? puzzle : puzzle?.id;
          const dt = dateFromKey(id);
          if (dt && !Number.isNaN(+dt)) return formatShareDate(dt);
          const lbl = puzzleLabel(puzzle);
          if (lbl) return lbl;
          return formatShareDate(new Date());
        })();
    const baseUrl =
      SHARE_URL_OVERRIDE && SHARE_URL_OVERRIDE.trim()
        ? SHARE_URL_OVERRIDE.trim()
        : (() => {
            try {
              return location.href;
            } catch {
              return "https://mbb670.github.io/Narrative/tokens/games/overlap_V1/";
            }
          })();

    let msg = linkOnly ? "" : `Overlap | ${shareDateLabel}`;

    if (!linkOnly && mode === MODE.CHAIN) {
      const elapsed = Math.max(0, +chain.lastFinishElapsedSec || 0);
      const timeText = formatTime(elapsed);
      if (timeText) msg += `\nI solved the puzzle in ${timeText}`;
      const hints = Math.max(0, chain.hintsUsed || 0);
      const hintLabel = hints === 1 ? "hint" : "hints";
      if (chain.unsolvedCount > 0 && chain.lastFinishReason !== "solved") {
        msg += ` with ${chain.unsolvedCount} unsolved words`;
        if (hints > 0) msg += ` and ${hints} ${hintLabel}.`;
      } else if (hints > 0) {
        msg += ` with ${hints} ${hintLabel}.`;
      }
    }

    const payload = linkOnly ? { url: baseUrl } : { title: "Overlap", text: msg, url: baseUrl };

    const full = linkOnly ? baseUrl : `${msg}\n${baseUrl}`;

    const isTouch =
      "ontouchstart" in window ||
      navigator.maxTouchPoints > 0 ||
      navigator.userAgentData?.mobile === true;

    const tryClipboard = async (message) => {
      try {
        await navigator.clipboard?.writeText(full);
        if (message && toasts?.showShareToast) toasts.showShareToast(message, toastEl);
        return true;
      } catch {
        return false;
      }
    };

    (async () => {
      // Prefer native share on touch; otherwise fall back to clipboard or alert.
      if (isTouch && navigator.share) {
        try {
          await navigator.share(payload);
          return;
        } catch {
          // on touch, if native share fails, don't alert; silently return
          return;
        }
      }

      const copied = await tryClipboard(isTouch ? null : (linkOnly ? "Copied to clipboard" : "Results copied to clipboard"));
      if (!copied) {
        alert(full);
      }
    })();
  }

  return { shareResult };
}
