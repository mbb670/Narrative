// tools/style-dictionary/formats/format-css-collections.mjs
const JOINER = "-";

// === Tunables ===============================================================
const INCLUDE_FALLBACKS = false;        // var(--token, fallback) → set false for var(--token)
const VAR_SEGMENT_CASE = "lower";       // 'lower' (fontfamily) or 'kebab' (font-family)
const MANUAL_ATTR_TOGGLES = false;      // duplicate default blocks as [data-...] mirrors
const BREAKPOINT_DEFAULTS = { mobile: 0, tablet: 640, desktop: 1024 };

const TYPE_MAP = {
  global: "global",
  base: "global",
  break: "breakpoint",
  breakpoint: "breakpoint",
  breakpoints: "breakpoint",
  bp: "breakpoint",
  bps: "breakpoint",
  mode: "mode",
  modes: "mode",
  theme: "mode",
  themes: "mode",
  style: "styles",
  styles: "styles"
};

// === helpers ================================================================
const toKebab = (str) =>
  String(str).replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[\s_]+/g, "-").toLowerCase();

const normSeg = (s) => {
  const raw = String(s);
  if (VAR_SEGMENT_CASE === "lower") return raw.toLowerCase().replace(/[\s_]+/g, "-");
  return toKebab(raw);
};

const cssProp = (k) => toKebab(k);
const isPrivate = (seg) => /^[_$]/.test(seg);

const varNameFromToken = (t) =>
  "--" + t.path.filter((p) => !isPrivate(p)).map(normSeg).join(JOINER);

function getCollectionInfo(token) {
  // tokens/raw/<collection>/<set or file>.json/(…)
  const rel = token.filePath.replace(/\\/g, "/");
  const idx = rel.indexOf("tokens/raw/");
  if (idx === -1) return { type: "other", collectionKey: "misc", setName: "default" };
  const rest = rel.slice(idx + "tokens/raw/".length);
  const parts = rest.split("/"); // [collection, maybeSetOrFile, ...]
  const rawCol = parts[0] || "misc";
  const type = TYPE_MAP[rawCol.toLowerCase()] || "other";

  let setName = "default";
  if (parts.length >= 2) {
    const p1 = parts[1];
    // if it's a file (like mobile.json), take the base filename without extension
    const maybe = p1.replace(/\.json$/i, "");
    setName = maybe || "default";
  }
  const collectionKey = type === "other" ? rawCol : type;
  return { type, collectionKey, setName };
}

const visibleVarTokens = (all) =>
  all.filter((t) => !t.path.some(isPrivate) && typeof t.value !== "object");
const styleObjectTokens = (all) =>
  all.filter(
    (t) => !t.path.some(isPrivate) && (typeof t.value === "object" || Array.isArray(t.value))
  );

function computeBaseMap(varTokens) {
  const base = {};
  // Globals first
  for (const t of varTokens) {
    const info = getCollectionInfo(t);
    if (info.type === "global") base[varNameFromToken(t)] = String(t.value);
  }
  // Other defaults next (for fallback resolution if enabled)
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
  const header = comment ? `/* ${comment} */\n` : "";
  return header + `${selector} {\n` + lines.map((l) => `  ${l}`).join("\n") + `\n}\n\n`;
}

function emitAtMedia(minWidth, innerCss, comment) {
  if (!innerCss) return "";
  const header = comment ? `/* ${comment} */\n` : "";
  return (
    header +
    `@media (min-width: ${minWidth}px) {\n` +
    innerCss
      .split("\n")
      .map((l) => (l.length ? "  " + l : l))
      .join("\n") +
    `\n}\n\n`
  );
}

