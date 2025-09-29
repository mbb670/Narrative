// tools/style-dictionary/formats/format-css-collections.mjs
// Emits CSS variables & utility classes by "collection" (global / breakpoint / other / mode / styles)
// Tweaks: include Other/default in Base; robust typography detection; robust box-shadow; no fallbacks.

const JOINER = "-";
const INCLUDE_FALLBACKS = false;
const VAR_SEGMENT_CASE = "lower";                 // 'lower' => fontfamily, lineheight; 'kebab' => font-family
const MANUAL_ATTR_TOGGLES = false;
const BREAKPOINT_DEFAULTS = { mobile: 0, tablet: 640, desktop: 1024 };

const TYPE_MAP = {
  global: "global", base: "global",
  break: "breakpoint", breakpoint: "breakpoint", breakpoints: "breakpoint", bp: "breakpoint", bps: "breakpoint",
  mode: "mode", modes: "mode", theme: "mode", themes: "mode",
  style: "styles", styles: "styles"
};

// ---------- helpers ----------
const toKebab = (s) => String(s)
  .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
  .replace(/[\s_]+/g, "-")
  .toLowerCase();

const normSeg = (s) => (VAR_SEGMENT_CASE === "lower" ? String(s).toLowerCase().replace(/[\s_]+/g, "-") : toKebab(s));
const cssProp = (k) => toKebab(k);
const isPrivate = (seg) => /^[_$]/.test(seg);

const varNameFromToken = (t) => "--" + t.path.filter((p) => !isPrivate(p)).map(normSeg).join(JOINER);

// file path → {type, collectionKey, setName}
function getCollectionInfo(token) {
  const fp = token.filePath.replace(/\\/g, "/");
  const ix = fp.indexOf("tokens/raw/");
  const rest = ix >= 0 ? fp.slice(ix + "tokens/raw/".length) : fp;
  const parts = rest.split("/");
  const rawCol = parts[0] || "misc";
  const type = TYPE_MAP[rawCol.toLowerCase()] || "other";
  let setName = "default";
  if (parts.length >= 2) {
    setName = (parts[1] || "default").replace(/\.json$/i, "") || "default";
  }
  const collectionKey = type === "other" ? rawCol : type;
  return { type, collectionKey, setName };
}

// keep non-object values as vars; keep object/array for classes
const visibleVarTokens = (all) => all.filter((t) => !t.path.some(isPrivate) && typeof t.value !== "object");
const styleObjectTokens = (all) => all.filter((t) => !t.path.some(isPrivate) && (typeof t.value === "object" || Array.isArray(t.value)));

function computeBaseMap(varTokens) {
  const base = {};
  // 1) globals
  for (const t of varTokens) {
    if (getCollectionInfo(t).type === "global") base[varNameFromToken(t)] = String(t.value);
  }
  // 2) other/defaults
  for (const t of varTokens) {
    const info = getCollectionInfo(t);
    if (info.type === "other" && info.setName.toLowerCase() === "default") {
      base[varNameFromToken(t)] = String(t.value);
    }
  }
  return base;
}

function refPieces(str, baseMap) {
  const m = /^\{([^}]+)\}$/.exec(String(str).trim());
  if (!m) return null;
  const refPath = m[1].split(".").map(normSeg).join(JOINER);
  const refVar = `--${refPath}`;
  const fallback = baseMap[refVar] ?? null;
  return { refVar, fallback };
}

function tokenDecl(t, baseMap) {
  const name = varNameFromToken(t);
  const orig = t.original && t.original.value != null ? t.original.value : t.value;
  const ref = typeof orig === "string" ? refPieces(orig, baseMap) : null;
  if (ref) {
    if (INCLUDE_FALLBACKS && ref.fallback && !/\{.+\}/.test(String(ref.fallback))) {
      return `${name}: var(${ref.refVar}, ${ref.fallback});`;
    }
    return `${name}: var(${ref.refVar});`;
  }
  return `${name}: ${t.value};`;
}

function emitBlock(selector, lines, comment) {
  if (!lines.length) return "";
  const head = comment ? `/* ${comment} */\n` : "";
  return head + `${selector} {\n` + lines.map((l) => `  ${l}`).join("\n") + `\n}\n\n`;
}

function emitAtMedia(min, inner, comment) {
  if (!inner) return "";
  const head = comment ? `/* ${comment} */\n` : "";
  return head + `@media (min-width: ${min}px) {\n` +
    inner.split("\n").map((l) => (l ? "  " + l : l)).join("\n") +
    `\n}\n\n`;
}

