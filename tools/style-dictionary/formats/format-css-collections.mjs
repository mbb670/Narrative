// tools/style-dictionary/formats/format-css-collections.mjs
// Folder-based collections -> CSS:
//  global     -> :root (base variables)
//  breakpoint -> :root (mobile) + @media(min-width: …) for tablet/desktop
//  mode       -> [data-theme="light" | "dark"] blocks
//  styles     -> utility classes (e.g. elevation-*)
//  other      -> "Other ..." sections (defaults/overrides)
//
// NOTE: This file targets Style Dictionary v3.x API: { name, format }.

const BP_MIN = { mobile: 0, tablet: 640, desktop: 1024 };

const INDENT = (n = 2) => " ".repeat(n);
const by = (prop) => (a, b) => (a[prop] > b[prop] ? 1 : a[prop] < b[prop] ? -1 : 0);

function getCollection(token) {
  const p = token.filePath.replace(/\\/g, "/");
  // tokens/raw/<collection>/...
  const m = p.match(/\/tokens\/raw\/([^/]+)/);
  return m ? m[1] : "other";
}

function getSubgroup(token, collection) {
  // e.g. tokens/raw/breakpoint/tablet/… → "tablet"
  const p = token.filePath.replace(/\\/g, "/");
  const rx = new RegExp(`/tokens/raw/${collection}/([^/]+)/`);
  const m = p.match(rx);
  return m ? m[1] : undefined;
}

function cssVarLine(t) {
  return `--${t.name}: ${t.value};`;
}

function block(title, body) {
  if (!body.trim()) return "";
  return `/* ${title} */\n${body}\n`;
}

function rootBlock(lines) {
  if (!lines.length) return "";
  return `:root {\n${INDENT()}${lines.join(`\n${INDENT()}`)}\n}\n`;
}

function modeBlock(mode, lines) {
  if (!lines.length) return "";
  return `[data-theme="${mode}"] {\n${INDENT()}${lines.join(`\n${INDENT()}`)}\n}\n`;
}

function mediaRoot(minWidthPx, lines) {
  if (!lines.length) return "";
  return `@media (min-width: ${minWidthPx}px) {\n  :root {\n    ${lines.join(`\n    `)}\n  }\n}\n`;
}

function styleClassRule(token) {
  // Expect names like "elevation-elevation-action" etc.
  // If value is already a declaration "box-shadow: …", keep it.
  // Otherwise assume it's a box-shadow literal.
  const v = String(token.value).trim();
  const decl = v.includes(":") ? v : `box-shadow: ${v};`;
  return `.${token.name} {\n  ${decl}\n}`;
}

export default {
  name: "css/collections",
  format: ({ dictionary }) => {
    // Partition tokens by top-level collection folder
    const groups = {
      global: [],
      breakpoint: [],
      mode: [],
      styles: [],
      other: []
    };

    for (const t of dictionary.allTokens) {
      const col = getCollection(t);
      if (groups[col]) groups[col].push(t);
      else groups.other.push(t);
    }

    // ===== GLOBAL =====
    const globalVars = groups.global
      .slice()
      .sort(by("name"))
      .map(cssVarLine);

    let out = "";
    out += block("Base: Global + inline + defaults", rootBlock(globalVars));

    // ===== BREAKPOINTS =====
    // Split by mobile/tablet/desktop
    const bpBySub = { mobile: [], tablet: [], desktop: [] };
    for (const t of groups.breakpoint) {
      const sub = getSubgroup(t, "breakpoint") || "mobile";
      if (!bpBySub[sub]) bpBySub[sub] = [];
      bpBySub[sub].push(t);
    }

    // MOBILE (default root)
    const mobileLines = (bpBySub.mobile || [])
      .slice()
      .sort(by("name"))
      .map(cssVarLine);
    if (mobileLines.length) {
      out += block("Breakpoint default — breakpoint/mobile", rootBlock(mobileLines));
    }

    // TABLET / DESKTOP (@media)
    const tabletLines = (bpBySub.tablet || [])
      .slice()
      .sort(by("name"))
      .map(cssVarLine);
    if (tabletLines.length) {
      out += block(
        "Breakpoint min-width 640px — breakpoint/tablet",
        mediaRoot(BP_MIN.tablet, tabletLines)
      );
    }

    const desktopLines = (bpBySub.desktop || [])
      .slice()
      .sort(by("name"))
      .map(cssVarLine);
    if (desktopLines.length) {
      out += block(
        "Breakpoint min-width 1024px — breakpoint/desktop",
        mediaRoot(BP_MIN.desktop, desktopLines)
      );
    }

    // ===== MODE (light/dark/others) =====
    const modeBuckets = {};
    for (const t of groups.mode) {
      const sub = getSubgroup(t, "mode") || "default";
      (modeBuckets[sub] ||= []).push(t);
    }
    for (const [mode, toks] of Object.entries(modeBuckets)) {
      const lines = toks.slice().sort(by("name")).map(cssVarLine);
      const title =
        mode === "light"
          ? "Mode light — mode/light"
          : mode === "dark"
          ? "Mode dark — mode/dark"
          : `Mode ${mode} — mode/${mode}`;
      out += block(title, modeBlock(mode, lines));
    }

    // ===== STYLES (utility classes) =====
    const styleRules = groups.styles
      .slice()
      .sort(by("name"))
      .map(styleClassRule);
    if (styleRules.length) {
      out += block("Styles (utility classes)", "");
      out += block("Styles: generated from /styles", styleRules.join("\n\n") + "\n");
    }

    // ===== OTHER =====
    // Dump anything unclassified into labeled sections grouped by second folder
    if (groups.other.length) {
      const otherBuckets = {};
      for (const t of groups.other) {
        // tokens/raw/<other>/<sub>/...
        const other = getCollection(t); // will be "other"
        const sub = getSubgroup(t, other) || "default";
        (otherBuckets[sub] ||= []).push(t);
      }
      for (const [sub, toks] of Object.entries(otherBuckets)) {
        const lines = toks.slice().sort(by("name")).map(cssVarLine);
        const title =
          sub === "default"
            ? "Other — default"
            : `Other ${sub} — set ${sub}`;
        out += block(title, rootBlock(lines));
      }
    }

    return out.trim() + "\n";
  }
};
