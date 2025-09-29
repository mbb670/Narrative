// tools/style-dictionary/formats/format-css-collections.mjs
// Folder -> CSS collections:
//  global     -> :root
//  breakpoint -> :root (mobile) + @media(min-width:...) tablet/desktop
//  mode       -> [data-theme="..."]
//  styles     -> utility classes (object tokens => multiple declarations)
//  other      -> attribute blocks for colorTheme/fontTheme, otherwise :root sections

const RESERVED = new Set(["global", "breakpoint", "mode", "styles"]);
const BP_MIN = { mobile: 0, tablet: 640, desktop: 1024 };

const LEAF_CANON = new Map([
  ["font-family", "fontfamily"],
  ["font-size", "fontsize"],
  ["font-weight", "fontweight"],
  ["letter-spacing", "letterspacing"],
  ["line-height", "lineheight"],
]);

const IND = (n = 2) => " ".repeat(n);
const by = (prop) => (a, b) => (a[prop] > b[prop] ? 1 : a[prop] < b[prop] ? -1 : 0);

// ---------- helpers ----------
const norm = (s) =>
  String(s)
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

function canonPath(path) {
  const p = path.slice();
  const i = p.length - 1;
  const leaf = p[i];
  if (LEAF_CANON.has(leaf)) p[i] = LEAF_CANON.get(leaf);
  return p.map(norm);
}

function varNameFromToken(t) {
  return canonPath(t.path).join("-");
}

function classNameFromToken(t) {
  // drop the leading "styles" segment
  const p = canonPath(t.path.slice(1));
  return p.join("-");
}

function cssVarLine(t) {
  return `--${varNameFromToken(t)}: ${t.value};`;
}

function block(title, body) {
  if (!body.trim()) return "";
  return `/* ${title} */\n${body}\n`;
}

function rootBlock(lines) {
  if (!lines.length) return "";
  return `:root {\n${IND()}${lines.join(`\n${IND()}`)}\n}\n`;
}

function modeBlock(mode, lines) {
  if (!lines.length) return "";
  return `[data-theme="${mode}"] {\n${IND()}${lines.join(`\n${IND()}`)}\n}\n`;
}

function mediaRoot(minWidthPx, lines) {
  if (!lines.length) return "";
  return `@media (min-width: ${minWidthPx}px) {\n  :root {\n    ${lines.join(
    `\n    `
  )}\n  }\n}\n`;
}

function styleRuleFromToken(t) {
  const cls = classNameFromToken(t);
  const v = t.value;

  // Object → multiple declarations (typography, etc.)
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const decls = Object.entries(v).map(([k, val]) => `${k}: ${val};`);
    return `.${cls} {\n  ${decls.join("\n  ")}\n}`;
  }

  // String → default to box-shadow if it looks like an elevation value,
  // otherwise treat as a raw declaration if it already includes a colon.
  const str = String(v).trim();
  const decl = str.includes(":") ? str : `box-shadow: ${str};`;
  return `.${cls} {\n  ${decl}\n}`;
}

function topFolder(t) {
  const p = t.filePath.replace(/\\/g, "/");
  const m = p.match(/\/tokens\/raw\/([^/]+)/);
  return m ? m[1] : "other";
}

function secondFolder(t) {
  const p = t.filePath.replace(/\\/g, "/");
  const m = p.match(/\/tokens\/raw\/[^/]+\/([^/]+)/);
  return m ? m[1] : undefined;
}

function thirdFolder(t) {
  const p = t.filePath.replace(/\\/g, "/");
  const m = p.match(/\/tokens\/raw\/[^/]+\/[^/]+\/([^/]+)/);
  return m ? m[1] : undefined;
}

// ---------- main formatter ----------
export default {
  name: "css/collections",
  format: ({ dictionary /*, file*/ }) => {
    const groups = { global: [], breakpoint: [], mode: [], styles: [], other: [] };

    for (const t of dictionary.allTokens) {
      const folder = topFolder(t);
      if (RESERVED.has(folder)) groups[folder].push(t);
      else groups.other.push(t);
    }

    let out = "";

    // ===== GLOBAL =====
    const globalLines = groups.global.slice().sort(by("name")).map(cssVarLine);
    out += block("Base: Global + inline + defaults", rootBlock(globalLines));

    // ===== BREAKPOINTS =====
    const bp = { mobile: [], tablet: [], desktop: [] };
    for (const t of groups.breakpoint) {
      const which = secondFolder(t) || "mobile";
      (bp[which] ||= []).push(t);
    }
    const mobile = (bp.mobile || []).slice().sort(by("name")).map(cssVarLine);
    if (mobile.length) {
      out += block("Breakpoint default — breakpoint/mobile", rootBlock(mobile));
    }
    const tablet = (bp.tablet || []).slice().sort(by("name")).map(cssVarLine);
    if (tablet.length) {
      out += block(
        "Breakpoint min-width 640px — breakpoint/tablet",
        mediaRoot(BP_MIN.tablet, tablet)
      );
    }
    const desktop = (bp.desktop || []).slice().sort(by("name")).map(cssVarLine);
    if (desktop.length) {
      out += block(
        "Breakpoint min-width 1024px — breakpoint/desktop",
        mediaRoot(BP_MIN.desktop, desktop)
      );
    }

    // ===== MODE =====
    const modes = {};
    for (const t of groups.mode) {
      const which = secondFolder(t) || "default";
      (modes[which] ||= []).push(t);
    }
    for (const [mode, toks] of Object.entries(modes)) {
      const lines = toks.slice().sort(by("name")).map(cssVarLine);
      const title =
        mode === "light"
          ? "Mode light — mode/light"
          : mode === "dark"
          ? "Mode dark — mode/dark"
          : `Mode ${mode} — mode/${mode}`;
      out += block(title, modeBlock(mode, lines));
    }

    // ===== STYLES =====
    const styleRules = groups.styles.slice().sort(by("name")).map(styleRuleFromToken);
    if (styleRules.length) {
      out += block("Styles: styles/styles", styleRules.join("\n\n") + "\n");
    }

    // ===== OTHER =====
    // Group by top-level "other" name (e.g., colorTheme, fontTheme, etc.)
    if (groups.other.length) {
      const otherBuckets = {};
      for (const t of groups.other) {
        const first = topFolder(t); // will be a non-reserved folder
        (otherBuckets[first] ||= []).push(t);
      }

      for (const [folderName, toks] of Object.entries(otherBuckets)) {
        // Further split by set name under that folder, e.g. default, slate, opinion...
        const sets = {};
        for (const t of toks) {
          const setName = secondFolder(t) || "default";
          (sets[setName] ||= []).push(t);
        }

        for (const [setName, setTokens] of Object.entries(sets)) {
          const lines = setTokens.slice().sort(by("name")).map(cssVarLine);

          // Special handling for colorTheme/fontTheme attribute blocks
          const attrKey =
            folderName === "colorTheme"
              ? `data-colorTheme`
              : folderName === "fontTheme"
              ? `data-fontTheme`
              : null;

          const titlePrefix = `Other ${folderName}`;
          if (setName === "default") {
            out += block(`${titlePrefix} — default`, rootBlock(lines));
          } else if (attrKey) {
            const body = `[${attrKey}="${setName}"] {\n${IND()}${lines.join(
              `\n${IND()}`
            )}\n}\n`;
            out += block(`${titlePrefix} — set ${setName}`, body);
          } else {
            out += block(`${titlePrefix} — set ${setName}`, rootBlock(lines));
          }
        }
      }
    }

    return out.trim() + "\n";
  },
};
