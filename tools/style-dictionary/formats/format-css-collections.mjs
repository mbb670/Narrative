// tools/style-dictionary/formats/format-css-collections.mjs
// Format id: "css/collections"
// Mirrors the browser converter’s behavior you pasted:
// - Base = Global (+ inline if provided via options.inlineTokens), NOT "Other" defaults
// - Order: Base → Breakpoint (mobile → tablet → desktop → custom) → Other (default unwrapped, others in [data-…]) → Mode (light @ :root, dark as [data-theme="dark"]) → Styles (typography / boxShadow / generic classes)
// - Refs become var(--path, fallback) with fallbacks resolved against Base ⊕ current set
// - Numbers: no unit by default (px only if options.numPx); optional fontSize→rem via options.fontRem/remBase
// - Private keys (_ or $) skipped

const FORMAT_ID = "css/collections";

// ---------- options / defaults ----------
function getOpts(options = {}) {
  return {
    // naming
    prefix: options.prefix || "",                 // e.g. "tw"
    selector: options.selector || ":root",
    case: options.case || "kebab",               // "kebab" | "snake" | "camel"
    joiner: options.joiner || "-",

    // value handling
    numPx: !!options.numPx,                      // number → "Npx"
    fontRem: !!options.fontRem,                  // fontSize only → rem
    remBase: Number(options.remBase ?? 16),
    excludePriv: options.excludePriv !== false,  // skip keys starting _ or $
    emitVarRefs: options.emitVarRefs !== false,  // if false + resolveRefs true → raw values only
    resolveRefs: !!options.resolveRefs,          // fully resolve {refs} to raw values
    emitFallback: options.emitFallback !== false,// var(--x, fallback)
    // collection behavior
    autoSort: options.autoSort !== false,
    attrManual: !!options.attrManual,            // duplicate breakpoint + other-default blocks as attrs
    // (optional) inline object to merge into Base (use sparingly, mainly for tests)
    inlineTokens: options.inlineTokens || null,
  };
}

// ---------- utilities ----------
const isPriv = (s) => /^[_$]/.test(s);
const toKebab = (s) =>
  String(s).replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[^a-z0-9\-]+/gi, "-").toLowerCase();

function toCase(parts, opt) {
  const j = opt.joiner;
  const norm = (p) => String(p).replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (opt.case === "snake") return parts.map((p) => norm(p).toLowerCase().replace(/\s+/g, "_")).join(j);
  if (opt.case === "camel")
    return parts
      .map((p, i) => {
        p = norm(p).toLowerCase();
        return i ? p.replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\s+/g, "") : p.replace(/\s+/g, "");
      })
      .join("");
  // kebab default
  return parts
    .map((p) => norm(p).toLowerCase().replace(/\s+/g, "-"))
    .join(j);
}

function varNameFromPath(path, opt) {
  const parts = (opt.prefix ? [opt.prefix, ...path] : path).map((p) => String(p));
  return `--${toCase(parts, opt)}`;
}

function cssPropName(name) {
  return String(name).replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}

function rgbaToHex8(str) {
  const m =
    /^\s*rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*(0|0?\.\d+|1(?:\.0+)?))?\s*\)\s*$/i.exec(
      str
    );
  if (!m) return null;
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp(+m[1]), g = clamp(+m[2]), b = clamp(+m[3]);
  const a = Math.max(0, Math.min(1, m[4] == null ? 1 : +m[4]));
  const h2 = (n) => n.toString(16).padStart(2, "0");
  return `#${h2(r)}${h2(g)}${h2(b)}${h2(Math.round(a * 255))}`;
}

function formatScalar(v) {
  if (typeof v === "string") return rgbaToHex8(v) || v;
  if (Array.isArray(v)) return v.map(formatScalar).join(" ");
  return String(v);
}

function withUnits(path, val, opt) {
  if (typeof val === "number") {
    const isFontSize = /(^|\.|\/)font(Size|size)$/.test(path.join("."));
    if (opt.fontRem && isFontSize) {
      const rem = val / (opt.remBase || 16);
      return String(+rem.toFixed(5)).replace(/\.0+$/, "");
    }
    return opt.numPx ? `${val}px` : String(val);
  }
  if (typeof val === "string") return formatScalar(val);
  if (Array.isArray(val)) return val.map((x) => withUnits(path, x, opt)).join(" ");
  return String(val);
}

