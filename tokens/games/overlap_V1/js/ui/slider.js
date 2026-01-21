/*
 * File Overview
 * Purpose: Slider UI for navigating puzzles or progress.
 * Controls: Slider input, value display, and scroll sync.
 * How: Binds input events and updates view state or scroll.
 * Key interactions: Uses view-state, archive, and dom cache.
 */
// Slider UI + smooth scroll-follow (shared by grid and slider scrubbing).
import { MODE, VIEW } from "../core/config.js";
import { clamp } from "../utils/index.js";
import { paletteColorForWord } from "../core/palette.js";

export function createSlider({
  els,
  getPlay,
  getPuzzles,
  getPuzzleIndex,
  getCurrentView,
  isWordCorrect,
  isUserPanning,
  isAutoCheckEnabled,
}) {
  const autoCheckEnabled =
    typeof isAutoCheckEnabled === "function" ? isAutoCheckEnabled : () => true;
  // The slider mirrors horizontal grid scroll and provides a quick scrub control.
  // It renders an SVG capsule with thick/thin segments (unsolved/solved).
  const SLIDER_CFG = {
    viewH: 100,
    unit: 8, // px per cell in the viewBox space
    thickH: 76,
    thinH: 26,
    curve: 14,
  };

  // Runtime slider state (DOM refs + interaction state + cached geometry).
  const slider = {
    root: null,
    track: null,
    thumb: null,
    grabbing: false,
    pointerDown: false,
    dragging: false,
    startX: 0,
    clickSlop: 4,
    cache: null, // { key, stops, segments }
  };

  // ---- Smooth scroll-follow (prevents native smooth jitter on rapid updates) ----
  const SCROLL_FOLLOW_K = 0.28;   // 0..1 (higher = faster, lower = smoother)
  const SCROLL_FOLLOW_EPS = 0.75; // stop threshold (px)

  let _scrollFollowRaf = 0;
  let _scrollFollowEl = null;
  let _scrollFollowTarget = 0;
  let _scrollFollowK = SCROLL_FOLLOW_K;
  let _scrollFollowEps = SCROLL_FOLLOW_EPS;

  // Simple spring-like follow for scrollLeft updates.
  function smoothFollowScrollLeft(sc, target, opts = {}) {
    _scrollFollowEl = sc;
    _scrollFollowTarget = target;
    _scrollFollowK = opts.k ?? SCROLL_FOLLOW_K;
    _scrollFollowEps = opts.eps ?? SCROLL_FOLLOW_EPS;

    if (_scrollFollowRaf) return;

    const tick = () => {
      const el = _scrollFollowEl;
      // Bail out if the user is actively panning; we don't want to fight them.
      if (isUserPanning && isUserPanning()) { _scrollFollowRaf = 0; return; }
      if (!el) { _scrollFollowRaf = 0; return; }

      const cur = el.scrollLeft;
      const delta = _scrollFollowTarget - cur;

      // close enough: snap + stop
      if (Math.abs(delta) <= _scrollFollowEps) {
        el.scrollLeft = _scrollFollowTarget;
        _scrollFollowRaf = 0;
        return;
      }

      // critically-damped-ish follow
      el.scrollLeft = cur + delta * _scrollFollowK;
      _scrollFollowRaf = requestAnimationFrame(tick);
    };

    _scrollFollowRaf = requestAnimationFrame(tick);
  }

  function cancelSmoothFollow() {
    if (_scrollFollowRaf) {
      cancelAnimationFrame(_scrollFollowRaf);
      _scrollFollowRaf = 0;
    }
    _scrollFollowEl = null;
  }

  // Read CSS mix settings so the slider gradient can be toned down for legibility.
  function getSliderMixSettings() {
    const css = getComputedStyle(document.documentElement);
    const base = css.getPropertyValue("--slider-color-mix-base").trim() || "var(--background-default)";
    const amtRaw = css.getPropertyValue("--slider-color-mix-amount").trim();
    const amtNum = parseFloat(amtRaw);
    const amount = Number.isFinite(amtNum) ? clamp(amtNum, 0, 100) : 0;
    return { base, amount };
  }

  // Measure effective scroll range (taking padding into account).
  function sliderScrollMetrics() {
    const sc = els.gridScroll;
    if (!sc) return { max: 0, padL: 0, padR: 0, eff: 0 };
    const cs = getComputedStyle(sc);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const effWidth = Math.max(0, sc.scrollWidth - padL - padR);
    const max = Math.max(0, effWidth - sc.clientWidth);
    return { max, padL, padR, eff: effWidth };
  }

  // Map slider percent to scrollLeft with optional smooth follow.
  function setScrollFromSliderPct(pct, { smooth = false } = {}) {
    if (!els.gridScroll) return;
    const sc = els.gridScroll;
    const { max, padL } = sliderScrollMetrics();
    const target = padL + pct * max;
    const clamped = clamp(target, 0, padL + max);
    if (smooth) {
      smoothFollowScrollLeft(sc, clamped);
    } else {
      sc.scrollLeft = clamped;
    }
    if (slider.thumb) slider.thumb.style.left = `${pct * 100}%`;
  }

  // Sync thumb position from the current scroll offset.
  function updateThumbFromScroll(force = false) {
    if (!slider.root || !slider.thumb) return;
    if (slider.grabbing && !force) return;
    if (!els.gridScroll) return;
    const sc = els.gridScroll;
    const { max, padL } = sliderScrollMetrics();
    const pct = max > 0 ? clamp((sc.scrollLeft - padL) / max, 0, 1) : 0;
    slider.thumb.style.left = `${pct * 100}%`;
  }

  // Build thick/thin runs from solved cells (not just locked words).
  function computeSolvedCells() {
    const play = getPlay();
    if (play.mode !== MODE.CHAIN || !play.n) return [];

    const total = play.n;
    const solved = Array.from({ length: total }, () => false);

    // Map cells to covering entries
    const covers = Array.from({ length: total }, () => []);
    for (const e of play.entries || []) {
      for (let i = e.start; i < e.start + e.len && i < total; i++) {
        covers[i].push(e);
      }
    }

    // Precompute which words are correct to avoid repeat checks per cell.
    const wordCorrect = new Map();
    for (const e of play.entries || []) {
      wordCorrect.set(e.eIdx, isWordCorrect(e));
    }

    for (let i = 0; i < total; i++) {
      const entriesHere = covers[i];
      if (!entriesHere.length) {
        // Fallback: only mark solved if the cell exactly matches expected
        solved[i] = play.usr?.[i] && play.exp?.[i] && play.usr[i] === play.exp[i];
        continue;
      }
      solved[i] = entriesHere.every((e) => wordCorrect.get(e.eIdx));
    }

    return solved;
  }

  // Convert solved cells into contiguous thick/thin segments.
  function sliderSegments(solvedCellsOverride) {
    const play = getPlay();
    const total = play.n || 0;
    if (!total) return [{ start: 0, len: 1, type: "thick" }];

    const solvedCells = Array.isArray(solvedCellsOverride) ? solvedCellsOverride : null;
    if (!solvedCells || play.mode !== MODE.CHAIN || solvedCells.length !== total) {
      return [{ start: 0, len: total, type: "thick" }];
    }

    const runs = [];
    let i = 0;
    while (i < total) {
      const solved = !!solvedCells[i];
      const start = i;
      while (i < total && !!solvedCells[i] === solved) i++;
      runs.push({ start, len: i - start, type: solved ? "thin" : "thick" });
    }
    return runs;
  }

  const sliderHeightFor = (t) => (t === "thin" ? SLIDER_CFG.thinH : SLIDER_CFG.thickH);
  const sliderTopFor = (t) => (SLIDER_CFG.viewH - sliderHeightFor(t)) / 2;
  const sliderBottomFor = (t) => sliderTopFor(t) + sliderHeightFor(t);

  // Curves at segment boundaries are clamped so short segments are not over-curved.
  function sliderCurveLen(prevLenPx, nextLenPx) {
    const base = SLIDER_CFG.curve;
    const lim = Math.min(prevLenPx * 0.5, nextLenPx * 0.5);
    return Math.max(2, Math.min(base, Math.max(0, lim)));
  }

  // Create the squished capsule SVG path + mask stops for thick/thin blending.
  function buildSliderGeometry(runs) {
    if (!runs?.length) return { path: "", totalWidth: 100, segments: [], maskStops: [] };

    // Convert cell runs into pixel segments so we can draw a single capsule path.
    const segments = [];
    let x = 0;

    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      const lenPx = Math.max(1, r.len * SLIDER_CFG.unit);
      const curveIn =
        i > 0 && runs[i - 1].type !== r.type ? sliderCurveLen(runs[i - 1].len * SLIDER_CFG.unit, lenPx) : 0;
      const startPx = x;
      const endPx = startPx + lenPx;

      segments.push({ ...r, startCell: r.start, lenPx, start: startPx, end: endPx, curveIn });
      x = endPx;
    }

    const totalWidth = Math.max(1, x);

    // Build the squished capsule path (single path used for both base and gradient fill).
    let d = `M ${segments[0].start} ${sliderTopFor(segments[0].type)} `;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const prev = segments[i - 1];
      const top = sliderTopFor(seg.type);

      if (i > 0 && seg.curveIn > 0 && prev && prev.type !== seg.type) {
        const curve = seg.curveIn;
        const startCurve = Math.max(0, seg.start - curve);
        const mid = curve * 0.5;
        d += `L ${startCurve} ${sliderTopFor(prev.type)} `;
        d += `C ${startCurve + mid} ${sliderTopFor(prev.type)} ${seg.start - mid} ${top} ${seg.start} ${top} `;
      }

      d += `L ${seg.end} ${top} `;
    }

    const last = segments[segments.length - 1];
    const lastH = sliderHeightFor(last.type);
    d += `A ${lastH / 2} ${lastH / 2} 0 0 1 ${last.end} ${sliderBottomFor(last.type)} `;

    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      const prev = segments[i - 1];
      const bottom = sliderBottomFor(seg.type);

      d += `L ${seg.start} ${bottom} `;

      if (i > 0 && seg.curveIn > 0 && prev && prev.type !== seg.type) {
        const curve = seg.curveIn;
        const startCurve = Math.max(0, seg.start - curve);
        const mid = curve * 0.5;
        d += `C ${seg.start - mid} ${bottom} ${startCurve + mid} ${sliderBottomFor(prev.type)} ${startCurve} ${sliderBottomFor(prev.type)} `;
      }
    }

    const first = segments[0];
    const firstH = sliderHeightFor(first.type);
    d += `A ${firstH / 2} ${firstH / 2} 0 0 1 0 ${sliderTopFor(first.type)} Z`;

    // Mask stops (opaque where thick, transparent where thin) with feathered transitions
    // so the gradient fades in/out around solved areas.
    const FEATHER_L = Math.max(1, SLIDER_CFG.unit * 2); // earlier gray on entry
    const FEATHER_R = Math.max(2, SLIDER_CFG.unit * 1); // shorter gray bleed exiting
    const maskStops = [];
    const pushStop = (pos, opacity) => {
      const p = clamp(pos, 0, totalWidth);
      maskStops.push({ pos: p, opacity });
    };

    pushStop(0, segments[0].type === "thin" ? 0 : 1);

    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1];
      const seg = segments[i];
      if (prev.type === seg.type) continue;

      const boundary = seg.start;
      const opPrev = prev.type === "thin" ? 0 : 1;
      const opCurr = seg.type === "thin" ? 0 : 1;

      pushStop(boundary - FEATHER_L, opPrev);
      pushStop(boundary, opPrev * 0.4 + opCurr * 0.6);
      pushStop(boundary + FEATHER_R, opCurr);
    }

    const lastSeg = segments[segments.length - 1];
    pushStop(lastSeg.end - FEATHER_R, lastSeg.type === "thin" ? 0 : 1);
    pushStop(lastSeg.end, lastSeg.type === "thin" ? 0 : 1);

    return { path: d, totalWidth, segments, maskStops };
  }

  // Translate cell index boundaries into SVG x positions.
  function sliderBoundaryX(idx, segments, totalCells) {
    if (idx <= 0) return 0;
    if (idx >= totalCells) return segments.length ? segments[segments.length - 1].end : 0;

    const targetCell = idx - 1;
    for (const seg of segments) {
      if (targetCell >= seg.startCell && targetCell < seg.startCell + seg.len) {
        const offsetCells = idx - seg.startCell;
        return seg.start + offsetCells * SLIDER_CFG.unit;
      }
    }

    return (idx / Math.max(1, totalCells)) * (segments[segments.length - 1]?.end || 0);
  }

  // Compute gradient stops based on word colors, with optional solved override.
  function sliderColorStops(entries, puzzle, geometry, solvedCellsOverride, allowSolved = false) {
    const play = getPlay();
    const total = play.n || 0;
    if (!entries?.length || !total || !geometry?.segments?.length) return [];

    const useSolved = allowSolved && Array.isArray(solvedCellsOverride);
    const solvedCells = useSolved ? solvedCellsOverride : null;
    const solvedColor =
      getComputedStyle(document.documentElement).getPropertyValue("--slider-solved").trim() ||
      "rgba(0,0,0,0.35)";

    // Map each cell to the entries that cover it.
    const covers = Array.from({ length: total }, () => []);
    for (const e of entries) {
      for (let i = e.start; i < e.start + e.len && i < total; i++) covers[i].push(e);
    }

    const wordCorrect = new Map();
    for (const e of entries) wordCorrect.set(e.eIdx, isWordCorrect(e));

    // Pick a color for each cell based on the first unsolved word covering it.
    const colors = Array.from({ length: total }, () => null);
    for (let i = 0; i < total; i++) {
      if (useSolved && solvedCells?.[i]) {
        colors[i] = solvedColor;
        continue;
      }

      const firstUnsolved = covers[i].find((e) => !wordCorrect.get(e.eIdx));
      if (firstUnsolved) {
        colors[i] = paletteColorForWord(puzzle, firstUnsolved.rawIdx ?? firstUnsolved.eIdx ?? 0);
        continue;
      }

      if (covers[i].length) {
        const e = covers[i][0];
        colors[i] = paletteColorForWord(puzzle, e.rawIdx ?? e.eIdx ?? 0);
        continue;
      }
    }

    // Ensure all cells have a color (avoid empty gradients).
    const fallbackColor =
      colors.find(Boolean) ||
      paletteColorForWord(puzzle, 0) ||
      getComputedStyle(document.documentElement).getPropertyValue("--puzzle-color-1").trim() ||
      "#999";
    for (let i = 0; i < colors.length; i++) {
      if (!colors[i]) colors[i] = fallbackColor;
    }

    // Collapse consecutive cells into color runs so gradients blend smoothly.
    const runs = [];
    let i = 0;
    while (i < total) {
      const c = colors[i];
      const start = i;
      while (i < total && colors[i] === c) i++;
      runs.push({ color: c, start, end: i });
    }

    // Build per-run gradient stops with short blends at run boundaries.
    const stops = [];
    const mix = (a, b) => (b ? `color-mix(in srgb, ${a} 45%, ${b} 55%)` : a);
    const totalWidth = geometry.totalWidth;
    const mixSettings = getSliderMixSettings();
    const mixColor = (c) => {
      if (!mixSettings.amount) return c;
      const keep = Math.max(0, 100 - mixSettings.amount);
      return `color-mix(in srgb, ${c} ${keep}%, ${mixSettings.base} ${mixSettings.amount}%)`;
    };

    const xForBoundary = (idx) => {
      if (idx <= 0) return 0;
      if (idx >= total) return totalWidth;
      const targetCell = idx - 1;
      for (const seg of geometry.segments) {
        if (targetCell >= seg.startCell && targetCell < seg.startCell + seg.len) {
          const offsetCells = idx - seg.startCell;
          return seg.start + offsetCells * SLIDER_CFG.unit;
        }
      }
      return (idx / total) * totalWidth;
    };

    for (let r = 0; r < runs.length; r++) {
      const seg = runs[r];
      const prev = runs[r - 1]?.color || seg.color;
      const next = runs[r + 1]?.color || seg.color;

      const startX = xForBoundary(seg.start);
      const endX = xForBoundary(seg.end);
      const span = Math.max(0, endX - startX);
      const blend = Math.min(span * 0.5, SLIDER_CFG.unit * 2);

      const a0 = startX;
      const a1 = Math.min(endX, startX + blend);
      const b0 = Math.max(startX, endX - blend);
      const b1 = endX;

      const mixStart = mix(prev, seg.color);
      const mixEnd = mix(seg.color, next);

      stops.push(
        { offset: (a0 / totalWidth) * 100, color: mixStart },
        { offset: (a1 / totalWidth) * 100, color: seg.color },
        { offset: (b0 / totalWidth) * 100, color: seg.color },
        { offset: (b1 / totalWidth) * 100, color: mixEnd }
      );
    }

    return stops.map((s) => ({ ...s, color: mixColor(s.color) }));
  }

  // Render the slider SVG; cache geometry when possible to avoid recompute.
  function renderSliderSvg() {
    if (!slider.track) return;

    const play = getPlay();
    const puzzles = getPuzzles();
    const pIdx = getPuzzleIndex();
    const currentView = getCurrentView();

    // In chain view, allow solved cells to thin out the slider (visual progress).
    const allowSolved = play.mode === MODE.CHAIN && autoCheckEnabled();
    const solvedCells = allowSolved ? computeSolvedCells() : null;

    let runs;
    let baseStops;
    let geometry;

    const cacheKey =
      !allowSolved && currentView === VIEW.PLAY ? `play-${pIdx}-${play.mode}` : null;

    if (cacheKey && slider.cache?.key === cacheKey) {
      ({ runs, baseStops, geometry } = slider.cache);
    } else {
      runs = sliderSegments(solvedCells);
      geometry = buildSliderGeometry(runs);
      baseStops = sliderColorStops(play.entries, puzzles[pIdx], geometry, solvedCells, allowSolved);
      if (cacheKey) {
        slider.cache = { key: cacheKey, runs, baseStops, geometry };
      }
    }
    const maskStops = geometry.maskStops;

    const id = `slider-${Math.random().toString(16).slice(2, 8)}`;
    const fallbackA = paletteColorForWord(puzzles[pIdx], 0);
    const fallbackB = paletteColorForWord(puzzles[pIdx], 1) || fallbackA;
    const stopsToUse = baseStops.length ? baseStops : [
      { offset: 0, color: fallbackA },
      { offset: 100, color: fallbackB },
    ];

    const baseStopsStr = stopsToUse
      .map((s) => `<stop offset="${s.offset}%" stop-color="${s.color}" />`)
      .join("");
    const maskStopsStr = maskStops
      .map((s) => `<stop offset="${(s.pos / geometry.totalWidth) * 100}%" stop-color="white" stop-opacity="${s.opacity}" />`)
      .join("");

    const svg = `
      <svg class="slider-svg" viewBox="0 0 ${geometry.totalWidth} ${SLIDER_CFG.viewH}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="${id}-base" x1="0" x2="1" y1="0" y2="0">
            ${baseStopsStr}
          </linearGradient>
          <linearGradient id="${id}-mask" x1="0" x2="1" y1="0" y2="0">
            ${maskStopsStr}
          </linearGradient>
          <mask id="${id}-mask-use">
            <rect x="0" y="0" width="${geometry.totalWidth}" height="${SLIDER_CFG.viewH}" fill="url(#${id}-mask)" />
          </mask>
        </defs>
        <path d="${geometry.path}" fill="var(--slider-base-bg, var(--slider-solved, #c2c5cb))" />
        <path d="${geometry.path}" fill="url(#${id}-base)" mask="url(#${id}-mask-use)" />
      </svg>
    `;

    slider.track.innerHTML = svg;
  }

  // Show/hide slider based on overflow and repaint its SVG.
  function updateSliderUI() {
    if (!slider.root || !slider.track) return;
    const currentView = getCurrentView();
    const isPlayableView = currentView === VIEW.PLAY;
    const overflow = isPlayableView && els.gridScroll && els.gridScroll.scrollWidth > els.gridScroll.clientWidth + 4;
    slider.root.style.display = overflow ? "" : "none";
    if (!overflow) return;

    renderSliderSvg();
    updateThumbFromScroll();
  }

  // Build slider DOM and wire pointer drag/click handling.
  function initSlider() {
    slider.root = els.slider;
    if (!slider.root) return;
    slider.root.innerHTML = "";
    slider.root.classList.add("slider");
    slider.track = document.createElement("div");
    slider.track.className = "slider-track";
    slider.thumb = document.createElement("div");
    slider.thumb.className = "slider-thumb";

    slider.root.append(slider.track, slider.thumb);

    const onPointerMove = (clientX, smooth = false) => {
      if (!slider.root || !els.gridScroll) return;
      const rect = slider.root.getBoundingClientRect();
      const pct = clamp((clientX - rect.left) / rect.width, 0, 1);
      setScrollFromSliderPct(pct, { smooth });
      updateThumbFromScroll(true);
    };

    const endInteraction = (e) => {
      slider.pointerDown = false;
      slider.dragging = false;
      slider.grabbing = false;
      slider.root.classList.remove("is-grabbing");
      if (e?.pointerId != null && slider.root.hasPointerCapture(e.pointerId)) {
        slider.root.releasePointerCapture(e.pointerId);
      }
    };

    slider.root.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      slider.pointerDown = true;
      slider.dragging = false;
      slider.startX = e.clientX;
      slider.root.setPointerCapture(e.pointerId);
      // cancel any ongoing smooth follow to avoid jitter
      cancelSmoothFollow();
    });

    slider.root.addEventListener("pointermove", (e) => {
      if (!slider.pointerDown) return;
      const dx = Math.abs(e.clientX - slider.startX);
      if (!slider.dragging && dx > slider.clickSlop) {
        slider.dragging = true;
        slider.grabbing = true;
        slider.root.classList.add("is-grabbing");
      }
      if (slider.dragging) {
        onPointerMove(e.clientX, false);
      }
    });

    slider.root.addEventListener("pointerup", (e) => {
      if (!slider.pointerDown) return;
      if (!slider.dragging) {
        // treated as click: jump thumb, smooth scroll content
        const rect = slider.root.getBoundingClientRect();
        const pct = clamp((slider.startX - rect.left) / rect.width, 0, 1);
        if (slider.thumb) slider.thumb.style.left = `${pct * 100}%`;
        setScrollFromSliderPct(pct, { smooth: true });
      }
      endInteraction(e);
    });

    slider.root.addEventListener("pointercancel", endInteraction);
  }

  let _gridScrollBound = false;
  function bindGridScrollCancels() {
    if (_gridScrollBound || !els.gridScroll) return;
    _gridScrollBound = true;
    const cancel = () => cancelSmoothFollow();
    const sc = els.gridScroll;
    ["pointerdown", "wheel", "touchstart"].forEach((ev) => {
      sc.addEventListener(ev, cancel, { passive: true });
    });
  }

  return {
    initSlider,
    updateSliderUI,
    updateThumbFromScroll,
    smoothFollowScrollLeft,
    cancelSmoothFollow,
    bindGridScrollCancels,
  };
}
