// tools/format-token-test.mjs
// Exports a function that Style Dictionary will use as a formatter.
// Matches your “Style Dictionary Conversion Spec”.

const JOINER = "-";

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

const BREAKPOINT_DEFAULTS = { mobile: 0, tablet: 640, desktop: 1024 };
const MANUAL_ATTR_TOGGLES = false; // flip to true if you want the mirrors

const toKebab = (str) =>
  String(str)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();

const isPrivate = (seg) => /^[_$]/.test(seg);

const varNameFromToken = (t) =>
  "--" + t.path.filter((p) => !isPrivate(p)).map(toKebab).join(JOINER);

function getCollectionInfo(token) {
  const rel = token.filePath.replace(/\\/g, "/");
  const idx = rel.indexOf("tokens/raw/");
  if (idx === -1) return { type: "other", collectionKey: "misc", setName: "default" };
  const rest = rel.slice(idx + "tokens/raw/".length);
  const parts = rest.split("/");
  const rawCol = parts[0] || "misc";
  const type = TYPE_MAP[rawCol.toLowerCase()] || "other";
  let setName = "default";
  if (parts.length >= 2 && !/\.json$/i.test(parts[1])) setName = parts[1];
  else if (type === "global") setName = "global";
  const collectionKey = type === "other" ? rawCol : type;
  return { type, collectionKey, setName };
}

function visibleVarTokens(all) {
  return all.filter((t) => !t.path.some(isPrivate) && typeof t.value !== "object");
}
function styleObjectTokens(all) {
  return all.filter(
    (t) => !t.path.some(isPrivate) && (typeof t.value === "object" || Array.isArray(t.value))
  );
}

function computeBaseMap(varTokens) {
  const base = {};
  const byGroup = {};
  for (const t of varTokens) {
    const info = getCollectionInfo(t);
    const k = `${info.type}__${info.collectionKey}__${info.setName}`;
    (byGroup[k] ||= { info, tokens: [] }).tokens.push(t);
  }
  // Globals
  Object.values(byGroup)
    .filter((g) => g.info.type === "global")
    .forEach((g) => g.tokens.forEach((t) => (base[varNameFromToken(t)] = String(t.value))));
  // Other/defaults
  const other = Object.values(byGroup).filter((g) => g.info.type === "other");
  const keys = [...new Set(other.map((g) => g.info.collectionKey))];
  for (const col of keys) {
    const def = other.find(
      (g) => g.info.collectionKey === col && g.info.setName.toLowerCase() === "default"
    );
    if (def) def.tokens.forEach((t) => (base[varNameFromToken(t)] = String(t.value)));
  }
  return base;
}

function refPieces(str, baseMap) {
  const m = /^\{([^}]+)\}$/.exec(String(str).trim());
  if (!m) return null;
  const refPath = m[1].split(".").map(toKebab).join(JOINER);
  const refVar = `--${refPath}`;
  const fallback = baseMap[refVar] ?? null;
  return { refVar, fallback };
}

function emitBlock(selector, bodyLines, comment) {
  if (!bodyLines.length) return "";
  const header = comment ? `/* ${comment} */\n` : "";
  return (
    header +
    `${selector} {\n` +
    bodyLines.map((l) => `  ${l}`).join("\n") +
    `\n}\n\n`
  );
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
  // look for *_meta.minWidth or minWidth tokens
  const cand = tokensInSet.find(
    (t) =>
      t.path.slice(-1)[0].toLowerCase() === "minwidth" ||
      t.path.slice(-2).join("/").toLowerCase().endsWith("_meta/minwidth")
  );
  if (cand) {
    const v = String(cand.value);
    const n = parseFloat(v);
    if (!isNaN(n)) return n;
  }
  if (Object.prototype.hasOwnProperty.call(BREAKPOINT_DEFAULTS, setName)) {
    return BREAKPOINT_DEFAULTS[setName];
  }
  return 0;
}