const hasRef = (s) => typeof s === "string" && /\{[^}]+\}/.test(s);
const refRegex = /\{([^}]+)\}/g;

function replaceRefs(str, map, toVar, opt, itPath) {
  return String(str).replace(refRegex, (_, p) => {
    const key = p.trim().replace(/\s+/g, "");
    const parts = key.split(".");
    if (toVar) {
      const name = varNameFromPath(parts, opt);
      if (!opt.emitFallback) return `var(${name})`;
      const fb = resolveKeyFully(key, map, itPath, opt);
      return fb == null ? `var(${name})` : `var(${name}, ${fb})`;
    }
    // raw resolution
    const v = map[key];
    if (v == null) return `{${p}}`;
    return typeof v === "string" || typeof v === "number" ? v : `{${p}}`;
  });
}

function resolveFully(str, map) {
  let cur = String(str);
  for (let i = 0; i < 16; i++) {
    const next = replaceRefs(cur, map, false);
    if (next === cur || !/\{[^}]+\}/.test(next)) return next;
    cur = next;
  }
  return cur;
}

function resolveKeyFully(key, map, itPath, opt) {
  let v = map[key];
  const fin = (val) => {
    if (typeof val === "string" && /\{[^}]+\}/.test(val)) return null;
    if (typeof val === "string" || typeof val === "number") return withUnits(itPath, val, opt);
    return null;
  };
  if (v != null) {
    if (typeof v === "string") v = resolveFully(v, map);
    return fin(v);
  }
  const res = resolveFully(`{${key}}`, map);
  if (/\{[^}]+\}/.test(res)) return null;
  return withUnits(itPath, res, opt);
}

// ---------- path & grouping ----------
const TYPE_SYNS = {
  global: new Set(["global", "base"]),
  breakpoint: new Set(["break", "breaks", "breakpoint", "breakpoints", "bp", "bps"]),
  mode: new Set(["mode", "modes", "theme", "themes"]),
  styles: new Set(["style", "styles"]),
};

const BP_MIN = { mobile: null, tablet: 640, desktop: 1024 };

function afterTokensParts(filePath) {
  const parts = String(filePath || "").replace(/\\/g, "/").split("/");
  const i = parts.lastIndexOf("tokens");
  const rest = i >= 0 ? parts.slice(i + 1) : parts;
  // drop filename
  if (rest.length && /\.[a-z0-9]+$/i.test(rest[rest.length - 1])) rest.pop();
  return rest;
}

function classifyToken(t) {
  const parts = afterTokensParts(t.filePath);
  const top = (parts[0] || "").toLowerCase();
  let type = "other";
  if (TYPE_SYNS.global.has(top)) type = "global";
  else if (TYPE_SYNS.breakpoint.has(top)) type = "breakpoint";
  else if (TYPE_SYNS.mode.has(top)) type = "mode";
  else if (TYPE_SYNS.styles.has(top)) type = "styles";

  let collection = type === "other" ? (parts[0] || "other") : type;
  let set =
    type === "global"
      ? "global"
      : parts[1] || (type === "breakpoint" ? "mobile" : type === "mode" ? "light" : type === "styles" ? "styles" : "default");

  // normalize common names inside paths:
  if (type === "breakpoint") {
    const low = set.toLowerCase();
    if (/mobile/.test(low)) set = "mobile";
    else if (/tablet/.test(low)) set = "tablet";
    else if (/desktop/.test(low)) set = "desktop";
  }
  if (type === "mode") {
    const low = set.toLowerCase();
    if (/^default$/.test(low)) set = "light";
    else if (/dark/.test(low)) set = "dark";
    else if (/light/.test(low)) set = "light";
  }
  return { type, collection, set };
}

// ---------- maps from tokens ----------
function tokenKeyFromPath(path) {
  return path.join(".");
}

// Build a flat path→original-value map, honoring private-key filtering
function mapFromTokens(tokens, opt) {
  const m = {};
  for (const t of tokens) {
    if (t.path.some((p) => isPriv(String(p)))) continue;
    const k = tokenKeyFromPath(t.path);
    m[k] = t.original?.value ?? t.value;
  }
  return m;
}

