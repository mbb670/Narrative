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

const HEIGHTS = [
  ["Full", "full"],
  ["Mid", "mid"],
  ["Inner", "inner"],
];

const MODE = { OVERLAP: "overlap", CHAIN: "chain" };
const VIEW = { PLAY: "play", CHAIN: "chain", BUILD: "build" };

// ---- Remember last tab/view ----
const LAST_VIEW_KEY = `${KEY}__last_view`;

const VALID_VIEWS = new Set(Object.values(VIEW));

function loadLastView() {
  try {
    const v = localStorage.getItem(LAST_VIEW_KEY);
    return VALID_VIEWS.has(v) ? v : VIEW.PLAY;
  } catch {
    return VIEW.PLAY;
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
  success: $("#success"),
  sClose: $("#sClose"),
  sAgain: $("#sAgain"),
  sNext: $("#sNext"),
  slider: $(".game-slider"),
  nextPuzzleBtn: $("#nextPuzzleBtn"),
  puzzleActions: document.querySelector(".puzzle-actions"),
  navWordPrev: $("#navWordPrev"),
  navCellPrev: $("#navCellPrev"),
  navCellNext: $("#navCellNext"),
  navWordNext: $("#navWordNext"),
  pSel: $("#pSel"),
  pNew: $("#pNew"),
  pDel: $("#pDel"),
  pSave: $("#pSave"),
  pTitle: $("#pTitle"),
  rows: $("#rows"),
  wAdd: $("#wAdd"),
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
  };
  const el = map[type];
  if (!el) return;
  if (message) el.textContent = message;
  const dur = duration ?? toastDuration(type);
  if (toastTimers[type]) clearTimeout(toastTimers[type]);
  el.classList.remove("is-showing");
  void el.offsetWidth; // restart transition
  el.classList.add("is-showing");
  toastTimers[type] = setTimeout(() => el.classList.remove("is-showing"), dur);
}

function clearToasts() {
  ["success", "warning", "error"].forEach((type) => {
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
    localStorage.setItem(KEY, JSON.stringify(puzzles));
  },
};


// ---- Utils ----
const uid = () =>
  `p-${Math.random().toString(16).slice(2, 8)}-${Date.now().toString(16)}`;
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

const normWord = (w, pType, opts = {}) => {
  const out = {
    clue: String(w?.clue || ""),
    answer: String(w?.answer || ""),
    start: +w?.start || 1,
    height: String(w?.height || "full"),
  };

  return out;
};


const normPuzzle = (p) => {
  const type = String(p?.type || MODE.OVERLAP);
  const wordsRaw = Array.isArray(p?.words) ? p.words : [];
  const fallback = { clue: "Clue", answer: "WORD", start: 1, height: "full" };
  const timed = type === MODE.CHAIN ? false : true;
  const words = (wordsRaw.length ? wordsRaw : [fallback]).map((w) => normWord(w, type, { timed }));


  const out = {
    id: String(p?.id || uid()),
    title: String(p?.title || "Untitled"),
    type,
    palette: normalizePaletteId(p?.palette),
    words,
  };

  if (type === MODE.CHAIN) {
    out.lockCorrectWords = true;
  }
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
let hasHardwareKeyboard = DEFAULTS_TO_HARDWARE;
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

  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "On-screen keyboard");
  root.innerHTML = "";

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
        btn.textContent = "⌫";
      } else if (isEnter) {
        btn.dataset.action = "enter";
        btn.setAttribute("aria-label", "Next cell");
        btn.textContent = "↦";
      } else {
        btn.dataset.key = key;
        btn.textContent = key;
        btn.setAttribute("aria-label", key);
      }
      row.appendChild(btn);
    });

    root.appendChild(row);
  });

  const handlePress = (e) => {
    const btn = e.target.closest("[data-key], [data-action]");
    if (!btn) return;
    e.preventDefault();
    markInteracted();

    if (btn.dataset.key) write(btn.dataset.key);
    else if (btn.dataset.action === "backspace") back();
    else if (btn.dataset.action === "enter") move(1);

    focusForTyping();
  };

  let pressedBtn = null;
  const clearPressed = () => {
    if (pressedBtn) pressedBtn.classList.remove("is-pressed");
    pressedBtn = null;
  };

  root.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest("[data-key], [data-action]");
    if (!btn) return;
    pressedBtn = btn;
    btn.classList.add("is-pressed");
    handlePress(e);
  });

  const endEvents = ["pointerup", "pointercancel", "pointerleave"];
  endEvents.forEach((ev) => {
    root.addEventListener(ev, (e) => {
      if (!pressedBtn) return;
      if (e.type === "pointerleave" && root.contains(e.target)) return;
      clearPressed();
    });
  });
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
      const [t, b] = insets(w.height || "full");

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
        h: String(w.height || "full"),
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

