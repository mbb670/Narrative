/*
 * File Overview
 * Purpose: Palette lookup and CSS variable application.
 * Controls: Theme colors applied to the document.
 * How: Selects palette values and sets CSS variables on root elements.
 * Key interactions: Used by app.js and settings or theme controls.
 */
// Palette discovery and helpers for puzzle rendering.

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

const PALETTES = readCssPalettes();
const PALETTE_ID_SET = new Set(PALETTES.map((p) => p.id));
const FIRST_PALETTE_ID = PALETTES[0]?.id || FALLBACK_PALETTE_ID;

// Ensure palette id is valid, falling back to the first available palette.
export const normalizePaletteId = (id) => {
  const v = String(id || "");
  return PALETTE_ID_SET.has(v) ? v : FIRST_PALETTE_ID;
};

const getPaletteById = (id) => PALETTES.find((p) => p.id === id) || PALETTES[0];

// Pick a palette color based on the word index (wraps if needed).
export const paletteColorForWord = (puzzle, wordIdx) => {
  const pal = getPaletteById(normalizePaletteId(puzzle?.palette));
  const colors = pal?.colors?.length ? pal.colors : FALLBACK_PALETTE_COLORS;
  return colors[wordIdx % colors.length] || FALLBACK_PALETTE_COLORS[0];
};

// Apply palette selection to the root element for CSS to consume.
export const applyPaletteToDom = (paletteId) => {
  document.documentElement.setAttribute("data-puzzle-palette", normalizePaletteId(paletteId));
};
