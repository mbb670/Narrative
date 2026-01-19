// Time penalty helpers for chain mode.
import { MODE } from "../config.js";

export function createPenaltyManager({
  els,
  getPlay,
  getChain,
  ensureChainUI,
  fmtTime,
  toasts,
} = {}) {
  const getPlaySafe = typeof getPlay === "function" ? getPlay : () => null;
  const getChainSafe = typeof getChain === "function" ? getChain : () => null;
  const ensureChainUiSafe = typeof ensureChainUI === "function" ? ensureChainUI : () => null;
  const formatTime = typeof fmtTime === "function"
    ? fmtTime
    : (sec) => {
        const s = Math.max(0, Math.floor(sec || 0));
        const m = Math.floor(s / 60);
        const rem = s % 60;
        return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
      };
  const showToast = typeof toasts?.showToast === "function" ? toasts.showToast.bind(toasts) : () => {};

  // Chain mode uses time penalties for hints and "give up" reveals.
  function addTimePenalty(seconds, type = "") {
    const play = getPlaySafe();
    const chain = getChainSafe();
    if (!play || !chain) return;
    if (play.mode !== MODE.CHAIN) return;
    const sec = Math.max(0, Math.round(seconds || 0));
    if (!sec) return;
    if (type === "hint") chain.hintPenaltySecTotal = Math.max(0, (chain.hintPenaltySecTotal || 0) + sec);
    if (type === "word") chain.wordPenaltySecTotal = Math.max(0, (chain.wordPenaltySecTotal || 0) + sec);

    if (chain.running) {
      // Move start backward so elapsed includes penalty immediately
      chain.startAt -= sec * 1000;
      const ui = ensureChainUiSafe();
      const elapsed = (Date.now() - chain.startAt) / 1000;
      chain.elapsed = elapsed;
      if (ui?.timer) ui.timer.textContent = formatTime(elapsed);
    } else {
      chain.elapsed = Math.max(0, (chain.elapsed || 0) + sec);
      const ui = ensureChainUiSafe();
      if (ui?.timer) ui.timer.textContent = formatTime(chain.elapsed);
    }

    if (type === "hint" && els?.toastHint) {
      const txt = String(sec);
      showToast("hint", txt);
    }
  }

  return { addTimePenalty };
}
