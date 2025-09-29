// tools/style-dictionary/formats/format-css-collections.mjs
// Emits CSS variables & utility classes by "collection" (global / breakpoint / other / mode / styles)

const JOINER = "-";
const INCLUDE_FALLBACKS = false;
const BREAKPOINT_DEFAULTS = { mobile: 0, tablet: 640, desktop: 1024 };

const TYPE_MAP = {
  global: "global", base: "global",
  break: "breakpoint", breakpoint: "breakpoint", breakpoints: "breakpoint", bp: "breakpoint", bps: "breakpoint",
  mode: "mode", modes: "mode", theme: "mode", themes: "mode",
  style: "styles", styles: "styles",
  other: "other"
};

const toKebab = (s) => String(s)
  .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
  .replace(/[\s_]+/g, "-")
  .toLowerCase();

const stripExt = (s="") => s.replace(/\.(json|ts|js|yaml|yml)$/i, "");
const isPrivateSeg = (seg) => /^[_$]/.test(seg);

const varNameFromToken = (t) =>
  "--" + t.path.filter((p) => !isPrivateSeg(p)).map((p) => toKebab(p)).join(JOINER);

/** ── CRITICAL FIX: robustly derive {type, collectionKey, setName} from filePath */
function getCollectionInfo(token) {
  const fp = (token.filePath || "").replace(/\\/g, "/");
  const segs = fp.split("/");

  // find last "tokens" segment and slice after it (supports .../src/tokens/raw/... or .../tokens/...)
  let i = segs.lastIndexOf("tokens");
  let start = i >= 0 ? i + 1 : 0;
  // skip optional "raw"
  if (segs[start] && segs[start].toLowerCase() === "raw") start += 1;

  const s0 = (segs[start] || "").toLowerCase();
  const s1 = segs[start + 1] || "";
  const s2 = segs[start + 2] || "";

  // Cases:
  // A) tokens/raw/other/<collection>/<set>.json
  if (s0 === "other") {
    const collectionKey = toKebab(s1 || "misc");
    const setName = stripExt(s2 || "default") || "default";
    return { type: "other", collectionKey, setName };
  }

  // B) tokens/raw/<collection>/<set>.json  (where <collection> ∉ {global,breakpoint,mode,styles})
  if (!TYPE_MAP[s0]) {
    const collectionKey = toKebab(segs[start] || "misc");
    const setName = stripExt(segs[start + 1] || "default") || "default";
    return { type: "other", collectionKey, setName };
  }

  // C) Known typed collections
  const type = TYPE_MAP[s0];
  const collectionKey = type === "other" ? toKebab(s1 || "misc") : type;
  const setName = stripExt(s1 || "default") || "default";
  return { type, collectionKey, setName };
}

const visibleVarTokens = (all) =>
  all.filter((t) => !t.path.some(isPrivateSeg) && typeof t.value !== "object");

const styleObjectTokens = (all) =>
  all.filter((t) => !t.path.some(isPrivateSeg) && (typeof t.value === "object" || Array.isArray(t.value)));

function buildBaseMap(varTokens) {
  const base = {};
  for (const t of varTokens) {
    const info = getCollectionInfo(t);
    // include: all globals, plus ALL "other/*/default"
    if (info.type === "global" || (info.type === "other" && info.setName.toLowerCase() === "default")) {
      base[varNameFromToken(t)] = String(t.value);
    }
  }
  return base;
}

function refPieces(str, baseMap) {
  const m = /^\{([^}]+)\}$/.exec(String(str).trim());
  if (!m) return null;
  const refVar = "--" + m[1].split(".").map(toKebab).join(JOINER);
  const fallback = baseMap[refVar] ?? null;
  return { refVar, fallback };
}

