import "../../docs/token_switcher/switcher.js";

const KEY = "overlap_puzzles_v1";
const SHARE_URL_OVERRIDE = ""; // leave blank to use current page URL; update if you want a fixed share link

const COLORS = [
  ["Red", "--c-red"],
  ["Yellow", "--c-yellow"],
  ["Green", "--c-green"],
  ["Blue", "--c-blue"],
  ["Purple", "--c-purple"],
];

const HEIGHT_CYCLE = ["full", "mid", "inner"];

const MODE = { OVERLAP: "overlap", CHAIN: "chain" };
const VIEW = { PLAY: "play", CHAIN: "chain", BUILD: "build" };

// ---- Remember last tab/view ----
const LAST_VIEW_KEY = `${KEY}__last_view`;

const VALID_VIEWS = new Set(Object.values(VIEW));

const DEV_MODE = (() => {
  try {
    const url = new URL(location.href);
    return url.searchParams.has("dev") || url.searchParams.has("devmode");
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
const FTUE_SEEN_KEY = `${KEY}__ftue_seen`;

function loadLastView() {
  try {
    const v = localStorage.getItem(LAST_VIEW_KEY);
    if (!DEV_MODE && v === VIEW.BUILD) return VIEW.CHAIN;
    return (DEV_MODE ? VALID_VIEWS.has(v) : v === VIEW.PLAY || v === VIEW.CHAIN) ? v : VIEW.CHAIN;
  } catch {
    return VIEW.CHAIN;
  }
}


// ---- Palettes (5 colors, from CSS) ----
const PALETTE_SIZE = 5;
const FALLBACK_PALETTE_ID = "classic";
const FALLBACK_PALETTE_COLORS = ["var(--c-red)", "var(--c-orange)", "var(--c-yellow)", "var(--c-green)", "var(--c-blue)"];

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

const PALETTES = readCssPalettes();
const PALETTE_ID_SET = new Set(PALETTES.map((p) => p.id));
const FIRST_PALETTE_ID = PALETTES[0]?.id || FALLBACK_PALETTE_ID;

const normalizePaletteId = (id) => {
  const v = String(id || "");
  return PALETTE_ID_SET.has(v) ? v : FIRST_PALETTE_ID;
};
const getPaletteById = (id) => PALETTES.find((p) => p.id === id) || PALETTES[0];
const paletteColorForWord = (puzzle, wordIdx) => {
  const pal = getPaletteById(normalizePaletteId(puzzle?.palette));
  const colors = pal?.colors?.length ? pal.colors : FALLBACK_PALETTE_COLORS;
  return colors[wordIdx % colors.length] || FALLBACK_PALETTE_COLORS[0];
};
const applyPaletteToDom = (paletteId) => {
  document.documentElement.setAttribute("data-puzzle-palette", normalizePaletteId(paletteId));
};

// ---- Slider (scroll surrogate, squish-style) ----
const SLIDER_CFG = {
  viewH: 100,
  unit: 8, // px per cell in the viewBox space
  thickH: 76,
  thinH: 26,
  curve: 14,
};

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

function getSliderMixSettings() {
  const css = getComputedStyle(document.documentElement);
  const base = css.getPropertyValue("--slider-color-mix-base").trim() || "var(--background-default)";
  const amtRaw = css.getPropertyValue("--slider-color-mix-amount").trim();
  const amtNum = parseFloat(amtRaw);
  const amount = Number.isFinite(amtNum) ? clamp(amtNum, 0, 100) : 0;
  return { base, amount };
}

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

function updateThumbFromScroll(force = false) {
  if (!slider.root || !slider.thumb) return;
  if (slider.grabbing && !force) return;
  if (!els.gridScroll) return;
  const sc = els.gridScroll;
  const { max, padL } = sliderScrollMetrics();
  const pct = max > 0 ? clamp((sc.scrollLeft - padL) / max, 0, 1) : 0;
  slider.thumb.style.left = `${pct * 100}%`;
}

// Build thick/thin runs from solved cells (not just locked words)
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

  // Precompute which words are correct
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

function sliderCurveLen(prevLenPx, nextLenPx) {
  const base = SLIDER_CFG.curve;
  const lim = Math.min(prevLenPx * 0.5, nextLenPx * 0.5);
  return Math.max(2, Math.min(base, Math.max(0, lim)));
}

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

function sliderColorStops(entries, puzzle, geometry, solvedCellsOverride, allowSolved = false) {
  const total = play.n || 0;
  if (!entries?.length || !total || !geometry?.segments?.length) return [];

  const useSolved = allowSolved && Array.isArray(solvedCellsOverride);
  const solvedCells = useSolved ? solvedCellsOverride : null;
  const solvedColor =
    getComputedStyle(document.documentElement).getPropertyValue("--slider-solved").trim() ||
    "rgba(0,0,0,0.35)";

  const covers = Array.from({ length: total }, () => []);
  for (const e of entries) {
    for (let i = e.start; i < e.start + e.len && i < total; i++) covers[i].push(e);
  }

  const wordCorrect = new Map();
  for (const e of entries) wordCorrect.set(e.eIdx, isWordCorrect(e));

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

  const fallbackColor =
    colors.find(Boolean) ||
    paletteColorForWord(puzzle, 0) ||
    getComputedStyle(document.documentElement).getPropertyValue("--puzzle-color-1").trim() ||
    "#999";
  for (let i = 0; i < colors.length; i++) {
    if (!colors[i]) colors[i] = fallbackColor;
  }

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

function updateSliderUI() {
  if (!slider.root || !slider.track) return;
  const isPlayableView = currentView === VIEW.CHAIN || currentView === VIEW.PLAY;
  const overflow = isPlayableView && els.gridScroll && els.gridScroll.scrollWidth > els.gridScroll.clientWidth + 4;
  slider.root.style.display = overflow ? "" : "none";
  if (!overflow) return;

  renderSliderSvg();
  updateThumbFromScroll();
}

// ---- Defaults loading (robust + cache-bust) ----
const DEFAULTS_VERSION = "2025-12-02"; // <-- bump this any time you edit examples.json
const DEFAULTS_VER_KEY = `${KEY}__defaults_version`;

// Cache-bust + bypass browser HTTP cache differences
const defaultsURL = new URL("./examples.json", import.meta.url);
defaultsURL.searchParams.set("v", DEFAULTS_VERSION);

// "no-store" helps with browser cache; the ?v= param helps across browsers + SW caches
const DEF = await (await fetch(defaultsURL, { cache: "no-store" })).json();


// ---- DOM ----
const $ = (s) => document.querySelector(s);
const els = {
  tabPlay: $("#tabPlay"),
  tabChain: $("#tabChain"),
  tabBuild: $("#tabBuild"),
  panelPlay: $("#panelPlay"),
  panelBuild: $("#panelBuild"),
  stage: $("#stage"),
  gridScroll: $("#gridScroll"),
  grid: $("#grid"),
  legend: $("#legend"),
  meta: $("#meta"),
  prev: $("#prev"),
  next: $("#next"),
  reset: $("#reset"),
  reveal: $("#reveal"),
  resultsModal: document.getElementById("results"),
  resultsClose: document.querySelector(".resultsClose"),
  resultsShare: document.querySelector(".resultsShare"),
  chainTimer: document.querySelector(".chainTimer"),
  slider: $(".game-slider"),
  nextPuzzleBtn: $("#nextPuzzleBtn"),
  puzzleActions: document.querySelector(".puzzle-actions"),
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
  ftueGrid: $("#ftueGrid"),
  ftueGridScroll: $("#ftueGridScroll"),
  ftueDialog: document.querySelector(".ftue-modal__dialog"),
  ftuePlayPause: document.querySelector(".ftue-playpause"),
  ftuePlayPauseIcon: document.querySelector(".ftue-playpause-icon"),
  pSel: $("#pSel"),
  pNew: $("#pNew"),
  pDel: $("#pDel"),
  pSave: $("#pSave"),
  pTitle: $("#pTitle"),
  rows: $("#rows"),
  wAdd: $("#wAdd"),
  pDate: $("#pDate"),
  ioTxt: $("#ioTxt"),
  ioExp: $("#ioExp"),
  ioImp: $("#ioImp"),
  bGrid: $("#bGrid"),
  status: $("#status"),
  solution: $("#solution"),
  helper: $(".helper"),
  keyboard: $(".keyboard"),
  toastSuccess: $("#toastSuccess"),
  toastWarning: $("#toastWarning"),
  toastError: $("#toastError"),
  toastWordSolved: $("#toastWordSolved"),
  shareInline: $("#shareInline"),

};

let _gridScrollBound = false;
const NAV_DEBUG = false;
const logNav = () => {};

// ---- Toasts ----
const toastTimers = { success: 0, warning: 0, error: 0 };
let lastPlayWarningKey = "";
let lastChainWarningKey = "";

function parseMsVar(val, fallback) {
  if (!val) return fallback;
  const n = parseInt(String(val).trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toastDuration(type) {
  const css = getComputedStyle(document.documentElement);
  const raw =
    css.getPropertyValue(`--toast-${type}-duration`) ||
    css.getPropertyValue(`--toast-${type}-duration-ms`);
  return parseMsVar(raw, type === "error" ? 2200 : 2600);
}

function showToast(type, message, duration) {
  const map = {
    success: els.toastSuccess,
    warning: els.toastWarning,
    error: els.toastError,
    wordSolved: els.toastWordSolved,
  };
  const el = map[type];
  if (!el) return;
  if (type === "wordSolved") {
    const countSpan = el.querySelector(".toast-word-solved-count");
    if (countSpan) countSpan.textContent = message || "";
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

function clearToasts() {
  ["success", "warning", "error", "wordSolved"].forEach((type) => {
    if (toastTimers[type]) {
      clearTimeout(toastTimers[type]);
      toastTimers[type] = 0;
    }
    const el =
      type === "success" ? els.toastSuccess : type === "warning" ? els.toastWarning : els.toastError;
    if (el) el.classList.remove("is-showing");
  });
}

const userKey = () => (Array.isArray(play.usr) ? play.usr.join("") : "");

function resetToastGuards() {
  lastPlayWarningKey = "";
  lastChainWarningKey = "";
}

// ---- FTUE ----
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
const FTUE_TIMING = {
  typeStep: 550,
  stepStartDelay: [1000, 300, 1200], // per-step start delays (0,1,2)
  stepEndDelay: [7000, 5000, 10000], // per-step end delays (0,1,2)
  step3MidPause: 2000,
};

const ftueIsOpen = () => !!els.ftueModal?.classList.contains("is-open");
let _ftuePrevOverflow = "";
function ftueDisableInteractions() {
  _ftuePrevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
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

function renderFtueStep() {
  const step = Math.max(0, Math.min(FTUE_STEPS.length - 1, ftueStep));
  const data = FTUE_STEPS[step] || FTUE_STEPS[0];
  if (els.ftueTitle) els.ftueTitle.textContent = data.title || "";
  if (els.ftueDesc) els.ftueDesc.textContent = data.desc || "";
  if (els.ftueTip) els.ftueTip.textContent = data.tip || "";
  if (els.ftueStepLabel) els.ftueStepLabel.textContent = `${step + 1}/${FTUE_STEPS.length}`;
  if (els.ftuePrev) {
    els.ftuePrev.disabled = step === 0;
    els.ftuePrev.classList.toggle("is-disabled", step === 0);
  }
  if (els.ftueNext) {
    els.ftueNext.textContent = step === FTUE_STEPS.length - 1 ? "Let's Play" : "Next";
  }
  if (els.ftueDots && els.ftueDots.forEach) {
    els.ftueDots.forEach((dot, idx) => dot.classList.toggle("is-active", idx === step));
  }

  // reset any in-flight timers/scroll freeze before re-running animation
  clearFtueTimers();
  ftueDemo.freezeScroll = false;
  requestAnimationFrame(() => runFtueAnimation(step));
}

function openFtue(startStep = 0) {
  if (!els.ftueModal) return;
  clearTimeout(ftueDialogTimer);
  if (els.ftueDialog) els.ftueDialog.classList.remove("is-open");
  ftueNavBlockedUntil = 0;
  ftueStep = Math.max(0, Math.min(FTUE_STEPS.length - 1, startStep));
  ftueDemo.paused = false;
  ftueUpdatePlayPauseUI();
  ensureFtueBoard();
  renderFtueStep();
  els.ftueModal.classList.remove("is-open");
  els.ftueModal.setAttribute("aria-hidden", "false");
  els.ftueModal.removeAttribute("hidden");
  // document.body.classList.add("is-ftue-open");
  ftueDisableInteractions();
  requestAnimationFrame(() => {
    els.ftueModal?.classList.add("is-open");
  });
  ftueDialogTimer = window.setTimeout(() => {
    if (els.ftueDialog && ftueIsOpen()) {
      els.ftueDialog.classList.add("is-open");
    }
  }, FTUE_DIALOG_DELAY);
}

function closeFtue() {
  if (!els.ftueModal) return;
  clearFtueTimers();
  clearTimeout(ftueDialogTimer);
  ftueDialogTimer = null;
  ftueDemo.paused = true;
  if (els.ftueDialog) els.ftueDialog.classList.remove("is-open");
  els.ftueModal.classList.remove("is-open");
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

function maybeShowFtue() {
  if (!els.ftueModal) return;
  clearTimeout(ftueShowTimer);
  if (FORCE_FTUE || !hasSeenFtue()) {
    ftueShowTimer = window.setTimeout(() => openFtue(0), FTUE_DIALOG_DELAY);
  }
}

function clearFtueTimers() {
  ftueDemo.timers.forEach((t) => clearTimeout(t));
  ftueDemo.timers = [];
}

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

function ensureFtueBoard() {
  if (!els.ftueGrid) return null;
  const ftuePuzzle = puzzles.find(
    (p) => String(p.title || "").trim().toLowerCase() === "ftue"
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

function ftueAddSolvedCells(entry, count = null) {
  if (!entry || !ftueDemo.solvedCells) return;
  const n = count == null ? entry.len : Math.min(count, entry.len);
  for (let i = 0; i < n; i++) {
    ftueDemo.solvedCells.add(entry.start + i);
  }
}

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

function maybeToastPlayFilledWrong() {
  if (play.mode !== MODE.OVERLAP || play.done) return;
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

function bindGridScrollCancels() {
  if (_gridScrollBound || !els.gridScroll) return;
  _gridScrollBound = true;
  const cancel = () => cancelSmoothFollow();
  const sc = els.gridScroll;
  ["pointerdown", "wheel", "touchstart"].forEach((ev) => {
    sc.addEventListener(ev, cancel, { passive: true });
  });
}

const stripHeightsFromPuzzles = (arr = []) =>
  arr.map((p) => ({
    ...p,
    words: (p?.words || []).map((w) => {
      const { height, h, ...rest } = w || {};
      return { ...rest };
    }),
  }));

// ---- Storage ----
const store = {
  load() {
    try {
      const url = new URL(location.href);
      const forceReset = url.searchParams.has("reset") || url.searchParams.has("fresh");

      const savedDefaultsVer = localStorage.getItem(DEFAULTS_VER_KEY);

      // If defaults changed (or you force reset), discard saved puzzles so you get fresh examples.json
      if (forceReset || savedDefaultsVer !== DEFAULTS_VERSION) {
        localStorage.setItem(DEFAULTS_VER_KEY, DEFAULTS_VERSION);
        localStorage.removeItem(KEY);
      }

      const raw = localStorage.getItem(KEY);
      const v = raw ? JSON.parse(raw) : null;

      if (Array.isArray(v) && v.length) return v;

      // No saved puzzles => use shipped defaults
      localStorage.setItem(DEFAULTS_VER_KEY, DEFAULTS_VERSION);
      return structuredClone(DEF);
    } catch {
      return structuredClone(DEF);
    }
  },
  save() {
    localStorage.setItem(DEFAULTS_VER_KEY, DEFAULTS_VERSION);
    localStorage.setItem(KEY, JSON.stringify(stripHeightsFromPuzzles(puzzles)));
  },
};


// ---- Utils ----
const cleanA = (s) => (s || "").toUpperCase().replace(/[^A-Z]/g, "");
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const insets = (h) => (h === "mid" ? [12.5, 12.5] : h === "inner" ? [25, 25] : [0, 0]);
const isEditable = (el) =>
  !!(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));

let dirty = false;
const setDirty = (v = true) => {
  dirty = !!v;
  els.pSave && els.pSave.classList.toggle("is-hot", dirty);
};

const tieR = new WeakMap();
const tr = (w) => {
  let v = tieR.get(w);
  if (v == null) {
    v = Math.random();
    tieR.set(w, v);
  }
  return v;
};

const isChainPuzzle = (p) => String(p?.type || MODE.OVERLAP) === MODE.CHAIN;

const inferDiffFromColor = () => "easy";

const toDateKey = (d) => {
  if (!(d instanceof Date) || Number.isNaN(+d)) return null;
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const pad = (n) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(day)}`;
};

const normalizePuzzleDate = (val) => {
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

const puzzleDateLabel = (p) => {
  if (!p) return null;
  const dt = p.dateKey ? dateFromKey(p.dateKey) : null;
  const src = dt;
  if (!src || Number.isNaN(+src)) return null;
  return src.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
};

const normWord = (w, pType, opts = {}) => {
  const out = {
    clue: String(w?.clue || ""),
    answer: String(w?.answer || ""),
    start: +w?.start || 1,
  };

  return out;
};


const normPuzzle = (p) => {
  const type = String(p?.type || MODE.OVERLAP);
  const wordsRaw = Array.isArray(p?.words) ? p.words : [];
  const fallback = { clue: "Clue", answer: "WORD", start: 1 };
  const timed = type === MODE.CHAIN ? false : true;
  const words = (wordsRaw.length ? wordsRaw : [fallback]).map((w) => normWord(w, type, { timed }));
  const { dateKey } = normalizePuzzleDate(p?.dateKey || p?.date);


  const out = {
    title: String(p?.title || "Untitled"),
    type,
    palette: normalizePaletteId(p?.palette),
    words,
    dateKey,
  };
  return out;
};

// ---- State ----
let puzzles = store.load().map(normPuzzle);
let pIdx = 0;

let currentView = loadLastView(); // play | chain | build

const play = {
  mode: MODE.OVERLAP,
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

let selectedEntry = null;
let selectAllUnlocked = false;

// ---- Touch + on-screen keyboard ----
let hasInteracted = true;
const markInteracted = () => {
  hasInteracted = true;
};

const IS_TOUCH = "ontouchstart" in window || navigator.maxTouchPoints > 0;
const UA = navigator.userAgent || "";
const UA_DESKTOP_HINT =
  /(Windows NT|Macintosh|CrOS|Linux|X11)/i.test(UA) && !/(Mobile|Tablet|iPad|iPhone|Android)/i.test(UA);
const UA_DATA_DESKTOP = navigator.userAgentData ? navigator.userAgentData.mobile === false : false;

const DEFAULTS_TO_HARDWARE = UA_DESKTOP_HINT || UA_DATA_DESKTOP;
// On touch devices default to virtual keyboard; on desktop honor detection
let hasHardwareKeyboard = IS_TOUCH ? false : DEFAULTS_TO_HARDWARE;
let hardwareKeyboardLocked = false; // set true when we detect hardware during this session
let lastHardwareKeyboardTs = 0;
const HARDWARE_STALE_MS = 120000; // demote hardware flag after ~2 minutes of no keys
const shouldUseCustomKeyboard = () => IS_TOUCH && !hasHardwareKeyboard;

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

const KB_SENTINEL = "\u200B";
const kbReset = () => {
  kb.value = KB_SENTINEL;
  try {
    kb.setSelectionRange(1, 1);
  } catch {}
};
kbReset();

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

function updateKeyboardVisibility() {
  const root = els.keyboard;
  if (!root) return;

  const show = shouldUseCustomKeyboard() && (currentView === VIEW.PLAY || currentView === VIEW.CHAIN);

  root.classList.toggle("is-visible", show);
  root.setAttribute("aria-hidden", show ? "false" : "true");
  document.body.classList.toggle("uses-custom-keyboard", show);

  if (show) kb.blur();
}

function maybeDemoteHardwareKeyboard() {
  if (hardwareKeyboardLocked) return;
  if (!hasHardwareKeyboard) return;
  const stale = !lastHardwareKeyboardTs || Date.now() - lastHardwareKeyboardTs > HARDWARE_STALE_MS;
  if (!stale) return;

  hasHardwareKeyboard = false;
  updateKeyboardVisibility();
}

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
function computed(p) {
  const type = String(p?.type || MODE.OVERLAP);

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
  const exp = Array.from({ length: total }, () => null);

  for (const e of entries) {
    for (let i = 0; i < e.len; i++) {
      const idx = e.start + i;
      const ch = e.ans[i];
      if (exp[idx] && exp[idx] !== ch) {
        return { ok: false, total, exp, entries, conf: { idx, a: exp[idx], b: ch } };
      }
      exp[idx] = ch;
    }
  }

  const gaps = exp.map((c, i) => (c ? null : i)).filter((v) => v !== null);
  return { ok: true, total, exp, entries, gaps };
}

function setCols(n) {
  document.documentElement.style.setProperty("--cols", String(n));
}

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

function jumpToUnresolvedWord(delta) {
  logNav("jumpToUnresolvedWord start", {
    delta,
    at: play.at,
    currentEntry: entryAtIndex(play.at),
    usr: play.usr?.join(""),
    locked: [...play.lockedEntries],
  });

  // Overlap mode: always jump by word starts, ignoring correctness/locks (done or not).
  if (play.mode === MODE.OVERLAP) {
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

function applyHintForEntry(eIdx) {
  clearSelectAll();
  const entry = play.entries.find((x) => x.eIdx === eIdx);
  if (!entry) return;
  const idx = firstHintIndex(entry);
  if (idx == null) return;

  const expected = play.exp[idx] || "";
  play.usr[idx] = expected;

  if (play.mode === MODE.CHAIN) {
    if (!chain.started && !play.done) chainStartNow();
    chain.hintsUsed += 1;
    play.lockedCells[idx] = true;

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
  } else {
    updatePlayUI();
    checkSolvedOverlapOnly();
  }

  updateResetRevealVisibility();
  updatePlayControlsVisibility();
  updatePuzzleActionsVisibility();
}

function updateSelectedWordUI() {
  els.grid.querySelectorAll(".range").forEach((r) => {
    r.classList.toggle("is-selected", selectedEntry != null && r.dataset.e === String(selectedEntry));
  });
}

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

// ---- UI visibility helpers ----
function updatePlayControlsVisibility() {
  if (!els.reset || !els.reveal) return;
  // Only gate in play/overlap mode; otherwise leave visible.
  if (play.mode !== MODE.OVERLAP || currentView !== VIEW.PLAY) {
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

function findTodayChainIndex() {
  const todayKey = toDateKey(new Date());
  if (!todayKey) return null;
  for (let i = 0; i < puzzles.length; i++) {
    const p = puzzles[i];
    if (isChainPuzzle(p) && p.dateKey && p.dateKey === todayKey) return i;
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

function ensureCurrentPuzzleMatchesView() {
  const list = indicesForView(currentView);
  if (!list.length) return false;
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
};


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


function chainSetUIState(state, ui = ensureChainUI()) {
  // global hook for CSS
  document.body.dataset.chainState = state;

  // button hook for CSS
  ui.startBtn.dataset.state = state;

  // button label
ui.startBtn.textContent =
  state === CHAIN_UI.IDLE ? "Start" :
  state === CHAIN_UI.RUNNING ? "Pause" :
  state === CHAIN_UI.PAUSED ? "Resume" :
  "Reset";

  // toggle reset/reveal visibility in chain mode
  updateResetRevealVisibility(state);
  updatePuzzleActionsVisibility(state);
}

function chainPause() {
  if (!chain.started || !chain.running) return;

  const ui = ensureChainUI();

  // snapshot time so resume is accurate
  const elapsed = Math.max(0, (Date.now() - chain.startAt) / 1000);
  chain.elapsed = elapsed;
  ui.timer.textContent = fmtTime(elapsed);

  chain.running = false;
  chainSetUIState(CHAIN_UI.PAUSED, ui);
}

function chainPauseIfBackgrounded() {
  if (DEV_DISABLE_AUTOPAUSE) return;
  if (play.mode !== MODE.CHAIN) return;
  if (!chain.started || !chain.running) return;
  if (play.done) return;
  chainPause();
}

function chainResume() {
  if (!chain.started || chain.running) return;

  const ui = ensureChainUI();

  const elapsed = Math.max(0, +chain.elapsed || 0);
  chain.startAt = Date.now() - elapsed * 1000;

  chain.running = true;
  chainSetUIState(CHAIN_UI.RUNNING, ui);
  focusForTyping();
}

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



function ensureChainUI() {
  if (chainUI) return chainUI;

  const hud = document.querySelector(".chainHud");

  const host = els.helper || els.meta?.parentElement || document.body;
  if (hud && host && hud.parentElement !== host) host.appendChild(hud);

  const startBtn = hud.querySelector("#chainStartBtn");

startBtn.addEventListener("click", () => {
  markInteracted();

  if (play.mode !== MODE.CHAIN) return;

  // If completed, button becomes Reset
  if (play.done) {
    chainResetFromHud();
    return;
  }

  if (!chain.started) chainStartNow();
  else if (chain.running) chainPause();
  else chainResume();
});



  chainUI = {
    hud,
    startBtn,
    timer: document.querySelector(".chainTimer"),
  };
chainSetUIState(
  play?.done
    ? CHAIN_UI.DONE
    : (chain.started ? (chain.running ? CHAIN_UI.RUNNING : CHAIN_UI.PAUSED) : CHAIN_UI.IDLE),
  chainUI
);


  return chainUI;
}

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
    cClose,
    cShare,
  };
  return chainResults;
}

function closeChainResults() {
  if (!chainResults) return;
  chainResults.wrap.classList.remove("is-open");
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

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
}

function chainResetTimer() {
  const p = puzzles[pIdx];
  const ui = ensureChainUI();

  chainStopTimer();

  chain.elapsed = 0;
  ui.timer.textContent = fmtTime(0);
}

function chainForceIdleZero() {
  if (play.mode !== MODE.CHAIN) return;
  chainStopTimer();
  chain.started = false;
  chain.running = false;
  chain.left = 0;
  chain.elapsed = 0;
  const ui = ensureChainUI();
  ui.timer.textContent = fmtTime(0);
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
  ui.timer.textContent = fmtTime(0);
  chainSetUIState(CHAIN_UI.DONE, ui);
  setInlineCluesHiddenUntilChainStart(); // will unhide since started=true
}


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

  if (chain.tickId) clearInterval(chain.tickId);
  chain.tickId = setInterval(() => {
    if (!chain.running) return;

    const elapsed = (Date.now() - chain.startAt) / 1000;
    chain.elapsed = elapsed;

    ui.timer.textContent = fmtTime(elapsed);
  }, 120);
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

function scoreChain() {
  const entries = play.entries || [];
  const correct = entries.filter(isWordCorrect).length;
  const attempted = entries.filter(isWordAttempted).length;
  return { correct, attempted };
}

function openChainResults(stats, reason) {
  const r = ensureChainResults();
  if (!r) return;
  r.wrap.classList.add("is-open");
  const tSec = Math.max(0, Math.floor(chain.lastFinishElapsedSec || 0));
  const total = play.entries?.length || 0;
  const solved = Math.max(0, total - Math.max(0, chain.unsolvedCount || 0));
  const allSolved = chain.unsolvedCount === 0;

  r.wrap.setAttribute("data-result", allSolved ? "solved" : "partial");
  r.title.textContent = allSolved ? "Success!" : "Overlap";

  const p = puzzles[pIdx];
  const label = puzzleDateLabel(p) || new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  r.subtitle.textContent = label;

  r.statTime.textContent = fmtTime(tSec);
  r.statSolved.textContent = `${solved}/${total}`;
  r.statHints.textContent = String(Math.max(0, chain.hintsUsed || 0));

}

function chainFinish(reason = "time", opts = {}) {
  if (play.mode !== MODE.CHAIN) return;
  if (play.done) return;
  const unsolved = Math.max(0, opts.unsolved ?? 0);
  if (reason === "solved" && chain.started) {
    chain.lastFinishElapsedSec = Math.max(0, (Date.now() - chain.startAt) / 1000);
    chain.lastFinishLeftSec = 0;
  } else {
    chain.lastFinishLeftSec = 0;
    const elapsed = chain.startAt ? (Date.now() - chain.startAt) / 1000 : chain.elapsed || 0;
    chain.lastFinishElapsedSec = Math.max(0, elapsed);
  }

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

  openChainResults(scoreChain(), reason);
}

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
function isCellLocked(i) {
  return !!play.lockedCells[i];
}

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
  if (play.mode !== MODE.OVERLAP || !els.grid || play.fullSolveAnimated) return;
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

function updateLockedWordUI() {
  els.grid.querySelectorAll(".range").forEach((r) => {
    const eIdx = +r.dataset.e;
    const locked = play.mode === MODE.CHAIN && play.lockedEntries.has(eIdx);
    r.classList.toggle("is-locked", locked);
  });
  updateSliderUI();
}

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
          showToast("wordSolved", `${solved}/${total}`);
        }))
      );
    }
  }
}

function findNextEditable(from, dir) {
  let i = from;
  while (i >= 0 && i < play.n) {
    if (!isCellLocked(i)) return i;
    i += dir;
  }
  return null;
}

function chainInputAllowed() {
  if (play.mode !== MODE.CHAIN) return true;
  if (!chain.started && !play.done) chainStartNow();
  else if (chain.started && !chain.running && !play.done) chainResume();
  return chain.started;
}
function setInlineCluesHiddenUntilChainStart() {
  const preStart = play.mode === MODE.CHAIN && !chain.started && currentView !== VIEW.BUILD;

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

function updateChainClues() {
  // Legend clues removed; rely on inline range clues only.
  if (els.legend) {
    els.legend.hidden = true;
    els.legend.innerHTML = "";
  }
}


// ---- Play UI ----
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
}

function setAt(i, { behavior, noScroll } = {}) {
  clearSelectAll();
  play.at = clamp(i, 0, play.n - 1);
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
}

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

function write(ch) {
  if (play.done) return;
  if (!chainInputAllowed()) return; // require Start for word chain

  if (play.mode === MODE.CHAIN && isCellLocked(play.at)) {
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
      const nxt = findNextEditable(prevAt + 1, +1);
      if (nxt != null) nextAt = nxt;
      else nextAt = prevAt;
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
    return;
  }

  play.at = nextAt;
  updatePlayUI();
  maybeToastPlayFilledWrong();
  requestKeepActiveCellInView({ behavior: "smooth", delta: Math.abs(nextAt - prevAt) || 1 });
  checkSolvedOverlapOnly();
}

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
function openSuccess() {
  // Success overlay disabled for play mode; toast handles feedback.
}

function closeSuccess() {
  els.resultsModal?.classList.remove("is-open");
}

function shareResult({ mode }) {
  const puzzle = puzzles[pIdx];
  const shareDateLabel = (() => {
    const src = mode === MODE.CHAIN && puzzle?.dateKey ? dateFromKey(puzzle.dateKey) : null;
    const opts = {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    };
    if (src) opts.timeZone = "UTC";
    const d = src || new Date();
    const label = d.toLocaleDateString(undefined, opts);
    return label ? label.replace(/^([A-Za-z]{3})/, (m) => m.toUpperCase()) : label;
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

  let msg = `Overlap | ${shareDateLabel}`;

  if (mode === MODE.CHAIN) {
    const elapsed = Math.max(0, +chain.lastFinishElapsedSec || 0);
    const timeText = fmtTime(elapsed);
    if (timeText) msg += `\nI solved the puzzle in ${timeText}`;
    const hints = Math.max(0, chain.hintsUsed || 0);
    if (chain.unsolvedCount > 0 && chain.lastFinishReason !== "solved") {
      msg += ` with ${chain.unsolvedCount} unsolved words`;
      if (hints > 0) msg += ` and ${hints} hints.`;
    } else if (hints > 0) {
      msg += ` with ${hints} hints.`;
    }
  }

  const payload = { title: "Overlap", text: msg, url: baseUrl };

  if (navigator.share) {
    navigator.share(payload).catch(() => {});
    return;
  }

  // Fallback: copy to clipboard
  const full = `${msg}\n${baseUrl}`;
  navigator.clipboard?.writeText(full).then(
    () => alert("Share text copied!"),
    () => alert(full)
  );
}

// ---- Reset / reveal ----
function resetPlay() {
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
    const ui = ensureChainUI();
    ui.startBtn.style.display = "";
    els.legend.hidden = true;
    els.legend.innerHTML = "";
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
    play.usr = play.exp.slice();
    chainFinish("reveal", { unsolved });
    return;
  }

  play.usr = play.exp.slice();
  play.done = true;
  play.revealed = true;
  updatePlayUI();
  updatePlayControlsVisibility();
}

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

  play.mode = isChainPuzzle(p) ? MODE.CHAIN : MODE.OVERLAP;
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


  // Legend mode
  if (play.mode === MODE.CHAIN) {
    const ui = ensureChainUI();
    ui.hud.hidden = false;
    ui.startBtn.style.display = ""; // show Start

    if (els.legend) {
      els.legend.classList.add("chainLegend");
      els.legend.hidden = true; // hide unused legend
      els.legend.innerHTML = "";
    }

    chainResetTimer();
    setInlineCluesHiddenUntilChainStart();

  } else {
    if (chainUI) chainUI.hud.hidden = true;
    if (els.reveal) els.reveal.style.display = "";

    if (els.legend) {
      els.legend.hidden = true;
      els.legend.classList.remove("chainLegend");
      els.legend.innerHTML = "";
    }
    setInlineCluesHiddenUntilChainStart(); // clears chain-prestart class when not in chain mode
    pulseRangeHintIntro();
  }
  updateResetRevealVisibility();

  // meta count should reflect current view list
  const viewForMeta = currentView === VIEW.BUILD ? (isChainPuzzle(p) ? VIEW.CHAIN : VIEW.PLAY) : currentView;
  const list = indicesForView(viewForMeta);
  const pos = list.indexOf(pIdx);
  const posText = list.length ? `${(pos >= 0 ? pos : 0) + 1} / ${list.length}` : `1 / ${puzzles.length}`;

  els.meta.replaceChildren(
  document.createTextNode(p.title || "Untitled"),
  document.createTextNode(" "),
  Object.assign(document.createElement("span"), { textContent: `• ${posText}` })
);


  updatePlayUI();
  updatePlayControlsVisibility();
  updatePuzzleActionsVisibility();

  if (els.gridScroll) els.gridScroll.scrollLeft = 0;

  syncBuilder();
  setDirty(false);
  setAt(0, { behavior: "none", noScroll: true });
}

// ---- Tabs ----
function setTab(which) {
  if (!DEV_MODE && which === VIEW.BUILD) which = VIEW.CHAIN;
  currentView = which;
  try { localStorage.setItem(LAST_VIEW_KEY, currentView); } catch {}
  resetPlay();
  chainSetUIState(CHAIN_UI.IDLE);

  // Global hook for CSS
  document.body.dataset.view = which; // "play" | "chain" | "build"

  const isBuild = which === VIEW.BUILD;
  const isChain = which === VIEW.CHAIN;
  const isPlay  = which === VIEW.PLAY;

  els.tabPlay?.classList.toggle("is-active", isPlay);
  els.tabChain?.classList.toggle("is-active", isChain);
  els.tabBuild?.classList.toggle("is-active", DEV_MODE && isBuild);

  els.tabPlay?.setAttribute("aria-selected", isPlay ? "true" : "false");
  els.tabChain?.setAttribute("aria-selected", isChain ? "true" : "false");
  els.tabBuild?.setAttribute("aria-selected", isBuild && DEV_MODE ? "true" : "false");

  els.panelPlay?.classList.toggle("is-active", !isBuild);
  els.panelBuild?.classList.toggle("is-active", DEV_MODE && isBuild);

  const hideTimer = which === VIEW.PLAY;
  els.chainTimer?.toggleAttribute("hidden", hideTimer);

  updateKeyboardVisibility();

  if (!isBuild) {
    ensureCurrentPuzzleMatchesView();
    updateSliderUI();
    focusForTyping();
  } else {
    chainStopTimer();
  }

  updateResetRevealVisibility();
  updatePlayControlsVisibility();
  updatePuzzleActionsVisibility();
}


// ---- Escaping ----
function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
}

function escapeAttr(s) {
  return String(s).replace(
    /[&<>"']/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}

function handleEnterKey() {
  if (play.mode === MODE.OVERLAP) {
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

// ---- Builder UI injection (mode + chain fields) ----
let bModeWrap = null;
let bModeSel = null;
let bPaletteSel = null;

function ensureBuilderModeUI() {
  if (bModeWrap) return;

  const box = document.querySelector(".puzzle_inputs");
  if (!box) return;

  const wrap = document.createElement("div");
  wrap.style.marginTop = "12px";
  wrap.innerHTML = `
    <label class="lab" for="pMode">Mode</label>
    <select class="sel" id="pMode">
      <option value="${MODE.OVERLAP}">Overlap</option>
      <option value="${MODE.CHAIN}">Word Chain</option>
    </select>

    <div style="margin-top:10px">
      <label class="lab" for="pPalette">Palette</label>
      <select class="sel" id="pPalette"></select>
    </div>
  `;

  els.pTitle.insertAdjacentElement("afterend", wrap);

  bModeWrap = wrap;
  bModeSel = wrap.querySelector("#pMode");
  bPaletteSel = wrap.querySelector("#pPalette");

  bModeSel.addEventListener("change", () => {
    puzzles[pIdx].type = bModeSel.value;

    if (puzzles[pIdx].type === MODE.CHAIN) {
      puzzles[pIdx].words = (puzzles[pIdx].words || []).map((w) => normWord(w, MODE.CHAIN));
    }

    setDirty(true);
    syncBuilder();
  });

  bPaletteSel.addEventListener("change", () => {
    puzzles[pIdx].palette = normalizePaletteId(bPaletteSel.value);
    setDirty(true);
    applyPaletteToDom(puzzles[pIdx].palette);
    renderPreview();
    renderRows();
  });

}

// ---- Builder render ----
function syncBuilder() {
  ensureBuilderModeUI();

  els.pSel.innerHTML = puzzles
    .map((p, i) => {
      const tag = p.type === MODE.CHAIN ? " — Word Chain" : "";
      return `<option value="${i}" ${i === pIdx ? "selected" : ""}>${escapeHtml(p.title || "Untitled")}${tag}</option>`;
    })
    .join("");

  els.pTitle.value = puzzles[pIdx]?.title || "";
  els.pDate.value = puzzles[pIdx]?.dateKey || "";

  const p = puzzles[pIdx];
  const chainMode = isChainPuzzle(p);

  if (bModeSel) bModeSel.value = p.type || MODE.OVERLAP;
  if (bPaletteSel) {
    const opts = PALETTES.map(
      (pal) => `<option value="${pal.id}" ${pal.id === p.palette ? "selected" : ""}>${escapeHtml(pal.label)}</option>`
    ).join("");
    bPaletteSel.innerHTML = opts;
    bPaletteSel.value = p.palette;
  }

  renderRows();
  renderPreview();
}

function setStatus(m) {
  const gaps = m.gaps || [];
  if (!m.ok) {
    els.status.className = "status bad";
    els.status.textContent = `Conflict at column ${m.conf.idx + 1}: “${m.conf.a}” vs “${m.conf.b}”.`;
  } else if (gaps.length) {
    els.status.className = "status bad";
    els.status.textContent = `Uncovered columns: ${gaps.slice(0, 18).map((x) => x + 1).join(", ")}${gaps.length > 18 ? "…" : ""}`;
  } else {
    els.status.className = "status";
    els.status.innerHTML = `Total columns: <strong>${m.total}</strong> • Words: <strong>${m.entries.length}</strong> • ${dirty ? "Unsaved changes" : "Saved"}`;
  }
}

function renderRows() {
  const p = puzzles[pIdx];
  const chainMode = isChainPuzzle(p);


  const ws = p.words || [];
  const order = ws.map((w, i) => ({ i, s: +w.start || 1, r: tr(w) })).sort((a, b) => a.s - b.s || a.r - b.r);

  els.rows.innerHTML = order
    .map((o, pos) => {
      const i = o.i;
      const w = ws[i];

      const swColor = paletteColorForWord(p, i);

      return `
        <div class="row" data-i="${i}">
          <div class="rowTop">
            <div class="left">
              <span class="range-swatch" style="--color:${swColor}"></span>
              <span>Word ${pos + 1}</span>
            </div>
            <div class="right"><button class="pill" type="button" data-act="rm">Remove</button></div>
          </div>
            <div class="grid5">
              <div class="full">
                <label class="lab">Clue</label>
                <input class="mi" data-f="clue" value="${escapeAttr(w.clue || "")}" />
              </div>
              <div class="full">
              <label class="lab">Answer</label>
              <input class="mi" data-f="answer" value="${escapeAttr(w.answer || "")}" />
            </div>
            <div>
              <label class="lab">Start</label>
              <input class="mi" data-f="start" inputmode="numeric" value="${escapeAttr(String(w.start ?? 1))}" />
            </div>
          </div>
        </div>`;
    })
    .join("");

  const m = computed(puzzles[pIdx]);
  setStatus(m);
}

function renderPreview() {
  const m = computed(puzzles[pIdx]);
  setCols(m.total);
  renderGrid(els.bGrid, m, false, puzzles[pIdx]);
  els.bGrid.classList.add("showNums");

  const bad = m.ok ? null : m.conf?.idx;

  els.bGrid.querySelectorAll(".cell").forEach((c) => {
    const i = +c.dataset.i;
    c.querySelector(".num").textContent = i + 1;
    c.querySelector(".letter").textContent = m.exp[i] || "";
    c.classList.toggle("is-bad", bad === i);
  });

  els.solution.textContent = `Solution row: ${m.exp.map((c) => c || "·").join("")}`;

  setStatus(m);
}

function saveAndReRender() {
  setDirty(true);
  renderRows();
  renderPreview();
}

// ---- Events ----
// Save
els.pSave.addEventListener("click", () => {
  const m = computed(puzzles[pIdx]);
  if (!m.ok) return alert("Fix conflicts before saving.");
  if (m.gaps?.length) return alert("Cover every column (no gaps) before saving.");
  store.save();
  setDirty(false);
  loadPuzzle(pIdx);
});

// Export
els.ioExp.addEventListener("click", async () => {
  const t = JSON.stringify(stripHeightsFromPuzzles(puzzles), null, 2);
  els.ioTxt.value = t;
  try {
    await navigator.clipboard.writeText(t);
  } catch {}
});

// Import
els.ioImp.addEventListener("click", () => {
  try {
    const arr = JSON.parse(els.ioTxt.value || "");
    if (!Array.isArray(arr)) throw 0;
    puzzles = arr.map((p) => normPuzzle(p));
    store.save();
    els.ioTxt.value = "";
    loadPuzzle(0);
    setTab(VIEW.BUILD);
  } catch {
    alert("Invalid JSON. Paste the exported puzzles JSON and try again.");
  }
});

// Tabs
els.tabPlay?.addEventListener("click", () => setTab(VIEW.PLAY));
els.tabChain?.addEventListener("click", () => setTab(VIEW.CHAIN));
if (DEV_MODE) {
  els.tabBuild?.addEventListener("click", () => setTab(VIEW.BUILD));
} else if (els.tabBuild) {
  els.tabBuild.style.display = "none";
  els.panelBuild && (els.panelBuild.style.display = "none");
}

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
  revealPlay();
  focusForTyping();
});
els.nextPuzzleBtn?.addEventListener("click", () => {
  markInteracted();
  loadByViewOffset(1);
});
els.shareInline?.addEventListener("click", () => {
  markInteracted();
  shareResult({ mode: play.mode });
});
const navActions = {
  cellPrev: () => {
    let tgt = null;
    if (play.done || play.mode === MODE.OVERLAP) {
      tgt = clamp(play.at - 1, 0, play.n - 1);
    } else {
      tgt = findUnresolvedCell(play.at, -1);
    }
    if (tgt != null) setAt(tgt, { behavior: { behavior: "smooth", delta: Math.abs(play.at - tgt) || 1 } });
  },
  cellNext: () => {
    let tgt = null;
    if (play.done || play.mode === MODE.OVERLAP) {
      tgt = clamp(play.at + 1, 0, play.n - 1);
    } else {
      tgt = findUnresolvedCell(play.at, +1);
    }
    if (tgt != null) setAt(tgt, { behavior: { behavior: "smooth", delta: Math.abs(play.at - tgt) || 1 } });
  },
  wordPrev: () => jumpToUnresolvedWord(-1),
  wordNext: () => jumpToUnresolvedWord(1),
};

function attachHoldRepeat(btn, fn) {
  if (!btn || typeof fn !== "function") return;
  let repeatT = null;
  let repeatI = null;
  let lastPointerTs = 0;

  const stop = () => {
    if (repeatT) clearTimeout(repeatT);
    if (repeatI) clearInterval(repeatI);
    repeatT = null;
    repeatI = null;
  };

  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    lastPointerTs = performance.now();
    stop();
    fn();
    repeatT = setTimeout(() => {
      repeatI = setInterval(fn, 120);
    }, 350);
  });

  ["pointerup", "pointercancel", "pointerleave", "blur"].forEach((ev) => {
    btn.addEventListener(ev, () => stop());
  });

  btn.addEventListener("click", (e) => {
    if (performance.now() - lastPointerTs < 150) return;
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
  prevFtue();
});
els.ftueNext?.addEventListener("click", (e) => {
  e.preventDefault();
  nextFtue();
});
els.ftueSkip?.addEventListener("click", (e) => {
  e.preventDefault();
  closeFtue();
});
els.ftueDots?.forEach?.((dot, idx) =>
  dot.addEventListener("click", (e) => {
    e.preventDefault();
    ftueStep = idx;
    renderFtueStep();
  })
);
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

// Builder
els.pSel.addEventListener("change", () => {
  pIdx = +els.pSel.value || 0;
  loadPuzzle(pIdx);
});

els.pTitle.addEventListener("input", () => {
  puzzles[pIdx].title = els.pTitle.value;
  if (els.pSel.options[pIdx]) {
    const tag = puzzles[pIdx].type === MODE.CHAIN ? " — Word Chain" : "";
    els.pSel.options[pIdx].text = (els.pTitle.value || "Untitled") + tag;
  }
  setDirty(true);
  renderPreview();
});
els.pDate?.addEventListener("input", () => {
  const { dateKey } = normalizePuzzleDate(els.pDate.value);
  puzzles[pIdx].dateKey = dateKey;
  setDirty(true);
});

els.pNew.addEventListener("click", () => {
  puzzles.push(
    normPuzzle({
      title: "Untitled",
      type: MODE.OVERLAP,
      palette: FIRST_PALETTE_ID,
      words: [{ clue: "Clue", answer: "WORD", start: 1 }],
    })
  );
  store.save();
  loadPuzzle(puzzles.length - 1);
  setTab(VIEW.BUILD);
});

els.pDel.addEventListener("click", () => {
  if (puzzles.length <= 1) return;
  if (!confirm("Delete this puzzle?")) return;
  puzzles.splice(pIdx, 1);
  store.save();
  loadPuzzle(Math.max(0, pIdx - 1));
});

els.wAdd.addEventListener("click", () => {
  const p = puzzles[pIdx];
  p.words = p.words || [];

  const maxEnd = p.words.reduce((m, w) => {
    const s = Math.max(1, Math.floor(+w.start || 1));
    const len = cleanA(w.answer).length || 4;
    return Math.max(m, s + len - 1);
  }, 0);

  const nextStart = Math.max(1, maxEnd + 1);
  const chainMode = isChainPuzzle(p);

  p.words.push({
    clue: "Clue",
    answer: "WORD",
    start: nextStart,
    color: "--c-red",
    ...(chainMode ? { diff: "easy" } : {}),
  });

  saveAndReRender();
});

els.rows.addEventListener("click", (e) => {
  const row = e.target.closest(".row");
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!row || !act) return;

  const i = +row.dataset.i;
  const ws = puzzles[pIdx].words || [];

  if (act === "rm") {
    ws.splice(i, 1);
    saveAndReRender();
  }
});

els.rows.addEventListener("input", (e) => {
  const row = e.target.closest(".row");
  const f = e.target.dataset.f;
  if (!row || !f) return;

  const i = +row.dataset.i;
  const w = (puzzles[pIdx].words || [])[i];
  if (!w) return;

  if (f === "start") w.start = +e.target.value || 1;
  else w[f] = e.target.value;

  setDirty(true);
  renderPreview();
});

els.rows.addEventListener("change", (e) => {
  const row = e.target.closest(".row");
  const f = e.target.dataset.f;
  if (!row || !f) return;

  const i = +row.dataset.i;
  const w = (puzzles[pIdx].words || [])[i];
  if (!w) return;

  w[f] = e.target.value;

  setDirty(true);
  renderRows();
  renderPreview();
});

// ---- Start ----
initOnScreenKeyboard();
initSlider();
loadPuzzle(0);
setTab(currentView);
queueInitialHintIntro();
maybeShowFtue();

requestAnimationFrame(() => {
  setAt(0);
  focusForTyping();
});
