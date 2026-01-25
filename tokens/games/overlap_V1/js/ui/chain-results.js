/*
 * File Overview
 * Purpose: Chain results modal.
 * Controls: End-of-chain summary, share actions, and close flow.
 * How: Builds summary data and binds modal events.
 * Key interactions: Uses chain-progress, share, toasts, and app callbacks.
 */
// Chain results modal helpers.
import { MODE } from "../core/config.js";
import { bindDialogDismiss, setAppLock } from "./dialogs.js";
import { puzzleDateLabel, puzzleLabel } from "../utils/index.js";

export function createChainResults({
  els,
  getPlay,
  getChain,
  getPuzzles,
  getPuzzleIndex,
  fmtTime,
  setResultsInert,
  shareResult,
  onOverlayClose,
} = {}) {
  const formatTime = typeof fmtTime === "function"
    ? fmtTime
    : (sec) => {
        const s = Math.max(0, Math.floor(sec || 0));
        const m = Math.floor(s / 60);
        const rem = s % 60;
        return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
      };

  let chainResults = null;

  function closeChainResults() {
    if (!chainResults) return;
    const wasOpen = !!chainResults.wrap.open;
    if (typeof chainResults.wrap.close === "function") {
      if (wasOpen) chainResults.wrap.close();
    }
    else chainResults.wrap.classList.remove("is-open");
    if (typeof setResultsInert === "function") setResultsInert(false);
    if (wasOpen) setAppLock(false);
  }

  function ensureChainResults() {
    if (chainResults) return chainResults;

    const wrap = els?.resultsModal;
    if (!wrap) return null;

    const cClose = els?.resultsClose;
    const cShare = els?.resultsShare;

    bindDialogDismiss(wrap, () => {
      if (typeof onOverlayClose === "function") onOverlayClose();
      closeChainResults();
    });
    cClose?.addEventListener("click", closeChainResults);
    cShare?.addEventListener("click", () => {
      if (typeof shareResult === "function") shareResult({ mode: MODE.CHAIN });
    });

    chainResults = {
      wrap,
      title: wrap.querySelector(".resultsTitle"),
      subtitle: wrap.querySelector(".resultsSubtitle"),
      statTime: wrap.querySelector(".resultsStatTimeVal"),
      statSolved: wrap.querySelector(".resultsStatSolvedVal"),
      statHints: wrap.querySelector(".resultsStatHintsVal"),
      pluralHints: wrap.querySelector("#pluralHints"),
      cClose,
      cShare,
    };
    return chainResults;
  }

  // Populate and display the results modal.
  function openChainResults(stats, reason) {
    const r = ensureChainResults();
    if (!r) return;
    const wasOpen = !!r.wrap.open;
    if (typeof r.wrap.showModal === "function") {
      if (!wasOpen) r.wrap.showModal();
    } else r.wrap.classList.add("is-open");
    if (typeof setResultsInert === "function") setResultsInert(true);
    if (!wasOpen) setAppLock(true);

    const play = typeof getPlay === "function" ? getPlay() : null;
    const chain = typeof getChain === "function" ? getChain() : null;
    const puzzles = typeof getPuzzles === "function" ? (getPuzzles() || []) : [];
    const pIdx = typeof getPuzzleIndex === "function" ? getPuzzleIndex() : 0;

    const tSec = Math.max(0, Math.floor(chain?.lastFinishElapsedSec || 0));
    const total = play?.entries?.length || 0;
    const solved = Math.max(0, total - Math.max(0, chain?.unsolvedCount || 0));
    const allSolved = (chain?.unsolvedCount || 0) === 0;

    r.wrap.setAttribute("data-result", allSolved ? "solved" : "partial");
    r.title.textContent = allSolved ? "Success!" : "Overlap";

    const p = puzzles[pIdx];
    const label =
      puzzleDateLabel(p) ||
      puzzleLabel(p) ||
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    r.subtitle.textContent = label;

    r.statTime.textContent = formatTime(tSec);
    r.statSolved.textContent = `${solved}/${total}`;
    const hintCount = Math.max(0, chain?.hintsUsed || 0);
    r.statHints.textContent = String(hintCount);
    if (r.pluralHints) r.pluralHints.style.display = hintCount === 1 ? "none" : "";
    const hintPenalty = Math.max(0, chain?.hintPenaltySecTotal || 0);
    const wordPenalty = Math.max(0, chain?.wordPenaltySecTotal || 0);
    if (els?.totalHintPenalty) {
      els.totalHintPenalty.textContent = formatTime(hintPenalty);
      if (els.totalHintPenalty.parentElement) {
        els.totalHintPenalty.parentElement.style.display = hintPenalty > 0 ? "" : "none";
      }
    }
    if (els?.totalWordPenalty) {
      els.totalWordPenalty.textContent = formatTime(wordPenalty);
      if (els.totalWordPenalty.parentElement) {
        els.totalWordPenalty.parentElement.style.display = wordPenalty > 0 ? "" : "none";
      }
    }
  }

  return {
    openChainResults,
    closeChainResults,
  };
}
