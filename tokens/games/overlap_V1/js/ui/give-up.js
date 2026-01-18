// Give-up confirm modal helpers.

export function createGiveUpModal({
  els,
  fmtTime,
  getUnsolvedWords,
  getUnsolvedLetters,
  hintPenaltySec = 0,
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

  // Shows penalty summary before revealing chain answers.
  function openGiveUpModal() {
    if (!els?.giveUpModal) return;
    const unsolvedWords = Math.max(0, getWords() || 0);
    const unsolvedLetters = Math.max(0, getLetters() || 0);
    const penaltySec = unsolvedLetters * penaltyPerLetter;

    if (els.giveUpWordsCount) els.giveUpWordsCount.textContent = String(unsolvedWords).padStart(2, "0");
    if (els.giveUpWordLabel) els.giveUpWordLabel.textContent = unsolvedWords === 1 ? "word" : "words";
    if (els.giveUpSeconds) els.giveUpSeconds.textContent = formatTime(penaltySec);

    els.giveUpModal.hidden = false;
    els.giveUpModal.classList.add("is-open");
    els.giveUpModal.setAttribute("aria-hidden", "false");

    try {
      els.giveUpConfirm?.focus({ preventScroll: true });
    } catch {}
  }

  function closeGiveUpModal() {
    if (!els?.giveUpModal) return;
    els.giveUpModal.classList.remove("is-open");
    els.giveUpModal.hidden = true;
    els.giveUpModal.setAttribute("aria-hidden", "true");
  }

  return { openGiveUpModal, closeGiveUpModal };
}
