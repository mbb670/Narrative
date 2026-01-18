// Overlap V1 game runtime.
// Single-file implementation that handles puzzle loading, UI, input, chain timing,
// persistence, and all modal flows. Comments below are intended to guide future modularization.
import "../../docs/token_switcher/switcher.js";

// window.tokenSwapDefaults = {
//   mode: "dark"
// };

// Storage and sharing keys are centralized so data resets can be managed predictably.
const KEY = "overlap_puzzles_v1";
const SHARE_URL_OVERRIDE = ""; // leave blank to use current page URL; update if you want a fixed share link

// Legacy/default color names mapped to CSS variables (palette-driven colors are preferred).
const COLORS = [
  ["Red", "--c-red"],
  ["Yellow", "--c-yellow"],
  ["Green", "--c-green"],
  ["Blue", "--c-blue"],
  ["Purple", "--c-purple"],
];

// Height cycle gives each word a stacking height for the layered "overlap" layout.
const HEIGHT_CYCLE = ["full", "mid", "inner"];

// Game mode is per puzzle; view is the tab selection.
const MODE = { PUZZLE: "puzzle", CHAIN: "chain" };
const VIEW = { PLAY: "play", CHAIN: "chain" };

// ---- Remember last tab/view ----
const LAST_VIEW_KEY = `${KEY}__last_view`;
const ARCHIVE_RETURN_TIMEOUT_MS = 45 * 60 * 1000;

// URL flags used for debug, FTUE forcing, and splash suppression.
const DEV_MODE = (() => {
  try {
    const url = new URL(location.href);
    return url.searchParams.has("dev") || url.searchParams.has("devmode");
  } catch {
    return false;
  }
})();
const SUPPRESS_SPLASH = (() => {
  try {
    const url = new URL(location.href);
    return url.searchParams.get("splash") === "1";
  } catch {
    return false;
  }
})();
const DEV_DISABLE_AUTOPAUSE = DEV_MODE;
const FORCE_FTUE = (() => {
  try {
    const url = new URL(location.href);
    return url.searchParams.has("ftue");
  } catch {
    return false;
  }
})();
// iOS detection is used to avoid scroll/overflow changes that Safari dislikes.
const IS_IOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent || "") ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const FTUE_SEEN_KEY = `${KEY}__ftue_seen`;
const LAST_PLAYED_CHAIN_KEY = `${KEY}__last_chain_played`;

// Reads last open tab from storage with a safe fallback.
function loadLastView() {
  try {
    const v = localStorage.getItem(LAST_VIEW_KEY);
    return v === VIEW.PLAY || v === VIEW.CHAIN ? v : VIEW.CHAIN;
  } catch {
    return VIEW.CHAIN;
  }
}


// ---- Palettes (5 colors, from CSS) ----
// Palettes are defined in CSS via [data-puzzle-palette="..."] selectors and
// --puzzle-color-<n> variables. JS discovers palette IDs and reads computed values.
const PALETTE_SIZE = 5;
const FALLBACK_PALETTE_ID = "classic";
const FALLBACK_PALETTE_COLORS = ["var(--c-red)", "var(--c-orange)", "var(--c-yellow)", "var(--c-green)", "var(--c-blue)"];

