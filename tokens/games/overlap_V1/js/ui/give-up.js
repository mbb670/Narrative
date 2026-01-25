/*
 * File Overview
 * Purpose: Give-up confirmation modal.
 * Controls: Open/close modal and confirm action.
 * How: Binds modal buttons to reset or cancel flows.
 * Key interactions: Uses play/actions and dom cache.
 */
// Give-up confirm modal helpers.
import { bindDialogDismiss } from "./dialogs.js";

export function createGiveUpModal({
  els,
  fmtTime,
  getUnsolvedWords,
  getUnsolvedLetters,
  hintPenaltySec = 0,
  isAutoCheckEnabled,
} = {}) {
  const formatTime = typeof fmtTime === "function"
    ? fmtTime
    : (sec) => {
        const s = Math.max(0, Math.floor(sec || 0));
        const m = Math.floor(s / 60);
        const rem = s % 60;
        return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
      };

  const getWords = typeof getUnsolvedWords === "function" ? getUnsolvedWords : () => 0;
  const getLetters = typeof getUnsolvedLetters === "function" ? getUnsolvedLetters : () => 0;
  const penaltyPerLetter = Number.isFinite(hintPenaltySec) ? hintPenaltySec : 0;
  const autoCheckEnabled =
    typeof isAutoCheckEnabled === "function" ? isAutoCheckEnabled : () => true;

  bindDialogDismiss(els?.giveUpModal, () => els.giveUpCancel?.click());

  // Shows penalty summary before revealing chain answers.
  function openGiveUpModal() {
    if (!els?.giveUpModal) return;
    const unsolvedWords = Math.max(0, getWords() || 0);
    const unsolvedLetters = Math.max(0, getLetters() || 0);
    const penaltySec = unsolvedLetters * penaltyPerLetter;

    if (els.giveUpUnsolvedLine) els.giveUpUnsolvedLine.hidden = !autoCheckEnabled();
    if (els.giveUpWordsCount) els.giveUpWordsCount.textContent = String(unsolvedWords).padStart(2, "0");
    if (els.giveUpWordLabel) els.giveUpWordLabel.textContent = unsolvedWords === 1 ? "word" : "words";
    if (els.giveUpSeconds) els.giveUpSeconds.textContent = formatTime(penaltySec);

    if (typeof els.giveUpModal.showModal === "function") {
      els.giveUpModal.showModal();
    }

    try {
      els.giveUpConfirm?.focus({ preventScroll: true });
    } catch {}
  }

  function closeGiveUpModal() {
    if (!els?.giveUpModal) return;
    if (typeof els.giveUpModal.close === "function") {
      els.giveUpModal.close();
    }
  }

  return { openGiveUpModal, closeGiveUpModal };
}
