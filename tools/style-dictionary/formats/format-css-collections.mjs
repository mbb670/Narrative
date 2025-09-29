// tools/style-dictionary/formats/format-css-collections.mjs
// Strict folder-based collections: global | breakpoint | mode | styles | other(<folder>)

const JOINER = "-";
const RESERVED_TYPES = new Set(["global", "breakpoint", "mode", "styles"]);
const DEFAULT_BP_ORDER = ["mobile", "tablet", "desktop"];
const DEFAULT_BP_MIN = { mobile: 0, tablet: 640, desktop: 1024 };
const INCLUDE_OTHER_DEFAULTS_IN_BASE = true;

// Map dashed CSS-y leaf keys to the undashed style your expected CSS uses.
const CANON_LEAF = [
  ["font-family", "fontfamily"],
  ["font-size", "fontsize"],
  ["line-height", "lineheight"],
  ["font-weight", "fontweight"],
  ["letter-spacing", "letterspacing"],
  ["text-transform", "texttransform"],
  ["font-stretch", "fontstretch"],
];
const canonLeaf = (seg) => {
  for (const [from, to] of CANON_LEAF) {
    if (seg === from) return to;
    // handle suffixes like font-size-lg → fontsize-lg
    if (seg.startsWith(from + "-")) return seg.replace(from + "-", to + "-");
  }
  return seg;
};

const isPriv = (s) => /^[_$]/.test(s);
const stripExt = (s) => s.replace(/\.(json|ya?ml|ts|js)$/i, "");

function lastIndexOfTokens(segs) {
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i].toLowerCase() === "tokens") return i;
  }
  return -1;
}

/** === Classification: strictly by folder name === */
function classify(token) {
  const fp = (token.filePath || "").replace(/\\/g, "/");
  const segs = fp.split("/");
  let i = lastIndexOfTokens(segs);
  let idx = i >= 0 ? i + 1 : 0;
  if (segs[idx] && segs[idx].toLowerCase() === "raw") idx += 1;

  const folderRaw = segs[idx] || "";
  const folder = folderRaw.toLowerCase();
  const nextRaw = segs[idx + 1] || ""; // may be file or subfolder
  const next = stripExt(nextRaw);

  if (RESERVED_TYPES.has(folder)) {
    // global has no setName; others do
    return {
      type: folder,                             // "global" | "breakpoint" | "mode" | "styles"
      collectionKey: folder,                    // label/selector base
      collectionKeyLabel: folderRaw,            // preserve original case for comments/attrs
      setName: folder === "global" ? "default" : (next || "default"),
    };
  }

  // Anything else is "other" with collection=<folderRaw> and set=<next>
  return {
    type: "other",
    collectionKey: folder,                      // lowercase for internal use
    collectionKeyLabel: folderRaw,              // keep original like "colorTheme", "fontTheme"
    setName: next || "default",
  };
}

/** Build CSS custom property name from token.path */
function varNameFromToken(t) {
  // normalize only "leaf" keys that are the property names like font-family → fontfamily
  const parts = t.path.filter((p) => !isPriv(p)).map((p) => String(p));
  if (parts.length) {
    const leaf = parts[parts.length - 1];
    parts[parts.length - 1] = canonLeaf(leaf);
  }
  return "--" + parts.map((p) =>
    p.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[\s_]+/g, "-").toLowerCase()
  ).join(JOINER);
}

const visibleVarTokens = (all) =>
  all.filter((t) => !t.path.some(isPriv) && typeof t.value !== "object");

const styleObjectTokens = (all) =>
  all.filter((t) => !t.path.some(isPriv) && (typeof t.value === "object" || Array.isArray(t.value)));

/** Reference detection on *original* string "{a.b.c}" */
function refFromString(str) {
  const m = /^\{([^}]+)\}$/.exec(String(str).trim());
  if (!m) return null;
  const refVar =
    "--" +
    m[1]
      .split(".")
      .map((p, i, arr) => {
        // apply same leaf canonicalization to the last segment
        if (i === arr.length - 1) p = canonLeaf(p);
        return p.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[\s_]+/g, "-").toLowerCase();
      })
      .join(JOINER);
  return { refVar };
}

function tokenDecl(t) {
  const name = varNameFromToken(t);
  const orig = t.original && t.original.value != null ? t.original.value : t.value;
  if (typeof orig === "string") {
    const r = refFromString(orig);
    if (r) return `${name}: var(${r.refVar});`;
  }
  return `${name}: ${t.value};`;
}

