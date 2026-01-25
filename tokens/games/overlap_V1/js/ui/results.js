/*
 * File Overview
 * Purpose: Standard results modal for non-chain puzzles.
 * Controls: Summary display, share button, and close behavior.
 * How: Builds result text from model and stores and binds events.
 * Key interactions: Uses share, toasts, data/store, and utils.
 */
// Results modal helpers.

export function createResultsUI({
  els,
} = {}) {
  // The success overlay is legacy; chain mode uses results modal instead.
  function openSuccess() {
    // Success overlay disabled for play mode; toast handles feedback.
  }

  function closeSuccess() {
    const modal = els?.resultsModal;
    if (!modal) return;
    if (typeof modal.close === "function") modal.close();
    else modal.classList.remove("is-open");
  }
  function setResultsInert() {}

  return {
    openSuccess,
    closeSuccess,
    setResultsInert,
  };
}
