/*
 * File Overview
 * Purpose: User warnings and guardrails.
 * Controls: Single-shot warning messages for invalid actions.
 * How: Uses toasts to display warnings and rate-limits repeats.
 * Key interactions: Used by keyboard, play/actions, and controls.
 */
// Warning toasts for fully filled but incorrect boards.
import { MODE } from "../core/config.js";

export function createWarningToasts({
  getPlay,
  getUserKey,
  getLastPlayWarningKey,
  getLastChainWarningKey,
  setLastPlayWarningKey,
  setLastChainWarningKey,
  countUnsolvedWords,
  toasts,
} = {}) {
  const getPlaySafe = typeof getPlay === "function" ? getPlay : () => null;
  const getKeySafe = typeof getUserKey === "function" ? getUserKey : () => "";
  const getLastPlay = typeof getLastPlayWarningKey === "function" ? getLastPlayWarningKey : () => "";
  const getLastChain = typeof getLastChainWarningKey === "function" ? getLastChainWarningKey : () => "";
  const setLastPlay = typeof setLastPlayWarningKey === "function" ? setLastPlayWarningKey : () => {};
  const setLastChain = typeof setLastChainWarningKey === "function" ? setLastChainWarningKey : () => {};
  const countUnsolved = typeof countUnsolvedWords === "function" ? countUnsolvedWords : () => 0;
  const showToast = typeof toasts?.showToast === "function" ? toasts.showToast.bind(toasts) : () => {};

  function resetToastGuards() {
    setLastPlay("");
    setLastChain("");
  }

  // Warnings shown when the board is fully filled but incorrect.
  function maybeToastPlayFilledWrong() {
    const play = getPlaySafe();
    if (!play || play.mode !== MODE.PUZZLE || play.done) return;
    const filled = play.usr.every(Boolean);
    if (!filled) {
      setLastPlay("");
      return;
    }
    const key = getKeySafe();
    const allCorrect = play.usr.every((ch, i) => ch === play.exp[i]);
    if (allCorrect) return;
    if (key !== getLastPlay()) {
      showToast("warning", "Not quite: Some or all words are incorrect");
      setLastPlay(key);
    }
  }

  function maybeToastChainFilledWrong() {
    const play = getPlaySafe();
    if (!play || play.mode !== MODE.CHAIN || play.done) return;
    const filled = play.usr.every(Boolean);
    if (!filled) {
      setLastChain("");
      return;
    }
    const key = getKeySafe();
    const unsolved = countUnsolved();
    if (unsolved <= 0) return;
    if (key !== getLastChain()) {
      showToast("warning", `Not quite: ${unsolved} words are incomplete or incorrect`);
      setLastChain(key);
    }
  }

  return {
    maybeToastPlayFilledWrong,
    maybeToastChainFilledWrong,
    resetToastGuards,
  };
}