function getBreakpointMinWidth(tokensInSet, setName) {
  // try explicit token (minWidth) first
  const cand = tokensInSet.find(
    (t) =>
      t.path.slice(-1)[0].toLowerCase() === "minwidth" ||
      t.path.slice(-2).join("/").toLowerCase().endsWith("_meta/minwidth")
  );
  if (cand) {
    const n = parseFloat(String(cand.value));
    if (!isNaN(n)) return n;
  }
  // else defaults
  if (Object.prototype.hasOwnProperty.call(BREAKPOINT_DEFAULTS, setName)) {
    return BREAKPOINT_DEFAULTS[setName];
  }
  return 0;
}

const isShadowPiece = (o) =>
  o &&
  typeof o === "object" &&
  (Object.hasOwn(o, "x") || Object.hasOwn(o, "y") || Object.hasOwn(o, "blur") || Object.hasOwn(o, "spread") || Object.hasOwn(o, "color"));

const looksLikeTypography = (o) =>
  o &&
  typeof o === "object" &&
  (Object.hasOwn(o, "fontSize") ||
    Object.hasOwn(o, "fontFamily") ||
    Object.hasOwn(o, "lineHeight") ||
    Object.hasOwn(o, "letterSpacing") ||
    Object.hasOwn(o, "fontWeight") ||
    Object.hasOwn(o, "textTransform") ||
    Object.hasOwn(o, "fontStretch"));

function stylePrefixAndNameParts(t) {
  // drop leading "styles" from the class name
  const parts = t.path.filter((p) => !isPrivate(p));
  const clean = parts[0] === "styles" ? parts.slice(1) : parts;
  const first = (clean[0] || "").toLowerCase();

  // elevation → box-shadow class
  if (first === "elevation") return { prefix: "elevation-", parts: clean };

  return { prefix: looksLikeTypography(t.value) ? "text-" : "style-", parts: clean };
}

function valWithRefs(v, baseMap) {
  if (typeof v !== "string") return v;
  const p = refPieces(v, baseMap);
  if (!p) return v;
  if (INCLUDE_FALLBACKS && p.fallback && !/\{.+\}/.test(String(p.fallback)))
    return `var(${p.refVar}, ${p.fallback})`;
  return `var(${p.refVar})`;
}

function objToDecls(obj, baseMap, targetPropName) {
  if (targetPropName === "box-shadow") {
    const arr = Array.isArray(obj) ? obj : [obj];
    const segs = arr.map((o) => {
      const x = valWithRefs(o.x ?? 0, baseMap);
      const y = valWithRefs(o.y ?? 0, baseMap);
      const blur = valWithRefs(o.blur ?? 0, baseMap);
      const spread = valWithRefs(o.spread ?? 0, baseMap);
      const color = valWithRefs(o.color ?? "currentColor", baseMap);
      const inset = o.inset ? " inset" : "";
      return `${x} ${y} ${blur} ${spread} ${color}${inset}`.trim();
    });
    return [`${targetPropName}: ${segs.join(", ")};`];
  }
  // generic: map object keys to CSS props, preserving refs
  return Object.entries(obj).map(([k, v]) => {
    const prop = cssProp(k);
    const val =
      typeof v === "string" ? valWithRefs(v, baseMap) :
      Array.isArray(v) ? v.map((x) => valWithRefs(x, baseMap)).join(" ") :
      v;
    return `${prop}: ${val};`;
  });
}

function classNameFromParts(parts, prefix) {
  return "." + prefix + parts.map(normSeg).join(JOINER);
}

