/*
 * File Overview
 * Purpose: First-time user experience overlay.
 * Controls: FTUE modal steps and persistence.
 * How: Shows or hides steps and records completion in storage.
 * Key interactions: Uses dom cache and settings or controls triggers.
 */
// First-time user experience (FTUE) demo and modal flow.
import { FORCE_FTUE, FTUE_SEEN_KEY, IS_IOS, MODE } from "../core/config.js";

export function createFtue({
  els,
  getPuzzles,
  computed,
  renderGrid,
  clamp,
  getPlay,
  getChain,
  chainSetUIState,
  chainUiStates,
  chainProgressSummary,
  isAutoCheckEnabled,
} = {}) {
  const getPuzzlesSafe = typeof getPuzzles === "function" ? getPuzzles : () => [];
  const compute = typeof computed === "function" ? computed : () => null;
  const renderGridSafe = typeof renderGrid === "function" ? renderGrid : () => {};
  const clampSafe = typeof clamp === "function" ? clamp : (v, min, max) => Math.min(max, Math.max(min, v));
  const getPlaySafe = typeof getPlay === "function" ? getPlay : () => null;
  const getChainSafe = typeof getChain === "function" ? getChain : () => null;
  const autoCheckEnabled =
    typeof isAutoCheckEnabled === "function" ? isAutoCheckEnabled : () => true;
  const setChainUI = typeof chainSetUIState === "function" ? chainSetUIState : () => {};
  const chainStates = chainUiStates || { IDLE: "idle", RUNNING: "running", PAUSED: "paused", DONE: "done" };
  const getChainSummary =
    typeof chainProgressSummary === "function" ? chainProgressSummary : () => ({ state: "default", solved: 0, total: 0 });

  // First-time user experience is a scripted demo board with timed typing animations.
  const FTUE_STEPS = [
    {
      title: "Solve each clue to fill a block",
      desc: "Type in a block to fill the answer. Once correct, the letters are locked in.",
      tip: "Tip: Start anywhere in the puzzle.",
    },
    {
      title: "Neighboring blocks share letters",
      desc: "Stuck? Try a nearby block. Shared letters will help fill in the gaps.",
      tip: "Tip: Tap a clue to reveal a hint.",
    },
    {
      title: "Complete the chain to finish the puzzle",
      desc: "Solve every word to complete the chain. Speed counts!",
      tip: "Tip: A new puzzle drops every day.",
    },
  ];

  let ftueStep = 0;
  let ftueDialogTimer = null;
  let ftueShowTimer = null;
  let ftueNavBlockedUntil = 0;
  let ftueTouchStart = null;
  // FTUE demo state is independent from the real play state.
  const ftueDemo = {
    puzzle: null,
    model: null,
    usr: [],
    at: 0,
    timers: [],
    lockedEntries: new Set(),
    paused: false,
    solvedCells: new Set(),
  };
  const FTUE_DIALOG_DELAY = 500;
  const FTUE_NAV_COOLDOWN = 10;
  const FTUE_SWIPE_THRESHOLD = 40;
  const FTUE_TIMING = {
    typeStep: 600,
    stepStartDelay: [1000, 300, 1200], // per-step start delays (0,1,2)
    stepEndDelay: [7000, 5000, 10000], // per-step end delays (0,1,2)
    step3MidPause: 2000,
  };

  // Modal state helpers for FTUE.
  const ftueIsOpen = () => !!els?.ftueModal?.classList.contains("is-open");
  let _ftuePrevOverflow = "";
  // Prevent interaction with the live board while FTUE is open.
  function ftueDisableInteractions() {
    _ftuePrevOverflow = document.body.style.overflow;
    if (!IS_IOS) document.body.style.overflow = "hidden";
    if (els?.stage) els.stage.style.pointerEvents = "none";
    if (els?.gridScroll) els.gridScroll.style.pointerEvents = "none";
    if (els?.keyboard) els.keyboard.style.pointerEvents = "none";
  }
  function ftueEnableInteractions() {
    document.body.style.overflow = _ftuePrevOverflow || "";
    if (els?.stage) els.stage.style.pointerEvents = "";
    if (els?.gridScroll) els.gridScroll.style.pointerEvents = "";
    if (els?.keyboard) els.keyboard.style.pointerEvents = "";
  }

  // FTUE persistence flags (localStorage).
  const hasSeenFtue = () => {
    try {
      return localStorage.getItem(FTUE_SEEN_KEY) === "1";
    } catch {
      return false;
    }
  };
  const markFtueSeen = () => {
    try {
      localStorage.setItem(FTUE_SEEN_KEY, "1");
    } catch {}
  };

  const getFtueStep = () => ftueStep;
  const getFtueStepCount = () => FTUE_STEPS.length;
  const setFtueStep = (step) => {
    ftueStep = Math.max(0, Math.min(FTUE_STEPS.length - 1, step));
  };

  // Render labels and kick off the step animation.
  function renderFtueStep() {
    const step = Math.max(0, Math.min(FTUE_STEPS.length - 1, ftueStep));
    const data = FTUE_STEPS[step] || FTUE_STEPS[0];
    if (els?.ftueTitle) els.ftueTitle.textContent = data.title || "";
    if (els?.ftueDesc) els.ftueDesc.textContent = data.desc || "";
    if (els?.ftueTip) els.ftueTip.textContent = data.tip || "";
    if (els?.ftueStepLabel) els.ftueStepLabel.textContent = `${step + 1}/${FTUE_STEPS.length}`;
    if (els?.ftuePrev) {
      // Keep back enabled so users can return to splash on step 0
      els.ftuePrev.disabled = false;
      els.ftuePrev.classList.remove("is-disabled");
    }
    if (els?.ftueNext) {
      const summary = getChainSummary();
      const play = getPlaySafe();
      const solved = summary.solved || 0;
      const total = summary.total || play?.entries?.length || 0;
      let label = "Next";
      if (step === FTUE_STEPS.length - 1) {
        label =
          summary.state === "complete"
            ? "Admire puzzle"
            : summary.state === "paused"
            ? (autoCheckEnabled() ? `Continue puzzle (${solved}/${total})` : "Continue puzzle")
            : "Let's Play";
      }
      els.ftueNext.textContent = label;
    }
    if (els?.ftueDots && els.ftueDots.forEach) {
      els.ftueDots.forEach((dot, idx) => dot.classList.toggle("is-active", idx === step));
    }

    // reset any in-flight timers/scroll freeze before re-running animation
    clearFtueTimers();
    ftueDemo.freezeScroll = false;
    requestAnimationFrame(() => runFtueAnimation(step));
  }

  // Open the FTUE modal and pause any live chain progress underneath.
  function openFtue(startStep = 0, opts = {}) {
    if (!els?.ftueModal) return;
    clearTimeout(ftueDialogTimer);
    if (els?.ftueDialog) els.ftueDialog.classList.remove("is-open");
    ftueNavBlockedUntil = 0;
    setFtueStep(startStep);
    ftueDemo.paused = false;
    ftueUpdatePlayPauseUI();

    const play = getPlaySafe();
    const chain = getChainSafe();

    // Ensure chain isn't running underneath the FTUE
    if (play?.mode === MODE.CHAIN && chain) {
      // snapshot elapsed if running
      if (chain.running) {
        const elapsed = Math.max(0, (Date.now() - chain.startAt) / 1000);
        chain.elapsed = elapsed;
      }
      chain.running = false;
      if (chain.tickId) {
        clearInterval(chain.tickId);
        chain.tickId = 0;
      }
      const anyProgress = chain.started || play.usr.some(Boolean);
      setChainUI(play.done ? chainStates.DONE : anyProgress ? chainStates.PAUSED : chainStates.IDLE);
    }

    ensureFtueBoard();
    renderFtueStep();
    els.ftueModal.classList.remove("is-open");
    els.ftueModal.setAttribute("aria-hidden", "false");
    els.ftueModal.removeAttribute("hidden");
    // document.body.classList.add("is-ftue-open");
    ftueDisableInteractions();
    const noAnim = opts.noAnim === true;
    const applyNoAnim = () => {
      [els.ftueModal, els.ftueDialog].forEach((el) => {
        if (!el) return;
        el.dataset.ftuePrevTransition = el.style.transition || "";
        el.dataset.ftuePrevAnim = el.style.animationDuration || "";
        el.style.transition = "none";
        el.style.animationDuration = "0ms";
      });
    };
    const restoreNoAnim = () => {
      [els.ftueModal, els.ftueDialog].forEach((el) => {
        if (!el) return;
        if (el.dataset.ftuePrevTransition != null) {
          el.style.transition = el.dataset.ftuePrevTransition;
          delete el.dataset.ftuePrevTransition;
        } else {
          el.style.transition = "";
        }
        if (el.dataset.ftuePrevAnim != null) {
          el.style.animationDuration = el.dataset.ftuePrevAnim;
          delete el.dataset.ftuePrevAnim;
        } else {
          el.style.animationDuration = "";
        }
      });
    };

    if (noAnim) applyNoAnim();

    const finishOpen = () => {
      els.ftueModal?.classList.add("is-open");
      if (els.ftueDialog && ftueIsOpen()) {
        els.ftueDialog.classList.add("is-open");
      }
      if (noAnim) {
        // restore styles after paint so future opens animate
        setTimeout(restoreNoAnim, 50);
      }
    };

    if (opts.instant || noAnim) {
      finishOpen();
    } else {
      requestAnimationFrame(finishOpen);
      ftueDialogTimer = window.setTimeout(() => {
        if (els.ftueDialog && ftueIsOpen()) {
          els.ftueDialog.classList.add("is-open");
        }
      }, FTUE_DIALOG_DELAY);
    }
  }

  // Close FTUE, restore body state, and mark as seen.
  function closeFtue() {
    if (!els?.ftueModal) return;
    clearFtueTimers();
    clearTimeout(ftueDialogTimer);
    ftueDialogTimer = null;
    ftueDemo.paused = true;
    if (els?.ftueDialog) els.ftueDialog.classList.remove("is-open");
    els.ftueModal.classList.remove("is-open");
    [els.ftueModal, els.ftueDialog].forEach((el) => {
      if (!el) return;
      el.style.transition = "";
      el.style.animationDuration = "";
      delete el.dataset.ftuePrevTransition;
      delete el.dataset.ftuePrevAnim;
    });
    els.ftueModal.setAttribute("aria-hidden", "true");
    els.ftueModal.setAttribute("hidden", "true");
    // document.body.classList.remove("is-ftue-open");
    markFtueSeen();
    ftueEnableInteractions();
  }

  const nextFtue = () => {
    const now = Date.now();
    if (now < ftueNavBlockedUntil) return;
    ftueNavBlockedUntil = now + FTUE_NAV_COOLDOWN;
    if (ftueStep >= FTUE_STEPS.length - 1) {
      closeFtue();
      return;
    }
    ftueStep = Math.min(ftueStep + 1, FTUE_STEPS.length - 1);
    renderFtueStep();
  };

  const prevFtue = () => {
    const now = Date.now();
    if (now < ftueNavBlockedUntil) return;
    ftueNavBlockedUntil = now + FTUE_NAV_COOLDOWN;
    ftueStep = Math.max(ftueStep - 1, 0);
    renderFtueStep();
  };

  // Show FTUE automatically if not seen or forced.
  function maybeShowFtue() {
    if (!els?.ftueModal) return;
    clearTimeout(ftueShowTimer);
    if (FORCE_FTUE || !hasSeenFtue()) {
      ftueShowTimer = window.setTimeout(() => openFtue(0), FTUE_DIALOG_DELAY);
    }
  }

  // All FTUE animations are timer-driven; reset between steps.
  function clearFtueTimers() {
    ftueDemo.timers.forEach((t) => clearTimeout(t));
    ftueDemo.timers = [];
  }

  // Swipe navigation between FTUE steps (touch only).
  function onFtueTouchStart(e) {
    if (!ftueIsOpen()) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    ftueTouchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
  }

  function onFtueTouchEnd(e) {
    if (!ftueIsOpen() || !ftueTouchStart) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) {
      ftueTouchStart = null;
      return;
    }
    const dx = t.clientX - ftueTouchStart.x;
    const dy = t.clientY - ftueTouchStart.y;
    const dt = Date.now() - ftueTouchStart.time;
    ftueTouchStart = null;
    if (Math.abs(dx) < FTUE_SWIPE_THRESHOLD) return;
    if (Math.abs(dx) <= Math.abs(dy)) return;
    if (dt > 800) return;
    if (dx < 0) nextFtue();
    else prevFtue();
  }

  // FTUE animation can be paused; update the toggle UI.
  function ftueUpdatePlayPauseUI() {
    if (!els?.ftuePlayPause) return;
    const isPaused = !!ftueDemo.paused;
    els.ftuePlayPause.setAttribute("aria-pressed", isPaused ? "true" : "false");
    if (els?.ftuePlayPauseIcon) {
      els.ftuePlayPauseIcon.textContent = isPaused ? "▶" : "⏸";
    }
    els.ftuePlayPause.title = isPaused ? "Play animation" : "Pause animation";
  }

  function ftuePause() {
    ftueDemo.paused = true;
    clearFtueTimers();
    ftueUpdatePlayPauseUI();
  }

  function ftuePlay() {
    ftueDemo.paused = false;
    clearFtueTimers();
    ftueUpdatePlayPauseUI();
    runFtueAnimation(ftueStep);
  }

  // Build a synthetic board for the FTUE demo puzzle.
  function ensureFtueBoard() {
    if (!els?.ftueGrid) return null;
    const puzzles = getPuzzlesSafe();
    const ftuePuzzle = puzzles.find(
      (p) => String(p.id || p.title || "").trim().toLowerCase() === "ftue"
    );
    if (!ftuePuzzle) return null;
    const model = compute(ftuePuzzle);
    if (!model) return null;
    ftueDemo.puzzle = ftuePuzzle;
    ftueDemo.model = model;
    ftueDemo.usr = Array.from({ length: model.total }, () => "");
    ftueDemo.at = 0;
    ftueDemo.lockedEntries = new Set();
    renderGridSafe(els.ftueGrid, model, false, ftuePuzzle);
    ftueRenderState();
    return ftueDemo;
  }

  // Render FTUE board state (letters, active cell, solved/locked styling).
  function ftueRenderState() {
    if (!ftueDemo.model || !els?.ftueGrid) return;
    const cells = els.ftueGrid.querySelectorAll(".cell");
    cells.forEach((c) => {
      const i = +c.dataset.i;
      const letterEl = c.querySelector(".letter");
      if (letterEl) letterEl.textContent = ftueDemo.usr[i] || "";
      c.classList.toggle("is-active", i === ftueDemo.at);

      // solved state only when a covering entry is solved
      const solved = ftueDemo.solvedCells.has(i);
      c.classList.toggle("cell-solved", solved);
    });
    // range lock styling
    els.ftueGrid.querySelectorAll(".range").forEach((r) => {
      const eIdx = Number(r.dataset.e);
      r.classList.toggle("is-locked", ftueDemo.lockedEntries.has(eIdx));
    });
    ftueKeepActiveInView(ftueDemo.lastScrollBehavior || "smooth");
  }

  // Move the demo cursor and keep it in view.
  function ftueSetAt(idx, opts = {}) {
    if (!ftueDemo.model) return;
    ftueDemo.at = clampSafe(idx, 0, ftueDemo.model.total - 1);
    ftueDemo.lastScrollBehavior = opts.smooth ? "smooth" : "auto";
    ftueRenderState();
  }

  function ftueSetLetter(idx, ch) {
    if (!ftueDemo.model) return;
    if (idx == null || idx < 0 || idx >= ftueDemo.usr.length) return;
    ftueDemo.usr[idx] = (ch || "").toUpperCase();
    ftueRenderState();
  }

  // FTUE uses its own "solved" check separate from live play.
  function ftueIsEntrySolved(entry) {
    if (!entry) return false;
    for (let i = 0; i < entry.len; i++) {
      if (ftueDemo.usr[entry.start + i] !== entry.ans[i]) return false;
    }
    return true;
  }

  // Add cells to the "solved" styling set (used in demo visuals).
  function ftueAddSolvedCells(entry, count = null) {
    if (!entry || !ftueDemo.solvedCells) return;
    const n = count == null ? entry.len : Math.min(count, entry.len);
    for (let i = 0; i < n; i++) {
      ftueDemo.solvedCells.add(entry.start + i);
    }
  }

  // Maintain FTUE cursor in view; can freeze during animations.
  function ftueKeepActiveInView(behavior = "smooth") {
    if (ftueDemo.freezeScroll) return;
    if (ftueStep === 0) {
      if (els?.ftueGridScroll) els.ftueGridScroll.scrollTo({ left: 0, behavior: "smooth" });
      return; // slide 1 stays static
    }
    const sc = els?.ftueGridScroll;
    if (!sc || !els?.ftueGrid) return;
    const cell = els.ftueGrid.querySelector(`.cell[data-i="${ftueDemo.at}"]`);
    if (!cell) return;
    const rect = cell.getBoundingClientRect();
    const scRect = sc.getBoundingClientRect();
    const target =
      sc.scrollLeft + (rect.left - scRect.left) - (sc.clientWidth - rect.width) / 2;
    const max = Math.max(0, sc.scrollWidth - sc.clientWidth);
    const clamped = Math.max(0, Math.min(max, target));
    sc.scrollTo({ left: clamped, behavior });
    if (clamped >= max - 1) {
      ftueDemo.freezeScroll = true;
    }
  }

  // Lock a demo entry and play its solve animation.
  function ftueLockEntry(entry) {
    if (!entry) return;
    if (!ftueDemo.lockedEntries) ftueDemo.lockedEntries = new Set();
    ftueDemo.lockedEntries.add(entry.eIdx);
    const rangeEl = els?.ftueGrid?.querySelector(`.range[data-e="${entry.eIdx}"]`);
    if (rangeEl) {
      rangeEl.classList.add("range-solve-anim");
      rangeEl.addEventListener(
        "animationend",
        () => rangeEl.classList.remove("range-solve-anim"),
        { once: true }
      );
    }
    ftueRenderState();
  }

  function ftueFillEntryInstant(entry) {
    if (!entry) return;
    const letters = entry.ans.split("");
    letters.forEach((ch, idx) => {
      ftueSetLetter(entry.start + idx, ch);
    });
  }

  // Stepwise typing animation for the FTUE demo.
  function ftueTypeLetters(startIdx, letters, opts = {}) {
    let delay = opts.delayBefore ?? 0;
    const step = opts.step ?? 180;
    const smoothScroll = opts.smoothScroll !== false; // default true
    const freezeDuring = opts.freezeDuringType === true; // default false
    const centerAfter = opts.centerAfter !== false; // default true
    const onDone = opts.onDone;
    const touched = [];
    letters.toUpperCase().split("").forEach((ch, offset) => {
      ftueDemo.timers.push(
        setTimeout(() => {
          const idx = startIdx + offset;
          touched.push(idx);
          ftueSetLetter(idx, ch);
          ftueSetAt(idx, { smooth: smoothScroll });
        }, delay)
      );
      delay += step;
    });
    if (onDone) {
      ftueDemo.timers.push(
        setTimeout(() => {
          if (freezeDuring) ftueDemo.freezeScroll = false;
          if (centerAfter && touched.length) ftueSetAt(touched[touched.length - 1], { smooth: true });
          onDone();
        }, delay + (opts.afterDone ?? 0))
      );
    }
  }

  // Trigger the same solve animations used in the live board.
  function ftueTriggerSolveAnimation(entry) {
    if (!entry || !els?.ftueGrid) return;
    const letters = [];
    for (let i = entry.start; i < entry.start + entry.len; i++) {
      const cell = els.ftueGrid.querySelector(`.cell[data-i="${i}"]`);
      const letter = cell?.querySelector(".letter");
      if (letter) letters.push(letter);
    }
    letters.forEach((letter, idx) => {
      letter.classList.remove("solve-anim");
      letter.style.setProperty("--solve-delay", `${idx * 80}ms`);
      void letter.offsetWidth;
      letter.classList.add("solve-anim");
      letter.addEventListener(
        "animationend",
        () => {
          letter.classList.remove("solve-anim");
          letter.style.removeProperty("--solve-delay");
        },
        { once: true }
      );
    });

    const rangeEl = els.ftueGrid.querySelector(`.range[data-e="${entry.eIdx}"]`);
    if (rangeEl) {
      rangeEl.classList.remove("range-solve-anim");
      void rangeEl.offsetWidth;
      rangeEl.classList.add("range-solve-anim");
      rangeEl.addEventListener(
        "animationend",
        () => rangeEl.classList.remove("range-solve-anim"),
        { once: true }
      );
    }
  }

  // Reset FTUE board to a blank state between loops.
  function ftueResetBoard() {
    if (!ftueDemo.model) return;
    if (els?.ftueGrid) {
      els.ftueGrid.querySelectorAll(".solve-anim").forEach((el) => {
        el.classList.remove("solve-anim");
        el.style.removeProperty("--solve-delay");
      });
      els.ftueGrid.querySelectorAll(".range-solve-anim").forEach((el) => el.classList.remove("range-solve-anim"));
      els.ftueGrid.querySelectorAll(".cell-solved").forEach((el) => el.classList.remove("cell-solved"));
      els.ftueGrid.querySelectorAll(".range.is-locked").forEach((el) => el.classList.remove("is-locked"));
    }
    ftueDemo.usr = Array.from({ length: ftueDemo.model.total }, () => "");
    ftueDemo.lockedEntries = new Set();
    ftueDemo.solvedCells = new Set();
    ftueDemo.freezeScroll = false;
    ftueSetAt(0, { smooth: true });
    ftueRenderState();
  }

  // Orchestrate the scripted typing demo per FTUE step.
  function runFtueAnimation(step) {
    if (!ensureFtueBoard()) return;
    clearFtueTimers();
    if (ftueDemo.paused) return;

    const startDelay = Array.isArray(FTUE_TIMING.stepStartDelay)
      ? FTUE_TIMING.stepStartDelay[step] ?? 0
      : 0;
    const endDelay = Array.isArray(FTUE_TIMING.stepEndDelay)
      ? FTUE_TIMING.stepEndDelay[step] ?? 0
      : 0;

    const entries = ftueDemo.model?.entries || [];
    const first = entries[0];
    const second = entries[1];
    const third = entries[2];
    const fourth = entries[3];
    const earthEntry =
      entries.find((e) => e.ans?.toUpperCase() === "EARTH") || third || second || entries[0];
    const loveEntry = entries.find((e) => e.ans?.toUpperCase() === "LOVE") || second;

    // Reset board
    ftueResetBoard();

    if (step === 0) {
      ftueSetAt(first ? first.start : 0, { smooth: true });
      ftueRenderState();
      if (first) {
        ftueDemo.timers.push(
          setTimeout(() => {
            ftueTypeLetters(first.start, first.ans, {
              step: FTUE_TIMING.typeStep,
              smoothScroll: true,
              onDone: () => {
                ftueTriggerSolveAnimation(first);
                ftueLockEntry(first);
                // Only mark H,E,L as "solved" for demo
                ftueAddSolvedCells(first, 3);
                ftueRenderState();
                ftueSetAt(first.start + first.len - 1);
              },
            });
          }, startDelay)
        );
        ftueDemo.timers.push(
          setTimeout(() => {
            if (ftueStep === step) runFtueAnimation(step);
          }, endDelay)
        );
      }
      return;
    }

    if (step === 1) {
      // Prefill first word
      if (first) {
        ftueFillEntryInstant(first);
        ftueLockEntry(first);
        ftueAddSolvedCells(first, 3); // keep HEL marked
      }
      const startAfterFirst = first ? first.start + first.len : 0;
      ftueSetAt(startAfterFirst, { smooth: true });
      ftueRenderState();

      if (loveEntry) {
        ftueDemo.timers.push(
          setTimeout(() => {
            // Type next two letters (e.g., V, E) without extra movement
            const startIdx = loveEntry.start + 2; // positions for V and E in LOVE
            // prefill first two letters so VE completes the word
            ftueSetLetter(loveEntry.start, loveEntry.ans[0] || "L");
            ftueSetLetter(loveEntry.start + 1, loveEntry.ans[1] || "O");
            ftueSetAt(startIdx, { smooth: true });
            ftueDemo.timers.push(
              setTimeout(() => {
                ftueTypeLetters(startIdx, (loveEntry.ans || "VE").slice(2, 4) || "VE", {
                  step: FTUE_TIMING.typeStep,
                  smoothScroll: true,
                  onDone: () => {
                    if (ftueIsEntrySolved(loveEntry)) {
                      ftueTriggerSolveAnimation(loveEntry);
                      ftueLockEntry(loveEntry);
                    }
                    // mark L,O,V as solved demo cells
                    ftueAddSolvedCells(loveEntry, 3);
                    ftueRenderState();
                    ftueSetAt(startIdx + 1, { smooth: true });
                  },
                });
              }, startDelay)
            );
          }, startDelay)
        );
        ftueDemo.timers.push(
          setTimeout(() => {
            if (ftueStep === step) runFtueAnimation(step);
          }, endDelay)
        );
      }
      return;
    }

    if (step === 2) {
      if (first) {
        ftueFillEntryInstant(first);
        ftueLockEntry(first);
        ftueAddSolvedCells(first); // HELLO should already be solved
      }
      if (second) {
        ftueFillEntryInstant(second);
        ftueLockEntry(second);
        ftueAddSolvedCells(second, 3); // LOV persists
      }
      const earthStart = earthEntry ? earthEntry.start + 1 : 0; // continue after existing E
      ftueSetAt(earthStart, { smooth: true });
      ftueRenderState();

      // Type ARTH
      ftueDemo.timers.push(
        setTimeout(() => {
          ftueTypeLetters(earthStart, "ARTH", {
            step: FTUE_TIMING.typeStep,
            smoothScroll: true,
            centerAfter: true,
            onDone: () => {
              if (earthEntry && ftueIsEntrySolved(earthEntry)) {
                ftueTriggerSolveAnimation(earthEntry);
                ftueLockEntry(earthEntry);
              }
              // mark E,A,R as solved demo cells
              for (let i = 0; i < Math.min(3, earthEntry?.len || 0); i++) {
                ftueDemo.solvedCells.add((earthEntry?.start || 0) + i);
              }
              ftueRenderState();
              // Pause, then type RONE in the fourth entry if available
              ftueDemo.timers.push(
                setTimeout(() => {
                  if (fourth) {
                    const roneStart = fourth.start + 2; // start at R in THRONE
                    ftueDemo.freezeScroll = false; // allow scroll while finishing
                    ftueSetAt(roneStart, { smooth: true });
                    ftueTypeLetters(roneStart, "RONE", {
                      step: FTUE_TIMING.typeStep,
                      smoothScroll: true,
                      centerAfter: false,
                      onDone: () => {
                        if (ftueIsEntrySolved(fourth)) {
                          ftueTriggerSolveAnimation(fourth);
                          ftueLockEntry(fourth);
                        }
                        for (let i = 0; i < fourth.len; i++) {
                          ftueDemo.solvedCells.add(fourth.start + i);
                        }
                        ftueRenderState();
                        if (els?.ftueToast) {
                          els.ftueToast.classList.add("is-showing");
                          setTimeout(() => els.ftueToast?.classList.remove("is-showing"), 2000);
                        }
                        ftueDemo.freezeScroll = true; // keep board stable at end
                        ftueSetAt(fourth.start + fourth.len - 1, { smooth: false });
                      },
                    });
                  }
                }, FTUE_TIMING.step3MidPause)
              );
            },
          });
        }, startDelay)
      );
      ftueDemo.timers.push(
        setTimeout(() => {
          if (ftueStep === step) runFtueAnimation(step);
        }, endDelay)
      );
    }
  }

  return {
    ftueIsOpen,
    openFtue,
    closeFtue,
    nextFtue,
    prevFtue,
    maybeShowFtue,
    renderFtueStep,
    onFtueTouchStart,
    onFtueTouchEnd,
    ftuePlay,
    ftuePause,
    hasSeenFtue,
    getFtueStep,
    getFtueStepCount,
    setFtueStep,
    isPaused: () => !!ftueDemo.paused,
  };
}