function renderGrid(target, model, clickable) {
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
  rangeFocusEl.dataset.e = "";
  rangeFocusEl.classList.remove("is-active");
}

function showRangeFocusForEntry(entry) {
  if (!entry) return;
  const el = ensureRangeFocusEl();
  const rangeEl = els.grid?.querySelector(`.range[data-e="${entry.eIdx}"]`);
  const color = entry.color || rangeEl?.style.getPropertyValue("--color") || "var(--c-red)";
  el.hidden = false;
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

    if (isWordCorrect(entry)) {
      play.lockedEntries.add(entry.eIdx);
      rebuildLockedCells();
    }

    updateLockedWordUI();
    updatePlayUI();
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
    timer: hud.querySelector(".chainTimer"),
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

  const wrap = document.createElement("div");
  wrap.className = "success";
  wrap.id = "chainResults";
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.setAttribute("aria-label", "Results");

  wrap.innerHTML = `
    <div class="card">
      <h2 class="text-headline-semibold-sm" id="chainResultsTitle">Time!</h2>
      <p class="text-system-regular-md" id="chainScoreLine">Your results</p>
      <div class="note" id="chainBreakdown"></div>
      <div class="actions">
        <button class="btn" id="cClose" type="button">Close</button>
        <button class="btn" id="cAgain" type="button">Play again</button>
        <button class="btn primary" id="cNext" type="button">Next puzzle</button>
        <button class="btn" id="cShare" type="button">Share</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  const cClose = wrap.querySelector("#cClose");
  const cAgain = wrap.querySelector("#cAgain");
  const cNext = wrap.querySelector("#cNext");
  const cShare = wrap.querySelector("#cShare");

  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeChainResults();
  });
  cClose.addEventListener("click", closeChainResults);
  cAgain.addEventListener("click", () => {
    closeChainResults();
    resetPlay();
    chainSetUIState(CHAIN_UI.IDLE);
    focusForTyping();
  });
  cNext.addEventListener("click", () => {
    closeChainResults();
    chainSetUIState(CHAIN_UI.IDLE);
    loadByViewOffset(1);
  });
  cShare.addEventListener("click", () => {
    shareResult({ mode: MODE.CHAIN });
  });

  chainResults = {
    wrap,
    title: wrap.querySelector("#chainResultsTitle"),
    scoreLine: wrap.querySelector("#chainScoreLine"),
    breakdown: wrap.querySelector("#chainBreakdown"),
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
  r.wrap.classList.add("is-open");
  const tSec = Math.max(0, Math.floor(chain.lastFinishElapsedSec || 0));
  r.title.textContent = "Solved!";
  r.scoreLine.textContent = `Time: ${fmtTime(tSec)}`;
  const lines = [];
  if (chain.unsolvedCount > 0) lines.push(`Unsolved words: ${chain.unsolvedCount}`);
  if (chain.hintsUsed > 0) lines.push(`Hints used: ${chain.hintsUsed}`);
  r.breakdown.innerHTML = lines.join("<br>");
  if (!lines.length) r.breakdown.textContent = "";
  r.cClose.focus();
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

  for (const e of play.entries) {
    if (play.lockedEntries.has(e.eIdx)) continue;
    if (isWordCorrect(e)) {
      play.lockedEntries.add(e.eIdx);
      changed = true;
    }
  }

  if (changed) {
    rebuildLockedCells();
    updateLockedWordUI();
    if (selectedEntry != null && play.lockedEntries.has(selectedEntry)) clearSelection();
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
    const fullySolved = wordsHere.length > 0 && wordsHere.every((w) => isWordCorrect(w));
    const locked = play.mode === MODE.CHAIN && isCellLocked(i) && !fullySolved;
    c.classList.toggle("cell-solved", fullySolved);
    c.classList.toggle("cell-locked", locked);
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
  play.usr[play.at] = ch;

  // auto-advance (skip locked)
  let nextAt = play.at < play.n - 1 ? play.at + 1 : play.at;
  if (play.mode === MODE.CHAIN) {
    const nxt = findNextEditable(nextAt, +1);
    if (nxt != null) nextAt = nxt;
  }
  play.at = nextAt;

  if (play.mode === MODE.CHAIN) {
    chainApplyLocksIfEnabled();
    updatePlayUI();
    maybeToastChainFilledWrong();
    requestKeepActiveCellInView({ behavior: "smooth", delta: Math.abs(nextAt - prevAt) || 1 });
    requestChainClues();
    chainMaybeFinishIfSolved();
    return;
  }

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
    if (prev == null) return;
    play.at = prev;
  }

  const prevAt = play.at;
  if (play.usr[play.at]) {
    play.usr[play.at] = "";
  } else {
    let prevAt = play.at > 0 ? play.at - 1 : 0;
    if (play.mode === MODE.CHAIN) {
      const prev = findNextEditable(prevAt, -1);
      if (prev == null) prevAt = play.at;
      else prevAt = prev;
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
  els.success.classList.remove("is-open");
}

function shareResult({ mode }) {
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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

  let msg = `Overlap | ${dateStr}`;

  if (mode === MODE.CHAIN) {
    const elapsed = Math.max(0, +chain.lastFinishElapsedSec || 0);
    const timeText = fmtTime(elapsed);
    if (timeText) msg += `\nI solved today's puzzle in ${timeText}`;
    const hints = Math.max(0, chain.hintsUsed || 0);
    if (chain.unsolvedCount > 0 && chain.lastFinishReason !== "solved") {
      msg += ` with ${chain.unsolvedCount} unsolved words`;
      msg += ` and ${hints} hints.`;
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
  resetToastGuards();
  clearToasts();
  clearSelectAll();
  hideRangeFocus();

  play.lockedEntries.clear();
  play.lockedCells = Array.from({ length: play.n }, () => false);
  clearSelection();

  renderGrid(els.grid, m, true);
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
  els.tabBuild?.classList.toggle("is-active", isBuild);

  els.tabPlay?.setAttribute("aria-selected", isPlay ? "true" : "false");
  els.tabChain?.setAttribute("aria-selected", isChain ? "true" : "false");
  els.tabBuild?.setAttribute("aria-selected", isBuild ? "true" : "false");

  els.panelPlay?.classList.toggle("is-active", !isBuild);
  els.panelBuild?.classList.toggle("is-active", isBuild);

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
  if (els.success.classList.contains("is-open")) return;
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
      puzzles[pIdx].lockCorrectWords = true;
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

      const heightOpts = HEIGHTS.map(([lab, val]) => `<option value="${val}" ${w.height === val ? "selected" : ""}>${lab}</option>`).join("");
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

            <div>
              <label class="lab">Height</label>
              <select class="ms" data-f="height">${heightOpts}</select>
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
  renderGrid(els.bGrid, m, false);
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
  const t = JSON.stringify(puzzles, null, 2);
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
els.tabBuild?.addEventListener("click", () => setTab(VIEW.BUILD));

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
els.navCellPrev?.addEventListener("click", () => {
  let tgt = null;
  if (play.done || play.mode === MODE.OVERLAP) {
    tgt = clamp(play.at - 1, 0, play.n - 1);
  } else {
    tgt = findUnresolvedCell(play.at, -1);
  }
  if (tgt != null) setAt(tgt, { behavior: { behavior: "smooth", delta: Math.abs(play.at - tgt) || 1 } });
});
els.navCellNext?.addEventListener("click", () => {
  let tgt = null;
  if (play.done || play.mode === MODE.OVERLAP) {
    tgt = clamp(play.at + 1, 0, play.n - 1);
  } else {
    tgt = findUnresolvedCell(play.at, +1);
  }
  if (tgt != null) setAt(tgt, { behavior: { behavior: "smooth", delta: Math.abs(play.at - tgt) || 1 } });
});
els.navWordPrev?.addEventListener("click", () => jumpToUnresolvedWord(-1));
els.navWordNext?.addEventListener("click", () => jumpToUnresolvedWord(1));

// Success modal (Overlap)
els.success.addEventListener("click", (e) => {
  if (e.target === els.success) {
    markInteracted();
    closeSuccess();
    focusForTyping();
  }
});
els.sClose.addEventListener("click", () => {
  markInteracted();
  closeSuccess();
  focusForTyping();
});
els.sAgain.addEventListener("click", () => {
  markInteracted();
  resetPlay();
  focusForTyping();
});
els.sNext.addEventListener("click", () => {
  markInteracted();
  loadByViewOffset(1);
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

els.pNew.addEventListener("click", () => {
  puzzles.push(
    normPuzzle({
      id: uid(),
      title: "Untitled",
      type: MODE.OVERLAP,
      palette: FIRST_PALETTE_ID,
      words: [{ clue: "Clue", answer: "WORD", start: 1, height: "full" }],
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
    height: "full",
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

requestAnimationFrame(() => {
  setAt(0);
  focusForTyping();
});
