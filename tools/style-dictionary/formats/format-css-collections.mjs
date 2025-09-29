// tools/style-dictionary/formats/format-css-collections.mjs
// Custom Style Dictionary format: "css/collections"
// Implements folder-based collections and the output structure described by the user's converter spec.

const FORMAT_ID = "css/collections";

// -------------------------------
// Config & naming helpers
// -------------------------------

const JOINER = "-";

// synonyms for folder typing
const TYPE_SYNONYMS = {
  global: new Set(["global", "base"]),
  breakpoint: new Set(["break", "breakpoint", "breakpoints", "bp", "bps"]),
  mode: new Set(["mode", "modes", "theme", "themes"]),
  styles: new Set(["styles", "style"]),
};

// canonical order for top-level output groups
const OUTPUT_ORDER = ["base", "breakpoint", "other", "mode", "styles"];

// default breakpoint order and min-widths
const BP_ORDER = ["mobile", "tablet", "desktop"];
const BP_MIN = { mobile: 0, tablet: 640, desktop: 1024 };

// leaf name canon (variables only)
const CANON_LEAF = new Map([
  ["font-family", "fontfamily"],
  ["font-weight", "fontweight"],
  ["font-size", "fontsize"],
  ["line-height", "lineheight"],
  ["letter-spacing", "letterspacing"],
]);

const isPriv = (s) => /^[_$]/.test(s);