// pick only leaf (non-object) values for CSS variables
function isLeafValue(v) {
  if (v == null) return true;
  if (Array.isArray(v)) return true;
  if (typeof v !== "object") return true;
  // In SD, a style token has object value; skip as var and handle in classes
  return false;
}

// ---------- emit pieces ----------
const comment = (txt) => `/* ${txt} */\n\n`;
function emitRule(selector, lines) {
  if (!lines.length) return "";
  return `${selector} {\n${lines.map((l) => `  ${l}`).join("\n")}\n}\n\n`;
}

function emitVarsForTokens(tokens, refMap, opt) {
  const lines = [];
  for (const t of tokens) {
    if (t.path.some((p) => isPriv(String(p))) || !isLeafValue(t.original?.value ?? t.value)) continue;
    const raw = t.original?.value ?? t.value;
    let out;
    if (typeof raw === "string" && hasRef(raw)) {
      if (opt.resolveRefs && !opt.emitVarRefs) {
        const res = resolveFully(raw, refMap);
        out = withUnits(t.path, res, opt);
      } else {
        const replaced = replaceRefs(raw, refMap, true, opt, t.path);
        out = replaced;
      }
    } else {
      out = withUnits(t.path, raw, opt);
    }
    lines.push(`${varNameFromPath(t.path, opt)}: ${out};`);
  }
  return lines;
}

// ---------- styles (classes) ----------
const TYPO_KEYS = new Set([
  "fontSize",
  "font-size",
  "fontWeight",
  "font-weight",
  "fontFamily",
  "font-family",
  "lineHeight",
  "line-height",
  "letterSpacing",
  "letter-spacing",
  "textTransform",
  "fontStretch",
]);

function tokenStyleType(t) {
  const o = t.original || {};
  const tv = o.type || o.$type || (o.value && (o.value.type || o.value.$type));
  const s = tv ? String(tv).toLowerCase() : null;
  if (s === "typography") return "typography";
  if (s === "boxshadow") return "boxShadow";
  // heuristic
  if (typeof o.value === "object" && o.value) {
    const v = o.value;
    if (Array.isArray(v)) {
      if (v.every((seg) => seg && typeof seg === "object" && ("x" in seg || "y" in seg || "blur" in seg || "color" in seg)))
        return "boxShadow";
    } else {
      const keys = Object.keys(v);
      if (keys.some((k) => TYPO_KEYS.has(k))) return "typography";
      if (["x", "y", "blur", "spread", "color"].some((k) => k in v)) return "boxShadow";
    }
  }
  return null;
}

function classNameFor(t, styleType, opt) {
  const pref = styleType === "typography" ? "text" : styleType === "boxShadow" ? "elevation" : "style";
  const pathKb = t.path.map(toKebab);
  // If the path already starts with the semantic (e.g., "text" or "elevation"), drop it to avoid ".text-text-..."
  let tail = pathKb;
  if (styleType === "typography" && tail[0] === "text") tail = tail.slice(1);
  if (styleType === "boxShadow" && tail[0] === "elevation") tail = tail.slice(1);
  const parts = [pref, ...tail];
  return `.${toCase(parts, opt)}`;
}

function asVarOrUnits(v, refMap, path, opt) {
  if (typeof v === "string" && hasRef(v)) return replaceRefs(v, refMap, true, opt, path);
  return withUnits(path, v, opt);
}

function boxShadowCss(val, refMap, path, opt, original) {
  const arr = Array.isArray(val) ? val : [val];
  const segs = [];
  for (let i = 0; i < arr.length; i++) {
    const seg = arr[i] || {};
    const orig = (Array.isArray(original) ? original[i] : original) || seg;
    const x = asVarOrUnits(seg.x ?? 0, refMap, [...path, "x"], opt);
    const y = asVarOrUnits(seg.y ?? 0, refMap, [...path, "y"], opt);
    const blur = asVarOrUnits(seg.blur ?? 0, refMap, [...path, "blur"], opt);
    const spread = asVarOrUnits(seg.spread ?? 0, refMap, [...path, "spread"], opt);
    const color = typeof orig.color === "string" && hasRef(orig.color)
      ? replaceRefs(orig.color, refMap, true, opt, [...path, "color"])
      : asVarOrUnits(seg.color ?? "currentColor", refMap, [...path, "color"], opt);
    const inset = seg.inset ? " inset" : "";
    segs.push(`${x} ${y} ${blur} ${spread} ${color}${inset}`);
  }
  return `box-shadow: ${segs.join(", ")};`;
}

