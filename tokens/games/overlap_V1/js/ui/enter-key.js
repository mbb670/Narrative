/*
 * File Overview
 * Purpose: Enter key handling.
 * Controls: Submit and advance behavior when enter is pressed.
 * How: Listens to keyboard or UI enter triggers and calls actions.
 * Key interactions: Uses play/actions, selection, and navigation or chain logic.
 */
// Enter-key behavior for puzzle/chain completion warnings.
import { MODE } from "../core/config.js";

export function createEnterKeyHandler({
  getPlay,
  getUserKey,
  setLastPlayWarningKey,
  setLastChainWarningKey,
  toasts,
  checkSolvedOverlapOnly,
  countUnsolvedWords,
  chainMaybeFinishIfSolved,
} = {}) {
  const getPlaySafe = typeof getPlay === "function" ? getPlay : () => null;
  const getKeySafe = typeof getUserKey === "function" ? getUserKey : () => "";
  const setPlayKey = typeof setLastPlayWarningKey === "function" ? setLastPlayWarningKey : () => {};
  const setChainKey = typeof setLastChainWarningKey === "function" ? setLastChainWarningKey : () => {};
  const showToast = typeof toasts?.showToast === "function" ? toasts.showToast.bind(toasts) : () => {};
  const checkSolved = typeof checkSolvedOverlapOnly === "function" ? checkSolvedOverlapOnly : () => {};
  const countUnsolved = typeof countUnsolvedWords === "function" ? countUnsolvedWords : () => 0;
  const maybeFinishChain =
    typeof chainMaybeFinishIfSolved === "function" ? chainMaybeFinishIfSolved : () => {};

  // Enter key triggers solve checks or chain completion warnings.
  function handleEnterKey() {
    const play = getPlaySafe();
    if (!play) return;

    if (play.mode === MODE.PUZZLE) {
      if (play.done) return;
      const filled = play.usr.every(Boolean);
      if (!filled) {
        showToast("error", "Puzzle not complete!");
        return;
      }
      const allCorrect = play.usr.every((ch, i) => ch === play.exp[i]);
      if (allCorrect) {
        checkSolved();
        showToast("success", "Success! You solved the puzzle!");
      } else {
        showToast("warning", "Not quite: Some or all words are incorrect");
        setPlayKey(getKeySafe());
      }
      return;
    }

    // Word chain
    if (play.done) return;
    const hasInput = play.usr.some(Boolean);
    if (!hasInput) return;
    const unsolved = countUnsolved();
    if (unsolved > 0) {
      showToast("warning", `Not quite: ${unsolved} words are incomplete or incorrect`);
      setChainKey(getKeySafe());
    } else {
      maybeFinishChain();
    }
  }

  return { handleEnterKey };
}