function getBreakpointMinWidth(tokensInSet, setName) {
  // explicit token like …/minWidth or …/_meta/minWidth
  const cand = tokensInSet.find(
    (t) =>
      t.path.slice(-1)[0].toLowerCase() === "minwidth" ||
      t.path.slice(-2).join("/").toLowerCase().endsWith("_meta/minwidth")
  );
  if (cand) {
    const n = parseFloat(String(cand.value));
    if (!isNaN(n)) return n;
  }
  // fallback default table
  if (Object.prototype.hasOwnProperty.call(BREAKPOINT_DEFAULTS, setName)) return BREAKPOINT_DEFAULTS[setName];
  return 0;
}

// ---------- styles detection ----------
const keySet = (o) => new Set(Object.keys(o || {}).map((k) => k.toLowerCase()));

const looksLikeTypography = (o) => {
  if (!o || typeof o !== "object") return false;
  const ks = keySet(o);
  const candidates = ["fontsize","font-size","fontfamily","font-family","lineheight","line-height","letterspacing","letter-spacing","fontweight","font-weight","texttransform","text-transform","fontstretch","font-stretch"];
  return candidates.some((k) => ks.has(k));
};

const isShadowPiece = (o) => {
  if (!o || typeof o !== "object") return false;
  const ks = keySet(o);
  // figma tokens: { x, y, blur, spread, color, type: 'dropShadow'|'innerShadow' }
  const hasGeom = ks.has("x") || ks.has("y") || ks.has("blur") || ks.has("spread");
  const hasColor = ks.has("color");
  const hasType = ks.has("type");
  return (hasGeom && hasColor) || (hasType && (String(o.type).toLowerCase().includes("shadow")));
};

function stylePrefixAndNameParts(t) {
  const clean = (t.path[0] === "styles") ? t.path.slice(1) : t.path.slice();
  const first = (clean[0] || "").toLowerCase();
  if (first === "elevation") return { prefix: "elevation-", parts: clean };
  if (looksLikeTypography(t.value)) return { prefix: "text-", parts: clean };
  return { prefix: "style-", parts: clean };
}

function valWithRefs(v, baseMap) {
  if (typeof v !== "string") return v;
  const p = refPieces(v, baseMap);
  if (!p) return v;
  if (INCLUDE_FALLBACKS && p.fallback && !/\{.+\}/.test(String(p.fallback)))
    return `var(${p.refVar}, ${p.fallback})`;
  return `var(${p.refVar})`;
}

function objToDecls(obj, baseMap, forceProp /* e.g. 'box-shadow' */) {
  if (forceProp === "box-shadow") {
    const arr = Array.isArray(obj) ? obj : [obj];
    const segs = arr.map((o) => {
      const x = valWithRefs(o.x ?? 0, baseMap);
      const y = valWithRefs(o.y ?? 0, baseMap);
      const blur = valWithRefs(o.blur ?? 0, baseMap);
      const spread = valWithRefs(o.spread ?? 0, baseMap);
      const color = valWithRefs(o.color ?? "currentColor", baseMap);
      const inset = (String(o.type || "").toLowerCase().includes("inner") || o.inset) ? " inset" : "";
      return `${x} ${y} ${blur} ${spread} ${color}${inset}`.trim();
    });
    return [`${forceProp}: ${segs.join(", ")};`];
  }

  // generic: map object keys → CSS props (preserve refs, join arrays with spaces)
  return Object.entries(obj).map(([k, v]) => {
    const prop = cssProp(k);
    const val =
      typeof v === "string" ? valWithRefs(v, baseMap) :
      Array.isArray(v)       ? v.map((x) => valWithRefs(x, baseMap)).join(" ") :
                               v;
    return `${prop}: ${val};`;
  });
}

function classNameFromParts(parts, prefix) {
  return "." + prefix + parts.filter((p) => !isPrivate(p)).map(normSeg).join(JOINER);
}