// === formatter ==============================================================
export default function cssCollectionsFormatter({ dictionary }) {
  const all = dictionary.allTokens;
  const varTokens = visibleVarTokens(all);
  const styleTokens = styleObjectTokens(all);
  const baseMap = computeBaseMap(varTokens);

  // group var tokens
  const groups = {};
  for (const t of varTokens) {
    const info = getCollectionInfo(t);
    const k = `${info.type}::${info.collectionKey}::${info.setName}`;
    (groups[k] ||= { info, tokens: [] }).tokens.push(t);
  }

  const decls = (tokens) =>
    tokens
      .slice()
      .sort((a, b) => (varNameFromToken(a) < varNameFromToken(b) ? -1 : 1))
      .map((t) => tokenDecl(t, baseMap));

  let css = "";

  // Base (Global + inline + defaults)
  const baseDecls = [];
  for (const g of Object.values(groups).filter((g) => g.info.type === "global")) {
    baseDecls.push(...decls(g.tokens));
  }
  for (const g of Object.values(groups).filter(
    (g) => g.info.type === "other" && g.info.setName.toLowerCase() === "default"
  )) {
    baseDecls.push(...decls(g.tokens));
  }
  css += emitBlock(":root", baseDecls, "Base: Global + inline + defaults");

  // Breakpoints
  const bpGroups = Object.values(groups).filter((g) => g.info.type === "breakpoint");
  if (bpGroups.length) {
    const bySet = {};
    for (const g of bpGroups) (bySet[g.info.setName] ||= []).push(...g.tokens);
    const list = Object.keys(bySet).map((set) => ({
      set,
      min: getBreakpointMinWidth(bySet[set], set)
    }));
    list.sort((a, b) => a.min - b.min);
    for (const { set, min } of list) {
      const body = emitBlock(
        ":root",
        decls(bySet[set]),
        min === 0
          ? `Breakpoint default — breakpoint/${set}`
          : `Breakpoint min-width ${min}px — breakpoint/${set}`
      );
      if (min === 0) css += body;
      else css += emitAtMedia(min, body, null);

      if (MANUAL_ATTR_TOGGLES) {
        css += emitBlock(
          `[data-breakpoint="${set}"]`,
          decls(bySet[set]),
          `Manual breakpoint — ${set}`
        );
      }
    }
  }

  // Other collections
  const otherGroups = Object.values(groups).filter((g) => g.info.type === "other");
  const otherKeys = [...new Set(otherGroups.map((g) => g.info.collectionKey))];
  for (const col of otherKeys) {
    const ofCol = otherGroups.filter((g) => g.info.collectionKey === col);
    const defaults = ofCol.filter((g) => g.info.setName.toLowerCase() === "default");
    const nonDefaults = ofCol.filter((g) => g.info.setName.toLowerCase() !== "default");

    for (const g of defaults) {
      css += emitBlock(":root", decls(g.tokens), `Other ${col} — default`);
      if (MANUAL_ATTR_TOGGLES) {
        css += emitBlock(
          `[data-${col}="${g.info.setName}"]`,
          decls(g.tokens),
          `Other ${col} — default (manual attr mirror)`
        );
      }
    }
    for (const g of nonDefaults) {
      css += emitBlock(
        `[data-${col}="${g.info.setName}"]`,
        decls(g.tokens),
        `Other ${col} — set ${g.info.setName}`
      );
    }
  }

  // Mode (light first, then dark, then others)
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

  // Styles → classes
  let classes = "";
  for (const t of styleTokens) {
    const { prefix, parts } = stylePrefixAndNameParts(t);

    if (prefix === "elevation-" && (isShadowPiece(t.value) || (Array.isArray(t.value) && t.value.every(isShadowPiece)))) {
      classes += emitBlock(
        classNameFromParts(parts, prefix),
        objToDecls(t.value, baseMap, "box-shadow"),
        `Styles: ${parts.join("/")}`
      );
      continue;
    }

    if (looksLikeTypography(t.value)) {
      classes += emitBlock(
        classNameFromParts(parts, "text-"),
        objToDecls(t.value, baseMap),
        `Styles: ${parts.join("/")}`
      );
      continue;
    }

    // generic style object → style-* prefix
    classes += emitBlock(
      classNameFromParts(parts, "style-"),
      objToDecls(t.value, baseMap),
      `Styles: ${parts.join("/")}`
    );
  }
  if (classes) css += `/* Styles (utility classes) */\n` + classes;

  return css.trim() + "\n";
}
