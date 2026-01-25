/*
 * File Overview
 * Purpose: Chain clue visibility and updates.
 * Controls: Clue text and clue UI state for chain mode.
 * How: Updates DOM content based on chain state and selection.
 * Key interactions: Used by chain HUD and app wiring.
 */
// Chain clue helpers (pre-start hiding + cursor-based clue ordering).
import { MODE } from "../core/config.js";

export function createChainClues({
  els,
  getPlay,
  getChain,
} = {}) {
  const getPlayState = () => (typeof getPlay === "function" ? getPlay() : null);
  const getChainState = () => (typeof getChain === "function" ? getChain() : null);

  function entryContainsIndex(e, i) {
    return i >= e.start && i < e.start + e.len;
  }

  // Hide range clues until chain is started (prevents early peeking).
  function setInlineCluesHiddenUntilChainStart() {
    const play = getPlayState();
    const chain = getChainState();
    if (!play || !chain) return;

    const preStart = play.mode === MODE.CHAIN && !chain.started;

    // hard-hide inline clues during pre-start (covers common selectors)
    els?.grid?.querySelectorAll(".rangeClue").forEach((el) => {
      el.classList.toggle("is-hidden", preStart);
    });
  }

  let cluesRaf = 0;
  function requestChainClues() {
    if (cluesRaf) return;
    cluesRaf = requestAnimationFrame(() => {
      cluesRaf = 0;
      updateChainClues();
    });
  }

  function isEntryUnsolvedForClues(e) {
    const play = getPlayState();
    if (!play) return false;
    // Lock is always on in chain mode; unsolved == not locked
    return !play.lockedEntries?.has(e.eIdx);
  }

  // Candidates on current cursor cell, ordered:
  // 1) earlier start first
  // 2) if same start, random (uses e.r)
  function entriesOnCursorCellSorted() {
    const play = getPlayState();
    if (!play) return [];
    const i = play.at;
    const entries = play.entries || [];
    return entries
      .filter((e) => entryContainsIndex(e, i))
      .sort((a, b) => a.start - b.start || a.r - b.r);
  }

  function entryDistanceToIndex(e, i) {
    const a = e.start;
    const b = e.start + e.len - 1;
    return Math.min(Math.abs(a - i), Math.abs(b - i));
  }

  function nearestUnsolvedEntryToCursor() {
    const play = getPlayState();
    if (!play) return null;
    const i = play.at;
    const entries = play.entries || [];
    const unsolved = entries.filter(isEntryUnsolvedForClues);
    if (!unsolved.length) return null;
    unsolved.sort((a, b) => {
      const da = entryDistanceToIndex(a, i);
      const db = entryDistanceToIndex(b, i);
      return da - db || a.start - b.start || a.r - b.r;
    });
    return unsolved[0];
  }

  // Placeholder for chain-specific clue ordering/visibility logic.
  function updateChainClues() {
    // TODO: determine which clues to show based on cursor position and unsolved entries.
  }

  return {
    setInlineCluesHiddenUntilChainStart,
    requestChainClues,
    updateChainClues,
    entriesOnCursorCellSorted,
    nearestUnsolvedEntryToCursor,
    isEntryUnsolvedForClues,
  };
}