// Convert "camelCase" or "PascalCase" → "kebab-case"
function kebab(x) {
  return String(x)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

function canonLeaf(seg) {
  const keb = kebab(seg);
  return CANON_LEAF.get(keb) || keb;
}

function normalizeVarNameFromPath(path) {
  const parts = path.map((p) => kebab(p));
  if (parts.length) {
    parts[parts.length - 1] = canonLeaf(parts[parts.length - 1]);
  }
  return `--${parts.join(JOINER)}`;
}

function cssPropName(key) {
  // CSS property names stay kebab (no leaf canon for properties)
  return kebab(key);
}

// Parse rgba( r, g, b, a ) → #RRGGBBAA (as in your expected CSS)
function rgbaToHex8(str) {
  const m =
    /^\s*rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*(0|0?\.\d+|1(?:\.0+)?))?\s*\)\s*$/i.exec(
      str
    );
  if (!m) return null;
  const r = Math.max(0, Math.min(255, parseInt(m[1], 10)));
  const g = Math.max(0, Math.min(255, parseInt(m[2], 10)));
  const b = Math.max(0, Math.min(255, parseInt(m[3], 10)));
  const aRaw = m[4] == null ? 1 : parseFloat(m[4]);
  const a = Math.max(0, Math.min(1, aRaw));
  const toHex2 = (n) => n.toString(16).padStart(2, "0");
  const alpha = toHex2(Math.round(a * 255));
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}${alpha}`;
}

function formatScalar(value) {
  if (typeof value === "string") {
    const hex8 = rgbaToHex8(value);
    if (hex8) return hex8;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => formatScalar(v)).join(" ");
  }
  // numbers, booleans, others stringify
  return String(value);
}

function containsRef(val) {
  return typeof val === "string" && /\{[^}]+\}/.test(val);
}

function refParts(val) {
  // returns array of {raw, pathStr}
  const out = [];
  if (typeof val !== "string") return out;
  const re = /\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(val))) out.push({ raw: m[0], pathStr: m[1] });
  return out;
}

function pathStrToVarName(pathStr) {
  const segs = pathStr.split(".");
  return normalizeVarNameFromPath(segs);
}

// -------------------------------
// Repo path → collection typing
// -------------------------------

function findAfterTokensParts(filePath) {
  // normalize and split
  const parts = String(filePath).replace(/\\/g, "/").split("/");
  const idx = parts.lastIndexOf("tokens");
  if (idx === -1) return [];
  // skip well-known middle directories like raw/docs/resolved
  const out = [];
  for (let i = idx + 1; i < parts.length; i++) {
    const p = parts[i];
    if (!p || /\.json$/i.test(p)) continue; // skip filename
    if (["raw", "docs", "resolved"].includes(p)) continue;
    out.push(p);
  }
  return out;
}

function classifyFromFilePath(filePath) {
  const parts = findAfterTokensParts(filePath);
  // parts[0] is the collection folder name (or other collection id)
  const folder = parts[0] || "global";
  const lower = folder.toLowerCase();
  let type = "other";
  if (TYPE_SYNONYMS.global.has(lower)) type = "global";
  else if (TYPE_SYNONYMS.breakpoint.has(lower)) type = "breakpoint";
  else if (TYPE_SYNONYMS.mode.has(lower)) type = "mode";
  else if (TYPE_SYNONYMS.styles.has(lower)) type = "styles";

  // collection name: for "other" we keep the actual folder (e.g., colorTheme, fontTheme)
  const collection = type === "other" ? folder : type;

  // setName: usually the next folder level; fallback to "default"
  // for global there is no set
  let setName = parts[1] || "default";
  if (type === "global") setName = null;

  return { type, collection, set: setName };
}

// -------------------------------
// Value formatting with var() + fallback
// -------------------------------

// Build a quick map of base variables for fallbacks (Global + Inline + Other defaults)
function buildBaseVarMap(tokensMeta) {
  const base = new Map();
  for (const t of tokensMeta) {
    if (t.type === "global" || (t.type === "other" && t.set && t.set.toLowerCase() === "default")) {
      base.set(t.varName, formatScalar(t.value));
    }
  }
  return base;
}

function valueWithRefs(originalValue, resolvedValue, baseVarMap) {
  // If original had refs, replace each {path} with var(--path, fallback)
  if (!containsRef(originalValue)) {
    return formatScalar(resolvedValue);
  }
  let out = String(originalValue);
  for (const rp of refParts(originalValue)) {
    const refVar = pathStrToVarName(rp.pathStr);
    const fb = baseVarMap.get(refVar);
    const fallback = fb ? `, ${fb}` : "";
    out = out.replace(rp.raw, `var(${refVar}${fallback})`);
  }
  // If the whole value was a single ref, out is already "var(...)".
  // For composite (e.g., "0 0 {color.xxx}"), leave replacements inline.
  return out;
}

// -------------------------------
// Emit helpers
// -------------------------------

function emitBlockComment(title) {
  return `/* ${title} */\n\n`;
}

function emitRule(selector, decls) {
  if (!decls.length) return "";
  return `${selector} {\n${decls.map((d) => `  ${d}`).join("\n")}\n}\n\n`;
}

function emitVarDecls(tokens, baseVarMap) {
  const decls = [];
  for (const t of tokens) {
    // guard private path segments
    if (t.path.some(isPriv)) continue;
    const v = valueWithRefs(t.originalValue, t.value, baseVarMap);
    decls.push(`${t.varName}: ${v};`);
  }
  return decls;
}

function compareByVarName(a, b) {
  return a.varName.localeCompare(b.varName);
}

// -------------------------------
/**
 * The format function
 */
// -------------------------------
export default {
  name: FORMAT_ID,
  format: ({ dictionary /*, file, options, platform */ }) => {
    // 1) Flatten tokens and attach meta we need (type/collection/set, varName, etc.)
    const tokensMeta = dictionary.allTokens.map((t) => {
      const cls = classifyFromFilePath(t.filePath || "");
      const varName = normalizeVarNameFromPath(t.path);
      return {
        ...t,
        type: cls.type,
        collection: cls.collection,
        set: cls.set,
        varName,
        originalValue: t.original?.value ?? t.value,
      };
    });

    // Stable sort by varName so output is deterministic
    tokensMeta.sort(compareByVarName);

    // 2) Prepare groups
    const globalTokens = tokensMeta.filter((t) => t.type === "global");
    const bpTokens = tokensMeta.filter((t) => t.type === "breakpoint");
    const modeTokens = tokensMeta.filter((t) => t.type === "mode");
    const styleTokens = tokensMeta.filter((t) => t.type === "styles");
    const otherTokens = tokensMeta.filter((t) => t.type === "other");

    // "other" grouped by collection & set (detect default)
    const otherByCollection = new Map();
    for (const t of otherTokens) {
      const col = t.collection;
      if (!otherByCollection.has(col)) otherByCollection.set(col, new Map());
      const setName = t.set || "default";
      if (!otherByCollection.get(col).has(setName)) otherByCollection.get(col).set(setName, []);
      otherByCollection.get(col).get(setName).push(t);
    }

    // Breakpoints grouped by set
    const bpBySet = new Map();
    for (const t of bpTokens) {
      const s = (t.set || "mobile").toLowerCase();
      if (!bpBySet.has(s)) bpBySet.set(s, []);
      bpBySet.get(s).push(t);
    }

    // Mode grouped by set (light/dark)
    const modeBySet = new Map();
    for (const t of modeTokens) {
      const s = t.set || "light";
      if (!modeBySet.has(s)) modeBySet.set(s, []);
      modeBySet.get(s).push(t);
    }

    // 3) Base map for fallbacks: Global + defaults of every Other collection
    const defaultsFromOther = [];
    for (const [col, setsMap] of otherByCollection) {
      // find default (case-insensitive)
      let defKey = null;
      for (const s of setsMap.keys()) {
        if (String(s).toLowerCase() === "default") {
          defKey = s;
          break;
        }
      }
      if (defKey) defaultsFromOther.push(...setsMap.get(defKey));
    }
    const baseTokensForFallback = [...globalTokens, ...defaultsFromOther];
    const baseVarMap = buildBaseVarMap(baseTokensForFallback);

    // 4) Start emitting
    let out = "";

    // ---- Base block: Global + Inline (if any) + Other defaults
    out += emitBlockComment("Base: Global + inline + defaults");
    const baseDecls = emitVarDecls(baseTokensForFallback, baseVarMap);
    out += emitRule(":root", baseDecls);

    // ---- Breakpoints
    // mobile (default) unwrapped, then tablet/desktop (min-width), plus any custom sets sorted by width/name
    if (bpBySet.size) {
      // Default/mobile
      const mobileSet = bpBySet.get("mobile") || [];
      if (mobileSet.length) {
        out += emitBlockComment("Breakpoint default — breakpoint/mobile");
        const decls = emitVarDecls(mobileSet, baseVarMap);
        out += emitRule(":root", decls);
      }

      // tablet/desktop in defined order
      for (const key of BP_ORDER.slice(1)) {
        const arr = bpBySet.get(key) || [];
        if (!arr.length) continue;
        const min = BP_MIN[key] ?? 0;
        out += emitBlockComment(`Breakpoint min-width ${min}px — breakpoint/${key}`);
        const decls = emitVarDecls(arr, baseVarMap);
        out += `@media (min-width: ${min}px) {\n${emitRule("  :root", decls).replace(/\n$/, "")}}\n\n`;
      }

      // any custom sets not in BP_ORDER (sorted by name)
      const seen = new Set(BP_ORDER);
      const extras = [...bpBySet.keys()].filter((k) => !seen.has(k));
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

    // ---- Other collections
    for (const [collection, setsMap] of otherByCollection) {
      // Default first (unwrapped)
      let defKey = null;
      for (const s of setsMap.keys()) {
        if (String(s).toLowerCase() === "default") {
          defKey = s;
          break;
        }
      }
      if (defKey) {
        out += emitBlockComment(`Other ${collection} — default`);
        const decls = emitVarDecls(setsMap.get(defKey), baseVarMap);
        out += emitRule(":root", decls);
      }

      // Then the rest as [data-collection="set"]
      for (const [setName, arr] of setsMap) {
        if (setName === defKey) continue;
        out += emitBlockComment(`Other ${collection} — set ${setName}`);
        const decls = emitVarDecls(arr, baseVarMap);
        out += emitRule(`[data-${collection}="${setName}"]`, decls);
      }
    }

    // ---- Modes (themes)
    if (modeBySet.size) {
      // Emit in light → dark order, then any extras
      const primaryOrder = ["light", "dark"];
      const done = new Set();
      for (const m of primaryOrder) {
        const arr = modeBySet.get(m);
        if (!arr || !arr.length) continue;
        done.add(m);
        out += emitBlockComment(`Mode ${m} — mode/${m}`);
        const decls = emitVarDecls(arr, baseVarMap);
        out += emitRule(`[data-theme="${m}"]`, decls);
      }
      // extras
      for (const [m, arr] of modeBySet) {
        if (done.has(m)) continue;
        out += emitBlockComment(`Mode ${m} — mode/${m}`);
        const decls = emitVarDecls(arr, baseVarMap);
        out += emitRule(`[data-theme="${m}"]`, decls);
      }
    }

    // ---- Styles → utility classes
    if (styleTokens.length) {
      // Group by path to build classes from object-like tokens
      // We expect tokens with "type" (typography, boxShadow, etc.). We’ll read t.type if present;
      // otherwise fall back to token.attributes?.category/type if available.
      const classes = [];
      for (const t of styleTokens) {
        const styleType =
          t.type ||
          t.attributes?.type ||
          t.attributes?.category ||
          "style";

        // Class name from token path (without any "styles" folder in the path)
        const pathNoPriv = t.path.filter((p) => !isPriv(p));
        const pathParts = pathNoPriv.slice(); // copy
        // If first segment is literally "styles", drop it for class naming
        if (pathParts[0] && kebab(pathParts[0]) === "styles") pathParts.shift();

        const classBase = pathParts.map((p) => kebab(p)).join(JOINER);

        if (styleType === "typography" && typeof t.value === "object" && t.value) {
          const decls = [];
          for (const [k, v] of Object.entries(t.value)) {
            const prop = cssPropName(k);
            const val = containsRef(t.originalValue?.[k])
              ? valueWithRefs(t.originalValue[k], v, baseVarMap)
              : formatScalar(v);
            decls.push(`${prop}: ${val};`);
          }
          if (decls.length) {
            classes.push({
              selector: `.text-${classBase}`,
              decls,
            });
          }
          continue;
        }

        if (styleType === "boxShadow") {
          // value can be object or array of shadows
          const toSeg = (seg) => {
            if (typeof seg !== "object" || !seg) return null;
            const x = formatScalar(seg.x ?? 0);
            const y = formatScalar(seg.y ?? 0);
            const blur = formatScalar(seg.blur ?? 0);
            const spread = formatScalar(seg.spread ?? 0);
            const color = containsRef(seg.color)
              ? valueWithRefs(seg.color, seg.color, baseVarMap)
              : formatScalar(seg.color ?? "transparent");
            const inset = seg.inset ? " inset" : "";
            return `${x} ${y} ${blur} ${spread} ${color}${inset}`;
          };
          const val = Array.isArray(t.value)
            ? t.value.map(toSeg).filter(Boolean).join(", ")
            : toSeg(t.value);
          if (val) {
            classes.push({
              selector: `.elevation-${classBase}`,
              decls: [`box-shadow: ${val};`],
            });
          }
          continue;
        }

        // generic "style" object → .style-*
        if (typeof t.value === "object" && t.value) {
          const decls = [];
          for (const [k, v] of Object.entries(t.value)) {
            const prop = cssPropName(k);
            const val = containsRef(t.originalValue?.[k])
              ? valueWithRefs(t.originalValue[k], v, baseVarMap)
              : formatScalar(v);
            decls.push(`${prop}: ${val};`);
          }
          if (decls.length) {
            classes.push({
              selector: `.style-${classBase}`,
              decls,
            });
          }
        }
      }

      if (classes.length) {
        out += emitBlockComment("Styles (utility classes)");
        for (const cls of classes) {
          out += emitRule(cls.selector, cls.decls);
        }
      }
    }

    return out;
  },
};
