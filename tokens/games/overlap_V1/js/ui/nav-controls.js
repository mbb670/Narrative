/*
 * File Overview
 * Purpose: Navigation button bindings.
 * Controls: Prev and next word or cell buttons.
 * How: Binds DOM buttons to navigation helpers.
 * Key interactions: Uses navigation and selection.
 */
// Navigation button helpers for cell/word movement.
import { MODE } from "../core/config.js";

export function createNavControls({
  els,
  getPlay,
  setAt,
  findUnresolvedCell,
  jumpToUnresolvedWord,
  clamp,
} = {}) {
  const getPlaySafe = typeof getPlay === "function" ? getPlay : () => null;
  const setAtSafe = typeof setAt === "function" ? setAt : () => {};
  const findUnresolvedSafe = typeof findUnresolvedCell === "function" ? findUnresolvedCell : () => null;
  const jumpWordSafe = typeof jumpToUnresolvedWord === "function" ? jumpToUnresolvedWord : () => {};
  const clampSafe = typeof clamp === "function" ? clamp : (v, min, max) => Math.min(max, Math.max(min, v));

  const navActions = {
    cellPrev: () => {
      const play = getPlaySafe();
      if (!play) return;
      let tgt = null;
      if (play.done || play.mode === MODE.PUZZLE) {
        tgt = clampSafe(play.at - 1, 0, play.n - 1);
      } else {
        tgt = findUnresolvedSafe(play.at, -1);
      }
      if (tgt != null) {
        setAtSafe(tgt, { behavior: { behavior: "smooth", delta: Math.abs(play.at - tgt) || 1 } });
      }
    },
    cellNext: () => {
      const play = getPlaySafe();
      if (!play) return;
      let tgt = null;
      if (play.done || play.mode === MODE.PUZZLE) {
        tgt = clampSafe(play.at + 1, 0, play.n - 1);
      } else {
        tgt = findUnresolvedSafe(play.at, +1);
      }
      if (tgt != null) {
        setAtSafe(tgt, { behavior: { behavior: "smooth", delta: Math.abs(play.at - tgt) || 1 } });
      }
    },
    wordPrev: () => jumpWordSafe(-1),
    wordNext: () => jumpWordSafe(1),
  };

  // Allow nav buttons to repeat when held (pointerdown + interval).
  function attachHoldRepeat(btn, fn) {
    if (!btn || typeof fn !== "function") return;
    let repeatT = null;
    let repeatI = null;
    let suppressClicksUntil = 0;

    const stop = () => {
      if (repeatT) clearTimeout(repeatT);
      if (repeatI) clearInterval(repeatI);
      repeatT = null;
      repeatI = null;
    };

    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      stop();
      suppressClicksUntil = performance.now() + 1000;
      fn();
      repeatT = setTimeout(() => {
        repeatI = setInterval(fn, 120);
      }, 350);
    });

    ["pointerup", "blur"].forEach((ev) => {
      btn.addEventListener(ev, () => stop());
    });

    ["pointercancel", "pointerleave"].forEach((ev) => {
      btn.addEventListener(ev, () => {
        stop();
      });
    });

    btn.addEventListener("click", () => {
      if (performance.now() < suppressClicksUntil) return;
      fn();
    });
  }

  function initNavButtons() {
    attachHoldRepeat(els?.navCellPrev, navActions.cellPrev);
    attachHoldRepeat(els?.navCellNext, navActions.cellNext);
    attachHoldRepeat(els?.navWordPrev, navActions.wordPrev);
    attachHoldRepeat(els?.navWordNext, navActions.wordNext);
  }

  return {
    initNavButtons,
    navActions,
    attachHoldRepeat,
  };
}