export default function formatterCSS({ dictionary }) {
  const all = dictionary.allTokens;
  const varTokens = visibleVarTokens(all);
  const styleTokens = styleObjectTokens(all);
  const baseMap = computeBaseMap(varTokens);

  const groups = {};
  for (const t of varTokens) {
    const info = getCollectionInfo(t);
    const k = `${info.type}::${info.collectionKey}::${info.setName}`;
    (groups[k] ||= { info, tokens: [] }).tokens.push(t);
  }

  const tokenToDecl = (t) => {
    const name = varNameFromToken(t);
    const orig = t.original && t.original.value != null ? t.original.value : t.value;
    const ref = typeof orig === "string" ? refPieces(orig, baseMap) : null;
    if (ref) {
      if (ref.fallback && !/\{.+\}/.test(String(ref.fallback))) {
        return `${name}: var(${ref.refVar}, ${ref.fallback});`;
      }
      return `${name}: var(${ref.refVar});`;
    }
    return `${name}: ${t.value};`;
  };

  const decls = (tokens) =>
    tokens
      .slice()
      .sort((a, b) => (varNameFromToken(a) < varNameFromToken(b) ? -1 : 1))
      .map(tokenToDecl);

  let css = "";

  // Base block: Globals + Other/defaults
  const baseDecls = [];
  for (const g of Object.values(groups).filter((g) => g.info.type === "global")) {
    baseDecls.push(...decls(g.tokens));
  }
  for (const g of Object.values(groups).filter(
    (g) => g.info.type === "other" && g.info.setName.toLowerCase() === "default"
  )) {
    baseDecls.push(...decls(g.tokens));
  }
  css += emitBlock(":root", baseDecls, "Base: Global + Other defaults");

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
        min === 0 ? `Breakpoint default — breakpoint/${set}` : `Breakpoint min-width ${min}px — breakpoint/${set}`
      );
      if (min === 0) css += body;
      else css += emitAtMedia(min, body, null);

      if (MANUAL_ATTR_TOGGLES) {
        const attr = `[data-breakpoint="${set}"]`;
        css += emitBlock(attr, decls(bySet[set]), `Manual breakpoint — ${set}`);
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
        `Other ${col} — ${g.info.setName}`
      );
    }
  }

  // Mode
  const modeGroups = Object.values(groups).filter((g) => g.info.type === "mode");
  if (modeGroups.length) {
    const byMode = {};
    for (const g of modeGroups) (byMode[g.info.setName] ||= []).push(...g.tokens);
    const order = ["light", "dark", ...Object.keys(byMode).sort()];
    const seen = new Set();
    for (const m of order) {
      if (!byMode[m] || seen.has(m)) continue;
      seen.add(m);
      css += emitBlock(`[data-theme="${m}"]`, decls(byMode[m]), `Mode ${m} — theme/${m}`);
    }
  }

  // Styles → utility classes
  const toProp = (k) => toKebab(k);
  const valWithRefs = (v) => {
    if (typeof v !== "string") return v;
    const p = refPieces(v, baseMap);
    if (!p) return v;
    if (p.fallback && !/\{.+\}/.test(String(p.fallback))) return `var(${p.refVar}, ${p.fallback})`;
    return `var(${p.refVar})`;
    };
  const objToDecls = (obj, targetPropName) => {
    if (targetPropName === "box-shadow") {
      const arr = Array.isArray(obj) ? obj : [obj];
      const pieces = arr.map((o) => {
        const x = valWithRefs(o.x ?? 0);
        const y = valWithRefs(o.y ?? 0);
        const blur = valWithRefs(o.blur ?? 0);
        const spread = valWithRefs(o.spread ?? 0);
        const color = valWithRefs(o.color ?? "currentColor");
        const inset = o.inset ? " inset" : "";
        return `${x} ${y} ${blur} ${spread} ${color}${inset}`.trim();
      });
      return [`${targetPropName}: ${pieces.join(", ")};`];
    }
    return Object.entries(obj).map(([k, v]) => {
      const prop = toProp(k);
      const val =
        typeof v === "string" ? valWithRefs(v) :
        Array.isArray(v) ? v.map(valWithRefs).join(" ") :
        v;
      return `${prop}: ${val};`;
    });
  };
  const className = (t, prefix) =>
    prefix + t.path.filter((p) => !isPrivate(p)).map(toKebab).join(JOINER);

  let classes = "";
  for (const t of styleTokens) {
    const info = getCollectionInfo(t);
    if (info.type !== "styles") continue;
    const $type = t.$type || (t.attributes && t.attributes.type) || t.type || "";
    if ($type === "typography") {
      classes += emitBlock(
        "." + className(t, "text-"),
        objToDecls(t.value),
        `Styles: typography — ${t.path.join("/")}`
      );
    } else if ($type === "boxShadow" || $type === "box-shadow") {
      classes += emitBlock(
        "." + className(t, "elevation-"),
        objToDecls(t.value, "box-shadow"),
        `Styles: boxShadow — ${t.path.join("/")}`
      );
    } else {
      classes += emitBlock(
        "." + className(t, "style-"),
        objToDecls(t.value),
        `Styles: ${$type || "object"} — ${t.path.join("/")}`
      );
    }
  }
  if (classes) css += `/* Styles (utility classes) */\n` + classes;

  return css.trim() + "\n";
}
