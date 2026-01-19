// Chain timing + penalty helpers.
import { createPenaltyManager } from "../ui/penalties.js";

export const HINT_PENALTY_SEC = 10;

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function createChainTiming({
  els,
  getPlay,
  getChain,
  ensureChainUI,
  toasts,
} = {}) {
  const { addTimePenalty } = createPenaltyManager({
    els,
    getPlay,
    getChain,
    ensureChainUI,
    fmtTime,
    toasts,
  });

  return { addTimePenalty, fmtTime, hintPenaltySec: HINT_PENALTY_SEC };
}