function emitStyleBlocks(tokens, refMap, opt, labelPrefix = "Styles") {
  if (!tokens.length) return "";
  const bySet = new Map();
  for (const t of tokens) {
    const meta = classifyToken(t);
    const key = meta.set || "styles";
    (bySet.get(key) || bySet.set(key, []).get(key)).push(t);
  }
  let css = "";
  for (const [setName, arr] of bySet) {
    css += comment(`${labelPrefix}: styles/${setName}`);
    for (const t of arr) {
      const styleType = tokenStyleType(t);
      if (!styleType) continue;
      const cls = classNameFor(t, styleType, opt);
      const ov = t.original?.value ?? t.value;
      const rules = [];
      if (styleType === "typography" && typeof ov === "object") {
        for (const [k, v] of Object.entries(ov)) {
          rules.push(`${cssPropName(k)}: ${asVarOrUnits(v, refMap, [...t.path, k], opt)};`);
        }
      } else if (styleType === "boxShadow") {
        rules.push(boxShadowCss(ov, refMap, t.path, opt, ov));
      } else if (typeof ov === "object") {
        for (const [k, v] of Object.entries(ov)) {
          rules.push(`${cssPropName(k)}: ${asVarOrUnits(v, refMap, [...t.path, k], opt)};`);
        }
      }
      if (rules.length) css += `${cls} {\n  ${rules.join("\n  ")}\n}\n\n`;
    }
  }
  return css;
}