function emitBlock(selector, lines, comment) {
  if (!lines.length) return "";
  const head = comment ? `/* ${comment} */\n\n` : "";
  return head + `${selector} {\n` + lines.map((l) => `  ${l}`).join("\n") + `\n}\n\n`;
}

function emitAtMedia(min, inner, comment) {
  if (!inner) return "";
  const head = comment ? `/* ${comment} */\n\n` : "";
  const indented = inner.split("\n").map((l) => (l ? "  " + l : l)).join("\n");
  return `${head}@media (min-width: ${min}px) {\n${indented}}\n\n`;
}

/** Sort tokens for stable output */
const sortByVar = (a, b) => (varNameFromToken(a) < varNameFromToken(b) ? -1 : 1);

/** Pull a numeric "minWidth" from tokens in a breakpoint set, else defaults */
function minWidthForSet(setName, tokensInSet) {
  // look for *_meta/minWidth or minWidth token (original or resolved)
  const t = tokensInSet.find((x) =>
    /(^|\/)_?meta\/minwidth$/i.test(x.path.slice(-2).join("/")) ||
    /^minwidth$/i.test(x.path.slice(-1)[0])
  );
  if (t) {
    const v = parseFloat(String(t.value));
    if (!Number.isNaN(v)) return v;
  }
  if (Object.prototype.hasOwnProperty.call(DEFAULT_BP_MIN, setName)) return DEFAULT_BP_MIN[setName];
  return 0;
}

/** === Styles helpers: keep refs by using original value === */
const lowerKeys = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.toLowerCase(), v]));

function looksLikeTypography(obj) {
  const o = lowerKeys(obj);
  return (
    o["fontsize"] != null || o["font-size"] != null ||
    o["fontfamily"] != null || o["font-family"] != null ||
    o["lineheight"] != null || o["line-height"] != null ||
    o["letterspacing"] != null || o["letter-spacing"] != null ||
    o["fontweight"] != null || o["font-weight"] != null ||
    o["texttransform"] != null || o["text-transform"] != null ||
    o["fontstretch"] != null || o["font-stretch"] != null
  );
}
function looksLikeShadowPiece(o) {
  const k = lowerKeys(o);
  return ("x" in k || "y" in k || "blur" in k || "spread" in k) && ("color" in k || "type" in k);
}
function valWithRefs(v) {
  if (typeof v !== "string") return v;
  const r = refFromString(v);
  return r ? `var(${r.refVar})` : v;
}
function boxShadowFromPieces(pieces) {
  return pieces
    .map((o) => {
      const x = valWithRefs(o.x ?? 0);
      const y = valWithRefs(o.y ?? 0);
      const blur = valWithRefs(o.blur ?? 0);
      const spread = valWithRefs(o.spread ?? 0);
      const color = valWithRefs(o.color ?? "currentColor");
      const inset = String(o.type || "").toLowerCase().includes("inner") || o.inset ? " inset" : "";
      return `${x} ${y} ${blur} ${spread} ${color}${inset}`.trim();
    })
    .join(", ");
}

/** class selector builder: keep 'styles' trimmed from the front */
function classSelectorFromPath(pathParts, forcedPrefix) {
  const parts = pathParts.slice();
  while (parts[0] && parts[0].toLowerCase() === "styles") parts.shift();
  const cls = parts.map((p) =>
    p.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[\s_]+/g, "-").toLowerCase()
  ).join(JOINER);
  return `.${forcedPrefix}${cls}`;
}

