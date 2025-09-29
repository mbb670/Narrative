/* Style Dictionary config generating tokens/resolved/tokens-test.css
   to match Matthew's conversion spec.

   Assumptions about your repo (from your screenshot):
   - Source tokens live under tokens/raw/<collection>/<set>/...json
     e.g. tokens/raw/global/tokens.json
          tokens/raw/fontTheme/default/tokens.json
          tokens/raw/breakpoint/mobile/tokens.json
          tokens/raw/mode/light/tokens.json
          tokens/raw/styles/typography.json (or /<set>/tokens.json)

   If any folders differ, adjust SOURCE_GLOB or the path parser below.
*/

const path = require("path");

/* --------------------------
   CONFIG KNOBS (easy tweaks)
---------------------------*/
const SOURCE_GLOB = ["tokens/raw/**/*.json"];
const OUTPUT_DIR = "tokens/resolved/";
const OUTPUT_FILE = "tokens-test.css";

// Breakpoint defaults & order (min-width, mobile first).
const BREAKPOINT_DEFAULTS = {
  mobile: 0,
  tablet: 640,
  desktop: 1024
};

// Toggle to also output manual attribute mirrors (spec §10)
const MANUAL_ATTR_TOGGLES = false; // set true if you want the duplicates

// Kebab case + hyphen joiner per spec (§4)
const JOINER = "-";

/* Synonym mapping → canonical collection types per spec (§1) */
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

/* -------------
   UTIL HELPERS
---------------*/
const toKebab = (str) =>
  String(str)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();

const isPrivate = (seg) => /^[_$]/.test(seg);

// Build CSS var name from a token.path (skip private keys)
const varNameFromToken = (token) =>
  "--" +
  token.path
    .filter((p) => !isPrivate(p))
    .map(toKebab)
    .join(JOINER);

// Try to read a custom minWidth for a breakpoint set from special tokens such as:
//   { "_meta": { "minWidth": 768 } } or { "minWidth": "768px" }
// If not present, fall back to BREAKPOINT_DEFAULTS[set] (with 0 for unknown).
function getBreakpointMinWidth(tokensInSet, setName) {
  // Try find a token that looks like minWidth
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

// Resolve a single {ref.path} in a string; return {refVar, fallback}
// Fallback is looked up from baseMap (already-resolved raw value), else null.
function refPieces(str, baseMap) {
  const m = /^\{([^}]+)\}$/.exec(String(str).trim());
  if (!m) return null;
  const refPath = m[1].split(".").map(toKebab).join(JOINER);
  const refVar = `--${refPath}`;
  const fallback = baseMap[refVar] ?? null;
  return { refVar, fallback };
}