// ---------- main format ----------
export default {
  name: FORMAT_ID,
  format: ({ dictionary, options }) => {
    const opt = getOpts(options);

    // decorate tokens with collection metadata
    const tokens = dictionary.allTokens.map((t) => ({
      ...t,
      _meta: classifyToken(t),
    }));

    // split by type
    const globals = tokens.filter((t) => t._meta.type === "global");
    const breakpoints = tokens.filter((t) => t._meta.type === "breakpoint");
    const modes = tokens.filter((t) => t._meta.type === "mode");
    const others = tokens.filter((t) => t._meta.type === "other");
    const styles = tokens.filter((t) => t._meta.type === "styles");

    // Base: merge all "global" (optionally inline tokens)
    let baseTokens = globals.slice();
    if (opt.inlineTokens && typeof opt.inlineTokens === "object") {
      // allow injecting a synthetic "inline" pack; mimic SD token shape minimally
      const inject = [];
      const walk = (obj, path = []) => {
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          for (const k of Object.keys(obj)) walk(obj[k], [...path, k]);
        } else {
          inject.push({
            path,
            value: obj,
            original: { value: obj },
            filePath: "inline.json",
          });
        }
      };
      walk(opt.inlineTokens);
      baseTokens = baseTokens.concat(inject);
    }

    // Ref map for Base only
    const baseMap = mapFromTokens(baseTokens, opt);

    let out = "";
    // ---- Base
    out += comment("Base: Global + inline");
    out += emitRule(opt.selector, emitVarsForTokens(baseTokens, baseMap, opt));

    // helper: groupers
    const groupBy = (arr, keyFn) =>
      arr.reduce((m, t) => {
        const k = keyFn(t);
        (m.get(k) || m.set(k, []).get(k)).push(t);
        return m;
      }, new Map());

    // ---- Breakpoints
    if (breakpoints.length) {
      // group by set name
      const bpGroups = groupBy(breakpoints, (t) => t._meta.set || "mobile");
      // order
      const order = (name) => {
        const n = String(name).toLowerCase();
        if (n === "mobile" || n === "default") return 0;
        if (n === "tablet") return 1;
        if (n === "desktop") return 2;
        return 3;
      };
      const sets = [...bpGroups.keys()].sort((a, b) => order(a) - order(b) || String(a).localeCompare(String(b)));
      const manualQueues = [];

      for (const setName of sets) {
        const pack = bpGroups.get(setName);
        const mergedMap = { ...baseMap, ...mapFromTokens(pack, opt) };
        const lines = emitVarsForTokens(pack, mergedMap, opt);
        const low = String(setName).toLowerCase();
        if (low === "mobile" || low === "default") {
          out += comment(`Breakpoint default — breakpoint/${low === "default" ? "mobile" : "mobile"}`);
          out += emitRule(opt.selector, lines);
          if (opt.attrManual) {
            manualQueues.push(
              `${comment(`Breakpoint manual mobile — breakpoint/${setName}`)}[data-breakpoint="mobile"] {\n${lines
                .map((l) => `  ${l}`)
                .join("\n")}\n}\n\n`
            );
          }
        } else {
          const min = BP_MIN[low] ?? null;
          const minTxt = min == null ? "custom" : `min-width ${min}px`;
          out += comment(`Breakpoint ${minTxt} — breakpoint/${setName}`);
          const inside = emitRule(`  ${opt.selector}`, lines).replace(/\n$/, "");
          out += `@media (min-width: ${min ?? 0}px) {\n${inside}}\n\n`;
          if (opt.attrManual) {
            out += `${comment(`Breakpoint manual ${setName} — breakpoint/${setName}`)}[data-breakpoint="${toKebab(
              setName
            )}"] {\n${lines.map((l) => `  ${l}`).join("\n")}\n}\n\n`;
          }
        }
      }
      if (opt.attrManual && manualQueues.length) out += manualQueues.join("");
    }

    // ---- Other (collections)
    if (others.length) {
      // group: collection → set → tokens
      const byCollection = groupBy(others, (t) => t._meta.collection);
      for (const [collectionName, colArr] of byCollection) {
        const bySet = groupBy(colArr, (t) => t._meta.set || "default");
        // default first
        const sets = [...bySet.keys()].sort((a, b) => {
          const da = String(a).toLowerCase() === "default" ? -1 : 0;
          const db = String(b).toLowerCase() === "default" ? -1 : 0;
          if (da !== db) return da - db;
          return String(a).localeCompare(String(b));
        });

        for (const setName of sets) {
          const pack = bySet.get(setName);
          const mergedMap = { ...baseMap, ...mapFromTokens(pack, opt) };
          const lines = emitVarsForTokens(pack, mergedMap, opt);
          if (!lines.length) continue;
          const isDefault = String(setName).toLowerCase() === "default";
          if (isDefault) {
            out += comment(`Other ${collectionName} — default`);
            out += emitRule(opt.selector, lines);
            if (opt.attrManual) {
              out += `${comment(`Other manual default ${collectionName}=${setName} — ${collectionName}/${setName}`)}[data-${toKebab(
                collectionName
              )}="${toKebab(setName)}"] {\n${lines.map((l) => `  ${l}`).join("\n")}\n}\n\n`;
            }
          } else {
            out += comment(`Other ${collectionName} — set ${setName}`);
            out += emitRule(`[data-${toKebab(collectionName)}="${toKebab(setName)}"]`, lines);
          }
        }
      }
    }

    // ---- Modes
    if (modes.length) {
      const byMode = groupBy(modes, (t) => t._meta.set || "light");
      const emitMode = (name, isRootForLight) => {
        const pack = byMode.get(name);
        if (!pack || !pack.length) return;
        const mergedMap = { ...baseMap, ...mapFromTokens(pack, opt) };
        const lines = emitVarsForTokens(pack, mergedMap, opt);
        if (!lines.length) return;
        if (isRootForLight) {
          out += comment(`Mode light — mode/light`);
          out += emitRule(opt.selector, lines);
          if (opt.attrManual) {
            out += `${comment(`Mode light — mode/light (manual attr)`)}[data-theme="light"] {\n${lines
              .map((l) => `  ${l}`)
              .join("\n")}\n}\n\n`;
          }
        } else {
          out += comment(`Mode ${name} — mode/${name}`);
          out += emitRule(`[data-theme="${toKebab(name)}"]`, lines);
        }
      };
      emitMode("light", true);
      emitMode("dark", false);
      for (const key of byMode.keys()) {
        if (key !== "light" && key !== "dark") emitMode(key, false);
      }
    }

    // ---- Styles → classes
    if (styles.length) {
      // classes need Base ⊕ (style set) ref map so fallbacks resolve properly
      // Build one merged map that includes all styles on top of base
      const styleMap = { ...baseMap, ...mapFromTokens(styles, opt) };
      out += comment("Styles (utility classes)");
      out += emitStyleBlocks(styles, styleMap, opt);
    }

    return out;
  },
};
