// tools/style-dictionary/formats/format-css-collections.mjs
// Format id: "css/collections"
// Implements the converter spec: Base (Global+Inline+Other defaults) → Breakpoints → Other → Modes → Styles (classes)

const FORMAT_ID = "css/collections";
const JOINER = "-";

// -------------------------------
// Typing & order
// -------------------------------
const TYPE_SYNONYMS = {
  global: new Set(["global", "base"]),
  breakpoint: new Set(["break", "breaks", "breakpoint", "breakpoints", "bp", "bps"]),
  mode: new Set(["mode", "modes", "theme", "themes"]),
  styles: new Set(["styles", "style"]),
};
const BP_MIN = { mobile: 0, tablet: 640, desktop: 1024 };
const BP_KNOWN = new Set(["mobile", "tablet", "desktop"]);
const MODE_KNOWN = new Set(["light", "dark", "default"]);

// -------------------------------
// Small helpers
// -------------------------------
const isPriv = (s) => /^[_$]/.test(s);

// kebab
const kebab = (x) =>
  String(x).replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[_\s]+/g, "-").toLowerCase();

// canonicalize leaf names and paired segments (font-family → fontfamily, etc.)
function canonPairsInVarName(v) {
  return v
    .replace(/--font-family-/g, "--fontfamily-")
    .replace(/--font-weight-/g, "--fontweight-")
    .replace(/--font-size-/g, "--fontsize-")
    .replace(/--line-height-/g, "--lineheight-")
    .replace(/--letter-spacing-/g, "--letterspacing-");
}
function canonPairsInPathSeg(seg) {
  // Only used for last segment when building var names from paths
  const s = kebab(seg);
  if (s === "font-family") return "fontfamily";
  if (s === "font-weight") return "fontweight";
  if (s === "font-size") return "fontsize";
  if (s === "line-height") return "lineheight";
  if (s === "letter-spacing") return "letterspacing";
  return s;
}

function normalizeVarNameFromPath(path) {
  const parts = path.map((p) => kebab(p));
  if (parts.length) parts[parts.length - 1] = canonPairsInPathSeg(parts.at(-1));
  return canonPairsInVarName(`--${parts.join(JOINER)}`);
}

function cssPropName(k) {
  return kebab(k);
}