function tokenDecl(t, baseMap) {
  const name = varNameFromToken(t);
  const orig = t.original && t.original.value != null ? t.original.value : t.value;
  const ref = typeof orig === "string" ? refPieces(orig, baseMap) : null;
  if (ref) {
    if (INCLUDE_FALLBACKS && ref.fallback) return `${name}: var(${ref.refVar}, ${ref.fallback});`;
    return `${name}: var(${ref.refVar});`;
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
  const head = comment ? `/* ${comment} */\n` : "";
  const indented = inner.split("\n").map((l) => (l ? "  " + l : l)).join("\n");
  return `${head}@media (min-width: ${min}px) {\n${indented}}\n\n`;
}

function getBreakpointMinWidth(tokensInSet, setName) {
  // explicit token like …/_meta/minWidth or …/minWidth (number or px)
  const meta = tokensInSet.find((t) =>
    /(^|\/)_?meta\/minwidth$/i.test(t.path.slice(-2).join("/")) ||
    /minwidth$/i.test(t.path.slice(-1)[0])
  );
  if (meta) {
    const raw = String(meta.value);
    const n = parseFloat(raw);
    if (!isNaN(n)) return n;
  }
  // fallback table
  if (Object.prototype.hasOwnProperty.call(BREAKPOINT_DEFAULTS, setName)) return BREAKPOINT_DEFAULTS[setName];
  return 0;
}

// ---------- styles helpers ----------
const keySet = (o) => new Set(Object.keys(o || {}).map((k) => k.toLowerCase()));
const looksLikeTypography = (o) => {
  if (!o || typeof o !== "object") return false;
  const ks = keySet(o);
  const fields = ["fontsize","font-size","fontfamily","font-family","lineheight","line-height",
                  "letterspacing","letter-spacing","fontweight","font-weight","texttransform","text-transform","fontstretch","font-stretch"];
  return fields.some((f) => ks.has(f));
};
const isShadowPiece = (o) => {
  if (!o || typeof o !== "object") return false;
  const ks = keySet(o);
  const hasGeom = ks.has("x") || ks.has("y") || ks.has("blur") || ks.has("spread");
  const hasColor = ks.has("color");
  const hasType = ks.has("type");
  return (hasGeom && hasColor) || (hasType && String(o.type).toLowerCase().includes("shadow"));
};

function valWithRefs(v, baseMap) {
  if (typeof v !== "string") return v;
  const p = refPieces(v, baseMap);
  if (!p) return v;
  return INCLUDE_FALLBACKS && p.fallback ? `var(${p.refVar}, ${p.fallback})` : `var(${p.refVar})`;
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

  return Object.entries(obj).map(([k, v]) => {
    const prop = toKebab(k);
    const val =
      typeof v === "string" ? valWithRefs(v, baseMap) :
      Array.isArray(v)       ? v.map((x) => valWithRefs(x, baseMap)).join(" ") :
                               v;
    return `${prop}: ${val};`;
  });
}

/** strip *all* leading `styles` segments before building a class name */
function stripLeadingStyles(parts) {
  const out = parts.slice();
  while (out[0] && out[0].toLowerCase() === "styles") out.shift();
  return out;
}

function classSelector(parts, forcedPrefix /* 'text-' or 'elevation-' or 'style-' */) {
  const cleaned = stripLeadingStyles(parts).filter((p) => !isPrivateSeg(p)).map(toKebab);
  return "." + forcedPrefix + cleaned.join(JOINER);
}

export default function cssCollectionsFormatter({ dictionary }) {
  const all = dictionary.allTokens;
  const varTokens = visibleVarTokens(all);
  const styleTokens = styleObjectTokens(all);
  const baseMap = buildBaseMap(varTokens);

  // group variable tokens
  const groups = {};
  for (const t of varTokens) {
    const info = getCollectionInfo(t);
    const key = `${info.type}::${info.collectionKey}::${info.setName}`;
    (groups[key] ||= { info, tokens: [] }).tokens.push(t);
  }
  const decls = (tokens) =>
    tokens.slice()
      .sort((a, b) => (varNameFromToken(a) < varNameFromToken(b) ? -1 : 1))
      .map((t) => tokenDecl(t, baseMap));

  let css = "";

  // 1) Base (Global + Other/*/default)
  const baseDecls = [];
  for (const g of Object.values(groups)) {
    const { type, setName } = g.info;
    if (type === "global" || (type === "other" && setName.toLowerCase() === "default")) {
      baseDecls.push(...decls(g.tokens));
    }
  }
  css += emitBlock(":root", baseDecls, "Base: Global + inline + defaults");

  // 2) Breakpoints
  const bpGroups = Object.values(groups).filter((g) => g.info.type === "breakpoint");
  if (bpGroups.length) {
    const bySet = {};
    for (const g of bpGroups) (bySet[g.info.setName] ||= []).push(...g.tokens);
    const order = Object.keys(bySet)
      .map((set) => ({ set, min: getBreakpointMinWidth(bySet[set], set) }))
      .sort((a, b) => a.min - b.min);

    for (const { set, min } of order) {
      const block = emitBlock(":root", decls(bySet[set]),
        min === 0 ? `Breakpoint default — breakpoint/${set}` : `Breakpoint min-width ${min}px — breakpoint/${set}`
      );
      css += (min === 0) ? block : emitAtMedia(min, block);
    }
  }

  // 3) Other collections (default on :root; other sets behind data-* attr)
  const otherGroups = Object.values(groups).filter((g) => g.info.type === "other");
  const collections = [...new Set(otherGroups.map((g) => g.info.collectionKey))];
  for (const col of collections) {
    const inCol = otherGroups.filter((g) => g.info.collectionKey === col);
    const defaults = inCol.filter((g) => g.info.setName.toLowerCase() === "default");
    const nonDefaults = inCol.filter((g) => g.info.setName.toLowerCase() !== "default");

    for (const g of defaults) {
      css += emitBlock(":root", decls(g.tokens), `Other ${col} — default`);
    }
    for (const g of nonDefaults) {
      css += emitBlock(`[data-${col}="${g.info.setName}"]`, decls(g.tokens), `Other ${col} — set ${g.info.setName}`);
    }
  }

  // 4) Modes
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
    const parts = (t.path[0] === "styles") ? t.path.slice(1) : t.path.slice();

    // Elevation: array/object of shadow pieces → one box-shadow line
    if ((Array.isArray(t.value) && t.value.every(isShadowPiece)) || isShadowPiece(t.value)) {
      classes += emitBlock(
        classSelector(parts, "elevation-"),
        objToDecls(t.value, baseMap, "box-shadow"),
        `Styles: ${stripLeadingStyles(parts).join("/") || "styles"}`
      );
      continue;
    }

    // Typography: detect text shapes → text-* classes
    if (looksLikeTypography(t.value)) {
      classes += emitBlock(
        classSelector(parts, "text-"),
        objToDecls(t.value, baseMap),
        `Styles: ${stripLeadingStyles(parts).join("/") || "styles"}`
      );
      continue;
    }

    // Generic style-* (if you have other style objects)
    classes += emitBlock(
      classSelector(parts, "style-"),
      objToDecls(t.value, baseMap),
      `Styles: ${stripLeadingStyles(parts).join("/") || "styles"}`
    );
  }

  if (classes.trim()) css += `/* Styles (utility classes) */\n` + classes;

  return css.trim() + "\n";
}