// Extract palette IDs from stylesheets, then read computed CSS variables with a probe element.
function readCssPalettes() {
  const css = getComputedStyle(document.documentElement);

  const discoverIdsFromRules = () => {
    const ids = new Set();
    const re = /\[data-puzzle-palette\s*=\s*["']?([^"'\]]+)["']?\]/gi;

    for (const sheet of Array.from(document.styleSheets || [])) {
      let rules;
      try {
        rules = sheet.cssRules || [];
      } catch {
        continue; // cross-origin or inaccessible
      }
      for (const rule of Array.from(rules)) {
        if (!rule.selectorText) continue;
        let m;
        while ((m = re.exec(rule.selectorText))) {
          if (m[1]) ids.add(m[1].trim());
        }
      }
    }
    return Array.from(ids);
  };

  const names = discoverIdsFromRules();
  if (!names.length) names.push(FALLBACK_PALETTE_ID);

  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:0;height:0;pointer-events:none;";
  document.documentElement.appendChild(probe);

  const palettes = names.map((name) => {
    const labelRaw = css.getPropertyValue(`--palette-${name}-label`) || name;
    const cleanLabel =
      (labelRaw || "")
        .replace(/^["']|["']$/g, "")
        .trim() ||
      name;

    probe.setAttribute("data-puzzle-palette", name);
    const pcss = getComputedStyle(probe);

    const colors = [];
    for (let i = 1; i <= PALETTE_SIZE; i++) {
      const v = pcss.getPropertyValue(`--puzzle-color-${i}`).trim();
      if (v) colors.push(v);
    }

    return {
      id: name,
      label: cleanLabel,
      colors: colors.length ? colors : FALLBACK_PALETTE_COLORS,
    };
  });

  probe.remove();

  if (!palettes.length) {
    return [{ id: FALLBACK_PALETTE_ID, label: "Default", colors: FALLBACK_PALETTE_COLORS }];
  }
  return palettes;
}

// Palette helpers normalize IDs and fetch word colors for rendering and UI accents.
const PALETTES = readCssPalettes();
const PALETTE_ID_SET = new Set(PALETTES.map((p) => p.id));
const FIRST_PALETTE_ID = PALETTES[0]?.id || FALLBACK_PALETTE_ID;

// Ensure palette id is valid, falling back to the first available palette.
const normalizePaletteId = (id) => {
  const v = String(id || "");
  return PALETTE_ID_SET.has(v) ? v : FIRST_PALETTE_ID;
};
const getPaletteById = (id) => PALETTES.find((p) => p.id === id) || PALETTES[0];
// Pick a palette color based on the word index (wraps if needed).
const paletteColorForWord = (puzzle, wordIdx) => {
  const pal = getPaletteById(normalizePaletteId(puzzle?.palette));
  const colors = pal?.colors?.length ? pal.colors : FALLBACK_PALETTE_COLORS;
  return colors[wordIdx % colors.length] || FALLBACK_PALETTE_COLORS[0];
};
// Apply palette selection to the root element for CSS to consume.
const applyPaletteToDom = (paletteId) => {
  document.documentElement.setAttribute("data-puzzle-palette", normalizePaletteId(paletteId));
};

// ---- Slider (scroll surrogate, squish-style) ----
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

  // Build the squished capsule path
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

  const allowSolved = play.mode === MODE.CHAIN && currentView === VIEW.CHAIN;
  const solvedCells = allowSolved ? computeSolvedCells() : null;

  let runs;
  let baseStops;
  let geometry;

  const cacheKey = currentView === VIEW.PLAY ? `play-${pIdx}-${play.mode}` : null;

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
  const isPlayableView = currentView === VIEW.CHAIN || currentView === VIEW.PLAY;
  const overflow = isPlayableView && els.gridScroll && els.gridScroll.scrollWidth > els.gridScroll.clientWidth + 4;
  slider.root.style.display = overflow ? "" : "none";
  if (!overflow) return;

  renderSliderSvg();
  updateThumbFromScroll();
}

// ---- Defaults loading (modular data files) ----
// Puzzle content lives in JSON bundles; this section fetches and flattens them.
const DEFAULTS_VERSION = "2026-01-26"; // <-- bump this any time you edit puzzle data layout
const DEFAULTS_VER_KEY = `${KEY}__defaults_version`;

const JSON_FETCH_OPTS = { cache: "no-store" };

// Fetch JSON with a safe fallback (no caching so daily updates show up immediately).
async function fetchJson(url, fallback = null) {
  try {
    const res = await fetch(url, JSON_FETCH_OPTS);
    if (!res?.ok) throw new Error(`Failed ${url}`);
    return await res.json();
  } catch {
    return fallback;
  }
}

// Given a list of JSON file paths, return a single flattened array.
async function loadJsonArraysFromList(baseUrl, paths = []) {
  const results = await Promise.all(
    paths.map(async (p) => {
      const url = new URL(p, baseUrl);
      const data = await fetchJson(url, []);
      return Array.isArray(data) ? data : [];
    })
  );
  return results.flat();
}

// Non-chain puzzles (overlap mode) are loaded from the puzzles data folder.
async function loadPuzzleModeDefaults() {
  const base = new URL("./data/puzzles/", import.meta.url);
  const manifest = await fetchJson(new URL("./data/puzzles/index.json", import.meta.url), null);
  const list =
    Array.isArray(manifest?.files) ? manifest.files :
    Array.isArray(manifest) ? manifest :
    ["Initial_group/initial.json"];
  return loadJsonArraysFromList(base, list);
}

// Non-daily chain content (FTUE, custom packs, etc).
async function loadChainOtherDefaults() {
  const base = new URL("./data/chain/other/", import.meta.url);
  const manifest = await fetchJson(new URL("./data/chain/other/index.json", import.meta.url), null);
  const list =
    Array.isArray(manifest?.files) ? manifest.files :
    Array.isArray(manifest) ? manifest :
    ["util/ftue.json", "custom/personal.json"];
  return loadJsonArraysFromList(base, list);
}

// Daily chain puzzles are grouped by month for smaller fetches.
async function loadDailyChainDefaults(date = new Date()) {
  const base = new URL("./data/chain/daily/", import.meta.url);
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const monthPath = `${y}/${String(m).padStart(2, "0")}.json`;
  return loadJsonArraysFromList(base, [monthPath]);
}

// Load all default puzzle sources in parallel.
async function loadDefaultPuzzles() {
  const [daily, chainOther, puzzleModes] = await Promise.all([
    loadDailyChainDefaults(),
    loadChainOtherDefaults(),
    loadPuzzleModeDefaults(),
  ]);
  return [...daily, ...chainOther, ...puzzleModes];
}

const DEF = await loadDefaultPuzzles();


// ---- DOM ----
// Cache frequently used nodes so logic and rendering are decoupled from selectors.
const $ = (s) => document.querySelector(s);
const els = {
  logo: $("#logo"),
  panelPlay: $("#panelPlay"),
  stage: $("#stage"),
  gridScroll: $("#gridScroll"),
  grid: $("#grid"),
  meta: $("#meta"),
  prev: $("#prev"),
  next: $("#next"),
  reset: $("#reset"),
  reveal: $("#reveal"),
  resultsModal: document.getElementById("results"),
  resultsClose: document.querySelector(".resultsClose"),
  resultsShare: document.querySelector(".resultsShare"),
  slider: $(".game-slider"),
  nextPuzzleBtn: $("#nextPuzzleBtn"),
  puzzleActions: document.querySelector(".puzzle-actions"),
  splash: $("#splashModal"),
  splashPrimary: $("#splashPrimary"),
  splashPuzzleBtn: document.querySelector("#splashPuzzleBtns, #splashPuzzleBtn"),
  splashArchiveBtn: $("#splashArchiveBtn"),
  splashTutorialBtn: $("#splashTutorialBtn"),
  splashDate: $("#splashDate"),
  splashTitle: $("#splashTitle"),
  splashSubtitle: $("#splashSubtitle"),
  splashAvgTime: $("#splashAvgTime"),
  splashGamesPlayed: $("#splashGamesPlayed"),
  splashVersion: $("#splashVersion"),
  settingsBtn: $("#settingsBtn"),
  settingsPanel: $("#settingsPanel"),
  settingsCloseBtn: $("#settingsCloseBtn"),
  archiveModal: $("#archiveModal"),
  archiveDialog: document.querySelector(".archive__dialog"),
  archiveBackBtn: $("#archiveBackBtn"),
  archivePrevMonth: $("#archivePrevMonth"),
  archiveNextMonth: $("#archiveNextMonth"),
  archiveMonthSelect: $("#archiveMonthSelect"),
  archiveYearSelect: $("#archiveYearSelect"),
  archiveCalendar: $("#archiveCalendar"),
  archiveTodayBtn: $("#archiveTodayBtn"),
  archiveActionBtn: $("#archiveActionBtn"),
  archiveActionLabel: $("#archiveActionLabel"),
  archiveActionMeta: $("#archiveActionMeta"),
  giveUpModal: $("#giveUpModal"),
  giveUpSubtitle: document.querySelector(".giveUpSubtitle"),
  giveUpWordsCount: document.querySelector(".giveUpWordsCount"),
  giveUpWordLabel: document.querySelector(".giveUpWordLabel"),
  giveUpSeconds: document.querySelector(".giveUpSeconds"),
  giveUpConfirm: $("#giveUpConfirm"),
  giveUpCancel: $("#giveUpCancel"),
  navWordPrev: $("#navWordPrev"),
  navCellPrev: $("#navCellPrev"),
  navCellNext: $("#navCellNext"),
  navWordNext: $("#navWordNext"),
  ftueModal: $("#ftueModal"),
  ftuePrev: document.querySelector(".ftue-prev"),
  ftueNext: document.querySelector(".ftue-next"),
  ftueSkip: document.querySelector(".ftue-skip"),
  ftueStepLabel: document.querySelector(".ftue-step-label"),
  ftueTitle: document.querySelector("#ftueTitle"),
  ftueDesc: document.querySelector(".ftue-desc"),
  ftueTip: document.querySelector(".ftue-tip"),
  ftueDots: document.querySelectorAll(".ftue-dot"),
  ftueToast: document.querySelector(".ftue-toast"),
  ftueGrid: $("#ftueGrid"),
  ftueGridScroll: $("#ftueGridScroll"),
  ftueDialog: document.querySelector(".ftue-modal__dialog"),
  ftuePlayPause: document.querySelector(".ftue-playpause"),
  ftuePlayPauseIcon: document.querySelector(".ftue-playpause-icon"),
  pClear: $("#pClear"),
  status: $("#status"),
  helper: $(".helper"),
  keyboard: $(".keyboard"),
  archiveDate: $("#archiveDate"),
  toastSuccess: $("#toastSuccess"),
  toastWarning: $("#toastWarning"),
  toastError: $("#toastError"),
  toastErrorPuzzle: $("#toastError-puzzle"),
  toastWordSolved: $("#toastWordSolved"),
  toastHint: $("#toastHint"),
  hintPenalty: $("#hintPenalty"),
  shareInline: $("#shareInline"),
  splashShareToast: $("#splashShareToast"),
  shareBtn: $("#shareBtn"),
  showOnscreenKeyboard: $("#showOnscreenKeyboard"),
  totalHintPenalty: $("#totalHintPenalty"),
  totalWordPenalty: $("#totalWordPenalty"),

};

let _gridScrollBound = false;
const NAV_DEBUG = false;
const logNav = () => {};

// ---- Toasts ----
// Toasts are timed UI messages; we track timers per type to avoid overlap flicker.
const toastTimers = { success: 0, warning: 0, error: 0, hint: 0 };
let resultsToastTimer = 0;
const inlineToastTimers = new WeakMap();
let lastPlayWarningKey = "";
let lastChainWarningKey = "";
const HINT_PENALTY_SEC = 10;

// Parse CSS custom properties that store durations (ms).
function parseMsVar(val, fallback) {
  if (!val) return fallback;
  const n = parseInt(String(val).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Duration per toast type; driven by CSS variables with sensible defaults.
function toastDuration(type) {
  const css = getComputedStyle(document.documentElement);
  const raw =
    css.getPropertyValue(`--toast-${type}-duration`) ||
    css.getPropertyValue(`--toast-${type}-duration-ms`);
  return parseMsVar(raw, type === "error" ? 2200 : 2600);
}

// Show a toast and reset its animation by toggling the class.
function showToast(type, message, duration) {
  const map = {
    success: els.toastSuccess,
    warning: els.toastWarning,
    error: els.toastError,
    wordSolved: els.toastWordSolved,
    hint: els.toastHint,
  };
  const el = map[type];
  if (!el) return;
  if (type === "wordSolved") {
    updateWordSolvedCount(message);
  } else if (type === "hint") {
    const penaltyEl = el.querySelector("#hintPenalty");
    if (penaltyEl && message != null) penaltyEl.textContent = message;
  } else if (message) {
    el.textContent = message;
  }
  const dur = duration ?? toastDuration(type);
  if (toastTimers[type]) clearTimeout(toastTimers[type]);
  el.classList.remove("is-showing");
  void el.offsetWidth; // restart transition
  el.classList.add("is-showing");
  toastTimers[type] = setTimeout(() => el.classList.remove("is-showing"), dur);
}

// Update inline counters for solved words; called by toasts and UI refreshes.
function updateWordSolvedCount(message) {
  const targets = document.querySelectorAll(".word-solved-count");
  if (!targets.length) return;
  let text = message;
  if (!text) {
    if (play.mode === MODE.CHAIN && Array.isArray(play.entries) && play.entries.length) {
      const total = play.entries.length;
      const solved = play.lockedEntries ? play.lockedEntries.size : play.entries.filter(isWordCorrect).length;
      text = `${solved} of ${total}`;
    } else {
      text = "";
    }
  }
  targets.forEach((el) => {
    el.textContent = text;
  });
}

// Inline toast is used in small UI areas (share, results, etc).
function showInlineToast(el, message) {
  if (!el) return;
  el.textContent = message || "";
  const dur = toastDuration("success");
  const prev = inlineToastTimers.get(el);
  if (prev) clearTimeout(prev);
  el.classList.remove("is-showing");
  void el.offsetWidth;
  el.classList.add("is-showing");
  inlineToastTimers.set(el, setTimeout(() => el.classList.remove("is-showing"), dur));
}

// Share feedback prefers inline toasts if a target is provided or results modal is open.
function showShareToast(message, targetEl) {
  if (targetEl) {
    showInlineToast(targetEl, message);
    return;
  }
  const t = els.resultsModal?.querySelector(".resultsShareToast");
  const resultsOpen = t && els.resultsModal?.classList.contains("is-open");
  if (resultsOpen && t) {
    t.textContent = message;
    const dur = toastDuration("success");
    if (resultsToastTimer) clearTimeout(resultsToastTimer);
    t.classList.remove("is-showing");
    void t.offsetWidth;
    t.classList.add("is-showing");
    resultsToastTimer = setTimeout(() => t.classList.remove("is-showing"), dur);
    return;
  }
  showToast("success", message);
}

// Clear all current toasts and timers (useful on reset).
function clearToasts() {
  ["success", "warning", "error", "wordSolved", "hint"].forEach((type) => {
    if (toastTimers[type]) {
      clearTimeout(toastTimers[type]);
      toastTimers[type] = 0;
    }
    const el =
      type === "success" ? els.toastSuccess : type === "warning" ? els.toastWarning : type === "error" ? els.toastError : type === "wordSolved" ? els.toastWordSolved : els.toastHint;
    if (el) el.classList.remove("is-showing");
  });
}

const userKey = () => (Array.isArray(play.usr) ? play.usr.join("") : "");

function resetToastGuards() {
  lastPlayWarningKey = "";
  lastChainWarningKey = "";
}

// ---- Time penalties ----
// Chain mode uses time penalties for hints and "give up" reveals.
function addTimePenalty(seconds, type = "") {
  if (play.mode !== MODE.CHAIN) return;
  const sec = Math.max(0, Math.round(seconds || 0));
  if (!sec) return;
  if (type === "hint") chain.hintPenaltySecTotal = Math.max(0, (chain.hintPenaltySecTotal || 0) + sec);
  if (type === "word") chain.wordPenaltySecTotal = Math.max(0, (chain.wordPenaltySecTotal || 0) + sec);

  if (chain.running) {
    // Move start backward so elapsed includes penalty immediately
    chain.startAt -= sec * 1000;
    const ui = ensureChainUI();
    const elapsed = (Date.now() - chain.startAt) / 1000;
    chain.elapsed = elapsed;
    if (ui.timer) ui.timer.textContent = fmtTime(elapsed);
  } else {
    chain.elapsed = Math.max(0, (chain.elapsed || 0) + sec);
    const ui = ensureChainUI();
    if (ui.timer) ui.timer.textContent = fmtTime(chain.elapsed);
  }

  if (type === "hint" && els.toastHint) {
    const txt = String(sec);
    showToast("hint", txt);
  }
}

// ---- FTUE ----
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
const ftueIsOpen = () => !!els.ftueModal?.classList.contains("is-open");
let _ftuePrevOverflow = "";
// Prevent interaction with the live board while FTUE is open.
function ftueDisableInteractions() {
  _ftuePrevOverflow = document.body.style.overflow;
  if (!IS_IOS) document.body.style.overflow = "hidden";
  if (els.stage) els.stage.style.pointerEvents = "none";
  if (els.gridScroll) els.gridScroll.style.pointerEvents = "none";
  if (els.keyboard) els.keyboard.style.pointerEvents = "none";
}
function ftueEnableInteractions() {
  document.body.style.overflow = _ftuePrevOverflow || "";
  if (els.stage) els.stage.style.pointerEvents = "";
  if (els.gridScroll) els.gridScroll.style.pointerEvents = "";
  if (els.keyboard) els.keyboard.style.pointerEvents = "";
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

// Render labels and kick off the step animation.
function renderFtueStep() {
  const step = Math.max(0, Math.min(FTUE_STEPS.length - 1, ftueStep));
  const data = FTUE_STEPS[step] || FTUE_STEPS[0];
  if (els.ftueTitle) els.ftueTitle.textContent = data.title || "";
  if (els.ftueDesc) els.ftueDesc.textContent = data.desc || "";
  if (els.ftueTip) els.ftueTip.textContent = data.tip || "";
  if (els.ftueStepLabel) els.ftueStepLabel.textContent = `${step + 1}/${FTUE_STEPS.length}`;
  if (els.ftuePrev) {
    // Keep back enabled so users can return to splash on step 0
    els.ftuePrev.disabled = false;
    els.ftuePrev.classList.remove("is-disabled");
  }
  if (els.ftueNext) {
    const summary = chainProgressSummary();
    const solved = summary.solved || 0;
    const total = summary.total || play.entries.length || 0;
    let label = "Next";
    if (step === FTUE_STEPS.length - 1) {
      label =
        summary.state === "complete"
          ? "Admire puzzle"
          : summary.state === "paused"
          ? `Continue puzzle (${solved}/${total})`
          : "Let's Play";
    }
    els.ftueNext.textContent = label;
  }
  if (els.ftueDots && els.ftueDots.forEach) {
    els.ftueDots.forEach((dot, idx) => dot.classList.toggle("is-active", idx === step));
  }

  // reset any in-flight timers/scroll freeze before re-running animation
  clearFtueTimers();
  ftueDemo.freezeScroll = false;
  requestAnimationFrame(() => runFtueAnimation(step));
}

// Open the FTUE modal and pause any live chain progress underneath.
function openFtue(startStep = 0, opts = {}) {
  if (!els.ftueModal) return;
  clearTimeout(ftueDialogTimer);
  if (els.ftueDialog) els.ftueDialog.classList.remove("is-open");
  ftueNavBlockedUntil = 0;
  ftueStep = Math.max(0, Math.min(FTUE_STEPS.length - 1, startStep));
  ftueDemo.paused = false;
  ftueUpdatePlayPauseUI();

  // Ensure chain isn't running underneath the FTUE
  if (play.mode === MODE.CHAIN) {
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
    chainSetUIState(play.done ? CHAIN_UI.DONE : anyProgress ? CHAIN_UI.PAUSED : CHAIN_UI.IDLE);
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
  if (!els.ftueModal) return;
  clearFtueTimers();
  clearTimeout(ftueDialogTimer);
  ftueDialogTimer = null;
  ftueDemo.paused = true;
  if (els.ftueDialog) els.ftueDialog.classList.remove("is-open");
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
  if (!els.ftueModal) return;
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
  if (!els.ftuePlayPause) return;
  const isPaused = !!ftueDemo.paused;
  els.ftuePlayPause.setAttribute("aria-pressed", isPaused ? "true" : "false");
  if (els.ftuePlayPauseIcon) {
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
  if (!els.ftueGrid) return null;
  const ftuePuzzle = puzzles.find(
    (p) => String(p.id || p.title || "").trim().toLowerCase() === "ftue"
  );
  if (!ftuePuzzle) return null;
  const model = computed(ftuePuzzle);
  ftueDemo.puzzle = ftuePuzzle;
  ftueDemo.model = model;
  ftueDemo.usr = Array.from({ length: model.total }, () => "");
  ftueDemo.at = 0;
  ftueDemo.lockedEntries = new Set();
  renderGrid(els.ftueGrid, model, false, ftuePuzzle);
  ftueRenderState();
  return ftueDemo;
}

// Render FTUE board state (letters, active cell, solved/locked styling).
function ftueRenderState() {
  if (!ftueDemo.model || !els.ftueGrid) return;
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
  ftueDemo.at = clamp(idx, 0, ftueDemo.model.total - 1);
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

// function ftueIsCellSolved(i) {
//   if (ftueDemo.solvedCells?.size) return ftueDemo.solvedCells.has(i);
//   const covering = ftueDemo.model?.entries?.filter((e) => entryContainsIndex(e, i)) || [];
//   if (!covering.length) return false;
//   return covering.every((e) => ftueDemo.lockedEntries.has(e.eIdx) && ftueIsEntrySolved(e));
// }

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
    if (els.ftueGridScroll) els.ftueGridScroll.scrollTo({ left: 0, behavior: "smooth" });
    return; // slide 1 stays static
  }
  const sc = els.ftueGridScroll;
  if (!sc || !els.ftueGrid) return;
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
  const rangeEl = els.ftueGrid?.querySelector(`.range[data-e="${entry.eIdx}"]`);
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

// function ftueEntry(ans) {
//   if (!ftueDemo.model) return null;
//   return ftueDemo.model.entries.find((e) => e.ans.toUpperCase() === ans.toUpperCase()) || null;
// }

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
  if (!entry || !els.ftueGrid) return;
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
  if (els.ftueGrid) {
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
                      if (els.ftueToast) {
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

// Clear all editable cells (used for select-all delete and reset behaviors).
function clearAllUnlockedCells() {
  if (play.done) return;
  if (play.mode === MODE.CHAIN && !chainInputAllowed()) return;

  let changed = false;
  const isLocked = (i) => play.mode === MODE.CHAIN && isCellLocked(i);
  for (let i = 0; i < play.n; i++) {
    if (isLocked(i)) continue;
    if (play.usr[i]) {
      play.usr[i] = "";
      changed = true;
    }
  }
  clearSelectAll();

  const target =
    play.mode === MODE.CHAIN ? findNextEditable(0, +1) ?? 0 : 0;
  setAt(target, { behavior: "smooth" });

  if (changed) {
    if (play.mode === MODE.CHAIN) {
      updatePlayUI();
      requestChainClues();
    } else {
      updatePlayUI();
      checkSolvedOverlapOnly();
    }
    updateResetRevealVisibility();
    updatePlayControlsVisibility();
    updatePuzzleActionsVisibility();
  } else {
    updatePlayUI();
  }
}

// Warnings shown when the board is fully filled but incorrect.
function maybeToastPlayFilledWrong() {
  if (play.mode !== MODE.PUZZLE || play.done) return;
  const filled = play.usr.every(Boolean);
  if (!filled) {
    lastPlayWarningKey = "";
    return;
  }
  const key = userKey();
  const allCorrect = play.usr.every((ch, i) => ch === play.exp[i]);
  if (allCorrect) return;
  if (key !== lastPlayWarningKey) {
    showToast("warning", "Not quite: Some or all words are incorrect");
    lastPlayWarningKey = key;
  }
}

function maybeToastChainFilledWrong() {
  if (play.mode !== MODE.CHAIN || play.done) return;
  const filled = play.usr.every(Boolean);
  if (!filled) {
    lastChainWarningKey = "";
    return;
  }
  const key = userKey();
  const unsolved = countUnsolvedWords();
  if (unsolved <= 0) return;
  if (key !== lastChainWarningKey) {
    showToast("warning", `Not quite: ${unsolved} words are incomplete or incorrect`);
    lastChainWarningKey = key;
  }
}

// Grid scroll should cancel smooth-follow so dragging feels direct.
function bindGridScrollCancels() {
  if (_gridScrollBound || !els.gridScroll) return;
  _gridScrollBound = true;
  const cancel = () => cancelSmoothFollow();
  const sc = els.gridScroll;
  ["pointerdown", "wheel", "touchstart"].forEach((ev) => {
    sc.addEventListener(ev, cancel, { passive: true });
  });
}

// Remove derived height fields before persisting puzzles (keeps storage stable across layouts).
const stripHeightsFromPuzzles = (arr = []) =>
  arr.map((p) => {
    const { words = [], height, h, dateKey, title, ...restPuzzle } = p || {};
    return {
      ...restPuzzle,
      words: words.map((w) => {
        const { height: wHeight, h: wH, ...rest } = w || {};
        return { ...rest };
      }),
    };
  });

// ---- Storage ----
// Puzzles are stored in localStorage; defaults are merged so shipped updates appear.
const store = {
  // Merge saved puzzles with shipped defaults; defaults fill any missing items.
  load() {
    const defaults = structuredClone(DEF);
    try {
      const url = new URL(location.href);
      const forceReset = url.searchParams.has("reset") || url.searchParams.has("fresh");

      const savedDefaultsVer = localStorage.getItem(DEFAULTS_VER_KEY);

      // If defaults changed (or you force reset), discard saved puzzles so you get fresh data files
      if (forceReset || savedDefaultsVer !== DEFAULTS_VERSION) {
        localStorage.setItem(DEFAULTS_VER_KEY, DEFAULTS_VERSION);
        localStorage.removeItem(KEY);
      }

      const raw = localStorage.getItem(KEY);
      const v = raw ? JSON.parse(raw) : null;

      if (Array.isArray(v) && v.length) {
        const byId = new Map();
        const add = (p, allowOverwrite = true) => {
          const id = String(p?.id || "").trim() || `__noid__${byId.size}`;
          if (!byId.has(id) || allowOverwrite) byId.set(id, p);
        };
        v.forEach((p) => add(p, true));       // saved takes priority
        defaults.forEach((p) => add(p, false)); // fill in any new defaults
        return Array.from(byId.values());
      }

      // No saved puzzles => use shipped defaults
      localStorage.setItem(DEFAULTS_VER_KEY, DEFAULTS_VERSION);
      return defaults;
    } catch {
      return defaults;
    }
  },
  // Persist puzzles (without layout-only data) and the defaults version.
  save() {
    localStorage.setItem(DEFAULTS_VER_KEY, DEFAULTS_VERSION);
    localStorage.setItem(KEY, JSON.stringify(stripHeightsFromPuzzles(puzzles)));
  },
};

// ---- Per-puzzle chain progress persistence ----
// Stores partial progress for chain puzzles (including daily puzzles).
const CHAIN_PROGRESS_KEY = `${KEY}__chain_progress_v2`;
const CHAIN_STATS_KEY = `${KEY}__chain_stats_v2`;
const clearLegacyChainStorage = () => {
  const legacy = [`${KEY}__chain_progress_v1`, `${KEY}__chain_stats_v1`];
  try {
    legacy.forEach((k) => localStorage.removeItem(k));
  } catch {}
};

const todayKey = () => toDateKey(new Date());

// Use puzzle ID + word signature to create a stable key even if ordering changes.
function chainPuzzleKey(p) {
  if (!p || !isChainPuzzle(p)) return null;
  const wordSig = puzzleWordSignature(p);
  const id = normalizePuzzleId(p).id || "no-id";
  return `${MODE.CHAIN}||${id}||${wordSig || "words"}`;
}

// Load progress store and normalize its shape.
function loadChainProgressStore() {
  clearLegacyChainStorage();
  try {
    const raw = JSON.parse(localStorage.getItem(CHAIN_PROGRESS_KEY) || "{}");
    const base = raw && typeof raw === "object" ? raw : {};
    base.puzzles = base.puzzles && typeof base.puzzles === "object" ? base.puzzles : {};
    return base;
  } catch {
    return { puzzles: {} };
  }
}

function saveChainProgressStore(store) {
  try {
    localStorage.setItem(CHAIN_PROGRESS_KEY, JSON.stringify(store));
  } catch {}
}

// Daily puzzles expire when a new day starts; remove stale entries.
function pruneStaleChainProgress() {
  const store = loadChainProgressStore();
  const t = todayKey();
  let changed = false;
  Object.keys(store.puzzles || {}).forEach((k) => {
    const v = store.puzzles[k];
    const savedDay = v?.savedDayKey;
    const id = String(v?.puzzleId || v?.id || "").trim();
    const type = v?.puzzleType || v?.type || null;
    const daily =
      !!v?.puzzleIdIsDate ||
      (String(type || MODE.PUZZLE) === MODE.CHAIN && isDateId(id));
    const isCurrentDaily = daily && t && id === t;
    if (isCurrentDaily && savedDay && savedDay !== t) {
      delete store.puzzles[k];
      changed = true;
    }
  });
  if (changed) saveChainProgressStore(store);
}

// Remove progress for a single puzzle.
function clearChainProgressForPuzzle(p) {
  const key = chainPuzzleKey(p);
  if (!key) return;
  const store = loadChainProgressStore();
  if (store.puzzles?.[key]) {
    delete store.puzzles[key];
    saveChainProgressStore(store);
  }
}

// Remove all chain progress (used by the clear stats action).
function clearAllChainProgress() {
  try {
    localStorage.removeItem(CHAIN_PROGRESS_KEY);
  } catch {}
}

let _persistChainRaf = 0;
let _persistTickLastTs = 0;
let _restoredFromStorage = false;
let _restoredAt = 0;
let _splashShown = false;
let _ftueNoAnimRestore = null;

// ---- Chain stats (completed games only) ----
// Aggregates completed chain games for the splash screen summary.
function loadChainStatsStore() {
  clearLegacyChainStorage();
  try {
    const raw = JSON.parse(localStorage.getItem(CHAIN_STATS_KEY) || "{}");
    if (!raw || typeof raw !== "object") throw 0;
    raw.puzzles = raw.puzzles && typeof raw.puzzles === "object" ? raw.puzzles : {};
    raw.games = Number.isFinite(raw.games) ? raw.games : 0;
    raw.totalSec = Number.isFinite(raw.totalSec) ? raw.totalSec : 0;
    return raw;
  } catch {
    return { games: 0, totalSec: 0, puzzles: {} };
  }
}

function saveChainStatsStore(store) {
  try {
    localStorage.setItem(CHAIN_STATS_KEY, JSON.stringify(store));
  } catch {}
}

function clearChainStats() {
  try {
    localStorage.removeItem(CHAIN_STATS_KEY);
  } catch {}
}

// Record completion once per puzzle key (prevents double counting).
function recordChainCompletionIfNeeded(elapsedSec) {
  const key = chainPuzzleKey(puzzles[pIdx]);
  if (!key || play.mode !== MODE.CHAIN) return;
  const store = loadChainStatsStore();
  if (store.puzzles[key]?.done) return;
  const time = Math.max(0, Math.floor(elapsedSec || 0));
  store.puzzles[key] = { done: true, timeSec: time };
  store.games = Math.max(0, (store.games || 0) + 1);
  store.totalSec = Math.max(0, (store.totalSec || 0) + time);
  saveChainStatsStore(store);
}

// Summary used on splash: total games and average time.
function chainStatsSummary() {
  const store = loadChainStatsStore();
  const games = Math.max(0, store.games || 0);
  const totalSec = Math.max(0, store.totalSec || 0);
  const avgSec = games > 0 ? totalSec / games : 0;
  return { games, totalSec, avgSec };
}

// ---- Splash modal ----
// Splash summarizes chain progress and exposes quick actions (play/continue/admire).
function chainSummaryFromLive() {
  if (play.mode !== MODE.CHAIN) return null;
  const total = play.entries?.length || 0;
  const solved = total ? play.entries.filter(isWordCorrect).length : 0;
  const state = play.done ? "complete" : chain.started && !chain.running ? "paused" : "default";
  return { state, solved, total };
}

// When not on chain view, infer summary from stored progress.
function chainSummaryFromStore() {
  // Use today's chain puzzle (if available) to infer state when not in chain view
  const idx = findTodayChainIndex();
  const p = idx != null ? puzzles[idx] : null;
  if (!p || !isChainPuzzle(p)) return null;
  const key = chainPuzzleKey(p);
  if (!key) return null;
  const store = loadChainProgressStore();
  const data = store.puzzles?.[key];
  const today = todayKey();
  const puzzleId = normalizePuzzleId(p).id;
  const isCurrentDaily = isDailyChainPuzzle(p) && today && puzzleId === today;
  if (isCurrentDaily && data?.savedDayKey && data.savedDayKey !== today) {
    return { state: "default", solved: 0, total: computed(p).entries?.length || 0 };
  }
  if (!data) return { state: "default", solved: 0, total: computed(p).entries?.length || 0 };

  const model = computed(p);
  const total = model.entries?.length || 0;
  const usr = Array.isArray(data.usr) ? data.usr : [];
  const solved = (model.entries || []).filter((e) => {
    for (let i = 0; i < e.len; i++) {
      const idx = e.start + i;
      if (!usr[idx]) return false;
      if (usr[idx] !== model.exp[idx]) return false;
    }
    return true;
  }).length;

  const anyInput = usr.some(Boolean);
  const state = data.done
    ? "complete"
    : data.started || anyInput
    ? "paused"
    : "default";

  return { state, solved, total };
}

function chainProgressSummary() {
  return chainSummaryFromLive() || chainSummaryFromStore() || { state: "default", solved: 0, total: 0 };
}

function splashState() {
  return chainProgressSummary().state;
}

function splashSolvedText() {
  const { solved, total } = chainProgressSummary();
  return { solved, total };
}

// Populate splash labels and stats based on current progress.
function updateSplashContent(forceState) {
  if (!els.splash) return;
  const summary = chainProgressSummary();
  const state = forceState || summary.state;
  const solved = summary.solved || 0;
  const total = summary.total || play.entries.length || 0;

  if (els.splashDate) {
    const now = new Date();
    els.splashDate.textContent = now.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  const primaryLabel =
    state === "complete"
      ? "Admire puzzle"
      : state === "paused"
      ? `Continue puzzle (${solved}/${total || play.entries.length || 0})`
      : "Play";

  if (els.splashPrimary) els.splashPrimary.textContent = primaryLabel;
  if (els.splashSubtitle) {
    els.splashSubtitle.textContent =
      state === "complete"
        ? "You finished today’s chain"
        : state === "paused"
        ? "Pick up where you left off"
        : "Daily word chain";
  }
  const stats = chainStatsSummary();
  if (els.splashGamesPlayed) {
    els.splashGamesPlayed.textContent = stats.games > 0 ? String(stats.games) : "--";
  }
  if (els.splashAvgTime) {
    if (stats.games > 0) {
      const sec = Math.max(0, Math.round(stats.avgSec));
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      els.splashAvgTime.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    } else {
      els.splashAvgTime.textContent = "--";
    }
  }
  if (els.splashVersion) {
    const txt = els.splashVersion.textContent || "";
    els.splashVersion.textContent = txt || "V3.6";
  }
}

// ---- Archive modal ----
// Daily puzzle archive with month navigation and resume/admire actions.
const ARCHIVE_MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Archive state keeps cached months and the current selection.
const archiveState = {
  ready: false,
  loadingPromise: null,
  years: [],
  monthsByYear: new Map(),
  availableMonths: [],
  monthCache: new Map(),
  current: { year: null, month: null },
  monthData: null,
  selectedDateKey: null,
  selectedPuzzle: null,
  selectedPlayable: false,
  selectedAction: "none",
  renderToken: 0,
};

const pad2 = (n) => String(n).padStart(2, "0");
const archiveMonthKey = (year, month) => `${year}-${pad2(month)}`;
const archiveDateKey = (year, month, day) => `${year}-${pad2(month)}-${pad2(day)}`;

// Load the available years/months for daily puzzles (from JSON index files).
async function loadArchiveIndex() {
  if (archiveState.ready) return;
  if (archiveState.loadingPromise) return archiveState.loadingPromise;

  archiveState.loadingPromise = (async () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const idxUrl = new URL("./data/chain/daily/index.json", import.meta.url);
    const idx = await fetchJson(idxUrl, null);
    let years = [];
    if (Array.isArray(idx?.years)) years = idx.years;
    else if (Array.isArray(idx?.files)) years = idx.files;

    years = years
      .map((y) => String(y).split("/")[0])
      .map((y) => Number.parseInt(y, 10))
      .filter((y) => Number.isFinite(y));

    if (!years.length) {
      const derived = puzzles
        .filter(isDailyChainPuzzle)
        .map((p) => normalizePuzzleId(p).id)
        .filter(isDateId);
      years = derived
        .map((id) => Number.parseInt(String(id).slice(0, 4), 10))
        .filter((y) => Number.isFinite(y));
    }

    years = Array.from(new Set(years))
      .filter((y) => DEV_MODE || y <= currentYear)
      .sort((a, b) => a - b);

    const monthsByYear = new Map();
    for (const year of years) {
      const yearIdxUrl = new URL(`./data/chain/daily/${year}/index.json`, import.meta.url);
      const yearIdx = await fetchJson(yearIdxUrl, null);
      let months = [];
      if (Array.isArray(yearIdx?.months)) months = yearIdx.months;
      else if (Array.isArray(yearIdx?.files)) months = yearIdx.files;

      months = months
        .map((m) => {
          const raw = String(m);
          const match = raw.match(/(\d{2})(?:\.json)?$/);
          return match ? Number.parseInt(match[1], 10) : Number.parseInt(raw, 10);
        })
        .filter((m) => Number.isFinite(m) && m >= 1 && m <= 12);

      if (!months.length) {
        months = puzzles
          .filter(isDailyChainPuzzle)
          .map((p) => normalizePuzzleId(p).id)
          .filter((id) => String(id).startsWith(`${year}-`))
          .map((id) => Number.parseInt(String(id).slice(5, 7), 10))
          .filter((m) => Number.isFinite(m) && m >= 1 && m <= 12);
      }

      months = Array.from(new Set(months))
        .filter((m) => DEV_MODE || year < currentYear || (year === currentYear && m <= currentMonth))
        .sort((a, b) => a - b);

      if (months.length) monthsByYear.set(year, months);
    }

    const availableMonths = [];
    monthsByYear.forEach((months, year) => {
      months.forEach((month) => availableMonths.push({ year, month }));
    });
    availableMonths.sort((a, b) => (a.year - b.year) || (a.month - b.month));

    archiveState.years = Array.from(monthsByYear.keys()).sort((a, b) => a - b);
    archiveState.monthsByYear = monthsByYear;
    archiveState.availableMonths = availableMonths;
    archiveState.ready = true;
    archiveState.loadingPromise = null;
  })();

  return archiveState.loadingPromise;
}

// Load a single month's daily puzzles and map them by date ID.
async function loadArchiveMonth(year, month) {
  const key = archiveMonthKey(year, month);
  if (archiveState.monthCache.has(key)) return archiveState.monthCache.get(key);

  const url = new URL(`./data/chain/daily/${year}/${pad2(month)}.json`, import.meta.url);
  const data = await fetchJson(url, []);
  const list = Array.isArray(data) ? data : [];
  const byDate = new Map();
  list.forEach((raw) => {
    const p = normPuzzle(raw);
    const id = normalizePuzzleId(p).id;
    if (isDateId(id)) byDate.set(id, p);
  });

  const monthData = { year, month, puzzles: list, byDate };
  archiveState.monthCache.set(key, monthData);
  return monthData;
}

// Choose a default date for a month (today if available, otherwise first day).
function archiveDefaultSelection(year, month, monthData) {
  const today = toDateKey(new Date());
  const monthPrefix = `${year}-${pad2(month)}-`;
  if (today && today.startsWith(monthPrefix)) return today;
  const dates = Array.from(monthData?.byDate?.keys?.() || []).sort();
  if (dates.length) return dates[0];
  return archiveDateKey(year, month, 1);
}

// Populate year/month selectors and enable prev/next navigation.
function renderArchiveControls() {
  const yearSel = els.archiveYearSelect;
  const monthSel = els.archiveMonthSelect;
  const prevBtn = els.archivePrevMonth;
  const nextBtn = els.archiveNextMonth;
  if (!yearSel || !monthSel || !prevBtn || !nextBtn) return;

  const years = [...archiveState.years].sort((a, b) => b - a);
  yearSel.innerHTML = "";
  years.forEach((y) => {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    yearSel.appendChild(opt);
  });

  const curYear = archiveState.current.year ?? years[0];
  const yearMonths = archiveState.monthsByYear.get(curYear) || [];
  const curMonth = archiveState.current.month ?? yearMonths[0];

  yearSel.value = curYear != null ? String(curYear) : "";
  monthSel.innerHTML = "";
  yearMonths.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = String(m);
    opt.textContent = ARCHIVE_MONTH_LABELS[m - 1] || String(m);
    monthSel.appendChild(opt);
  });
  monthSel.value = curMonth != null ? String(curMonth) : "";

  yearSel.disabled = !years.length;
  monthSel.disabled = !yearMonths.length;

  const idx = archiveState.availableMonths.findIndex(
    (m) => m.year === curYear && m.month === curMonth
  );
  prevBtn.disabled = idx <= 0;
  nextBtn.disabled = idx < 0 || idx >= archiveState.availableMonths.length - 1;
}

// Render the calendar grid with per-day progress states.
function renderArchiveCalendar() {
  const grid = els.archiveCalendar;
  if (!grid) return;
  grid.innerHTML = "";

  const data = archiveState.monthData;
  if (!data) return;

  const { year, month, byDate } = data;
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDay = new Date(year, month - 1, 1).getDay();
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  const progressStore = loadChainProgressStore();
  const todayKey = toDateKey(new Date());

  const frag = document.createDocumentFragment();
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDay + 1;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "archive-day";

    if (dayNum < 1 || dayNum > daysInMonth) {
      btn.classList.add("is-empty");
      btn.setAttribute("aria-hidden", "true");
      btn.disabled = true;
      frag.appendChild(btn);
      continue;
    }

    const dateKey = archiveDateKey(year, month, dayNum);
    const puzzle = byDate.get(dateKey) || null;
    const hasPuzzle = !!puzzle;
    const isFuture = !!(todayKey && dateKey > todayKey);

    // state drives calendar visuals: hidden, complete, progress, or not-started.
    let state = "hidden";
    if (hasPuzzle && !isFuture) {
      const key = chainPuzzleKey(puzzle);
      const data = key ? progressStore.puzzles?.[key] : null;
      const hasInput = Array.isArray(data?.usr) && data.usr.some(Boolean);
      if (data?.done) state = "complete";
      else if (data?.started || hasInput) state = "progress";
      else state = "not-started";
    }

    const isPlayable = hasPuzzle && (!isFuture || DEV_MODE);
    btn.dataset.archiveDate = dateKey;
    btn.dataset.state = state;
    btn.dataset.hasPuzzle = hasPuzzle ? "true" : "false";
    btn.dataset.future = isFuture ? "true" : "false";
    const metaSpan = document.createElement("span");
    metaSpan.className = "archive-day-meta";
    const labelSpan = document.createElement("span");
    labelSpan.className = "archive-day-label";
    labelSpan.textContent = String(dayNum);
    btn.append(metaSpan, labelSpan);
    btn.disabled = !isPlayable;

    if (todayKey && dateKey === todayKey) btn.classList.add("is-today");
    if (archiveState.selectedDateKey === dateKey) btn.classList.add("is-selected");

    frag.appendChild(btn);
  }

  grid.appendChild(frag);
}

// Update the CTA label based on progress (play/continue/admire).
function updateArchiveAction() {
  const btn = els.archiveActionBtn;
  if (!btn) return;
  const label = els.archiveActionLabel;
  const meta = els.archiveActionMeta;

  const dateKey = archiveState.selectedDateKey;
  const monthData = archiveState.monthData;
  const todayKey = toDateKey(new Date());

  const puzzle = monthData?.byDate?.get?.(dateKey) || null;
  const isFuture = !!(todayKey && dateKey && dateKey > todayKey);
  const playable = !!puzzle && (!isFuture || DEV_MODE);

  archiveState.selectedPuzzle = puzzle;
  archiveState.selectedPlayable = playable;
  archiveState.selectedAction = "none";

  if (!puzzle) {
    if (label) label.textContent = "No puzzle";
    if (meta) meta.textContent = "";
    btn.disabled = true;
    return;
  }

  const store = loadChainProgressStore();
  const key = chainPuzzleKey(puzzle);
  const data = key ? store.puzzles?.[key] : null;
  const usr = Array.isArray(data?.usr) ? data.usr : [];
  const hasInput = usr.some(Boolean);
  const model = computed(puzzle);
  const total = model.entries?.length || 0;
  const solved = (model.entries || []).filter((e) => {
    for (let i = 0; i < e.len; i++) {
      const idx = e.start + i;
      if (!usr[idx]) return false;
      if (usr[idx] !== model.exp[idx]) return false;
    }
    return true;
  }).length;

  if (data?.done) {
    archiveState.selectedAction = "admire";
    if (label) label.textContent = "Admire puzzle";
    const timeSec = Math.max(0, Math.floor(data?.stats?.timeSec || data?.lastFinishElapsedSec || 0));
    if (meta) meta.textContent = fmtTime(timeSec);
  } else if (data?.started || hasInput) {
    archiveState.selectedAction = "continue";
    if (label) label.textContent = "Continue puzzle";
    if (meta) meta.textContent = `(${solved}/${total})`;
  } else {
    archiveState.selectedAction = "play";
    if (label) label.textContent = "Play";
    if (meta) meta.textContent = "";
  }

  btn.disabled = !playable;
}

// Set month/year selection and render calendar.
async function setArchiveMonth(year, month, opts = {}) {
  const token = ++archiveState.renderToken;
  await loadArchiveIndex();
  if (token !== archiveState.renderToken) return;

  if (!archiveState.availableMonths.length) {
    archiveState.current = { year: null, month: null };
    archiveState.monthData = null;
    archiveState.selectedDateKey = null;
    renderArchiveControls();
    renderArchiveCalendar();
    updateArchiveAction();
    return;
  }

  const requestedParts = opts.selectDateKey ? datePartsFromKey(opts.selectDateKey) : null;
  const targetYear = requestedParts?.year ?? year;
  const targetMonth = requestedParts?.month ?? month;
  const exact = archiveState.availableMonths.find((m) => m.year === targetYear && m.month === targetMonth);
  const fallback = exact || archiveState.availableMonths[archiveState.availableMonths.length - 1];

  archiveState.current = { year: fallback.year, month: fallback.month };
  renderArchiveControls();

  const monthData = await loadArchiveMonth(fallback.year, fallback.month);
  if (token !== archiveState.renderToken) return;
  archiveState.monthData = monthData;

  const nextSelection = opts.selectDateKey || archiveDefaultSelection(fallback.year, fallback.month, monthData);
  archiveState.selectedDateKey = nextSelection;

  renderArchiveCalendar();
  updateArchiveAction();
}

// Select a day in the archive calendar.
function selectArchiveDate(dateKey) {
  if (!dateKey) return;
  archiveState.selectedDateKey = dateKey;
  els.archiveCalendar?.querySelectorAll?.(".archive-day.is-selected")
    ?.forEach((el) => el.classList.remove("is-selected"));
  const btn = els.archiveCalendar?.querySelector?.(`[data-archive-date="${dateKey}"]`);
  btn?.classList.add("is-selected");
  updateArchiveAction();
}

// Ensure an archive puzzle exists in the main puzzles list; return its index.
function ensurePuzzleInList(puzzle) {
  const id = normalizePuzzleId(puzzle).id;
  const idx = puzzles.findIndex((p) => isChainPuzzle(p) && normalizePuzzleId(p).id === id);
  if (idx >= 0) return idx;
  puzzles.push(normPuzzle(puzzle));
  return puzzles.length - 1;
}

const isArchiveDailyPuzzle = (p) => {
  const id = normalizePuzzleId(p).id;
  const today = todayKey();
  return isDailyChainPuzzle(p) && id && today && id !== today;
};

// Open the archive modal and load the requested date/month.
async function openArchiveModal(opts = {}) {
  if (!els.archiveModal) return;
  const now = new Date();
  if (!els.archiveModal.hidden) return;
  if (els.splash && !els.splash.hidden) closeSplash();
  els.archiveModal.hidden = false;
  els.archiveModal.setAttribute("aria-hidden", "false");
  document.documentElement.classList.add("is-modal-open");
  if (!IS_IOS) {
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
  }
  requestAnimationFrame(() => els.archiveModal?.classList.add("is-open"));
  const dateKey = typeof opts.dateKey === "string" ? opts.dateKey : toDateKey(now);
  const parts = dateKey ? datePartsFromKey(dateKey) : null;
  const targetYear = parts?.year ?? now.getFullYear();
  const targetMonth = parts?.month ?? (now.getMonth() + 1);
  setArchiveMonth(targetYear, targetMonth, { selectDateKey: dateKey });
}

function closeArchiveModal() {
  if (!els.archiveModal) return;
  els.archiveModal.classList.remove("is-open");
  els.archiveModal.setAttribute("aria-hidden", "true");
  els.archiveModal.hidden = true;
  document.documentElement.classList.remove("is-modal-open");
  if (!IS_IOS) {
    document.body.style.overflow = "";
    document.body.style.touchAction = "";
  }
}

// Settings panel is a simple show/hide container.
const isSettingsPanelOpen = () => !!els.settingsPanel && !els.settingsPanel.hidden;
function openSettingsPanel() {
  if (!els.settingsPanel) return;
  els.settingsPanel.hidden = false;
  els.settingsPanel.setAttribute("aria-hidden", "false");
  els.settingsPanel.classList.add("is-open");
  els.settingsBtn?.setAttribute("aria-expanded", "true");
}

function closeSettingsPanel() {
  if (!els.settingsPanel) return;
  els.settingsPanel.classList.remove("is-open");
  els.settingsPanel.setAttribute("aria-hidden", "true");
  els.settingsPanel.hidden = true;
  els.settingsBtn?.setAttribute("aria-expanded", "false");
}

function toggleSettingsPanel() {
  if (isSettingsPanelOpen()) closeSettingsPanel();
  else openSettingsPanel();
}

// Color mode persists per user and respects system preference for auto.
const COLOR_MODE_KEY = `${KEY}__color_mode`;
const ONSCREEN_KB_KEY = `${KEY}__show_onscreen_keyboard`;
const COLOR_MODE_AUTO = "auto";
const COLOR_MODE_LIGHT = "light";
const COLOR_MODE_DARK = "dark";
const COLOR_MODE_VALUES = new Set([COLOR_MODE_AUTO, COLOR_MODE_LIGHT, COLOR_MODE_DARK]);
const colorModeTabs = Array.from(document.querySelectorAll(".settings-color-mode .tab[data-mode]"));
const prefersColorQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
let currentColorMode = COLOR_MODE_AUTO;

// Resolve "auto" to the current system preference.
function resolveAutoColorMode() {
  return prefersColorQuery && prefersColorQuery.matches ? COLOR_MODE_DARK : COLOR_MODE_LIGHT;
}

// Apply resolved mode to the root for CSS theming.
function applyColorMode(mode) {
  const resolved = mode === COLOR_MODE_AUTO ? resolveAutoColorMode() : mode;
  if (!resolved) return;
  document.documentElement.setAttribute("data-mode", resolved);
}

// Update tab UI to reflect the current selection.
function updateColorModeUI(mode) {
  colorModeTabs.forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
}

// Set and optionally persist a color mode.
function setColorMode(mode, { persist = true } = {}) {
  const next = COLOR_MODE_VALUES.has(mode) ? mode : COLOR_MODE_AUTO;
  currentColorMode = next;
  updateColorModeUI(next);
  applyColorMode(next);
  if (persist) {
    try {
      localStorage.setItem(COLOR_MODE_KEY, next);
    } catch {}
  }
}

function loadColorMode() {
  let saved = null;
  try {
    saved = localStorage.getItem(COLOR_MODE_KEY);
  } catch {}
  setColorMode(saved || COLOR_MODE_AUTO, { persist: false });
}

// Restore user preference for the on-screen keyboard.
function loadOnscreenKeyboardPref() {
  if (!els.showOnscreenKeyboard) return;
  let enabled = false;
  try {
    enabled = localStorage.getItem(ONSCREEN_KB_KEY) === "1";
  } catch {}
  els.showOnscreenKeyboard.checked = enabled;
  els.showOnscreenKeyboard.dispatchEvent(new Event("change", { bubbles: true }));
}

function openSplash(forceState) {
  if (!els.splash) return;
  updateSplashContent(forceState);
  els.splash.hidden = false;
  els.splash.setAttribute("aria-hidden", "false");
  document.documentElement.classList.add("is-modal-open");
  if (!IS_IOS) {
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
  }
  requestAnimationFrame(() => els.splash?.classList.add("is-open"));
}

function closeSplash() {
  if (!els.splash) return;
  els.splash.classList.remove("is-open");
  els.splash.setAttribute("aria-hidden", "true");
  els.splash.hidden = true;
  closeSettingsPanel();
  document.documentElement.classList.remove("is-modal-open");
  if (!IS_IOS) {
    document.body.style.overflow = "";
    document.body.style.touchAction = "";
  }
}

// Primary CTA handles FTUE gating and resumes/starts the chain.
function handleSplashPrimary() {
  if (!hasSeenFtue()) {
    // First-time: move to chain view in an idle state, then show FTUE (chain must not start yet)
    setTab(VIEW.CHAIN);
    chainForceIdleZero();
    chain.started = false;
    chain.running = false;
    chain.elapsed = 0;
    chainSetUIState(CHAIN_UI.IDLE);
    closeSplash();
    openFtue(0);
    return;
  }

  const state = splashState();
  setTab(VIEW.CHAIN);
  if (state === "complete") {
    closeSplash();
    return;
  }
  if (state === "paused") {
    closeSplash();
    if (play.done) return;
    if (chain.started) chainResume();
    else chainStartNow();
    return;
  }
  closeSplash();
  if (!chain.started) chainStartNow();
  else if (!chain.running) chainResume();
}

// Decide whether to show splash or jump to the archive after a recent return.
function maybeShowSplashOnLoad() {
  if (_splashShown || SUPPRESS_SPLASH) return;
  _splashShown = true;
  const last = getLastPlayedChain();
  const today = todayKey();
  const lastAt = Number.isFinite(last?.at) ? last.at : null;
  const withinArchiveWindow =
    lastAt == null ? true : Date.now() - lastAt <= ARCHIVE_RETURN_TIMEOUT_MS;
  if (last?.isDate && last.id && today && last.id !== today && withinArchiveWindow) {
    openArchiveModal({ dateKey: last.id });
    return;
  }
  openSplash();
}

// Serialize the current chain state for persistence (including penalties + locks).
function chainProgressSnapshot(p) {
  if (play.mode !== MODE.CHAIN) return null;
  const key = chainPuzzleKey(p);
  if (!key) return null;
  const normalizedId = normalizePuzzleId(p);
  const puzzleType = MODE.CHAIN;
  const hasInput = Array.isArray(play.usr) && play.usr.some(Boolean);
  const elapsed = chain.running ? (Date.now() - chain.startAt) / 1000 : chain.elapsed || 0;
  const score = scoreChain();
  const snap = {
    puzzleKey: key,
    puzzleId: normalizedId.id || null,
    puzzleType,
    puzzleIdIsDate: !!normalizedId.isDate,
    savedDayKey: todayKey(), // used to invalidate daily puzzles on date change
    usr: (play.usr || []).slice(0, play.n),
    at: clamp(play.at ?? 0, 0, Math.max(0, play.n - 1)),
    started: !!(chain.started || play.done || hasInput),
    done: !!play.done,
    revealed: !!play.revealed,
    lockedEntries: [...play.lockedEntries],
    lockedCells: Array.isArray(play.lockedCells) ? play.lockedCells.slice(0, play.n) : [],
    hintsUsed: chain.hintsUsed || 0,
    hintPenaltySecTotal: chain.hintPenaltySecTotal || 0,
    wordPenaltySecTotal: chain.wordPenaltySecTotal || 0,
    elapsed: Math.max(0, +elapsed || 0),
    lastFinishElapsedSec: Math.max(0, chain.lastFinishElapsedSec || (play.done ? elapsed : 0)),
    unsolvedCount: chain.unsolvedCount || 0,
  };

  if (play.done) {
    snap.stats = {
      timeSec: snap.lastFinishElapsedSec,
      solved: score.correct,
      total: play.entries?.length || 0,
      hintsUsed: snap.hintsUsed,
    };
  }

  return snap;
}

// Save chain progress now (used after major events).
function persistChainProgressImmediate() {
  if (play.mode !== MODE.CHAIN) return;
  const p = puzzles[pIdx];
  const snap = chainProgressSnapshot(p);
  if (!snap) return;
  pruneStaleChainProgress();
  const store = loadChainProgressStore();
  store.puzzles[snap.puzzleKey] = snap;
  saveChainProgressStore(store);
  setLastPlayedChain(p);
  _persistTickLastTs = performance.now ? performance.now() : Date.now();
}

// Throttle persistence to animation frame to avoid excessive writes.
function requestPersistChainProgress() {
  if (play.mode !== MODE.CHAIN) return;
  if (_persistChainRaf) return;
  _persistChainRaf = requestAnimationFrame(() => {
    _persistChainRaf = 0;
    persistChainProgressImmediate();
  });
}

// Restore persisted progress for the current chain puzzle (if it matches).
function restoreChainProgressForCurrentPuzzle() {
  if (play.mode !== MODE.CHAIN) return false;
  _restoredFromStorage = false;
  const p = puzzles[pIdx];
  const key = chainPuzzleKey(p);
  if (!key) return false;

  pruneStaleChainProgress();
  const store = loadChainProgressStore();
  const data = store.puzzles?.[key];
  const today = todayKey();
  const isDaily = isDailyChainPuzzle(p);
  const puzzleId = normalizePuzzleId(p).id;
  const isCurrentDaily = isDaily && today && puzzleId === today;
  // Daily puzzles should not carry progress across days.
  const stale = data && isCurrentDaily && data.savedDayKey && data.savedDayKey !== today;

  if (stale) {
    delete store.puzzles[key];
    saveChainProgressStore(store);
  }
  if (!data || stale) return false;

  const ui = ensureChainUI();

  play.usr = Array.from({ length: play.n }, (_, i) => data.usr?.[i] || "");
  play.at = clamp(data.at ?? 0, 0, Math.max(0, play.n - 1));
  play.done = !!data.done;
  play.revealed = !!data.revealed;

  chain.started = !!(data.started || play.done || play.usr.some(Boolean));
  chain.running = false;
  chain.elapsed = Math.max(0, +data.elapsed || 0);
  chain.startAt = 0;
  chain.left = 0;
  chain.lastFinishElapsedSec = Math.max(0, +data.lastFinishElapsedSec || 0);
  chain.unsolvedCount = Math.max(0, +data.unsolvedCount || 0);
  chain.hintsUsed = Math.max(0, +data.hintsUsed || 0);
  chain.hintPenaltySecTotal = Math.max(0, +data.hintPenaltySecTotal || chain.hintsUsed * HINT_PENALTY_SEC || 0);
  chain.wordPenaltySecTotal = Math.max(0, +data.wordPenaltySecTotal || 0);

  play.lockedEntries = new Set(Array.isArray(data.lockedEntries) ? data.lockedEntries : []);
  const prevLocked = Array.isArray(data.lockedCells) ? data.lockedCells.slice(0, play.n) : [];
  play.lockedCells = prevLocked.concat(Array.from({ length: Math.max(0, play.n - prevLocked.length) }, () => false));
  rebuildLockedCells();

  ui.timer.textContent = fmtTime(chain.elapsed);
  const state = play.done ? CHAIN_UI.DONE : chain.started ? CHAIN_UI.PAUSED : CHAIN_UI.IDLE;
  chainSetUIState(state, ui);
  setInlineCluesHiddenUntilChainStart();
  updateLockedWordUI();
  updatePlayUI();
  setAt(play.at, { behavior: "none", noScroll: true });
  scrollActiveCellAfterRestore(play.at);
  _restoredFromStorage = true;
  _restoredAt = play.at;

  return true;
}


// ---- Utils ----
// Shared helpers for string normalization, bounds, IDs, and date parsing.
const cleanA = (s) => (s || "").toUpperCase().replace(/[^A-Z]/g, "");
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const insets = (h) => (h === "mid" ? [12.5, 12.5] : h === "inner" ? [25, 25] : [0, 0]);
const isEditable = (el) =>
  !!(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));

// Stable random tie-breaker for entries with the same start position.
const tieR = new WeakMap();
const tr = (w) => {
  let v = tieR.get(w);
  if (v == null) {
    v = Math.random();
    tieR.set(w, v);
  }
  return v;
};

const isChainPuzzle = (p) => String(p?.type || MODE.PUZZLE) === MODE.CHAIN;

// Placeholder difficulty inference (currently unused).
const inferDiffFromColor = () => "easy";

const DATE_ID_RE = /^\d{4}-\d{2}-\d{2}$/;

// Convert Date to YYYY-MM-DD (UTC-insensitive for labels).
const toDateKey = (d) => {
  if (!(d instanceof Date) || Number.isNaN(+d)) return null;
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const pad = (n) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(day)}`;
};

const normalizeDateKey = (val) => {
  const raw = String(val || "").trim();
  if (!raw) return { dateKey: null };

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const y = +iso[1];
    const m = +iso[2];
    const d = +iso[3];
    if (y >= 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return { dateKey: `${iso[1]}-${iso[2]}-${iso[3]}` };
    }
  }

  const mmddyyyy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mmddyyyy) {
    const m = +mmddyyyy[1];
    const d = +mmddyyyy[2];
    const y = +mmddyyyy[3];
    const dt = new Date(y, m - 1, d);
    if (dt && dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) {
      const pad = (n) => String(n).padStart(2, "0");
      return { dateKey: `${y}-${pad(m)}-${pad(d)}` };
    }
  }

  const parsed = new Date(raw);
  const key = toDateKey(parsed);
  return { dateKey: key };
};

const dateFromKey = (key) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt && dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) return dt;
  return null;
};

const datePartsFromKey = (key) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { year: y, month: mo, day: d };
};

// Normalize any ID candidate to either a date or a stable string key.
const normalizeIdCandidate = (val) => {
  const raw = String(val ?? "").trim();
  if (!raw) return { id: null, isDate: false };
  const { dateKey } = normalizeDateKey(raw);
  if (dateKey) return { id: dateKey, isDate: true };
  return { id: raw, isDate: DATE_ID_RE.test(raw) };
};

const getLastPlayedChain = () => {
  try {
    const raw = localStorage.getItem(LAST_PLAYED_CHAIN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const id = String(data.id || "").trim();
    if (!id) return null;
    const at = Number.isFinite(+data.at) ? +data.at : null;
    return { id, isDate: !!data.isDate, at };
  } catch {
    return null;
  }
};

const setLastPlayedChain = (puzzle) => {
  const norm = normalizePuzzleId(puzzle);
  if (!norm.id) return;
  try {
    localStorage.setItem(
      LAST_PLAYED_CHAIN_KEY,
      JSON.stringify({ id: norm.id, isDate: !!norm.isDate, at: Date.now() })
    );
  } catch {}
};

// Signature used to disambiguate puzzles without explicit IDs.
const puzzleWordSignature = (p) =>
  (p?.words || [])
    .map((w) => `${cleanA(w.answer)}@${Math.max(1, Math.floor(+w.start || 1))}`)
    .join(";");

// Pick a stable puzzle identifier (prefers explicit ID/date/title).
const normalizePuzzleId = (p) => {
  const candidates = [p?.id, p?.dateKey, p?.date, p?.title];
  for (const cand of candidates) {
    const norm = normalizeIdCandidate(cand);
    if (norm.id) return norm;
  }
  const sig = puzzleWordSignature(p);
  const fallback = sig || "puzzle";
  return { id: fallback, isDate: DATE_ID_RE.test(fallback) };
};

const isDateId = (id) => DATE_ID_RE.test(String(id || "").trim());

// Format a date-based puzzle ID for display.
const puzzleDateLabel = (p) => {
  const raw = typeof p === "string" ? p : p?.id;
  const id = String(raw || "").trim();
  if (!isDateId(id)) return null;
  const dt = dateFromKey(id);
  if (!dt || Number.isNaN(+dt)) return null;
  return dt.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
};

const puzzleLabel = (p) => {
  const id = String(p?.id || "").trim();
  return id || "Untitled";
};

const isDailyChainPuzzle = (p) => isChainPuzzle(p) && isDateId(p?.id);
const isCustomChainPuzzle = (p) => isChainPuzzle(p) && !isDateId(p?.id);

// Normalize word objects from data files.
const normWord = (w, pType, opts = {}) => {
  const out = {
    clue: String(w?.clue || ""),
    answer: String(w?.answer || ""),
    start: +w?.start || 1,
  };

  return out;
};


// Normalize puzzle records (type, palette, and word list).
const normPuzzle = (p) => {
  let type = String(p?.type || MODE.PUZZLE).toLowerCase();
  if (type === "overlap") type = MODE.PUZZLE;
  const wordsRaw = Array.isArray(p?.words) ? p.words : [];
  const fallback = { clue: "Clue", answer: "WORD", start: 1 };
  const timed = type === MODE.CHAIN ? false : true;
  const words = (wordsRaw.length ? wordsRaw : [fallback]).map((w) => normWord(w, type, { timed }));
  const { id } = normalizePuzzleId({ ...p, type });

  const out = {
    id,
    // legacy title retained in memory only; UI uses id instead
    title: String(p?.title || ""),
    type,
    palette: normalizePaletteId(p?.palette),
    words,
  };
  return out;
};

// ---- State ----
// Shared runtime state for the current puzzle and UI.
let puzzles = store.load().map(normPuzzle);
let pIdx = 0;

let currentView = loadLastView(); // play | chain

// Current puzzle state for the active board.
const play = {
  mode: MODE.PUZZLE,
  entries: [],
  exp: [],
  usr: [],
  n: 0,
  at: 0,
  done: false,
  revealed: false,
  fullSolveAnimated: false,

  lockedCells: [],
  lockedEntries: new Set(), // eIdx
};

// Selection state for range highlighting and select-all delete.
let selectedEntry = null;
let selectAllUnlocked = false;

// When we intentionally keep the cursor on a newly locked cell, pause letter-triggered auto-advance.
const lockedAutoAdvanceSuppression = { idx: null, remaining: 0 };

function markLockedAutoAdvanceSuppression(idx, count = 2) {
  lockedAutoAdvanceSuppression.idx = idx;
  lockedAutoAdvanceSuppression.remaining = Math.max(0, count);
}

function consumeLockedAutoAdvanceSuppression(idx) {
  if (
    lockedAutoAdvanceSuppression.remaining > 0 &&
    lockedAutoAdvanceSuppression.idx === idx &&
    isCellLocked(idx)
  ) {
    lockedAutoAdvanceSuppression.remaining -= 1;
    return true;
  }
  return false;
}

function clearLockedAutoAdvanceSuppressionIfMoved(newIdx) {
  if (lockedAutoAdvanceSuppression.idx != null && lockedAutoAdvanceSuppression.idx !== newIdx) {
    lockedAutoAdvanceSuppression.idx = null;
    lockedAutoAdvanceSuppression.remaining = 0;
  }
}

// ---- Touch + on-screen keyboard ----
// Handles hidden input for mobile typing and a custom on-screen keyboard on touch.
let hasInteracted = true;
const markInteracted = () => {
  hasInteracted = true;
};

const IS_TOUCH = "ontouchstart" in window || navigator.maxTouchPoints > 0;
const UA = navigator.userAgent || "";
const UA_DESKTOP_HINT =
  /(Windows NT|Macintosh|CrOS|Linux|X11)/i.test(UA) && !/(Mobile|Tablet|iPad|iPhone|Android)/i.test(UA);
const UA_DATA_DESKTOP = navigator.userAgentData ? navigator.userAgentData.mobile === false : false;

// On touch devices default to virtual keyboard; on desktop honor detection.
const DEFAULTS_TO_HARDWARE = UA_DESKTOP_HINT || UA_DATA_DESKTOP;
let hasHardwareKeyboard = IS_TOUCH ? false : DEFAULTS_TO_HARDWARE;
let hardwareKeyboardLocked = false; // set true when we detect hardware during this session
let lastHardwareKeyboardTs = 0;
const HARDWARE_STALE_MS = 120000; // demote hardware flag after ~2 minutes of no keys
const shouldUseCustomKeyboard = () => IS_TOUCH && !hasHardwareKeyboard;

// Hidden input used to receive native keyboard input on mobile.
const kb = document.createElement("input");
kb.type = "text";
kb.setAttribute("autocomplete", "off");
kb.setAttribute("autocapitalize", "none");
kb.spellcheck = false;
kb.setAttribute("autocorrect", "off");
kb.inputMode = "text";
kb.setAttribute("aria-hidden", "true");
kb.tabIndex = -1;
kb.style.cssText =
  "position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;font-size:16px;";
(document.body || document.documentElement).appendChild(kb);

// Sentinel keeps selection range consistent for mobile IME input.
const KB_SENTINEL = "\u200B";
const kbReset = () => {
  kb.value = KB_SENTINEL;
  try {
    kb.setSelectionRange(1, 1);
  } catch {}
};
kbReset();

// Focus the appropriate input target (stage or hidden input).
const focusForTyping = () => {
  if (!hasInteracted) return;
  if (!els.panelPlay || !els.panelPlay.classList.contains("is-active")) return;
  if (!document.hasFocus()) return;

  const a = document.activeElement;
  if (a && a !== kb && isEditable(a)) return;

  if (shouldUseCustomKeyboard() || hasHardwareKeyboard || !IS_TOUCH) {
    try {
      els.stage.focus({ preventScroll: true });
    } catch {
      els.stage.focus();
    }
    return;
  }

  try {
    kb.focus({ preventScroll: true });
  } catch {
    kb.focus();
  }
  kbReset();
};

kb.addEventListener("input", () => {
  if (shouldUseCustomKeyboard()) return;

  const v = kb.value || "";
  if (!v) return;
  for (const ch of v) {
    if (/^[a-zA-Z]$/.test(ch)) write(ch.toUpperCase());
  }
  kbReset();
});

kb.addEventListener("keydown", (e) => {
  if (shouldUseCustomKeyboard()) return;
  if (e.metaKey || e.ctrlKey) return;

  if (e.key === "Backspace") {
    e.preventDefault();
    back();
    kbReset();
    return;
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    move(-1);
    kbReset();
    return;
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    move(1);
    kbReset();
    return;
  }
});

const KB_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "BACKSPACE"],
];

// Build the custom on-screen keyboard and wire interactions (tap/hold repeat).
function initOnScreenKeyboard() {
  const root = els.keyboard;
  if (!root) return;

  root.addEventListener("contextmenu", (e) => e.preventDefault());

  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "On-screen keyboard");
  root.innerHTML = "";
  let lastPressTs = 0;
  let lastPointerHandledTs = 0;
  let suppressClicksUntil = 0;
  let repeatTimer = null;
  let repeatInterval = null;

  const stopRepeats = () => {
    if (repeatTimer) clearTimeout(repeatTimer);
    if (repeatInterval) clearInterval(repeatInterval);
    repeatTimer = null;
    repeatInterval = null;
  };

  KB_ROWS.forEach((rowKeys) => {
    const row = document.createElement("div");
    row.className = "keyboard-row text-system-semibold-sm";

    rowKeys.forEach((key) => {
      const btn = document.createElement("button");
      btn.type = "button";
      const isBackspace = key === "BACKSPACE";
      const isEnter = key === "ENTER";
      btn.className = `keyboard-key${isBackspace ? " keyboard-key--backspace" : ""}${isEnter ? " keyboard-key--enter" : ""}`;
      if (isBackspace) {
        btn.dataset.action = "backspace";
        btn.setAttribute("aria-label", "Backspace");
        btn.textContent = "";
      } else if (isEnter) {
        btn.dataset.action = "enter";
        btn.setAttribute("aria-label", "Next cell");
        btn.textContent = "";
      } else {
        btn.dataset.key = key;
        btn.setAttribute("aria-label", key);
        btn.textContent = key;
        const pv = document.createElement("div");
        pv.className = "keyboard-key-preview text-system-semibold-sm elevation-fixed-bottom";
        pv.textContent = key;
        btn.appendChild(pv);
      }
      row.appendChild(btn);
    });

    root.appendChild(row);
  });

  const triggerAction = (btn) => {
    if (btn.dataset.key) write(btn.dataset.key);
    else if (btn.dataset.action === "backspace") back();
    else if (btn.dataset.action === "enter") move(1);
  };

  const handlePress = (e, { isRepeat = false } = {}) => {
    const btn = e.target.closest("[data-key], [data-action]");
    if (!btn || btn.disabled) return;
    e.preventDefault();
    markInteracted();
    lastPressTs = performance.now();
    lastPointerHandledTs = lastPressTs;
    suppressClicksUntil = lastPointerHandledTs + 1000;

    pressedBtn = btn;
    btn.classList.add("is-pressed");
    if (!btn.dataset.action) showPreview(btn);

    triggerAction(btn);

    focusForTyping();

    // Start repeat for actions only on initial pointer press
    const allowRepeat = e.type && e.type.startsWith("pointer");
    if (!isRepeat && allowRepeat && btn.dataset.action) {
      stopRepeats();
      repeatTimer = setTimeout(() => {
        repeatInterval = setInterval(() => triggerAction(btn), 70);
      }, 350);
    }
  };

  const showPreview = (btn) => {
    if (!btn?.dataset?.key) return;
    const pv = btn.querySelector(".keyboard-key-preview");
    if (pv) pv.classList.add("is-visible");
  };

  const hidePreview = () => {
    if (!root) return;
    root.querySelectorAll(".keyboard-key-preview.is-visible").forEach((pv) => pv.classList.remove("is-visible"));
  };

  let pressedBtn = null;
  const clearPressed = () => {
    const pv = pressedBtn?.querySelector(".keyboard-key-preview");
    if (pv) pv.classList.remove("is-visible");
    if (pressedBtn) pressedBtn.classList.remove("is-pressed");
    pressedBtn = null;
    hidePreview();
    stopRepeats();
  };

  root.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest("[data-key], [data-action]");
    if (!btn) return;
    pressedBtn = btn;
    btn.classList.add("is-pressed");
    if (!btn.dataset.action) showPreview(btn);
    handlePress(e);
  });

  const endEvents = ["pointerup", "pointercancel"];
  endEvents.forEach((ev) => {
    root.addEventListener(ev, (e) => {
      if (!pressedBtn) return;
      lastPointerHandledTs = performance.now();
      suppressClicksUntil = lastPointerHandledTs + 1000;
      clearPressed();
    });
  });

  // Fallback click handler (in case a pointer event is missed)
  root.addEventListener("click", (e) => {
    // Skip if a pointer press was just handled
    if (performance.now() < suppressClicksUntil) return;
    handlePress(e);
    clearPressed();
  });

  ["pointerup", "pointercancel"].forEach((ev) => {
    window.addEventListener(ev, () => {
      stopRepeats();
      clearPressed();
    });
  });

  // safety: if focus leaves keyboard, clear pressed state
  root.addEventListener("focusout", () => clearPressed());
}

// Toggle custom keyboard based on device and view.
function updateKeyboardVisibility() {
  const root = els.keyboard;
  if (!root) return;

  const show = shouldUseCustomKeyboard() && (currentView === VIEW.PLAY || currentView === VIEW.CHAIN);

  root.classList.toggle("is-visible", show);
  root.setAttribute("aria-hidden", show ? "false" : "true");
  document.body.classList.toggle("uses-custom-keyboard", show);

  if (show) kb.blur();
}

// If no hardware key use is detected for a while, revert to touch keyboard.
function maybeDemoteHardwareKeyboard() {
  if (hardwareKeyboardLocked) return;
  if (!hasHardwareKeyboard) return;
  const stale = !lastHardwareKeyboardTs || Date.now() - lastHardwareKeyboardTs > HARDWARE_STALE_MS;
  if (!stale) return;

  hasHardwareKeyboard = false;
  updateKeyboardVisibility();
}

// Once hardware keyboard is detected on touch, lock it in for the session.
function noteHardwareKeyboard() {
  if (!IS_TOUCH) return;
  if (hasHardwareKeyboard) return;
  hasHardwareKeyboard = true;
  hardwareKeyboardLocked = true; // never show virtual keyboard again until reload
  lastHardwareKeyboardTs = Date.now();
  updateKeyboardVisibility();
  focusForTyping();
}

// ---- Model ----
// Build a normalized, sortable view of words and the expected letter array.
function computed(p) {
  let type = String(p?.type || MODE.PUZZLE).toLowerCase();
  if (type === "overlap") type = MODE.PUZZLE;

  // Normalize words into entries with calculated layout + color metadata.
  const entries = (p.words || [])
    .map((w, rawIdx) => {
      const ans = cleanA(w.answer);
      const start = Math.max(0, Math.floor(+w.start || 1) - 1);
      const h = HEIGHT_CYCLE[rawIdx % HEIGHT_CYCLE.length] || "full";
      const [t, b] = insets(h);

      let diff = null;
      const color = paletteColorForWord(p, rawIdx);


      return {
        clue: w.clue || "",
        ans,
        start,
        len: ans.length,
        color,
        t,
        b,
        h,
        r: tr(w),
        rawIdx,
        diff,
      };

    })
    .filter((e) => e.len)
    .sort((a, b) => a.start - b.start || a.r - b.r);

  entries.forEach((e, i) => (e.eIdx = i));

  const total = Math.max(1, ...entries.map((e) => e.start + e.len));
  // exp holds the expected letter per cell (null until covered by a word).
  const exp = Array.from({ length: total }, () => null);

  for (const e of entries) {
    for (let i = 0; i < e.len; i++) {
      const idx = e.start + i;
      const ch = e.ans[i];
      // If two words conflict on a letter, mark the puzzle invalid.
      if (exp[idx] && exp[idx] !== ch) {
        return { ok: false, total, exp, entries, conf: { idx, a: exp[idx], b: ch } };
      }
      exp[idx] = ch;
    }
  }

  // Any null positions are gaps (no word covers that column).
  const gaps = exp.map((c, i) => (c ? null : i)).filter((v) => v !== null);
  return { ok: true, total, exp, entries, gaps };
}

// Update CSS grid column count to match puzzle width.
function setCols(n) {
  document.documentElement.style.setProperty("--cols", String(n));
}

// Render the range overlays, clues, and per-cell buttons.
function renderGrid(target, model, clickable, puzzleForPalette) {
  if (target === els.grid) resetRangeClueHints();
  target.innerHTML = "";

  // Track which entries cover each cell (for ARIA + sizing)
  const cellWords = Array.from({ length: model.total }, () => []);

  // Ranges (explicit grid placement)
  for (const e of model.entries) {
    const d = document.createElement("div");

    const h = e.h || "full";
    d.className = `range range-${h}`;
    d.dataset.e = String(e.eIdx);

    // keep existing vars (safe if other CSS uses them)
    d.style.setProperty("--start", e.start);
    d.style.setProperty("--len", e.len);

    for (let i = e.start; i < e.start + e.len && i < model.total; i++) {
      cellWords[i].push(e);
    }

    // NEW: grid lines are 1-based
    d.style.setProperty("--gs", String(e.start + 1));
    d.style.setProperty("--ge", String(e.start + e.len + 1));

    d.style.setProperty("--color", e.color || "var(--c-red)");
    d.style.setProperty("--f", getComputedStyle(document.documentElement).getPropertyValue("--fill") || ".08");


    target.appendChild(d);

    // Range clue rendered directly in grid
    const rc = document.createElement("div");
    rc.className = "rangeClue";
    rc.dataset.e = String(e.eIdx);
    rc.style.setProperty("--gs", String(e.start + 1));
    rc.style.setProperty("--ge", String(e.start + e.len + 1));
    rc.style.setProperty("--color", e.color || "var(--c-red)");

    const row =
      h === "full" ? "1 / 2" :
      h === "mid" ? "2 / 3" :
      h === "inner" ? "3 / 4" : "1 / 2";
    rc.style.gridRow = row;

    const rcContent = document.createElement("div");
    rcContent.className = "rangeClue-content";

    const clueBtn = document.createElement("button");
    clueBtn.type = "button";
    clueBtn.className = "rangeClue-string text-uppercase-semibold-md elevation-active";
    clueBtn.dataset.e = String(e.eIdx);
    clueBtn.textContent = e.clue || "";
    clueBtn.setAttribute("aria-label", `${e.clue || "Clue"} (${e.len} letters)`);

    const hintBtn = document.createElement("button");
    hintBtn.type = "button";
    hintBtn.className = "rangeClue-hint text-uppercase-semibold-md elevation-active";
    hintBtn.dataset.e = String(e.eIdx);
    hintBtn.textContent = "Hint";
    hintBtn.setAttribute("aria-label", `Get a hint for ${e.clue || "this word"}`);

    rcContent.append(clueBtn, hintBtn);
    rc.appendChild(rcContent);
    target.appendChild(rc);
  }

  if (target === els.grid) {
    const focus = ensureRangeFocusEl();
    focus.hidden = true;
    focus.style.removeProperty("--gs");
    focus.style.removeProperty("--ge");
    focus.style.removeProperty("--color");
    focus.classList.remove("range-full", "range-mid", "range-inner");
    focus.classList.remove("is-active");
    focus.style.gridRow = "";
    target.appendChild(focus);
  }

  // Cells (MUST explicitly place into columns so they don't get auto-placed after ranges)
  for (let i = 0; i < model.total; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cell text-display-semibold-lg";
    b.dataset.i = i;
    b.disabled = !clickable;
    b.innerHTML = '<span class="num text-uppercase-semibold-md"></span><span class="letter"></span>';
    b.setAttribute("aria-label", cellAriaLabel(i, cellWords[i]));

    // Explicit column placement (1-based)
    b.style.gridColumnStart = String(i + 1);

    target.appendChild(b);
  }

  if (target === els.grid) {
    play.cellWords = cellWords;
  }

  // Ensure ranges always have a color (robust against missing inline vars)
  const ensureColor = (rangeEl) => {
    const existing = (rangeEl?.style?.getPropertyValue("--color") || "").trim();
    if (existing) return;
    const eIdx = Number(rangeEl?.dataset?.e);
    const entry = Number.isFinite(eIdx) ? model.entries.find((e) => e.eIdx === eIdx) : null;
    const fallbackColor = paletteColorForWord(puzzleForPalette || puzzles[pIdx], entry?.rawIdx ?? entry?.eIdx ?? 0);
    rangeEl.style.setProperty("--color", fallbackColor);
  };
  target.querySelectorAll(".range").forEach(ensureColor);
}




// ---- Horizontal keep-in-view ----
// Keeps the active cell centered without fighting user panning.
let _keepInViewRaf = 0;
// ---- Touch pan protection (iOS horizontal scroll) ----
let _isUserPanning = false;
let _panPointerId = null;
let _panMoved = false;
let _ignoreGridClickUntil = 0;

const PAN_SLOP_PX = 8;
let _panStartX = 0;
let _panStartY = 0;

function stopScrollFollow() {
  if (_scrollFollowRaf) cancelAnimationFrame(_scrollFollowRaf);
  _scrollFollowRaf = 0;
  _scrollFollowEl = null;
}


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
    if (_isUserPanning) { _scrollFollowRaf = 0; return; }
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


// Center a specific cell in the scroll view.
function keepCellInView(idx, behavior = IS_TOUCH ? "smooth" : "auto") {
  const sc = els.gridScroll;
  if (!sc || sc.scrollWidth <= sc.clientWidth) return;
  if (IS_TOUCH && _isUserPanning) return;

  let beh = behavior;
  let delta = 1;
  if (typeof behavior === "object") {
    beh = behavior.behavior ?? (IS_TOUCH ? "smooth" : "auto");
    delta = behavior.delta ?? 1;
  }

  const cell = els.grid.querySelector(`.cell[data-i="${idx}"]`);
  if (!cell) return;

  // Center-seeking scroll
  const cellCenter = cell.offsetLeft + cell.offsetWidth / 2;
  let target = cellCenter - sc.clientWidth / 2;

  const max = sc.scrollWidth - sc.clientWidth;
  target = Math.max(0, Math.min(target, max));

  // tiny deadzone to prevent micro updates
  if (Math.abs(sc.scrollLeft - target) < 1.5) return;

  // Avoid native smooth jitter on rapid calls
  if (beh === "smooth") {
    const k = delta > 1 ? 0.1 : 0.18; // slower ease on single and multi
    const eps = delta > 1 ? 0.5 : SCROLL_FOLLOW_EPS;
    smoothFollowScrollLeft(sc, target, { k, eps });
  } else {
    sc.scrollLeft = target;
  }
}



function keepActiveCellInView(behavior = IS_TOUCH ? "smooth" : "auto") {
  keepCellInView(play.at, behavior);
}

function requestKeepActiveCellInView(behavior) {
  if (_keepInViewRaf) return;
  _keepInViewRaf = requestAnimationFrame(() => {
    _keepInViewRaf = 0;
    keepActiveCellInView(behavior);
  });
}

// After restore, keep retrying until layout is ready.
function scrollActiveCellAfterRestore(idx = play.at) {
  let attempts = 0;
  const MAX_ATTEMPTS = 14;
  const tryScroll = () => {
    const sc = els.gridScroll;
    const cell = els.grid?.querySelector(`.cell[data-i="${idx}"]`);
    if (!sc || !cell) {
      if (attempts++ < MAX_ATTEMPTS) requestAnimationFrame(tryScroll);
      return;
    }
    const overflow = sc.scrollWidth - sc.clientWidth;
    if (overflow <= 2 && attempts++ < MAX_ATTEMPTS) {
      requestAnimationFrame(tryScroll);
      return;
    }
    keepCellInView(idx, { behavior: "auto", delta: 1 });
    updateThumbFromScroll(true);
  };
  requestAnimationFrame(tryScroll);
}

function scrollToWordStart(e, behavior = IS_TOUCH ? "smooth" : "auto") {
  if (!e) return;

  const sc = els.gridScroll;
  if (!sc || sc.scrollWidth <= sc.clientWidth) return;

  const cell = els.grid.querySelector(`.cell[data-i="${e.start}"]`);
  if (!cell) return;

  const pad = 24; // breathing room from left edge
  let target = cell.offsetLeft - pad;

  const max = sc.scrollWidth - sc.clientWidth;
  target = Math.max(0, Math.min(target, max));

  try {
    sc.scrollTo({ left: target, behavior });
  } catch {
    sc.scrollLeft = target;
  }
}


// ---- Selection highlight ----
// Navigation helpers for unresolved cells and word-based jumps.
function entryContainsIndex(e, i) {
  return i >= e.start && i < e.start + e.len;
}

function isCellUnresolved(i) {
  if (play.done) return false;
  if (play.mode === MODE.CHAIN) {
    return !isCellLocked(i);
  }
  const exp = play.exp?.[i] || "";
  const usr = play.usr?.[i] || "";
  return exp !== usr;
}

// Walk in a direction to find the next editable/incorrect cell.
function findUnresolvedCell(from, dir) {
  if (!play.exp?.length) return null;
  let i = clamp(from + dir, 0, play.n - 1);
  while (i >= 0 && i < play.n) {
    if (isCellUnresolved(i)) {
      logNav("findUnresolvedCell hit", { from, dir, i });
      return i;
    }
    i += dir;
  }
  logNav("findUnresolvedCell none", { from, dir });
  return null;
}

function unresolvedEntries() {
  return (play.entries || []).filter((e) => !isWordCorrect(e));
}

function firstUnresolvedCellInEntry(e) {
  if (!e) return null;
  for (let i = 0; i < e.len; i++) {
    const idx = e.start + i;
    if (isCellUnresolved(idx)) return idx;
  }
  return e.start; // fallback
}

// Word-level navigation; logic differs between overlap vs chain mode.
function jumpToUnresolvedWord(delta) {
  logNav("jumpToUnresolvedWord start", {
    delta,
    at: play.at,
    currentEntry: entryAtIndex(play.at),
    usr: play.usr?.join(""),
    locked: [...play.lockedEntries],
  });

  // Overlap mode: always jump by word starts, ignoring correctness/locks (done or not).
  if (play.mode === MODE.PUZZLE) {
    const entries = (play.entries || []).slice().sort((a, b) => a.start - b.start);
    if (!entries.length) return;
    const idx = play.at;
    const containing = entryAtIndex(idx);
    const before = entries.filter((e) => e.start <= idx);
    const cur = containing || (before.length ? before[before.length - 1] : entries[0]);

    let targetEntry = null;
    if (delta > 0) {
      targetEntry = entries.find((e) => e.start > idx) || entries[0];
    } else {
      if (idx !== cur.start) {
        targetEntry = cur;
      } else {
        const prev = [...entries].reverse().find((e) => e.start < idx);
        targetEntry = prev || entries[entries.length - 1];
      }
    }

    const targetCell = targetEntry.start;
    const deltaCells = Math.abs(targetCell - play.at) || 1;
    logNav("jumpToUnresolvedWord overlap-target", {
      targetCell,
      deltaCells,
      curStart: cur.start,
      targetStart: targetEntry.start,
    });
    setAt(targetCell, { behavior: { behavior: "smooth", delta: deltaCells } });
    showRangeFocusForEntry(targetEntry);
    return;
  }

  // In a finished puzzle, allow word navigation across all entries, including locked/solved.
  if (play.done) {
    const entries = (play.entries || []).slice().sort((a, b) => a.start - b.start);
    if (!entries.length) return;
    const idx = play.at;
    const cur = entryAtIndex(idx) || entries[0];
    const curIdx = entries.findIndex((e) => e === cur);
    const targetEntry =
      delta > 0
        ? entries[(curIdx + 1) % entries.length]
        : entries[(curIdx - 1 + entries.length) % entries.length];

    const targetCell = targetEntry.start;
    const deltaCells = Math.abs(targetCell - play.at) || 1;
    logNav("jumpToUnresolvedWord done-target", {
      targetCell,
      deltaCells,
      playAt: play.at,
      curStart: cur.start,
      targetStart: targetEntry.start,
    });
    setAt(targetCell, { behavior: { behavior: "smooth", delta: deltaCells } });
    showRangeFocusForEntry(targetEntry);
    return;
  }

  const unsolved = unresolvedEntries().sort((a, b) => a.start - b.start);
  if (!unsolved.length) return;
  const idx = play.at;
  const current = entryAtIndex(idx);

  const targets = unsolved
    .map((entry) => ({ entry, cell: firstUnresolvedCellInEntry(entry) }))
    .filter((t) => t.cell != null)
    .sort((a, b) => a.cell - b.cell);

  if (!targets.length) return;

  const curIdx =
    current && !isWordCorrect(current)
      ? targets.findIndex((t) => t.entry.eIdx === current.eIdx)
      : -1;
  const curFirst = curIdx >= 0 ? targets[curIdx].cell : null;

  logNav("jumpToUnresolvedWord map", {
    targets: targets.map((t) => ({ eIdx: t.entry.eIdx, start: t.entry.start, cell: t.cell })),
    curIdx,
    curFirst,
  });

  let targetCell = null;
  let targetEntry = null;
  const len = targets.length;

  if (delta > 0) {
    // Always move to the first unresolved cell of the next unresolved word
    const next = targets.find((t) => t.cell > idx);
    const tgt = next || targets[0];
    targetCell = tgt.cell;
    targetEntry = tgt.entry;
  } else {
    // Backward: if we're mid-word, go to this word's first unresolved; otherwise go to previous unresolved word
    if (curIdx >= 0 && idx !== curFirst) {
      targetCell = curFirst;
      targetEntry = targets[curIdx].entry;
    } else {
      const prev = [...targets].reverse().find((t) => t.cell < idx);
      const tgt = prev || targets[len - 1];
      targetCell = tgt.cell;
      targetEntry = tgt.entry;
    }
  }

  if (targetCell == null) return;
  if (targetCell === play.at) return;
  const deltaCells = Math.abs(targetCell - play.at) || 1;
  logNav("jumpToUnresolvedWord target", {
    targetCell,
    deltaCells,
    curFirst,
    targets: targets.map((t) => ({ eIdx: t.entry.eIdx, start: t.entry.start, cell: t.cell })),
    playAt: play.at,
  });
  setAt(targetCell, { behavior: { behavior: "smooth", delta: deltaCells } });
  if (targetEntry) showRangeFocusForEntry(targetEntry);
}
function cellAriaLabel(idx, words = []) {
  if (!words || !words.length) return `Cell ${idx + 1}`;

  const sorted = [...words].sort((a, b) => a.start - b.start || a.eIdx - b.eIdx);
  const parts = [];

  for (const w of sorted) {
    const pos = idx - w.start + 1;
    const status =
      play.mode === MODE.CHAIN ? (play.lockedEntries.has(w.eIdx) ? "solved" : "unsolved") : "";
    const clue = w.clue || "Clue";
    parts.push(`${clue}, cell ${pos} of ${w.len}${status ? `, ${status}` : ""}`);
  }

  return parts.join("; ");
}

// ---- Hints ----
// Range clue tooltips and hint application (fills one correct letter).
let _rangeHintOpen = null;
let _rangeHintHideTimer = 0;
let _rangeHintIntroTimer = 0;
let _rangeHintIntroClearTimer = 0;
let rangeFocusEl = null;
const HINT_OUT_MS = 180;
let _initialHintIntroQueued = false;
let _rangeHintPinned = null;

const focusedRangeEntry = () => {
  const eIdx = Number(rangeFocusEl?.dataset.e);
  if (Number.isNaN(eIdx)) return null;
  return play.entries.find((x) => x.eIdx === eIdx) || null;
};

const isCellInFocusedRange = (i) => {
  const e = focusedRangeEntry();
  if (!e) return false;
  return i >= e.start && i < e.start + e.len;
};

function setHintDisplay(rc, visible) {
  const hint = rc?.querySelector(".rangeClue-hint");
  if (!hint) return;
  hint.style.display = visible ? "inline-flex" : "none";
}

function scheduleHintDisplayNone(rc, delay = HINT_OUT_MS) {
  if (!rc) return;
  const hint = rc.querySelector(".rangeClue-hint");
  if (!hint) return;
  if (rc.classList.contains("is-hint-visible") || rc.classList.contains("is-hint-intro")) return;
  window.setTimeout(() => {
    if (rc.classList.contains("is-hint-visible") || rc.classList.contains("is-hint-intro")) return;
    hint.style.display = "none";
  }, delay);
}

function firstEditableCellInEntry(entry) {
  if (!entry) return null;
  for (let i = entry.start; i < entry.start + entry.len; i++) {
    if (play.mode === MODE.CHAIN && isCellLocked(i)) continue;
    return i;
  }
  return entry.start;
}

function clearRangeHintHideTimer() {
  if (_rangeHintHideTimer) clearTimeout(_rangeHintHideTimer);
  _rangeHintHideTimer = 0;
}

function rangeClueEl(eIdx) {
  return els.grid?.querySelector(`.rangeClue[data-e="${eIdx}"]`);
}

function hideRangeClueHint(eIdx = _rangeHintOpen) {
  if (eIdx == null) return;
  clearRangeHintHideTimer();
  const rc = rangeClueEl(eIdx);
  if (rc) {
    rc.classList.remove("is-hint-visible");
    scheduleHintDisplayNone(rc);
  }
  if (_rangeHintOpen === eIdx) _rangeHintOpen = null;
  if (_rangeHintPinned === eIdx) _rangeHintPinned = null;
}

function hideAllRangeClueHints() {
  clearRangeHintHideTimer();
  _rangeHintOpen = null;
  _rangeHintPinned = null;
  els.grid?.querySelectorAll(".rangeClue").forEach((rc) => {
    rc.classList.remove("is-hint-visible");
    scheduleHintDisplayNone(rc);
  });
}

// Show the hint button for a specific range clue.
function showRangeClueHint(eIdx) {
  const rc = rangeClueEl(eIdx);
  if (!rc || rc.classList.contains("is-hidden")) return;

  hideAllRangeClueHints();

  clearRangeHintHideTimer();
  const hint = rc.querySelector(".rangeClue-hint");
  if (hint) {
    hint.style.display = "inline-flex";
    rc.classList.remove("is-hint-visible", "is-hint-intro");
    void hint.offsetWidth; // ensure transition starts from hidden state
    requestAnimationFrame(() => rc.classList.add("is-hint-visible"));
  }
  _rangeHintOpen = eIdx;
}

function scheduleHideRangeClueHint(eIdx, delay = 2200) {
  clearRangeHintHideTimer();
  _rangeHintHideTimer = window.setTimeout(() => hideRangeClueHint(eIdx), delay);
}

function ensureRangeFocusEl() {
  if (!rangeFocusEl) {
    rangeFocusEl = document.createElement("div");
    rangeFocusEl.className = "range range-focus";
    rangeFocusEl.hidden = true;
  }
  return rangeFocusEl;
}

function hideRangeFocus() {
  if (!rangeFocusEl) return;
  rangeFocusEl.hidden = true;
  rangeFocusEl.style.display = "none";
  rangeFocusEl.dataset.e = "";
  rangeFocusEl.classList.remove("is-active");
}

// Highlight the selected word range with a focus overlay.
function showRangeFocusForEntry(entry) {
  if (!entry) return;
  const el = ensureRangeFocusEl();
  const rangeEl = els.grid?.querySelector(`.range[data-e="${entry.eIdx}"]`);
  const color = entry.color || rangeEl?.style.getPropertyValue("--color") || "var(--c-red)";
  el.hidden = false;
  el.style.display = "grid";
  el.dataset.e = String(entry.eIdx);
  el.style.setProperty("--gs", String(entry.start + 1));
  el.style.setProperty("--ge", String(entry.start + entry.len + 1));
  el.classList.remove("range-full", "range-mid", "range-inner");
  el.classList.add(`range-${entry.h || "full"}`);
  el.style.setProperty("--color", color);
  el.classList.add("is-active");
}

function onRangeClueContentOver(e) {
  if (IS_TOUCH || e.pointerType === "touch") return;
  const content = e.target.closest(".rangeClue-content");
  if (!content) return;
  const rc = content.closest(".rangeClue");
  const eIdx = Number(rc?.dataset.e);
  if (Number.isNaN(eIdx)) return;
  setHintDisplay(rc, true);
  clearRangeHintHideTimer();
  if (_rangeHintOpen === eIdx) rc.classList.add("is-hint-visible");
}

function onRangeClueContentOut(e) {
  if (IS_TOUCH || e.pointerType === "touch") return;
  const content = e.target.closest(".rangeClue-content");
  if (!content) return;
  const rc = content.closest(".rangeClue");
  const related = e.relatedTarget;
  if (related && related.closest(".rangeClue-content") === content) return;
  const eIdx = Number(rc?.dataset.e);
  if (Number.isNaN(eIdx)) return;
  if (_rangeHintPinned === eIdx) return;
  scheduleHideRangeClueHint(eIdx, 1000);
  scheduleHintDisplayNone(rc, HINT_OUT_MS);
}

function resetRangeClueHints() {
  clearRangeHintHideTimer();
  if (_rangeHintIntroTimer) clearTimeout(_rangeHintIntroTimer);
  if (_rangeHintIntroClearTimer) clearTimeout(_rangeHintIntroClearTimer);
  _rangeHintIntroTimer = 0;
  _rangeHintIntroClearTimer = 0;
  hideAllRangeClueHints();
  hideRangeFocus();
}

// Intro animation that briefly reveals hint buttons.
function pulseRangeHintIntro({ delay = 300, duration = 1400 } = {}) {
  if (play.mode === MODE.CHAIN && !chain.started) return;
  const clues = els.grid?.querySelectorAll(".rangeClue:not(.is-hidden)") || [];
  if (!clues.length || document.documentElement.classList.contains("chain-prestart")) return;

  if (_rangeHintIntroTimer) clearTimeout(_rangeHintIntroTimer);
  if (_rangeHintIntroClearTimer) clearTimeout(_rangeHintIntroClearTimer);

  _rangeHintIntroTimer = window.setTimeout(() => {
    clues.forEach((rc) => {
      setHintDisplay(rc, true);
      rc.classList.remove("is-hint-visible", "is-hint-intro");
      // force reflow so transition can start from opacity 0
      void rc.offsetWidth;
    });
    requestAnimationFrame(() => {
      clues.forEach((rc) => rc.classList.add("is-hint-intro", "is-hint-visible"));
      _rangeHintIntroClearTimer = window.setTimeout(() => {
        clues.forEach((rc) => {
          rc.classList.remove("is-hint-visible", "is-hint-intro");
          scheduleHintDisplayNone(rc, HINT_OUT_MS);
        });
        _rangeHintOpen = null;
      }, duration);
    });
  }, delay);
}

function queueInitialHintIntro(delay = 900) {
  if (_initialHintIntroQueued) return;
  _initialHintIntroQueued = true;
  window.setTimeout(() => pulseRangeHintIntro({ delay: 0 }), delay);
}

function firstHintIndex(entry) {
  if (!entry) return null;
  for (let i = entry.start; i < entry.start + entry.len && i < play.n; i++) {
    if (play.mode === MODE.CHAIN) {
      if (!isCellLocked(i)) return i;
    } else {
      if ((play.usr[i] || "") !== (play.exp[i] || "")) return i;
    }
  }
  return null;
}

// Fill one correct cell in a word and apply penalties in chain mode.
function applyHintForEntry(eIdx) {
  clearSelectAll();
  const entry = play.entries.find((x) => x.eIdx === eIdx);
  if (!entry) return;
  const idx = firstHintIndex(entry);
  if (idx == null) return;

  const expected = play.exp[idx] || "";
  const hadCorrectLetter = (play.usr[idx] || "") === expected;
  play.usr[idx] = expected;

  if (play.mode === MODE.CHAIN) {
    if (!chain.started && !play.done) chainStartNow();
    chain.hintsUsed += 1;
    play.lockedCells[idx] = true;
    const hintPenaltySec = hadCorrectLetter ? HINT_PENALTY_SEC / 2 : HINT_PENALTY_SEC;
    addTimePenalty(hintPenaltySec, "hint");

    let lockedByHint = false;
    if (isWordCorrect(entry)) {
      lockedByHint = !play.lockedEntries.has(entry.eIdx);
      play.lockedEntries.add(entry.eIdx);
      rebuildLockedCells();
    }

    updateLockedWordUI();
    updatePlayUI();
    if (lockedByHint) requestAnimationFrame(() => requestAnimationFrame(() => triggerSolveAnimation(entry)));
    requestChainClues();
    chainMaybeFinishIfSolved();
    requestPersistChainProgress();
  } else {
    updatePlayUI();
    checkSolvedOverlapOnly();
  }

  updateResetRevealVisibility();
  updatePlayControlsVisibility();
  updatePuzzleActionsVisibility();
}

// Toggle selected range highlight.
function updateSelectedWordUI() {
  els.grid.querySelectorAll(".range").forEach((r) => {
    r.classList.toggle("is-selected", selectedEntry != null && r.dataset.e === String(selectedEntry));
  });
}

// Select-all is a visual state; it does not lock cells.
function updateSelectAllUI() {
  if (!els.grid) return;
  els.grid.querySelectorAll(".cell").forEach((c) => {
    const i = +c.dataset.i;
    const locked = play.mode === MODE.CHAIN && isCellLocked(i);
    c.classList.toggle("is-select-all", selectAllUnlocked && !locked);
  });
}

function selectEntry(eIdx) {
  selectedEntry = eIdx;
  updateSelectedWordUI();
}

function clearSelection() {
  selectedEntry = null;
  updateSelectedWordUI();
}

function clearSelectAll() {
  if (!selectAllUnlocked) return;
  selectAllUnlocked = false;
  updateSelectAllUI();
}

function selectAllUnlockedCells() {
  selectAllUnlocked = true;
  updateSelectAllUI();
}

// ---- Give up confirm modal ----
// Shows penalty summary before revealing chain answers.
function openGiveUpModal() {
  if (!els.giveUpModal) return;
  const unsolvedWords = countUnsolvedWords();
  const unsolvedLetters = countUnsolvedLetters();
  const penaltySec = unsolvedLetters * HINT_PENALTY_SEC;

  if (els.giveUpWordsCount) els.giveUpWordsCount.textContent = String(unsolvedWords).padStart(2, "0");
  if (els.giveUpWordLabel) els.giveUpWordLabel.textContent = unsolvedWords === 1 ? "word" : "words";
  if (els.giveUpSeconds) els.giveUpSeconds.textContent = fmtTime(penaltySec);

  els.giveUpModal.hidden = false;
  els.giveUpModal.classList.add("is-open");
  els.giveUpModal.setAttribute("aria-hidden", "false");

  try {
    els.giveUpConfirm?.focus({ preventScroll: true });
  } catch {}
}

function closeGiveUpModal() {
  if (!els.giveUpModal) return;
  els.giveUpModal.classList.remove("is-open");
  els.giveUpModal.hidden = true;
  els.giveUpModal.setAttribute("aria-hidden", "true");
}

// ---- UI visibility helpers ----
// Centralize visibility toggles for play/chain controls.
function updatePlayControlsVisibility() {
  if (!els.reset || !els.reveal) return;
  // Only gate in play/overlap mode; otherwise leave visible.
  if (play.mode !== MODE.PUZZLE || currentView !== VIEW.PLAY) {
    els.reset.style.display = "";
    els.reveal.style.display = "";
    if (els.nextPuzzleBtn) els.nextPuzzleBtn.style.display = "none";
    if (els.shareInline) els.shareInline.style.display = "none";
    return;
  }

  const hasInput = Array.isArray(play.usr) && play.usr.some(Boolean);
  const solved = !!play.done;

  els.reveal.style.display = solved ? "none" : "";
  els.reset.style.display = solved || (hasInput && !solved) ? "" : "none";
  if (els.nextPuzzleBtn) {
    els.nextPuzzleBtn.style.display = solved ? "" : "none";
  }
  if (els.shareInline) {
    const showShare = solved && !play.revealed;
    els.shareInline.style.display = showShare ? "inline-flex" : "none";
  }
}

function maybeClearSelectionOnCursorMove() {
  if (selectedEntry == null) return;
  const e = play.entries.find((x) => x.eIdx === selectedEntry);
  if (!e) return clearSelection();

  const isLockedEntry = play.mode === MODE.CHAIN && play.lockedEntries.has(selectedEntry);
  if (isLockedEntry) return;

  if (!entryContainsIndex(e, play.at)) clearSelection();
}

function entryAtIndex(i) {
  const candidates = play.entries.filter((e) => entryContainsIndex(e, i));
  if (!candidates.length) return null;
  candidates.sort((a, b) => (i - a.start) - (i - b.start) || a.start - b.start);
  return candidates[0];
}

// ---- View filtering ----
// "Play" shows overlap puzzles; "Chain" shows chain puzzles (daily and custom).
function indicesForView(v = currentView) {
  const wantChain = v === VIEW.CHAIN;
  const out = [];
  for (let i = 0; i < puzzles.length; i++) {
    const p = puzzles[i];
    const isCh = isChainPuzzle(p);
    if (wantChain ? isCh : !isCh) out.push(i);
  }
  return out;
}

// Locate today's daily chain puzzle if present.
function findTodayChainIndex() {
  const todayKey = toDateKey(new Date());
  if (!todayKey) return null;
  for (let i = 0; i < puzzles.length; i++) {
    const p = puzzles[i];
    if (isDailyChainPuzzle(p) && p.id === todayKey) return i;
  }
  return null;
}

function loadByViewOffset(delta) {
  const list = indicesForView(currentView);
  if (!list.length) return;

  const pos = list.indexOf(pIdx);
  const at = pos >= 0 ? pos : 0;
  const nextPos = (at + delta + list.length) % list.length;
  loadPuzzle(list[nextPos]);
}

// Ensure the currently loaded puzzle aligns with the selected tab.
function ensureCurrentPuzzleMatchesView() {
  const list = indicesForView(currentView);
  if (!list.length) return false;
  if (currentView === VIEW.CHAIN) {
    const todayIdx = findTodayChainIndex();
    if (todayIdx != null) {
      if (pIdx !== todayIdx) {
        loadPuzzle(todayIdx);
        return true;
      }
      return true;
    }
  }
  if (list.includes(pIdx)) return true;
  if (currentView === VIEW.CHAIN) {
    const todayIdx = findTodayChainIndex();
    if (todayIdx != null) {
      loadPuzzle(todayIdx);
      return true;
    }
  }
  loadPuzzle(list[0]);
  return true;
}

// ---- Word Chain HUD & results ----
// Chain mode is an untimed "speed" run with pause/resume and results modal.
const chain = {
  running: false,
  started: false,
  endsAt: 0,              // used in timed mode
  startAt: 0,             // used in untimed mode
  left: 0,                // timed: seconds remaining
  elapsed: 0,             // untimed: seconds elapsed
  tickId: 0,
  lastFinishLeftSec: 0,   // timed bonus calc
  lastFinishElapsedSec: 0, // untimed results
  unsolvedCount: 0,
  lastFinishReason: "idle",
  hintsUsed: 0,
  hintPenaltySecTotal: 0,
  wordPenaltySecTotal: 0,
};


// Lazily created UI references for the chain HUD and results modal.
let chainUI = null;
let chainResults = null;

const CHAIN_UI = { IDLE: "idle", RUNNING: "running", PAUSED: "paused", DONE: "done" };

// Button/controls visibility
function updateResetRevealVisibility(stateOverride) {
  if (!els.reset || !els.reveal) return;
  if (play.mode !== MODE.CHAIN) {
    els.reset.style.display = "";
    els.reveal.style.display = "";
    return;
  }
  const state = stateOverride || document.body.dataset.chainState || CHAIN_UI.IDLE;
  const show = state === CHAIN_UI.RUNNING || state === CHAIN_UI.PAUSED;
  els.reset.style.display = show ? "" : "none";
  els.reveal.style.display = show ? "" : "none";
}

function updatePuzzleActionsVisibility(stateOverride) {
  const wrap = els.puzzleActions;
  if (!wrap) return;
  if (play.mode !== MODE.CHAIN) {
    wrap.style.display = "";
    return;
  }

  // turn this back on to set the give up to only show once the puzzl is started
  const state = stateOverride || document.body.dataset.chainState || CHAIN_UI.IDLE;
  const show = state === CHAIN_UI.RUNNING || state === CHAIN_UI.PAUSED;
  wrap.style.display = show ? "" : "none";
}


// Update global chain state and HUD labels/timer visibility.
function chainSetUIState(state, ui = ensureChainUI()) {
  // global hook for CSS
  document.body.dataset.chainState = state;

  // button hook for CSS
  ui.startBtn.dataset.state = state;

  const visibleLabel =
    state === CHAIN_UI.IDLE ? "Start" :
    state === CHAIN_UI.DONE ? "View results" :
    "";
  const ariaLabel =
    state === CHAIN_UI.IDLE ? "Start" :
    state === CHAIN_UI.RUNNING ? "Pause" :
    state === CHAIN_UI.PAUSED ? "Resume" :
    "View results";
  if (ui.label) ui.label.textContent = visibleLabel;
  else ui.startBtn.textContent = visibleLabel;
  ui.startBtn.setAttribute("aria-label", ariaLabel);

  const showTimer = state === CHAIN_UI.RUNNING || state === CHAIN_UI.PAUSED;
  if (ui.timer) {
    ui.timer.hidden = !showTimer;
    const current = Number.isFinite(chain.elapsed) ? chain.elapsed : 0;
    ui.timer.textContent = fmtTime(current);
  }

  // toggle reset/reveal visibility in chain mode
  updateResetRevealVisibility(state);
  updatePuzzleActionsVisibility(state);
}

function chainPause() {
  return chainPauseWithOpts({});
}

// Pause and optionally show the splash/archive.
function chainPauseWithOpts(opts = {}) {
  if (!chain.started || !chain.running) return;

  const ui = ensureChainUI();

  // snapshot time so resume is accurate
  const elapsed = Math.max(0, (Date.now() - chain.startAt) / 1000);
  chain.elapsed = elapsed;
  if (ui.timer) ui.timer.textContent = fmtTime(elapsed);

  chain.running = false;
  chainSetUIState(CHAIN_UI.PAUSED, ui);
  if (opts.showSplash) {
    const p = puzzles[pIdx];
    if (isArchiveDailyPuzzle(p)) {
      openArchiveModal({ dateKey: normalizePuzzleId(p).id });
    } else {
      openSplash("paused");
    }
  }
  requestPersistChainProgress();
}

function chainPauseIfBackgrounded() {
  if (DEV_DISABLE_AUTOPAUSE) return;
  if (play.mode !== MODE.CHAIN) return;
  if (!chain.started || !chain.running) return;
  if (play.done) return;
  chainPauseWithOpts({ showSplash: true });
}

// Resume from a paused chain; preserves elapsed time.
function chainResume() {
  if (!chain.started || chain.running) return;

  const ui = ensureChainUI();

  const elapsed = Math.max(0, +chain.elapsed || 0);
  chain.startAt = Date.now() - elapsed * 1000;

  chain.running = true;
  chainSetUIState(CHAIN_UI.RUNNING, ui);
  ensureChainTick();
  focusForTyping();
}

// Reset handler triggered from the HUD reset action.
function chainResetFromHud() {
  // optional: stop the tick if it's still running
  if (chain.tickId) {
    clearInterval(chain.tickId);
    chain.tickId = null;
  }

  // your existing reset behavior
  resetPlay();
  chainSetUIState(CHAIN_UI.IDLE);
  focusForTyping();
}



// Ensure chain HUD exists in the DOM and wire its click handler.
function ensureChainUI() {
  if (chainUI) return chainUI;

  const hud = document.querySelector(".chainHud");

  const host = els.helper || els.meta?.parentElement || document.body;
  if (hud && host && hud.parentElement !== host) host.appendChild(hud);

  const startBtn = hud.querySelector("#chainStartBtn");

startBtn.addEventListener("click", () => {
  markInteracted();

  if (play.mode !== MODE.CHAIN) return;

  // If completed, button becomes "View results"
  if (play.done) {
    openChainResults(scoreChain(), chain.lastFinishReason || "solved");
    return;
  }

  if (!chain.started) chainStartNow();
  else if (chain.running) chainPauseWithOpts({ showSplash: true });
  else chainResume();
});



  chainUI = {
    hud,
    startBtn,
    timer: startBtn.querySelector(".chainTimerLabel"),
    label: startBtn.querySelector(".chainStartLabel"),
  };
chainSetUIState(
  play?.done
    ? CHAIN_UI.DONE
    : (chain.started ? (chain.running ? CHAIN_UI.RUNNING : CHAIN_UI.PAUSED) : CHAIN_UI.IDLE),
  chainUI
);


  return chainUI;
}

// Ensure results modal references and wire share/close events.
function ensureChainResults() {
  if (chainResults) return chainResults;

  const wrap = els.resultsModal;
  if (!wrap) return null;

  const cClose = els.resultsClose;
  const cShare = els.resultsShare;

  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeChainResults();
  });
  cClose?.addEventListener("click", closeChainResults);
  cShare?.addEventListener("click", () => {
    shareResult({ mode: MODE.CHAIN });
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

function closeChainResults() {
  if (!chainResults) return;
  chainResults.wrap.classList.remove("is-open");
  setResultsInert(false);
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Fully reset chain timer state (used on load/reset).
function chainStopTimer() {
  chain.running = false;
  chain.started = false;
  chain.endsAt = 0;
    chain.startAt = 0;
  chain.elapsed = 0;
  chain.lastFinishElapsedSec = 0;

  chain.left = 0;
  chain.lastFinishLeftSec = 0;
  chain.unsolvedCount = 0;
  chain.lastFinishReason = "idle";
  chain.hintsUsed = 0;
  if (chain.tickId) {
    clearInterval(chain.tickId);
    chain.tickId = 0;
  }
  _persistTickLastTs = 0;
}

// Start the interval that drives the timer display and persistence throttle.
function ensureChainTick() {
  if (chain.tickId) return;
  const ui = ensureChainUI();
  chain.tickId = setInterval(() => {
    if (!chain.running) return;
    const elapsed = (Date.now() - chain.startAt) / 1000;
    chain.elapsed = elapsed;
    if (ui.timer) ui.timer.textContent = fmtTime(elapsed);

    // Throttle persistence so the latest time is saved even without typing
    const now = performance.now ? performance.now() : Date.now();
    if (!_persistTickLastTs || now - _persistTickLastTs > 900) {
      requestPersistChainProgress();
      _persistTickLastTs = now;
    }
  }, 120);
}

function chainResetTimer() {
  const p = puzzles[pIdx];
  const ui = ensureChainUI();

  chainStopTimer();

  chain.elapsed = 0;
  chain.hintsUsed = 0;
  chain.hintPenaltySecTotal = 0;
  chain.wordPenaltySecTotal = 0;
  if (ui.timer) ui.timer.textContent = fmtTime(0);
}

function chainForceIdleZero() {
  if (play.mode !== MODE.CHAIN) return;
  chainStopTimer();
  chain.started = false;
  chain.running = false;
  chain.left = 0;
  chain.elapsed = 0;
  const ui = ensureChainUI();
  if (ui.timer) ui.timer.textContent = fmtTime(0);
  chainSetUIState(CHAIN_UI.IDLE, ui);
  setInlineCluesHiddenUntilChainStart();
  resetRangeClueHints();
}

function chainShowResetWithClues() {
  if (play.mode !== MODE.CHAIN) return;
  chainStopTimer();
  chain.started = true; // mark started so clues render
  chain.running = false;
  chain.left = 0;
  chain.elapsed = 0;
  const ui = ensureChainUI();
  if (ui.timer) ui.timer.textContent = fmtTime(0);
  chainSetUIState(CHAIN_UI.DONE, ui);
  setInlineCluesHiddenUntilChainStart(); // will unhide since started=true
}


// Start chain mode (first editable cell, timer, and clue visibility).
function chainStartNow() {
  if (play.mode !== MODE.CHAIN) return;
  if (play.done) return;

  const ui = ensureChainUI();

  // jump to first editable cell (usually 0)
  const first = findNextEditable(0, +1);
  setAt(first == null ? 0 : first, { behavior: "auto" });
  focusForTyping();

  if (chain.started) return;

  chain.started = true;

  chain.running = true;
  setInlineCluesHiddenUntilChainStart();
  chain.isTimed = false;
  chainSetUIState(CHAIN_UI.RUNNING, ui);
  pulseRangeHintIntro();

  chain.startAt = Date.now();

  ensureChainTick();
  requestPersistChainProgress();
}

function isWordAttempted(e) {
  for (let i = e.start; i < e.start + e.len; i++) if (play.usr[i]) return true;
  return false;
}

function isWordCorrect(e) {
  for (let i = 0; i < e.len; i++) {
    const idx = e.start + i;
    if (!play.usr[idx]) return false;
    if (play.usr[idx] !== e.ans[i]) return false;
  }
  return true;
}

// Compute solved/attempted counts for results.
function scoreChain() {
  const entries = play.entries || [];
  const correct = entries.filter(isWordCorrect).length;
  const attempted = entries.filter(isWordAttempted).length;
  return { correct, attempted };
}

// Populate and display the results modal.
function openChainResults(stats, reason) {
  const r = ensureChainResults();
  if (!r) return;
  r.wrap.classList.add("is-open");
  setResultsInert(true);
  const tSec = Math.max(0, Math.floor(chain.lastFinishElapsedSec || 0));
  const total = play.entries?.length || 0;
  const solved = Math.max(0, total - Math.max(0, chain.unsolvedCount || 0));
  const allSolved = chain.unsolvedCount === 0;

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

  r.statTime.textContent = fmtTime(tSec);
  r.statSolved.textContent = `${solved}/${total}`;
  const hintCount = Math.max(0, chain.hintsUsed || 0);
  r.statHints.textContent = String(hintCount);
  if (r.pluralHints) r.pluralHints.style.display = hintCount === 1 ? "none" : "";
  const hintPenalty = Math.max(0, chain.hintPenaltySecTotal || 0);
  const wordPenalty = Math.max(0, chain.wordPenaltySecTotal || 0);
  if (els.totalHintPenalty) {
    els.totalHintPenalty.textContent = fmtTime(hintPenalty);
    els.totalHintPenalty.parentElement.style.display = hintPenalty > 0 ? "" : "none";
  }
  if (els.totalWordPenalty) {
    els.totalWordPenalty.textContent = fmtTime(wordPenalty);
    els.totalWordPenalty.parentElement.style.display = wordPenalty > 0 ? "" : "none";
  }

}

// Finalize a chain run and persist completion stats.
function chainFinish(reason = "time", opts = {}) {
  if (play.mode !== MODE.CHAIN) return;
  if (play.done) return;
  const unsolved = Math.max(0, opts.unsolved ?? 0);
  chain.lastFinishLeftSec = 0;

  const elapsed = (() => {
    // If actively running, derive from startAt; otherwise trust accumulated elapsed (penalties included).
    if (chain.running && chain.startAt) return (Date.now() - chain.startAt) / 1000;
    if (Number.isFinite(chain.elapsed)) return chain.elapsed;
    if (chain.startAt) return (Date.now() - chain.startAt) / 1000;
    return 0;
  })();

  chain.lastFinishElapsedSec = Math.max(0, elapsed);

  chain.running = false;
  if (chain.tickId) {
    clearInterval(chain.tickId);
    chain.tickId = 0;
  }

  play.done = true;
  chain.unsolvedCount = unsolved;
  chain.lastFinishReason = reason;
  chainSetUIState(CHAIN_UI.DONE);
  updatePlayUI();

  try {
    kb.blur();
  } catch {}

  recordChainCompletionIfNeeded(chain.lastFinishElapsedSec);
  openChainResults(scoreChain(), reason);
  persistChainProgressImmediate();
}

// Check for full solve and trigger chainFinish.
function chainMaybeFinishIfSolved() {
  if (play.mode !== MODE.CHAIN || play.done) return;
  if (!chain.started) return;

  for (let i = 0; i < play.n; i++) {
    if (!play.usr[i]) return;
    if (play.usr[i] !== play.exp[i]) return;
  }
  chainFinish("solved");
}

// ---- Word Chain locking behavior ----
// In chain mode, correct words lock and become non-editable.
function isCellLocked(i) {
  return !!play.lockedCells[i];
}

// Rebuild lockedCells array from lockedEntries (plus any hint-locked cells).
function rebuildLockedCells() {
  const prev = Array.isArray(play.lockedCells) ? play.lockedCells.slice() : [];
  play.lockedCells = Array.from({ length: play.n }, () => false);
  if (play.mode !== MODE.CHAIN) {
    for (let i = 0; i < Math.min(play.n, prev.length); i++) {
      if (prev[i]) play.lockedCells[i] = true;
    }
    return;
  }
  for (const eIdx of play.lockedEntries) {
    const e = play.entries.find((x) => x.eIdx === eIdx);
    if (!e) continue;
    for (let i = e.start; i < e.start + e.len; i++) play.lockedCells[i] = true;
  }
  // preserve individually locked cells (e.g., via hints)
  for (let i = 0; i < Math.min(play.n, prev.length); i++) {
    if (prev[i]) play.lockedCells[i] = true;
  }
}

// Animate a word's letters and range when it becomes locked.
function triggerSolveAnimation(entry) {
  if (!entry || play.mode !== MODE.CHAIN || !els.grid) return;
  const letters = [];
  for (let i = entry.start; i < entry.start + entry.len; i++) {
    const cell = els.grid.querySelector(`.cell[data-i="${i}"]`);
    const letter = cell?.querySelector(".letter");
    if (letter) letters.push(letter);
  }
  letters.forEach((letter, idx) => {
    letter.classList.remove("solve-anim");
    letter.style.setProperty("--solve-delay", `${idx * 80}ms`);
    // force reflow to restart animation
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

  const rangeEl = els.grid.querySelector(`.range[data-e="${entry.eIdx}"]`);
  if (rangeEl) {
    rangeEl.classList.remove("range-solve-anim");
    void rangeEl.offsetWidth;
    rangeEl.classList.add("range-solve-anim");
    rangeEl.addEventListener(
      "animationend",
      () => {
        rangeEl.classList.remove("range-solve-anim");
      },
      { once: true }
    );
  }
}

function triggerFullSolveAnimation() {
  if (play.mode !== MODE.PUZZLE || !els.grid || play.fullSolveAnimated) return;
  const letters = Array.from(els.grid.querySelectorAll(".cell .letter")).sort((a, b) => {
    const pa = a.closest(".cell");
    const pb = b.closest(".cell");
    const ia = pa ? +pa.dataset.i : 0;
    const ib = pb ? +pb.dataset.i : 0;
    return ia - ib;
  });
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
  play.fullSolveAnimated = true;
}

// Toggle locked styling for ranges and refresh slider segments.
function updateLockedWordUI() {
  els.grid.querySelectorAll(".range").forEach((r) => {
    const eIdx = +r.dataset.e;
    const locked = play.mode === MODE.CHAIN && play.lockedEntries.has(eIdx);
    r.classList.toggle("is-locked", locked);
  });
  updateSliderUI();
}

// Lock any newly correct words and trigger solve animations.
function chainApplyLocksIfEnabled() {
  const p = puzzles[pIdx];
  if (play.mode !== MODE.CHAIN) return;

  let changed = false;
  const newlyLocked = [];

  for (const e of play.entries) {
    if (play.lockedEntries.has(e.eIdx)) continue;
    if (isWordCorrect(e)) {
      play.lockedEntries.add(e.eIdx);
      changed = true;
      newlyLocked.push(e);
    }
  }

  if (changed) {
    rebuildLockedCells();
    updateLockedWordUI();
    if (selectedEntry != null && play.lockedEntries.has(selectedEntry)) clearSelection();
    if (newlyLocked.length) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => newlyLocked.forEach((e) => {
          triggerSolveAnimation(e);
          const solved = play.lockedEntries.size;
          const total = play.entries.length;
          showToast("wordSolved", `${solved} of ${total}`);
        }))
      );
    }
    requestPersistChainProgress();
  }
}

// Find the next editable cell in a given direction.
function findNextEditable(from, dir) {
  let i = from;
  while (i >= 0 && i < play.n) {
    if (!isCellLocked(i)) return i;
    i += dir;
  }
  return null;
}

// Decide where to move after a cell becomes locked (chain mode).
function chooseAutoAdvanceTarget(prevIdx) {
  // Strategy: prefer forward progress, but avoid jumping into locked/solved words.
  const currentEntry = entryAtIndex(prevIdx);
  const ordered = (play.entries || []).slice().sort((a, b) => a.start - b.start);
  const curPos = currentEntry ? ordered.findIndex((e) => e.eIdx === currentEntry.eIdx) : -1;
  const prevEntry = curPos > 0 ? ordered[curPos - 1] : null;
  const nextEntry = curPos >= 0 && curPos < ordered.length - 1 ? ordered[curPos + 1] : null;

  const prevSolved = prevEntry == null ? null : isWordCorrect(prevEntry);
  const nextSolved = nextEntry == null ? null : isWordCorrect(nextEntry);

  const nextUnresolvedRight = findUnresolvedCell(prevIdx, +1);
  const unsolved = unresolvedEntries().sort((a, b) => a.start - b.start);
  const editableRight = findNextEditable(prevIdx + 1, +1);
  const editableLeft = findNextEditable(prevIdx - 1, -1);

  let firstUnsolvedRight = unsolved.find((e) => e.start > (currentEntry?.start ?? -Infinity));
  let firstUnsolvedLeft = [...unsolved].reverse().find((e) => e.start < (currentEntry?.start ?? Infinity));

  // Fallback: if we didn't find an unsolved entry but there is an editable cell right/left, treat its entry as unsolved.
  if (!firstUnsolvedRight && editableRight != null && editableRight > prevIdx) {
    const e = entryAtIndex(editableRight);
    if (e && !isWordCorrect(e)) firstUnsolvedRight = e;
  }
  if (!firstUnsolvedLeft && editableLeft != null && editableLeft < prevIdx) {
    const e = entryAtIndex(editableLeft);
    if (e && !isWordCorrect(e)) firstUnsolvedLeft = e;
  }

  // If the word on the right is solved, decide whether and where to jump.
  if (nextSolved) {
    if (firstUnsolvedRight) {
      // Unsovled exists to the right
      if (prevSolved !== false) {
        // Case: prev solved + next solved + unsolved to the right -> jump right.
        const tgt =
          nextUnresolvedRight != null ? nextUnresolvedRight :
          firstEditableCellInEntry(firstUnsolvedRight);
        return { target: tgt, suppress: false };
      }
      // Case: prev unsolved + next solved -> stay put.
      return { target: null, suppress: true };
    }

    // No unsolved to the right; if any unsolved to the left, jump left (regardless of prev solved).
    if (!firstUnsolvedRight && firstUnsolvedLeft) {
      // But if there is an editable cell to the right, honor it instead of jumping left.
      if (nextUnresolvedRight != null && nextUnresolvedRight > prevIdx) {
        return { target: nextUnresolvedRight, suppress: false };
      }
      if (editableRight != null && editableRight > prevIdx) {
        return { target: editableRight, suppress: false };
      }
      return { target: firstEditableCellInEntry(firstUnsolvedLeft), suppress: false };
    }
  }

  // If there is no word to the right (end of chain) but unsolved remains to the left, jump left.
  if (!nextEntry && firstUnsolvedLeft) {
    // But if there is an editable cell to the right, prefer it.
    if (editableRight != null && editableRight > prevIdx) {
      return { target: editableRight, suppress: false };
    }
    return { target: firstEditableCellInEntry(firstUnsolvedLeft), suppress: false };
  }

  // Default behavior: step forward to the next editable cell if available.
  const fallback = findNextEditable(prevIdx + 1, +1);
  return { target: fallback != null ? fallback : prevIdx, suppress: false };
}

// Chain input is gated behind start/resume.
function chainInputAllowed() {
  if (play.mode !== MODE.CHAIN) return true;
  if (!chain.started && !play.done) chainStartNow();
  else if (chain.started && !chain.running && !play.done) chainResume();
  return chain.started;
}
// Hide range clues until chain is started (prevents early peeking).
function setInlineCluesHiddenUntilChainStart() {
  const preStart = play.mode === MODE.CHAIN && !chain.started;

  // toggle a class so you can also handle with CSS if you want
  document.documentElement.classList.toggle("chain-prestart", preStart);

  // hard-hide inline clues during pre-start (covers common selectors)
  els.grid?.querySelectorAll(
    ".rangeClue"
  ).forEach((el) => {
    el.classList.toggle("is-hidden", preStart);
  });
}


// ---- Word Chain clues (current word first + adjacent unsolved) ----
// This block is intended to manage a dynamic clue list; updateChainClues is a stub for now.
let _cluesRaf = 0;

function requestChainClues() {
  if (_cluesRaf) return;
  _cluesRaf = requestAnimationFrame(() => {
    _cluesRaf = 0;
    updateChainClues();
  });
}

function isEntryUnsolvedForClues(e) {
  // Lock is always on in chain mode; unsolved == not locked
  return !play.lockedEntries.has(e.eIdx);
}

// Candidates on current cursor cell, ordered:
// 1) earlier start first
// 2) if same start, random (uses e.r)
function entriesOnCursorCellSorted() {
  const i = play.at;
  return play.entries
    .filter((e) => entryContainsIndex(e, i))
    .sort((a, b) => a.start - b.start || a.r - b.r);
}

function entryDistanceToIndex(e, i) {
  const a = e.start;
  const b = e.start + e.len - 1;
  return Math.min(Math.abs(a - i), Math.abs(b - i));
}

function nearestUnsolvedEntryToCursor() {
  const i = play.at;
  const unsolved = play.entries.filter(isEntryUnsolvedForClues);
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
}

// Show a banner when viewing an archived daily puzzle.
function updateArchiveDateBanner(p = puzzles[pIdx]) {
  if (!els.archiveDate) return;
  const show = isArchiveDailyPuzzle(p);
  if (!show) {
    els.archiveDate.hidden = true;
    els.archiveDate.textContent = "";
    return;
  }
  const label = puzzleDateLabel(p);
  if (!label) {
    els.archiveDate.hidden = true;
    els.archiveDate.textContent = "";
    return;
  }
  els.archiveDate.textContent = label;
  els.archiveDate.hidden = false;
}


// ---- Play UI ----
// Render letters, active state, and cell classes based on current play state.
function updatePlayUI() {
  const cells = els.grid.querySelectorAll(".cell");
  cells.forEach((c) => {
    const i = +c.dataset.i;
    c.querySelector(".num").textContent = i + 1;
    c.querySelector(".letter").textContent = play.usr[i] || "";
    c.classList.toggle("is-active", i === play.at && !play.done);
    const wordsHere = play.cellWords?.[i] || [];
    const fullySolved = play.mode === MODE.CHAIN && wordsHere.length > 0 && wordsHere.every((w) => isWordCorrect(w));
    const locked = play.mode === MODE.CHAIN && isCellLocked(i) && !fullySolved;
    c.classList.toggle("cell-solved", fullySolved);
    c.classList.toggle("cell-locked", locked);
    // apply class for largest height covering this cell
    c.classList.remove("cell-height-full", "cell-height-mid", "cell-height-inner", "cell-range-start", "cell-range-end");
    if (wordsHere.length) {
      const priority = { full: 3, mid: 2, inner: 1 };
      const ranked = wordsHere.map((w) => {
        const h = w.h || w.height || "full";
        return { w, h, score: priority[h] || 0 };
      });
      ranked.sort((a, b) => b.score - a.score);
      const topScore = ranked[0]?.score || 0;
      const topHeights = ranked.filter((r) => r.score === topScore);
      const topHeight = topHeights[0]?.h;
      if (topHeight) c.classList.add(`cell-height-${topHeight}`);

      // range start/end flags only if that range shares the top height
      topHeights.forEach(({ w }) => {
        const startIdx = w.start;
        const endIdx = w.start + w.len - 1;
        if (i === startIdx) c.classList.add("cell-range-start");
        if (i === endIdx) c.classList.add("cell-range-end");
      });
    }
    c.setAttribute("aria-label", cellAriaLabel(i, wordsHere));
  });
  updateSelectedWordUI();
  updateSliderUI();
  updatePlayControlsVisibility();
  updateSelectAllUI();
  updateWordSolvedCount();
}

// Update cursor position and keep it visible.
function setAt(i, { behavior, noScroll } = {}) {
  clearSelectAll();
  const target = clamp(i, 0, play.n - 1);
  if (target !== play.at) clearLockedAutoAdvanceSuppressionIfMoved(target);
  play.at = target;
  updatePlayUI();
  if (!noScroll) {
    const bh = behavior || (IS_TOUCH ? "smooth" : "auto");
    keepActiveCellInView(
      typeof bh === "object" ? bh :
      bh === "smooth" ? { behavior: "smooth", delta: 1 } : bh
    );
  }

  maybeClearSelectionOnCursorMove();
  if (play.mode === MODE.CHAIN) requestChainClues();
  if (play.mode === MODE.CHAIN) requestPersistChainProgress();
}

// Jump to the first empty cell in a word and select it.
function jumpToEntry(eIdx) {
  const e = play.entries.find((x) => x.eIdx === eIdx);
  if (!e) return;

  let idx = e.start;
  for (let i = e.start; i < e.start + e.len; i++) {
    if (!play.usr[i]) {
      idx = i;
      break;
    }
  }

  selectEntry(e.eIdx);
  setAt(idx, { behavior: "smooth" });
  scrollToWordStart(e, "smooth");
}

// Only overlap (non-chain) puzzles use full-board correctness checks.
function checkSolvedOverlapOnly() {
  if (play.mode === MODE.CHAIN) return;
  if (!play.usr.every(Boolean)) return;
  if (play.usr.every((ch, i) => ch === play.exp[i])) {
    play.done = true;
    play.revealed = false;
    triggerFullSolveAnimation();
    showToast("success", "Success! You solved the puzzle!");
    updatePlayControlsVisibility();
  }
}

// Write a letter into the active cell and advance according to mode rules.
function write(ch) {
  if (play.done) return;
  if (!chainInputAllowed()) return; // require Start for word chain

  if (play.mode === MODE.CHAIN && isCellLocked(play.at)) {
    if (consumeLockedAutoAdvanceSuppression(play.at)) return;
    const next = findNextEditable(play.at, +1);
    if (next == null) return;
    play.at = next;
  }

  const prevAt = play.at;
  const wasLocked = isCellLocked(prevAt);
  play.usr[play.at] = ch;

  // auto-advance
  let nextAt = play.at < play.n - 1 ? play.at + 1 : play.at;

  if (play.mode === MODE.CHAIN) {
    chainApplyLocksIfEnabled();
    const lockedNow = isCellLocked(prevAt);
    if (lockedNow && !wasLocked) {
      const decision = chooseAutoAdvanceTarget(prevAt);
      if (decision.suppress) {
        nextAt = prevAt;
        markLockedAutoAdvanceSuppression(prevAt, 2);
      } else if (decision.target != null) {
        nextAt = decision.target;
      } else {
        nextAt = prevAt;
      }
    } else {
      // advance one step; if the next cell is locked, stay put and keep overwriting
      const step = Math.min(play.n - 1, prevAt + 1);
      nextAt = isCellLocked(step) ? prevAt : step;
    }

    play.at = nextAt;
    updatePlayUI();
    maybeToastChainFilledWrong();
    requestKeepActiveCellInView({ behavior: "smooth", delta: Math.abs(nextAt - prevAt) || 1 });
    requestChainClues();
    chainMaybeFinishIfSolved();
    requestPersistChainProgress();
    return;
  }

  play.at = nextAt;
  updatePlayUI();
  maybeToastPlayFilledWrong();
  requestKeepActiveCellInView({ behavior: "smooth", delta: Math.abs(nextAt - prevAt) || 1 });
  checkSolvedOverlapOnly();
}

// Backspace behavior supports chain locks and select-all delete.
function back() {
  if (play.done) return;
  if (!chainInputAllowed()) return; // require Start for word chain

  if (play.mode === MODE.CHAIN && isCellLocked(play.at)) {
    const prev = findNextEditable(play.at, -1);
    if (prev != null) play.at = prev;
    updatePlayUI();
    requestKeepActiveCellInView({ behavior: "smooth", delta: 1 });
    return;
  }

  const prevAt = play.at;
  if (play.usr[play.at]) {
    play.usr[play.at] = "";
  } else {
    let prevAt = play.at > 0 ? play.at - 1 : 0;
    if (play.mode === MODE.CHAIN) {
      // If the next cell back is locked, stay on current cell and overwrite it
      if (isCellLocked(prevAt)) {
        prevAt = play.at;
      } else {
        const prev = findNextEditable(prevAt, -1);
        if (prev == null) prevAt = play.at;
        else prevAt = prev;
      }
    }
    play.at = prevAt;
    if (play.mode !== MODE.CHAIN || !isCellLocked(play.at)) play.usr[play.at] = "";
  }

  if (play.mode === MODE.CHAIN) {
    updatePlayUI();
    maybeToastChainFilledWrong();
    requestKeepActiveCellInView({ behavior: "smooth", delta: Math.abs(play.at - prevAt) || 1 });
    requestChainClues();
    requestPersistChainProgress();
    return;
  }

  updatePlayUI();
  maybeToastPlayFilledWrong();
  requestKeepActiveCellInView({ behavior: "smooth", delta: Math.abs(play.at - prevAt) || 1 });
}

function countUnsolvedWords() {
  if (!play.entries?.length) return 0;
  return play.entries.filter((e) => !isWordCorrect(e)).length;
}

function countUnsolvedLetters() {
  if (!play.exp?.length || !play.usr?.length) return 0;
  let c = 0;
  for (let i = 0; i < play.exp.length; i++) {
    if ((play.usr[i] || "") !== (play.exp[i] || "")) c++;
  }
  return c;
}

// Cursor navigation with chain-mode lock skipping.
function move(d, opts = {}) {
  if (!chainInputAllowed()) return;

  let target = clamp(play.at + d, 0, play.n - 1);

  if (play.mode === MODE.CHAIN && !play.done) {
    const dir = d >= 0 ? +1 : -1;
    const nxt = findNextEditable(target, dir);
    if (nxt != null) target = nxt;
  }

  const delta = Math.abs(target - play.at) || 1;
  const bh = opts.behavior || { behavior: "smooth", delta };
  setAt(target, { behavior: bh });
}

// ---- Modals (Overlap) ----
// The success overlay is legacy; chain mode uses results modal instead.
function openSuccess() {
  // Success overlay disabled for play mode; toast handles feedback.
}

function closeSuccess() {
  els.resultsModal?.classList.remove("is-open");
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

// Share text and link for either puzzle or chain mode.
function shareResult({ mode, linkOnly = false, toastEl = null }) {
  const puzzle = puzzles[pIdx];
  const formatShareDate = (dt) =>
    dt.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const shareDateLabel = linkOnly
    ? ""
    : (() => {
        const id = typeof puzzle === "string" ? puzzle : puzzle?.id;
        const dt = dateFromKey(id);
        if (dt && !Number.isNaN(+dt)) return formatShareDate(dt);
        const lbl = puzzleLabel(puzzle);
        if (lbl) return lbl;
        return formatShareDate(new Date());
      })();
  const baseUrl =
    SHARE_URL_OVERRIDE && SHARE_URL_OVERRIDE.trim()
      ? SHARE_URL_OVERRIDE.trim()
      : (() => {
          try {
            return location.href;
          } catch {
            return "https://mbb670.github.io/Narrative/tokens/games/overlap_V1/";
          }
        })();

  let msg = linkOnly ? "" : `Overlap | ${shareDateLabel}`;

  if (!linkOnly && mode === MODE.CHAIN) {
    const elapsed = Math.max(0, +chain.lastFinishElapsedSec || 0);
    const timeText = fmtTime(elapsed);
    if (timeText) msg += `\nI solved the puzzle in ${timeText}`;
    const hints = Math.max(0, chain.hintsUsed || 0);
    const hintLabel = hints === 1 ? "hint" : "hints";
    if (chain.unsolvedCount > 0 && chain.lastFinishReason !== "solved") {
      msg += ` with ${chain.unsolvedCount} unsolved words`;
      if (hints > 0) msg += ` and ${hints} ${hintLabel}.`;
    } else if (hints > 0) {
      msg += ` with ${hints} ${hintLabel}.`;
    }
  }

  const payload = linkOnly ? { url: baseUrl } : { title: "Overlap", text: msg, url: baseUrl };

  const full = linkOnly ? baseUrl : `${msg}\n${baseUrl}`;

  const isTouch = IS_TOUCH || navigator.maxTouchPoints > 0 || navigator.userAgentData?.mobile === true;

  const tryClipboard = async (message) => {
    try {
      await navigator.clipboard?.writeText(full);
      if (message) showShareToast(message, toastEl);
      return true;
    } catch {
      return false;
    }
  };

  (async () => {
    if (isTouch && navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch {
        // on touch, if native share fails, don't alert; silently return
        return;
      }
    }

    const copied = await tryClipboard(isTouch ? null : (linkOnly ? "Copied to clipboard" : "Results copied to clipboard"));
    if (!copied) {
      alert(full);
    }
  })();
}

// ---- Reset / reveal ----
// Reset clears board and state; reveal fills expected answers (with penalties in chain).
function resetPlay(opts = {}) {
  const { clearPersist = true } = opts;
  play.usr = Array.from({ length: play.n }, () => "");
  play.at = 0;
  play.done = false;
  play.revealed = false;
  play.fullSolveAnimated = false;
  resetToastGuards();
  clearToasts();
  clearSelectAll();
  resetRangeClueHints();

  play.lockedEntries.clear();
  play.lockedCells = Array.from({ length: play.n }, () => false);

  updateLockedWordUI();
  clearSelection();

  updatePlayUI();
  closeSuccess();
  closeChainResults();

  if (play.mode === MODE.CHAIN) {
    if (clearPersist) clearChainProgressForPuzzle(puzzles[pIdx]);
    const ui = ensureChainUI();
    ui.startBtn.style.display = "";
    chainResetTimer();
    setInlineCluesHiddenUntilChainStart();
  } else {
    setInlineCluesHiddenUntilChainStart(); // ensure clues un-hidden when leaving chain mode
  }

  cancelSmoothFollow();
  if (els.gridScroll) els.gridScroll.scrollLeft = 0;
  setAt(0, { behavior: "none", noScroll: true });
}

function revealPlay() {
  if (play.mode === MODE.CHAIN) {
    const unsolved = countUnsolvedWords();
    const unsolvedLetters = countUnsolvedLetters();
    if (unsolvedLetters > 0) addTimePenalty(unsolvedLetters * HINT_PENALTY_SEC, "word");
    play.usr = play.exp.slice();
    chainFinish("reveal", { unsolved });
    persistChainProgressImmediate();
    return;
  }

  play.usr = play.exp.slice();
  play.done = true;
  play.revealed = true;
  updatePlayUI();
  updatePlayControlsVisibility();
}

// Main grid interaction handler (clue buttons + cell selection).
function onGridCellClick(e) {
  if (IS_TOUCH && performance.now() < _ignoreGridClickUntil) return;

  const hintBtn = e.target.closest(".rangeClue-hint");
  if (hintBtn) {
    const eIdx = Number(hintBtn.dataset.e || hintBtn.closest(".rangeClue")?.dataset.e);
    if (!Number.isNaN(eIdx)) {
      markInteracted();
      focusForTyping();
      applyHintForEntry(eIdx);
    }
    return;
  }

  const clueBtn = e.target.closest(".rangeClue-string");
  if (clueBtn) {
    const eIdx = Number(clueBtn.dataset.e || clueBtn.closest(".rangeClue")?.dataset.e);
    if (!Number.isNaN(eIdx)) {
      markInteracted();
      focusForTyping();
      showRangeClueHint(eIdx);
      _rangeHintPinned = eIdx;
      const entry = play.entries.find((x) => x.eIdx === eIdx);
      showRangeFocusForEntry(entry);
      const targetCell = firstEditableCellInEntry(entry);
      if (targetCell != null) setAt(targetCell, { behavior: "smooth" });
      if (IS_TOUCH) _ignoreGridClickUntil = performance.now() + 500;
    }
    return;
  }

  const cell = e.target.closest(".cell");
  if (!cell) {
    hideAllRangeClueHints();
    hideRangeFocus();
    return;
  }

  clearSelectAll();
  markInteracted();
  focusForTyping();

  const i = +cell.dataset.i;
  if (play.mode === MODE.CHAIN && !chain.started && !play.done) {
    chainStartNow();
  } else if (play.mode === MODE.CHAIN && chain.started && !chain.running && !play.done) {
    chainResume();
  }

  hideAllRangeClueHints();
  if (!isCellInFocusedRange(i)) hideRangeFocus();
  setAt(i, { behavior: "smooth" });
}

function onGridPointerUpTouch(e) {
  if (e.pointerType !== "touch") return;
  const hintBtn = e.target.closest(".rangeClue-hint");
  if (hintBtn) {
    e.preventDefault();
    const eIdx = Number(hintBtn.dataset.e || hintBtn.closest(".rangeClue")?.dataset.e);
    if (!Number.isNaN(eIdx)) {
      markInteracted();
      focusForTyping();
      applyHintForEntry(eIdx);
      _ignoreGridClickUntil = performance.now() + 500;
    }
    return;
  }

  const clueBtn = e.target.closest(".rangeClue-string");
  if (clueBtn) {
    e.preventDefault();
    const eIdx = Number(clueBtn.dataset.e || clueBtn.closest(".rangeClue")?.dataset.e);
    if (!Number.isNaN(eIdx)) {
      markInteracted();
      focusForTyping();
      showRangeClueHint(eIdx);
      _rangeHintPinned = eIdx;
      const entry = play.entries.find((x) => x.eIdx === eIdx);
      showRangeFocusForEntry(entry);
      const targetCell = firstEditableCellInEntry(entry);
      if (targetCell != null) setAt(targetCell, { behavior: "smooth" });
      _ignoreGridClickUntil = performance.now() + 500;
    }
    return;
  }
}

function onGridRangeCluePointerOut(e) {
  const rc = e.target.closest(".rangeClue");
  if (!rc) return;
  const related = e.relatedTarget;
  if (related && related.closest(".rangeClue") === rc) return;
  const eIdx = Number(rc.dataset.e);
  if (Number.isNaN(eIdx)) return;
  scheduleHideRangeClueHint(eIdx, 1000);
}

function onGlobalPointerDownForRangeClues(e) {
  if (e.target.closest(".puzzle-nav")) return;
  if (e.target.closest("#navWordPrev") || e.target.closest("#navWordNext")) return;
  if (e.target.closest(".rangeClue") || e.target.closest(".range-focus")) return;
  const cell = e.target.closest(".cell");
  if (cell && isCellInFocusedRange(Number(cell.dataset.i))) return;
  hideAllRangeClueHints();
  hideRangeFocus();
}

// ---- Load puzzle ----
// Reset state, build model/grid, and restore progress if available.
function loadPuzzle(i) {
  closeSuccess();
  closeChainResults();
  chainStopTimer();
  bindGridScrollCancels();
  cancelSmoothFollow();

  if (!puzzles.length) return;

  pIdx = ((i % puzzles.length) + puzzles.length) % puzzles.length;
  puzzles[pIdx] = normPuzzle(puzzles[pIdx]);

  const p = puzzles[pIdx];
  applyPaletteToDom(p.palette);
  const m = computed(p);
  setStatus(m);

  play.mode = isChainPuzzle(p) ? MODE.CHAIN : MODE.PUZZLE;
  play.entries = m.entries;

  setCols(m.total);

  play.exp = m.exp.map((c) => c || "");
  play.n = m.total;
  play.usr = Array.from({ length: play.n }, () => "");
  play.at = 0;
  play.done = false;
  play.revealed = false;
  play.fullSolveAnimated = false;
  resetToastGuards();
  clearToasts();
  clearSelectAll();
  hideRangeFocus();

  play.lockedEntries.clear();
  play.lockedCells = Array.from({ length: play.n }, () => false);
  clearSelection();

  renderGrid(els.grid, m, true, puzzles[pIdx]);
  updateSliderUI();


  if (play.mode === MODE.CHAIN) {
    const ui = ensureChainUI();
    ui.hud.hidden = false;
    ui.startBtn.style.display = ""; // show Start

    chainResetTimer();
    setInlineCluesHiddenUntilChainStart();

  } else {
    if (chainUI) chainUI.hud.hidden = true;
    if (els.reveal) els.reveal.style.display = "";

    setInlineCluesHiddenUntilChainStart(); // clears chain-prestart class when not in chain mode
    pulseRangeHintIntro();
  }
  updateResetRevealVisibility();

  // meta count should reflect current view list
  const list = indicesForView(currentView);
  const pos = list.indexOf(pIdx);
  const posText = list.length ? `${(pos >= 0 ? pos : 0) + 1} / ${list.length}` : `1 / ${puzzles.length}`;

  els.meta.replaceChildren(
    document.createTextNode(puzzleLabel(p)),
    document.createTextNode(" "),
    Object.assign(document.createElement("span"), { textContent: `• ${posText}` })
  );

  updateArchiveDateBanner(p);
  updatePlayUI();
  updatePlayControlsVisibility();
  updatePuzzleActionsVisibility();

  if (els.gridScroll) els.gridScroll.scrollLeft = 0;

  const restored = play.mode === MODE.CHAIN ? restoreChainProgressForCurrentPuzzle() : false;
  if (!restored) {
    _restoredFromStorage = false;
    _restoredAt = 0;
    setAt(0, { behavior: "none", noScroll: true });
  }
}

// ---- Tabs ----
// Switch between play and chain views (affects puzzle list and UI).
function setTab(which) {
  if (which !== VIEW.PLAY && which !== VIEW.CHAIN) which = VIEW.CHAIN;
  currentView = which;
  try { localStorage.setItem(LAST_VIEW_KEY, currentView); } catch {}

  // Global hook for CSS
  document.body.dataset.view = which; // "play" | "chain"

  els.panelPlay?.classList.toggle("is-active", true);

  updateKeyboardVisibility();

  ensureCurrentPuzzleMatchesView();
  updateSliderUI();
  focusForTyping();

  updateResetRevealVisibility();
  updatePlayControlsVisibility();
  updatePuzzleActionsVisibility();

  // Keep chain HUD in sync without resetting state
  const uiState =
    play.done
      ? CHAIN_UI.DONE
      : chain.running
      ? CHAIN_UI.RUNNING
      : chain.started
      ? CHAIN_UI.PAUSED
      : CHAIN_UI.IDLE;
  chainSetUIState(uiState);
  if (chain.running) ensureChainTick();
}


// ---- Escaping ----
// Safe text/attribute helpers for any HTML injection.
function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
}

function escapeAttr(s) {
  return String(s).replace(
    /[&<>"']/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

// Enter key triggers solve checks or chain completion warnings.
function handleEnterKey() {
  if (play.mode === MODE.PUZZLE) {
    if (play.done) return;
    const filled = play.usr.every(Boolean);
    if (!filled) {
      showToast("error", "Puzzle not complete!");
      return;
    }
    const allCorrect = play.usr.every((ch, i) => ch === play.exp[i]);
    if (allCorrect) {
      checkSolvedOverlapOnly();
      showToast("success", "Success! You solved the puzzle!");
    } else {
      showToast("warning", "Not quite: Some or all words are incorrect");
      lastPlayWarningKey = userKey();
    }
    return;
  }

  // Word chain
  if (play.done) return;
  const hasInput = play.usr.some(Boolean);
  if (!hasInput) return;
  const unsolved = countUnsolvedWords();
  if (unsolved > 0) {
    showToast("warning", `Not quite: ${unsolved} words are incomplete or incorrect`);
    lastChainWarningKey = userKey();
  } else {
    chainMaybeFinishIfSolved();
  }
}

// ---- Global key handler (desktop) ----
// Central keyboard handler for navigation and typing.
function onKey(e) {
  if (ftueIsOpen()) {
    e.preventDefault();
    e.stopImmediatePropagation?.();
    return;
  }
  if (els.resultsModal?.classList.contains("is-open")) return;
  if (chainResults?.wrap?.classList.contains("is-open")) return;
  if (e.metaKey && e.key.toLowerCase() === "a") {
    e.preventDefault();
    selectAllUnlockedCells();
    return;
  }
  if (e.metaKey || e.ctrlKey) return;

  if (IS_TOUCH && e.target === kb && (e.key === "Backspace" || e.key === "ArrowLeft" || e.key === "ArrowRight")) return;

  const t = e.target;
  if (t !== kb && isEditable(t)) return;

  if (selectAllUnlocked && e.key !== "Backspace" && e.key !== "Delete") {
    clearSelectAll();
  }

  if (e.key === "Backspace") {
    e.preventDefault();
    if (selectAllUnlocked) {
      clearAllUnlockedCells();
      return;
    }
    back();
    return;
  }
  if (e.key === "Delete") {
    e.preventDefault();
    if (selectAllUnlocked) {
      clearAllUnlockedCells();
      return;
    }
    back();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    handleEnterKey();
    return;
  }
  if (e.key === "ArrowLeft") {
    if (e.shiftKey) {
      e.preventDefault();
      jumpToUnresolvedWord(-1);
      return;
    }
    e.preventDefault();
    move(-1, { behavior: { behavior: "smooth", delta: 1 } });
    return;
  }
  if (e.key === "ArrowRight") {
    if (e.shiftKey) {
      e.preventDefault();
      jumpToUnresolvedWord(1);
      return;
    }
    e.preventDefault();
    move(1, { behavior: { behavior: "smooth", delta: 1 } });
    return;
  }
  if (e.key === " " || e.code === "Space") {
    e.preventDefault();
    move(1, { behavior: { behavior: "smooth", delta: 1 } });
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    const dir = e.shiftKey ? -1 : 1;
    move(dir, { behavior: { behavior: "smooth", delta: 1 } });
    return;
  }
  if (/^[a-zA-Z]$/.test(e.key)) {
    e.preventDefault();
    write(e.key.toUpperCase());
  }
}

// Update status bar for conflicts/gaps when a puzzle is invalid.
function setStatus(m) {
  const gaps = m.gaps || [];
  const hasError = !m.ok || gaps.length;
  if (els.status) {
    if (!m.ok) {
      els.status.className = "status bad";
      els.status.textContent = `Conflict at column ${m.conf.idx + 1}: “${m.conf.a}” vs “${m.conf.b}”.`;
    } else if (gaps.length) {
      els.status.className = "status bad";
      els.status.textContent = `Uncovered columns: ${gaps.slice(0, 18).map((x) => x + 1).join(", ")}${gaps.length > 18 ? "…" : ""}`;
    } else {
      els.status.className = "status";
      els.status.innerHTML = `Total columns: <strong>${m.total}</strong> • Words: <strong>${m.entries.length}</strong>`;
    }
  }
  if (els.toastErrorPuzzle) {
    els.toastErrorPuzzle.classList.toggle("is-showing", hasError);
  }
}

// ---- Events ----
// Central event wiring for keyboard, touch, modals, and controls.
// Keyboard (physical detection + input)
document.addEventListener(
  "keydown",
  (e) => {
    if (!IS_TOUCH || hasHardwareKeyboard) return;
    if (e.target === kb) return;
    if (isEditable(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Backspace" || e.key === "ArrowLeft" || e.key === "ArrowRight" || /^[a-zA-Z]$/.test(e.key)) {
      noteHardwareKeyboard();
    }
  },
  true
);
document.addEventListener(
  "pointerdown",
  (e) => {
    if (e.pointerType === "touch") {
      maybeDemoteHardwareKeyboard();
      markInteracted();
    }
  },
  { passive: true }
);
document.addEventListener("pointerdown", onGlobalPointerDownForRangeClues, { passive: true });
document.addEventListener("keydown", onKey, true);
window.addEventListener("resize", () => updateSliderUI());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) chainPauseIfBackgrounded();
});
window.addEventListener("pagehide", chainPauseIfBackgrounded);
window.addEventListener("blur", chainPauseIfBackgrounded);

// Focus gate
els.stage.addEventListener("pointerdown", (e) => {
  markInteracted();
  if (IS_TOUCH && e.target.closest("#gridScroll")) return;

  focusForTyping();
});


// Grid click
els.grid.addEventListener("click", onGridCellClick);
els.grid.addEventListener("pointerover", onRangeClueContentOver);
els.grid.addEventListener("pointerout", onRangeClueContentOut);
els.grid.addEventListener("pointerup", onGridPointerUpTouch);

// Chain clue updates on scroll
els.gridScroll?.addEventListener(
  "scroll",
  () => {
    if (play.mode === MODE.CHAIN) requestChainClues();
    updateThumbFromScroll();
  },
  { passive: true }
);


// ---- Touch pan detection: prevents follow-scroll + focus from fighting drag ----
if (els.gridScroll) {
  els.gridScroll.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "touch") return;

      _isUserPanning = true;
      _panPointerId = e.pointerId;
      _panMoved = false;
      _panStartX = e.clientX;
      _panStartY = e.clientY;

      stopScrollFollow();
    },
    { passive: true }
  );

  els.gridScroll.addEventListener(
    "pointermove",
    (e) => {
      if (!_isUserPanning || e.pointerId !== _panPointerId) return;
      if (_panMoved) return;

      const dx = Math.abs(e.clientX - _panStartX);
      const dy = Math.abs(e.clientY - _panStartY);
      if (dx >= PAN_SLOP_PX || dy >= PAN_SLOP_PX) _panMoved = true;
    },
    { passive: true }
  );

  const endPan = (e) => {
    if (e.pointerType !== "touch") return;
    if (e.pointerId !== _panPointerId) return;

    if (_panMoved) _ignoreGridClickUntil = performance.now() + 250;

    _isUserPanning = false;
    _panPointerId = null;
    _panMoved = false;
  };

  window.addEventListener("pointerup", endPan, { passive: true });
  window.addEventListener("pointercancel", endPan, { passive: true });
}


// Prev/Next
els.prev.addEventListener("click", () => {
  if (play.mode === MODE.CHAIN) chainForceIdleZero();
  loadByViewOffset(-1);
});

els.next.addEventListener("click", () => {
  if (play.mode === MODE.CHAIN) chainForceIdleZero();
  loadByViewOffset(1);
});


// Reset / Reveal
els.reset.addEventListener("click", () => {
  resetPlay();
  if (play.mode === MODE.CHAIN) chainForceIdleZero();
});
els.reveal.addEventListener("click", () => {
  markInteracted();
  if (play.mode === MODE.CHAIN && !play.done) {
    chainPauseWithOpts({ showSplash: false });
    openGiveUpModal();
    return;
  }
  revealPlay();
  focusForTyping();
});
els.settingsBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  toggleSettingsPanel();
});
els.settingsCloseBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  closeSettingsPanel();
});
els.showOnscreenKeyboard?.addEventListener("change", (e) => {
  const enabled = !!e.target.checked;
  try {
    if (enabled) localStorage.setItem(ONSCREEN_KB_KEY, "1");
    else localStorage.removeItem(ONSCREEN_KB_KEY);
  } catch {}
});
document.addEventListener("pointerdown", (e) => {
  if (!isSettingsPanelOpen()) return;
  const target = e.target;
  if (els.settingsPanel?.contains(target)) return;
  if (els.settingsBtn?.contains(target)) return;
  closeSettingsPanel();
});
colorModeTabs.forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const mode = btn.dataset.mode;
    setColorMode(mode);
  });
});
loadColorMode();
loadOnscreenKeyboardPref();
if (prefersColorQuery) {
  const handleSystemChange = () => {
    if (currentColorMode === COLOR_MODE_AUTO) applyColorMode(COLOR_MODE_AUTO);
  };
  if (typeof prefersColorQuery.addEventListener === "function") {
    prefersColorQuery.addEventListener("change", handleSystemChange);
  } else if (typeof prefersColorQuery.addListener === "function") {
    prefersColorQuery.addListener(handleSystemChange);
  }
}
els.splashPrimary?.addEventListener("click", (e) => {
  e.preventDefault();
  handleSplashPrimary();
});
els.splashArchiveBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  closeSplash();
  openArchiveModal();
});
els.archiveBackBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  closeArchiveModal();
  openSplash(splashState());
});
els.archivePrevMonth?.addEventListener("click", (e) => {
  e.preventDefault();
  const list = archiveState.availableMonths;
  const cur = archiveState.current;
  const idx = list.findIndex((m) => m.year === cur.year && m.month === cur.month);
  if (idx <= 0) return;
  const prev = list[idx - 1];
  setArchiveMonth(prev.year, prev.month);
});
els.archiveNextMonth?.addEventListener("click", (e) => {
  e.preventDefault();
  const list = archiveState.availableMonths;
  const cur = archiveState.current;
  const idx = list.findIndex((m) => m.year === cur.year && m.month === cur.month);
  if (idx < 0 || idx >= list.length - 1) return;
  const next = list[idx + 1];
  setArchiveMonth(next.year, next.month);
});
els.archiveYearSelect?.addEventListener("change", (e) => {
  const year = Number.parseInt(e.target.value, 10);
  if (Number.isNaN(year)) return;
  const months = archiveState.monthsByYear.get(year) || [];
  const currentMonth = archiveState.current.month;
  const nextMonth = months.includes(currentMonth) ? currentMonth : months[months.length - 1];
  setArchiveMonth(year, nextMonth);
});
els.archiveMonthSelect?.addEventListener("change", (e) => {
  const month = Number.parseInt(e.target.value, 10);
  if (Number.isNaN(month)) return;
  const year = archiveState.current.year;
  if (!year) return;
  setArchiveMonth(year, month);
});
els.archiveCalendar?.addEventListener("click", (e) => {
  const btn = e.target.closest(".archive-day");
  if (!btn || btn.disabled) return;
  const dateKey = btn.dataset.archiveDate;
  if (!dateKey) return;
  selectArchiveDate(dateKey);
});
els.archiveTodayBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const dateKey = toDateKey(now);
  setArchiveMonth(year, month, { selectDateKey: dateKey });
});
els.archiveActionBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  if (!archiveState.selectedPuzzle || !archiveState.selectedPlayable) return;
  const action = archiveState.selectedAction;
  const idx = ensurePuzzleInList(archiveState.selectedPuzzle);
  closeArchiveModal();
  setTab(VIEW.CHAIN);
  loadPuzzle(idx);
  if (action === "play" || action === "continue") {
    if (play.mode === MODE.CHAIN && !play.done) {
      if (!chain.started) chainStartNow();
      else if (!chain.running) chainResume();
    }
  }
});
els.giveUpConfirm?.addEventListener("click", () => {
  markInteracted();
  closeGiveUpModal();
  revealPlay();
});
els.giveUpCancel?.addEventListener("click", () => {
  markInteracted();
  closeGiveUpModal();
  if (play.mode === MODE.CHAIN && chain.started && !play.done) chainResume();
  focusForTyping();
});
els.logo?.addEventListener("click", () => {
  markInteracted();
  if (play.mode === MODE.CHAIN && chain.running && !play.done) {
    chainPauseWithOpts({ showSplash: true });
  } else {
    openSplash(splashState());
  }
});
els.splashPuzzleBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  closeSplash();
  setTab(VIEW.PLAY);
});
els.splashTutorialBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  // Update splash content to tutorial context then open FTUE
  closeSplash();
  openFtue(0, { instant: true, noAnim: true });
});
els.nextPuzzleBtn?.addEventListener("click", () => {
  markInteracted();
  loadByViewOffset(1);
});
els.shareInline?.addEventListener("click", () => {
  markInteracted();
  shareResult({ mode: play.mode });
});
els.shareBtn?.addEventListener("click", () => {
  markInteracted();
  shareResult({ mode: play.mode, linkOnly: true, toastEl: els.splashShareToast });
});
const navActions = {
  cellPrev: () => {
    let tgt = null;
    if (play.done || play.mode === MODE.PUZZLE) {
      tgt = clamp(play.at - 1, 0, play.n - 1);
    } else {
      tgt = findUnresolvedCell(play.at, -1);
    }
    if (tgt != null) setAt(tgt, { behavior: { behavior: "smooth", delta: Math.abs(play.at - tgt) || 1 } });
  },
  cellNext: () => {
    let tgt = null;
    if (play.done || play.mode === MODE.PUZZLE) {
      tgt = clamp(play.at + 1, 0, play.n - 1);
    } else {
      tgt = findUnresolvedCell(play.at, +1);
    }
    if (tgt != null) setAt(tgt, { behavior: { behavior: "smooth", delta: Math.abs(play.at - tgt) || 1 } });
  },
  wordPrev: () => jumpToUnresolvedWord(-1),
  wordNext: () => jumpToUnresolvedWord(1),
};

// Allow nav buttons to repeat when held (pointerdown + interval).
function attachHoldRepeat(btn, fn) {
  if (!btn || typeof fn !== "function") return;
  let repeatT = null;
  let repeatI = null;
  let ignoreClick = false;

  const stop = () => {
    if (repeatT) clearTimeout(repeatT);
    if (repeatI) clearInterval(repeatI);
    repeatT = null;
    repeatI = null;
  };

  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    ignoreClick = true;
    stop();
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
      ignoreClick = false;
      stop();
    });
  });

  btn.addEventListener("click", (e) => {
    if (ignoreClick) {
      ignoreClick = false;
      return;
    }
    fn();
  });
}

attachHoldRepeat(els.navCellPrev, navActions.cellPrev);
attachHoldRepeat(els.navCellNext, navActions.cellNext);
attachHoldRepeat(els.navWordPrev, navActions.wordPrev);
attachHoldRepeat(els.navWordNext, navActions.wordNext);

// FTUE events
els.ftuePrev?.addEventListener("click", (e) => {
  e.preventDefault();
  if (ftueStep === 0) {
    closeFtue();
    openSplash(splashState());
  } else {
    prevFtue();
  }
});
els.ftueNext?.addEventListener("click", (e) => {
  e.preventDefault();
  const atLast = ftueStep >= FTUE_STEPS.length - 1;
  if (atLast) {
    // Always jump into chain play on final CTA
    const summary = chainProgressSummary();
    closeFtue();
    setTab(VIEW.CHAIN);
    if (summary.state === "complete" || play.done) {
      chain.running = false;
      chain.started = true;
      chainSetUIState(CHAIN_UI.DONE);
      updatePlayUI();
    } else if (!chain.started) chainStartNow();
    else if (!chain.running) chainResume();
  } else {
    nextFtue();
  }
});
els.ftueSkip?.addEventListener("click", (e) => {
  e.preventDefault();
  closeFtue();
  setTab(VIEW.CHAIN);
  const summary = chainProgressSummary();
  if (summary.state === "complete" || play.done) {
    chain.running = false;
    chain.started = true;
    chainSetUIState(CHAIN_UI.DONE);
    updatePlayUI();
  } else if (!chain.started) chainStartNow();
  else if (!chain.running) chainResume();
});
els.ftueDots?.forEach?.((dot, idx) =>
  dot.addEventListener("click", (e) => {
    e.preventDefault();
    ftueStep = idx;
    renderFtueStep();
  })
);
els.ftueModal?.addEventListener("touchstart", onFtueTouchStart, { passive: true });
els.ftueModal?.addEventListener("touchend", onFtueTouchEnd, { passive: true });
els.ftuePlayPause?.addEventListener("click", (e) => {
  e.preventDefault();
  if (ftueDemo.paused) ftuePlay();
  else ftuePause();
});

// Results modal overlay click to close
els.resultsModal?.addEventListener("click", (e) => {
  if (e.target === els.resultsModal) {
    markInteracted();
    closeChainResults();
    focusForTyping();
  }
});

// Clear stats/progress
els.pClear?.addEventListener("click", () => {
  clearAllChainProgress();
  clearChainStats();
  resetPlay({ clearPersist: false });
  chainForceIdleZero();
});

// ---- Start ----
// Initialize UI and load the initial puzzle/view.
initOnScreenKeyboard();
initSlider();
loadPuzzle(0);
setTab(currentView);
queueInitialHintIntro();
maybeShowFtue();
maybeShowSplashOnLoad();

requestAnimationFrame(() => {
  if (_restoredFromStorage) {
    setAt(_restoredAt, { behavior: "none", noScroll: true });
  } else {
    setAt(0);
  }
  focusForTyping();
});