export default function formatter({ dictionary }) {
  const all = dictionary.allTokens;
  const varTokens = visibleVarTokens(all);
  const styleTokens = styleObjectTokens(all);

  // Group tokens
  const groups = {};
  for (const t of varTokens) {
    const info = classify(t);
    const key = `${info.type}::${info.collectionKeyLabel}::${info.setName}`;
    (groups[key] ||= { info, tokens: [] }).tokens.push(t);
  }

  const decls = (arr) => arr.slice().sort(sortByVar).map(tokenDecl);

  let css = "";

  // 1) Base: global + other/*/default (optional)
  const baseLines = [];
  for (const g of Object.values(groups)) {
    const { type, setName } = g.info;
    if (type === "global" || (INCLUDE_OTHER_DEFAULTS_IN_BASE && type === "other" && setName.toLowerCase() === "default")) {
      baseLines.push(...decls(g.tokens));
    }
  }
  css += emitBlock(":root", baseLines, "Base: Global + inline + defaults");

  // 2) Breakpoints (mobile default block first, then media queries)
  const bpGroups = Object.values(groups).filter((g) => g.info.type === "breakpoint");
  if (bpGroups.length) {
    const bySet = {};
    for (const g of bpGroups) (bySet[g.info.setName] ||= []).push(...g.tokens);
    // determine order using defaults; include any extra sets at the end sorted by minWidth
    const known = DEFAULT_BP_ORDER.filter((s) => bySet[s]);
    const unknown = Object.keys(bySet).filter((s) => !known.includes(s))
      .map((s) => ({ s, min: minWidthForSet(s, bySet[s]) }))
      .sort((a, b) => a.min - b.min)
      .map((x) => x.s);
    const order = [...known, ...unknown];

    for (const set of order) {
      const min = minWidthForSet(set, bySet[set]);
      const block = emitBlock(":root", decls(bySet[set]),
        min === 0 ? `Breakpoint default — breakpoint/${set}` : `Breakpoint min-width ${min}px — breakpoint/${set}`
      );
      css += min === 0 ? block : emitAtMedia(min, block);
    }
  }

  // 3) Other collections
  const others = Object.values(groups).filter((g) => g.info.type === "other");
  const collections = [...new Set(others.map((g) => g.info.collectionKeyLabel))];
  for (const colLabel of collections) {
    const inCol = others.filter((g) => g.info.collectionKeyLabel === colLabel);
    const defaults = inCol.filter((g) => g.info.setName.toLowerCase() === "default");
    const nonDefaults = inCol.filter((g) => g.info.setName.toLowerCase() !== "default");

    for (const g of defaults) {
      css += emitBlock(":root", decls(g.tokens), `Other ${colLabel} — default`);
    }
    for (const g of nonDefaults) {
      const attr = `data-${colLabel}`;
      css += emitBlock(`[${attr}="${g.info.setName}"]`, decls(g.tokens), `Other ${colLabel} — set ${g.info.setName}`);
    }
  }

  // 4) Modes
  const modeGroups = Object.values(groups).filter((g) => g.info.type === "mode");
  if (modeGroups.length) {
    const byMode = {};
    for (const g of modeGroups) (byMode[g.info.setName] ||= []).push(...g.tokens);
    // ensure light/dark come first if present
    const order = ["light", "dark", ...Object.keys(byMode).sort()];
    const seen = new Set();
    for (const m of order) {
      if (!byMode[m] || seen.has(m)) continue;
      seen.add(m);
      css += emitBlock(`[data-theme="${m}"]`, decls(byMode[m]), `Mode ${m} — mode/${m}`);
    }
  }

  // 5) Styles → classes (typography + elevation + generic)
  let classes = "";
  for (const t of styleTokens) {
    // Prefer original (to keep {refs}) but fall back to resolved
    const value = (t.original && t.original.value != null) ? t.original.value : t.value;

    // Elevation (array/object of shadow pieces)
    if ((Array.isArray(value) && value.every(looksLikeShadowPiece)) || looksLikeShadowPiece(value)) {
      const pieces = Array.isArray(value) ? value : [value];
      classes += emitBlock(
        classSelectorFromPath(t.path, "elevation-"),
        [`box-shadow: ${boxShadowFromPieces(pieces)};`],
        `Styles: ${t.path.filter((p) => p !== "styles").join("/")}`
      );
      continue;
    }

    // Typography objects
    if (value && typeof value === "object" && looksLikeTypography(value)) {
      const decls = Object.entries(value).map(([k, v]) => {
        const prop = k.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
        const val =
          Array.isArray(v) ? v.map(valWithRefs).join(" ") :
          typeof v === "string" ? valWithRefs(v) : v;
        return `${prop}: ${val};`;
      });
      classes += emitBlock(
        classSelectorFromPath(t.path, "text-"),
        decls,
        `Styles: ${t.path.filter((p) => p !== "styles").join("/")}`
      );
      continue;
    }

    // Generic style objects
    if (value && typeof value === "object") {
      const decls = Object.entries(value).map(([k, v]) => {
        const prop = k.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
        const val = typeof v === "string" ? valWithRefs(v) : v;
        return `${prop}: ${val};`;
      });
      classes += emitBlock(
        classSelectorFromPath(t.path, "style-"),
        decls,
        `Styles: ${t.path.filter((p) => p !== "styles").join("/")}`
      );
    }
  }
  if (classes.trim()) css += `/* Styles (utility classes) */\n` + classes;

  return css.trim() + "\n";
}