// ---------- formatter ----------
export default function cssCollectionsFormatter({ dictionary }) {
  const all = dictionary.allTokens;
  const varTokens = visibleVarTokens(all);
  const styleTokens = styleObjectTokens(all);
  const baseMap = computeBaseMap(varTokens);

  // group var tokens
  const groups = {};
  for (const t of varTokens) {
    const info = getCollectionInfo(t);
    const key = `${info.type}::${info.collectionKey}::${info.setName}`;
    (groups[key] ||= { info, tokens: [] }).tokens.push(t);
  }
  const decls = (tokens) =>
    tokens
      .slice()
      .sort((a, b) => (varNameFromToken(a) < varNameFromToken(b) ? -1 : 1))
      .map((t) => tokenDecl(t, baseMap));

  let css = "";

  // 1) Base (Global + inline + Other defaults)
  const baseDecls = [];
  for (const g of Object.values(groups).filter((g) => g.info.type === "global")) {
    baseDecls.push(...decls(g.tokens));
  }
  for (const g of Object.values(groups).filter((g) => g.info.type === "other" && g.info.setName.toLowerCase() === "default")) {
    baseDecls.push(...decls(g.tokens));
  }
  css += emitBlock(":root", baseDecls, "Base: Global + inline + defaults");

  // 2) Breakpoints (mobile unwrapped; others min-width)
  const bpGroups = Object.values(groups).filter((g) => g.info.type === "breakpoint");
  if (bpGroups.length) {
    const bySet = {};
    for (const g of bpGroups) (bySet[g.info.setName] ||= []).push(...g.tokens);
    const order = Object.keys(bySet).map((set) => ({ set, min: getBreakpointMinWidth(bySet[set], set) }))
      .sort((a, b) => a.min - b.min);

    for (const { set, min } of order) {
      const block = emitBlock(":root", decls(bySet[set]),
        min === 0 ? `Breakpoint default — breakpoint/${set}` : `Breakpoint min-width ${min}px — breakpoint/${set}`
      );
      css += (min === 0) ? block : emitAtMedia(min, block);
      if (MANUAL_ATTR_TOGGLES) {
        css += emitBlock(`[data-breakpoint="${set}"]`, decls(bySet[set]), `Manual breakpoint — ${set}`);
      }
    }
  }

  // 3) Other collections (default unwrapped, others as data-attrs)
  const otherGroups = Object.values(groups).filter((g) => g.info.type === "other");
  const otherKeys = [...new Set(otherGroups.map((g) => g.info.collectionKey))];
  for (const col of otherKeys) {
    const ofCol = otherGroups.filter((g) => g.info.collectionKey === col);
    const defaults = ofCol.filter((g) => g.info.setName.toLowerCase() === "default");
    const nonDefaults = ofCol.filter((g) => g.info.setName.toLowerCase() !== "default");
    for (const g of defaults) {
      css += emitBlock(":root", decls(g.tokens), `Other ${col} — default`);
      if (MANUAL_ATTR_TOGGLES) {
        css += emitBlock(`[data-${col}="${g.info.setName}"]`, decls(g.tokens), `Other ${col} — default (manual)`);
      }
    }
    for (const g of nonDefaults) {
      css += emitBlock(`[data-${col}="${g.info.setName}"]`, decls(g.tokens), `Other ${col} — set ${g.info.setName}`);
    }
  }

  // 4) Modes (light, dark, then any others)
  const modeGroups = Object.values(groups).filter((g) => g.info.type === "mode");
  if (modeGroups.length) {
    const byMode = {};
    for (const g of modeGroups) (byMode[g.info.setName] ||= []).push(...g.tokens);
    const order = ["light", "dark", ...Object.keys(byMode).sort()];
    const seen = new Set();
    for (const m of order) {
      if (!byMode[m] || seen.has(m)) continue;
      seen.add(m);
      css += emitBlock(`[data-theme="${m}"]`, decls(byMode[m]), `Mode ${m} — mode/${m}`);
    }
  }

  // 5) Styles → classes
  let classes = "";
  for (const t of styleTokens) {
    const { prefix, parts } = stylePrefixAndNameParts(t);
    // elevation / box-shadow
    if ((Array.isArray(t.value) && t.value.every(isShadowPiece)) || isShadowPiece(t.value)) {
      classes += emitBlock(classNameFromParts(parts, "elevation-"), objToDecls(t.value, baseMap, "box-shadow"), `Styles: ${parts.join("/")}`);
      continue;
    }
    // typography / text-*
    if (looksLikeTypography(t.value)) {
      classes += emitBlock(classNameFromParts(parts, "text-"), objToDecls(t.value, baseMap), `Styles: ${parts.join("/")}`);
      continue;
    }
    // generic style-*
    classes += emitBlock(classNameFromParts(parts, "style-"), objToDecls(t.value, baseMap), `Styles: ${parts.join("/")}`);
  }
  if (classes) css += `/* Styles (utility classes) */\n` + classes;

  return css.trim() + "\n";
}