// rgba(...) → #RRGGBBAA (matches your expected output)
function rgbaToHex8(str) {
  const m =
    /^\s*rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*(0|0?\.\d+|1(?:\.0+)?))?\s*\)\s*$/i.exec(
      str
    );
  if (!m) return null;
  const r = Math.max(0, Math.min(255, +m[1]));
  const g = Math.max(0, Math.min(255, +m[2]));
  const b = Math.max(0, Math.min(255, +m[3]));
  const a = Math.max(0, Math.min(1, m[4] == null ? 1 : +m[4]));
  const to2 = (n) => n.toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}${to2(Math.round(a * 255))}`;
}
function formatScalar(v) {
  if (typeof v === "string") return rgbaToHex8(v) || v;
  if (Array.isArray(v)) return v.map(formatScalar).join(" ");
  return String(v);
}

function containsRef(v) {
  return typeof v === "string" && /\{[^}]+\}/.test(v);
}
function refParts(v) {
  const out = [];
  if (typeof v !== "string") return out;
  const re = /\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(v))) out.push({ raw: m[0], pathStr: m[1] });
  return out;
}
function pathStrToVarName(pathStr) {
  return normalizeVarNameFromPath(pathStr.split("."));
}

// -------------------------------
// File-path classification
// -------------------------------
function afterTokensParts(filePath) {
  const parts = String(filePath || "").replace(/\\/g, "/").split("/");
  const i = parts.lastIndexOf("tokens");
  if (i < 0) return [];
  const out = [];
  for (let j = i + 1; j < parts.length; j++) {
    const p = parts[j];
    if (!p || /\.jsonc?$|\.ya?ml$|\.ts$|\.js$/i.test(p)) continue; // skip filename
    if (["raw", "docs", "resolved"].includes(p)) continue;
    out.push(p);
  }
  return out;
}
function findSetInPath(filePath, candidates) {
  const s = String(filePath || "").toLowerCase();
  for (const c of candidates) {
    const re = new RegExp(`(?:/|-)${c}(?:/|\\.|-)`);
    if (re.test(s)) return c;
  }
  return null;
}
function classifyFromFilePath(filePath, token) {
  const parts = afterTokensParts(filePath);
  const first = (parts[0] || "").toLowerCase();
  let type = "other";
  if (TYPE_SYNONYMS.global.has(first)) type = "global";
  else if (TYPE_SYNONYMS.breakpoint.has(first)) type = "breakpoint";
  else if (TYPE_SYNONYMS.mode.has(first)) type = "mode";
  else if (TYPE_SYNONYMS.styles.has(first)) type = "styles";

  // collection name
  const collection = type === "other" ? (parts[0] || "other") : type;

  // set detection
  let set = null;
  if (type === "global") {
    set = null;
  } else if (type === "breakpoint") {
    set =
      parts[1] ||
      token?.attributes?.breakpoint ||
      findSetInPath(filePath, BP_KNOWN) ||
      "mobile"; // treat default as mobile
  } else if (type === "mode") {
    set =
      parts[1] ||
      token?.attributes?.mode ||
      findSetInPath(filePath, MODE_KNOWN) ||
      "light";
    if (String(set).toLowerCase() === "default") set = "light";
  } else if (type === "styles") {
    // styles "set" is the remainder (often not needed)
    set = parts[1] || null;
  } else {
    set = parts[1] || "default";
  }

  return { type, collection, set };
}

// -------------------------------
// Base fallback map
// -------------------------------
function buildBaseVarMap(tokensMeta) {
  const m = new Map();
  for (const t of tokensMeta) {
    if (t.path.some(isPriv)) continue;
    m.set(t.varName, formatScalar(t.value));
  }
  return m;
}
function valueWithRefs(originalValue, resolvedValue, baseVarMap) {
  if (!containsRef(originalValue)) return formatScalar(resolvedValue);
  let out = String(originalValue);
  for (const rp of refParts(originalValue)) {
    const refVar = pathStrToVarName(rp.pathStr);
    const fb = baseVarMap.get(refVar);
    const fallback = fb ? `, ${fb}` : "";
    out = out.replace(rp.raw, `var(${refVar}${fallback})`);
  }
  return out;
}

// -------------------------------
// Emit helpers
// -------------------------------
const emitBlockComment = (t) => `/* ${t} */\n\n`;
const emitRule = (selector, decls) =>
  decls.length ? `${selector} {\n${decls.map((d) => `  ${d}`).join("\n")}\n}\n\n` : "";

function emitVarDecls(tokens, baseVarMap) {
  const decls = [];
  for (const t of tokens) {
    if (t.path.some(isPriv)) continue;
    const v = valueWithRefs(t.originalValue, t.value, baseVarMap);
    decls.push(`${t.varName}: ${v};`);
  }
  return decls;
}

// -------------------------------
// Style / utility classes
// -------------------------------
const TYPO_KEYS = new Set([
  "fontSize",
  "font-weight",
  "font-size",
  "fontFamily",
  "font-family",
  "lineHeight",
  "line-height",
  "letterSpacing",
  "letter-spacing",
  "textTransform",
  "fontStretch",
]);

function guessStyleType(t) {
  const typeCandidates = [
    t.type,
    t.$type,
    t.attributes?.$type,
    t.attributes?.type,
    t.attributes?.category,
  ]
    .filter(Boolean)
    .map((x) => String(x).toLowerCase());

  if (typeCandidates.some((x) => x === "typography")) return "typography";
  if (typeCandidates.some((x) => x === "boxshadow")) return "boxShadow";

  // Heuristics
  if (typeof t.value === "object" && t.value) {
    if (Array.isArray(t.value)) {
      // array of shadow objects?
      if (t.value.every((o) => typeof o === "object" && ("x" in o || "y" in o || "blur" in o || "color" in o)))
        return "boxShadow";
    } else {
      const keys = Object.keys(t.value);
      if (keys.some((k) => TYPO_KEYS.has(k))) return "typography";
      if (["x", "y", "blur", "spread", "color"].some((k) => k in t.value)) return "boxShadow";
    }
  }
  return "style";
}

function buildClassNamePrefix(styleType) {
  if (styleType === "typography") return ".text-";
  if (styleType === "boxShadow") return ".elevation-";
  return ".style-";
}

function boxShadowValue(v, baseVarMap, original) {
  const segToString = (seg, origSeg) => {
    if (!seg || typeof seg !== "object") return null;
    const x = formatScalar(seg.x ?? 0);
    const y = formatScalar(seg.y ?? 0);
    const blur = formatScalar(seg.blur ?? 0);
    const spread = formatScalar(seg.spread ?? 0);
    const color = containsRef(origSeg?.color)
      ? valueWithRefs(origSeg.color, seg.color, baseVarMap)
      : formatScalar(seg.color ?? "transparent");
    const inset = seg.inset ? " inset" : "";
    return `${x} ${y} ${blur} ${spread} ${color}${inset}`;
  };

  if (Array.isArray(v)) {
    const origArr = Array.isArray(original) ? original : [];
    return v
      .map((s, i) => segToString(s, origArr[i] || s))
      .filter(Boolean)
      .join(", ");
  }
  return segToString(v, original);
}

function emitStyles(styleTokens, baseVarMap) {
  const blocks = [];
  for (const t of styleTokens) {
    const styleType = guessStyleType(t);

    // class base from token.path (drop leading "styles" if present)
    const pathNoPriv = t.path.filter((p) => !isPriv(p));
    const parts = pathNoPriv.slice();
    if (parts[0] && kebab(parts[0]) === "styles") parts.shift();
    const classBase = parts.map((p) => kebab(p)).join(JOINER);

    const decls = [];
    if (styleType === "typography" && typeof t.value === "object" && t.value) {
      for (const [k, v] of Object.entries(t.value)) {
        const prop = cssPropName(k);
        const ov = t.originalValue?.[k] ?? v;
        const val = containsRef(ov) ? valueWithRefs(ov, v, baseVarMap) : formatScalar(v);
        decls.push(`${prop}: ${val};`);
      }
    } else if (styleType === "boxShadow") {
      const val = boxShadowValue(t.value, baseVarMap, t.originalValue ?? t.value);
      if (val) decls.push(`box-shadow: ${val};`);
    } else if (typeof t.value === "object" && t.value) {
      for (const [k, v] of Object.entries(t.value)) {
        const prop = cssPropName(k);
        const ov = t.originalValue?.[k] ?? v;
        const val = containsRef(ov) ? valueWithRefs(ov, v, baseVarMap) : formatScalar(v);
        decls.push(`${prop}: ${val};`);
      }
    }

    if (decls.length) {
      blocks.push(emitRule(`${buildClassNamePrefix(styleType)}${classBase}`, decls));
    }
  }
  return blocks.join("");
}

// -------------------------------
// Main format
// -------------------------------
export default {
  name: FORMAT_ID,
  format: ({ dictionary }) => {
    // Attach meta
    const tokensMeta = dictionary.allTokens.map((t) => {
      const cls = classifyFromFilePath(t.filePath, t);
      const varName = normalizeVarNameFromPath(t.path);
      return {
        ...t,
        typeBucket: cls.type,            // avoid clashing with token "type"
        collection: cls.collection,
        set: cls.set,
        varName,
        originalValue: t.original?.value ?? t.value,
      };
    });

    // Sort for deterministic output
    tokensMeta.sort((a, b) => a.varName.localeCompare(b.varName));

    // Buckets
    const globals = tokensMeta.filter((t) => t.typeBucket === "global");
    const others = tokensMeta.filter((t) => t.typeBucket === "other");
    const modes = tokensMeta.filter((t) => t.typeBucket === "mode");
    const bps = tokensMeta.filter((t) => t.typeBucket === "breakpoint");
    const styles = tokensMeta.filter((t) => t.typeBucket === "styles");

    // Group helpers
    const groupBy = (arr, key) =>
      arr.reduce((m, t) => (m.get(t[key])?.push(t) || m.set(t[key], [t]), m), new Map());

    const otherByCollection = groupBy(others, "collection"); // Map<collection, tokens[]>, we’ll split to sets next
    for (const [col, arr] of otherByCollection) otherByCollection.set(col, groupBy(arr, "set")); // Map<set, tokens[]>

    const bpBySet = groupBy(bps, "set"); // Map<mobile|tablet|desktop|custom, tokens[]>
    const modeBySet = groupBy(modes, "set"); // Map<light|dark|..., tokens[]>

    // Base (fallbacks) = Global + defaults from each Other collection
    const defaultsFromOther = [];
    for (const [, setsMap] of otherByCollection) {
      let defKey = null;
      for (const s of setsMap.keys()) if (String(s).toLowerCase() === "default") defKey = s;
      if (defKey) defaultsFromOther.push(...setsMap.get(defKey));
    }
    const baseTokens = [...globals, ...defaultsFromOther];
    const baseVarMap = buildBaseVarMap(baseTokens);

    let out = "";

    // Base
    out += emitBlockComment("Base: Global + inline + defaults");
    out += emitRule(":root", emitVarDecls(baseTokens, baseVarMap));

    // Breakpoints: mobile (unwrapped), then tablet/desktop (@media), then custom
    if (bpBySet.size) {
      const mobile = bpBySet.get("mobile") || bpBySet.get("default") || [];
      if (mobile.length) {
        out += emitBlockComment("Breakpoint default — breakpoint/mobile");
        out += emitRule(":root", emitVarDecls(mobile, baseVarMap));
      }

      for (const key of ["tablet", "desktop"]) {
        const arr = bpBySet.get(key) || [];
        if (!arr.length) continue;
        const min = BP_MIN[key] ?? 0;
        out += emitBlockComment(`Breakpoint min-width ${min}px — breakpoint/${key}`);
        const decls = emitVarDecls(arr, baseVarMap);
        out += `@media (min-width: ${min}px) {\n${emitRule("  :root", decls).replace(/\n$/, "")}}\n\n`;
      }

      // custom sets not in known list
      const seen = new Set(["mobile", "default", "tablet", "desktop"]);
      const extras = [...bpBySet.keys()].filter((k) => !seen.has(String(k).toLowerCase()));
      extras.sort();
      for (const k of extras) {
        const arr = bpBySet.get(k) || [];
        if (!arr.length) continue;
        const min = BP_MIN[k] ?? 0;
        const label = min ? `min-width ${min}px` : "custom";
        out += emitBlockComment(`Breakpoint ${label} — breakpoint/${k}`);
        const decls = emitVarDecls(arr, baseVarMap);
        if (min) {
          out += `@media (min-width: ${min}px) {\n${emitRule("  :root", decls).replace(/\n$/, "")}}\n\n`;
        } else {
          out += emitRule(":root", decls);
        }
      }
    }

    // Other collections: default unwrapped, others as [data-collection="set"]
    for (const [collection, setsMap] of otherByCollection) {
      let defKey = null;
      for (const s of setsMap.keys()) if (String(s).toLowerCase() === "default") defKey = s;

      if (defKey) {
        out += emitBlockComment(`Other ${collection} — default`);
        out += emitRule(":root", emitVarDecls(setsMap.get(defKey), baseVarMap));
      }
      for (const [setName, arr] of setsMap) {
        if (setName === defKey) continue;
        out += emitBlockComment(`Other ${collection} — set ${setName}`);
        out += emitRule(`[data-${collection}="${setName}"]`, emitVarDecls(arr, baseVarMap));
      }
    }

    // Modes: light → dark → extras
    if (modeBySet.size) {
      const emitMode = (m) => {
        const arr = modeBySet.get(m);
        if (!arr || !arr.length) return;
        out += emitBlockComment(`Mode ${m} — mode/${m}`);
        out += emitRule(`[data-theme="${m}"]`, emitVarDecls(arr, baseVarMap));
      };
      emitMode("light");
      emitMode("dark");
      for (const [m] of modeBySet) if (m !== "light" && m !== "dark") emitMode(m);
    }

    // Styles → utility classes (typography, boxShadow, generic)
    if (styles.length) {
      out += emitBlockComment("Styles (utility classes)");
      out += emitStyles(styles, baseVarMap);
    }

    return out;
  },
};