// Minimal, deterministic CSS emitter
function emitBlock(selector, bodyLines, comment) {
  const header = comment ? `/* ${comment} */\n` : "";
  if (!bodyLines.length) return "";
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

/* --------------------------
   COLLECTION DETECTION (§1)
---------------------------*/
// Extract {type, collectionKey, setName} from the token's source file path.
function getCollectionInfo(token) {
  // Normalize path like tokens/raw/<collection>/<set>/.../file.json
  const rel = token.filePath.replace(/\\/g, "/");
  const idx = rel.indexOf("tokens/raw/");
  if (idx === -1) {
    return { type: "other", collectionKey: "misc", setName: "default" };
  }
  const rest = rel.slice(idx + "tokens/raw/".length);
  const parts = rest.split("/"); // [collection, set?, ...]
  const rawCol = parts[0] || "misc";
  const type = TYPE_MAP[rawCol.toLowerCase()] || "other";
  let setName = "default";
  if (parts.length >= 2 && !/\.json$/i.test(parts[1])) {
    setName = parts[1];
  } else if (type === "global") {
    setName = "global";
  }
  const collectionKey =
    type === "other" ? rawCol : type; // for "other", keep the folder name as the key
  return { type, collectionKey, setName };
}

/* --------------------------------------------
   SELECT & ORDER TOKENS (skip private keys)
---------------------------------------------*/
function visibleVarTokens(allTokens) {
  return allTokens.filter((t) => !t.path.some(isPrivate) && typeof t.value !== "object");
}
function styleObjectTokens(allTokens) {
  // tokens that have object/array values: used for utility classes (§6)
  return allTokens.filter(
    (t) =>
      !t.path.some(isPrivate) &&
      (typeof t.value === "object" || Array.isArray(t.value))
  );
}

/* -----------------------------------------------------
   BUILD BASE MAP for fallbacks (§2 + §5 “Base” concept)
------------------------------------------------------*/
function computeBaseMap(varTokens) {
  // Base = Global + defaults of each OTHER collection.
  const base = {};
  // Collect tokens by (type, collectionKey, setName)
  const byGroup = {};
  for (const t of varTokens) {
    const info = getCollectionInfo(t);
    const k = `${info.type}__${info.collectionKey}__${info.setName}`;
    (byGroup[k] ||= { info, tokens: [] }).tokens.push(t);
  }
  // 1) All GLOBAL tokens
  Object.values(byGroup)
    .filter((g) => g.info.type === "global")
    .forEach((g) => {
      for (const t of g.tokens) base[varNameFromToken(t)] = String(t.value);
    });
  // 2) Each OTHER collection's "default" set (if exists)
  const otherGroups = Object.values(byGroup).filter((g) => g.info.type === "other");
  const otherKeys = [...new Set(otherGroups.map((g) => g.info.collectionKey))];
  for (const colKey of otherKeys) {
    const def = otherGroups.find(
      (g) => g.info.collectionKey === colKey && g.info.setName.toLowerCase() === "default"
    );
    if (def) {
      for (const t of def.tokens) base[varNameFromToken(t)] = String(t.value);
    }
  }
  return base;
}

/* ----------------------------------------------
   FORMATTER: build tokens-test.css per the spec
-----------------------------------------------*/
function formatterCSS(dictionary /*, config*/) {
  const all = dictionary.allTokens;

  // Separate variable tokens (scalars) and style-object tokens (for classes)
  const varTokens = visibleVarTokens(all);
  const styleTokens = styleObjectTokens(all);

  // Build the base map (for var() fallbacks)
  const baseMap = computeBaseMap(varTokens);

  // Group var tokens by collection/set
  const groups = {};
  for (const t of varTokens) {
    const info = getCollectionInfo(t);
    const key = `${info.type}::${info.collectionKey}::${info.setName}`;
    (groups[key] ||= { info, tokens: [] }).tokens.push(t);
  }

  // Helpers to turn tokens → CSS var lines with var(--, fallback) if single-ref
  function tokenToDecl(t) {
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
  }

  // Sort declarations deterministically
  function decls(tokens) {
    return tokens
      .slice()
      .sort((a, b) => (varNameFromToken(a) < varNameFromToken(b) ? -1 : 1))
      .map(tokenToDecl);
  }

  let css = "";

  /* 1) Base block: Global + Other defaults (spec §3 “Base block”) */
  const baseDecls = [];
  // Global (all sets)
  for (const g of Object.values(groups).filter((g) => g.info.type === "global")) {
    baseDecls.push(...decls(g.tokens));
  }
  // Other collection defaults
  const otherDefaults = Object.values(groups).filter(
    (g) => g.info.type === "other" && g.info.setName.toLowerCase() === "default"
  );
  // keep grouped but unwrapped in :root
  for (const g of otherDefaults) {
    baseDecls.push(...decls(g.tokens));
  }
  css += emitBlock(":root", baseDecls, "Base: Global + Other defaults");

  /* 2) Breakpoints (mobile unwrapped, tablet/desktop with min-width) */
  const bpGroups = Object.values(groups).filter((g) => g.info.type === "breakpoint");
  if (bpGroups.length) {
    // Map: setName -> tokens
    const bySet = {};
    for (const g of bpGroups) (bySet[g.info.setName] ||= []).push(...g.tokens);

    // Determine min-widths
    const list = Object.keys(bySet).map((set) => ({
      set,
      min: getBreakpointMinWidth(bySet[set], set)
    }));
    // Sort ascending min
    list.sort((a, b) => a.min - b.min);

    for (const { set, min } of list) {
      const body = emitBlock(":root", decls(bySet[set]), 
        min === 0
          ? `Breakpoint default — breakpoint/${set}`
          : `Breakpoint min-width ${min}px — breakpoint/${set}`
      );
      if (min === 0) {
        css += body; // mobile = unwrapped
      } else {
        css += emitAtMedia(min, body, null);
      }

      if (MANUAL_ATTR_TOGGLES) {
        const attr = `[data-breakpoint="${set}"]`;
        css += emitBlock(attr, decls(bySet[set]), `Manual breakpoint — ${set}`);
      }
    }
  }

  /* 3) Other collections (fontTheme, colorTheme, etc.)
        default set FIRST unwrapped, then the rest as [data-<collection>="<set>"] */
  const otherGroups = Object.values(groups).filter((g) => g.info.type === "other");
  const otherCollectionKeys = [...new Set(otherGroups.map((g) => g.info.collectionKey))];

  for (const col of otherCollectionKeys) {
    const ofCol = otherGroups.filter((g) => g.info.collectionKey === col);
    const defaults = ofCol.filter((g) => g.info.setName.toLowerCase() === "default");
    const nonDefaults = ofCol.filter((g) => g.info.setName.toLowerCase() !== "default");

    // default FIRST (unwrapped)
    for (const g of defaults) {
      css += emitBlock(
        ":root",
        decls(g.tokens),
        `Other ${col} — default`
      );

      if (MANUAL_ATTR_TOGGLES) {
        const attr = `[data-${col}="${g.info.setName}"]`;
        css += emitBlock(attr, decls(g.tokens), `Other ${col} — default (manual attr mirror)`);
      }
    }

    // then each non-default wrapped
    for (const g of nonDefaults) {
      const attr = `[data-${col}="${g.info.setName}"]`;
      css += emitBlock(attr, decls(g.tokens), `Other ${col} — ${g.info.setName}`);
    }
  }

  /* 4) Mode (light then dark) as [data-theme="<mode>"] */
  const modeGroups = Object.values(groups).filter((g) => g.info.type === "mode");
  if (modeGroups.length) {
    const byMode = {};
    for (const g of modeGroups) (byMode[g.info.setName] ||= []).push(...g.tokens);

    const ordered = ["light", "dark", ...Object.keys(byMode).sort()];
    const seen = new Set();
    for (const name of ordered) {
      if (!byMode[name] || seen.has(name)) continue;
      seen.add(name);
      const sel = `[data-theme="${name}"]`;
      css += emitBlock(sel, decls(byMode[name]), `Mode ${name} — theme/${name}`);
    }
  }

  /* 5) Styles → utility classes (spec §6)
        - type: "typography" => .text-<path> { font-* ... }
        - type: "boxShadow"  => .elevation-<path> { box-shadow: ... }
        - other types        => .style-<path> { ... }
  */
  function classNameFromToken(t, prefix) {
    const name = t.path
      .filter((p) => !isPrivate(p))
      .map(toKebab)
      .join(JOINER);
    return `${prefix}${name}`;
  }
  function cssPropName(k) {
    return toKebab(k);
  }
  function valueWithRefs(v) {
    if (typeof v !== "string") return v;
    const p = refPieces(v, baseMap);
    if (!p) return v;
    if (p.fallback && !/\{.+\}/.test(String(p.fallback))) {
      return `var(${p.refVar}, ${p.fallback})`;
    }
    return `var(${p.refVar})`;
  }

  // Flatten object → CSS declarations
  function objToDecls(obj, targetPropName) {
    // If targetPropName is provided, we’re building a composite (e.g., box-shadow)
    if (targetPropName === "box-shadow") {
      const arr = Array.isArray(obj) ? obj : [obj];
      const pieces = arr.map((o) => {
        const x = valueWithRefs(o.x ?? 0);
        const y = valueWithRefs(o.y ?? 0);
        const blur = valueWithRefs(o.blur ?? 0);
        const spread = valueWithRefs(o.spread ?? 0);
        const color = valueWithRefs(o.color ?? "currentColor");
        const inset = o.inset ? " inset" : "";
        return `${x} ${y} ${blur} ${spread} ${color}${inset}`.trim();
      });
      return [`${targetPropName}: ${pieces.join(", ")};`];
    }
    // Generic object → multiple CSS props
    return Object.entries(obj).map(([k, v]) => {
      const prop = cssPropName(k);
      const val =
        typeof v === "string" ? valueWithRefs(v) :
        Array.isArray(v) ? v.map(valueWithRefs).join(" ") :
        v;
      return `${prop}: ${val};`;
    });
  }

  // Emit classes grouped section header
  let classCss = "";
  for (const t of styleTokens) {
    const info = getCollectionInfo(t);
    // Only classes from styles/* (others may be object tokens we don't want as classes)
    if (info.type !== "styles") continue;

    const $type =
      t.$type || (t.attributes && t.attributes.type) || t.type || ""; // be liberal
    if ($type === "typography") {
      const cls = "." + classNameFromToken(t, "text-");
      const decls = objToDecls(t.value);
      classCss += emitBlock(cls, decls, `Styles: typography — ${t.path.join("/")}`);
    } else if ($type === "boxShadow" || $type === "box-shadow") {
      const cls = "." + classNameFromToken(t, "elevation-");
      const decls = objToDecls(t.value, "box-shadow");
      classCss += emitBlock(cls, decls, `Styles: boxShadow — ${t.path.join("/")}`);
    } else {
      const cls = "." + classNameFromToken(t, "style-");
      const decls = objToDecls(t.value);
      classCss += emitBlock(cls, decls, `Styles: ${$type || "object"} — ${t.path.join("/")}`);
    }
  }
  if (classCss) {
    css += `/* Styles (utility classes) */\n` + classCss;
  }

  return css.trim() + "\n";
}

/* -------------------------
   SD REGISTRATION + EXPORT
--------------------------*/
const StyleDictionary = require("style-dictionary");

StyleDictionary.registerFormat({
  name: "custom/css-token-test",
  formatter: formatterCSS
});

module.exports = {
  source: SOURCE_GLOB,
  platforms: {
    // keep your existing outputs if you want (tokens.css / tokens.js), or remove them.
    // cssDefault: {
    //   transformGroup: "css",
    //   buildPath: OUTPUT_DIR,
    //   files: [{ destination: "tokens.css", format: "css/variables", options: { selector: ":root", outputReferences: true } }]
    // },
    cssTokenTest: {
      // We keep default transforms so numbers/colors are normalized;
      // final formatting happens in our custom formatter.
      transformGroup: "css",
      buildPath: OUTPUT_DIR,
      files: [
        {
          destination: OUTPUT_FILE,
          format: "custom/css-token-test"
        }
      ]
    }
  }
};
