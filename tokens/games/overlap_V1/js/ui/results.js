// Results modal helpers.
import { IS_IOS } from "../config.js";

export function createResultsUI({
  els,
} = {}) {
  // The success overlay is legacy; chain mode uses results modal instead.
  function openSuccess() {
    // Success overlay disabled for play mode; toast handles feedback.
  }

  function closeSuccess() {
    els?.resultsModal?.classList.remove("is-open");
  }

  const resultsInertBlock = (e) => {
    if (!document.body?.hasAttribute("data-results-open")) return;
    if (e.target && e.target.closest && e.target.closest("#results")) return;
    e.stopPropagation();
    e.preventDefault();
  };
  let resultsInertActive = false;

  // Trap focus/interaction when results modal is open.
  function setResultsInert(isOpen) {
    const body = document.body;
    const root = document.documentElement;
    if (!body) return;
    body.toggleAttribute("data-results-open", isOpen);
    if (isOpen && !resultsInertActive) {
      // Capture events to prevent interactions outside the modal.
      window.addEventListener("focus", resultsInertBlock, true);
      window.addEventListener("pointerdown", resultsInertBlock, true);
      window.addEventListener("keydown", resultsInertBlock, true);
      resultsInertActive = true;
      if (!IS_IOS) body.style.overflow = "hidden";
    } else if (!isOpen && resultsInertActive) {
      window.removeEventListener("focus", resultsInertBlock, true);
      window.removeEventListener("pointerdown", resultsInertBlock, true);
      window.removeEventListener("keydown", resultsInertBlock, true);
      resultsInertActive = false;
      if (!IS_IOS) body.style.overflow = "";
    }
    root?.classList.toggle("results-open", isOpen);
  }

  return {
    openSuccess,
    closeSuccess,
    setResultsInert,
  };
}
