/* scripts/format-css-collections.mjs
 * Custom Style Dictionary formatter that emits:
 *   1) Base (Global + Inline + Other defaults) to :root
 *   2) Breakpoints: mobile(root) → tablet/desktop/@media(min-width)
 *   3) Other collections: default(root) then [data-<collection>="<alias>"]
 *   4) Mode: [data-theme="light"], [data-theme="dark"]
 *   5) Styles: utility classes for type: typography | boxShadow | other
 *
 * It also:
 *  - infers collection types from both collection and set names (raw/breakpoint -> Breakpoint)
 *  - resolves {refs} for fallbacks using the Base map
 *  - skips private keys (_ or $), and style-type leaves when emitting vars
 */

import { fileURLToPath } from "url";
const kebab = s => String(s).replace(/[^a-zA-Z0-9]+/g," ").trim().toLowerCase().replace(/\s+/g,"-");
const snake = s => String(s).replace(/[^a-zA-Z0-9]+/g," ").trim().toLowerCase().replace(/\s+/g,"_");
const camel = (s, i) => {
  s = String(s).replace(/[^a-zA-Z0-9]+/g," ").trim().toLowerCase();
  return i ? s.replace(/\b\w/g, m => m.toUpperCase()).replace(/\s+/g,"") : s.replace(/\s+/g,"");
};
const toCSSProp = n => String(n).replace(/[A-Z]/g, m => "-" + m.toLowerCase());

function toCase(parts, { joiner="-", casing="kebab" }){
  const norm = p => String(p);
  if (casing==="kebab") return parts.map(p=>kebab(norm(p))).join(joiner);
  if (casing==="snake") return parts.map(p=>snake(norm(p))).join(joiner);
  if (casing==="camel") return parts.map((p,i)=>camel(norm(p), i)).join("");
  return parts.join(joiner);
}

function slug(s){ return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,""); }
function isPrivateKey(k){ return /^[_$]/.test(k); }
function isLeaf(node){
  if (node == null) return true;
  if (Array.isArray(node)) return true;
  if (typeof node !== "object") return true;
  const ks = Object.keys(node);
  if (ks.length === 0) return true;
  if ("value" in node && ks.length <= 3) return true; // typical token leaf
  return false;
}
const leafVal = v => (v && typeof v === "object" && "value" in v) ? v.value : v;

function flatten(obj, path=[], out=[], { excludePriv=true }={}){
  if (isLeaf(obj)){
    out.push({ path:[...path], value: leafVal(obj), node: obj });
    return out;
  }
  for (const k of Object.keys(obj)){
    if (excludePriv && isPrivateKey(k)) continue;
    flatten(obj[k], [...path, k], out, { excludePriv });
  }
  return out;
}

function buildMap(flat){
  const m = {};
  for (const it of flat) m[it.path.join(".")] = leafVal(it.value);
  return m;
}

function resolveRefsInString(str, map, { emitVarRefs=true, prefixParts=[], fmt, itPath }){
  return String(str).replace(/\{([^}]+)\}/g, (_, raw) => {
    const key = raw.trim().replace(/\s+/g,"");
    const parts = key.split(".");
    if (emitVarRefs){
      const full = ["--" + toCase([...prefixParts, ...parts], fmt)];
      return `var(${full})`;
    }
    if (key in map){
      const v = map[key];
      return (typeof v==="string" || typeof v==="number") ? v : `{${raw}}`;
    }
    return `{${raw}}`;
  });
}

function resolveFully(str, map){
  let cur = String(str), prev = "";
  for (let i=0;i<12;i++){
    prev = cur;
    cur = resolveRefsInString(cur, map, { emitVarRefs: false });
    if (cur === prev || !/\{[^}]+\}/.test(cur)) break;
  }
  return cur;
}

function withUnits(nameParts, val, opts){
  const asRem = opts.fontSizeRem && /(^|\.|\/)font(Size|size)$/.test(nameParts.join("."));
  if (typeof val === "number"){
    if (asRem){
      const rem = val / (opts.remBase || 16);
      return Number(rem.toFixed(5)).toString().replace(/\.0+$/,"");
    }
    return opts.numPx ? `${val}px` : String(val);
  }
  if (typeof val === "string") return val;
  if (Array.isArray(val)) return val.map(v => withUnits(nameParts, v, opts)).join(" ");
  return String(val);
}

function toVarWithFallback(parts, map, itPath, { prefixParts=[], fmt, emitFallback=false, unitOpts }){
  const name = `--${toCase([...prefixParts, ...parts], fmt)}`;
  let fb = null;
  if (emitFallback){
    const key = parts.join(".");
    let v = (key in map) ? map[key] : null;
    const finish = x => (typeof x==="string" || typeof x==="number") ? withUnits(itPath, x, unitOpts) : null;
    if (v != null){
      if (typeof v==="string"){
        if (/\{[^}]+\}/.test(v)) v = resolveFully(v, map);
        if (/\{[^}]+\}/.test(v)) fb = null;
        else fb = finish(v);
      }else{
        fb = finish(v);
      }
    }else{
      const res = resolveFully(`{${key}}`, map);
      if (!/\{[^}]+\}/.test(res)) fb = finish(res);
    }
  }
  return fb!=null ? `var(${name}, ${fb})` : `var(${name})`;
}

function replaceRefsWithVars(str, map, itPath, refOpts){
  return String(str).replace(/\{([^}]+)\}/g, (_, raw) => {
    const parts = raw.trim().replace(/\s+/g,"").split(".");
    return toVarWithFallback(parts, map, itPath, refOpts);
  });
}

/* ----- Collection typing & ordering ----- */

function inferType(name){
  const t = String(name||"").trim().toLowerCase();
  if (/^(global|base)$/.test(t)) return "global";
  if (/^(mode|modes|theme|themes)$/.test(t)) return "mode";
  if (/^(break|breaks|breakpoint|breakpoints|bp|bps)$/.test(t)) return "breakpoint";
  if (/^(style|styles)$/.test(t)) return "styles";
  return "other";
}
// When collections were named "raw", look at set name too.
function inferTypeFromBoth(collectionName, setName){
  const c = inferType(collectionName);
  if (c !== "other") return c;
  const s = inferType(setName);
  return s === "other" ? "other" : s;
}

function bpMinFromName(name){
  const n = String(name||"").toLowerCase();
  if (/mobile/.test(n)) return null;        // default/root
  if (/tablet/.test(n)) return 640;
  if (/desktop/.test(n)) return 1024;
  return undefined; // custom: caller may supply min
}

function sortTypeOrder(t){
  return t==="global" ? 0
       : t==="breakpoint" ? 1
       : t==="other" ? 2
       : t==="mode" ? 3
       : t==="styles" ? 4
       : 5;
}

const modeRank = s => {
  const m = (s.mode && s.mode!=="auto") ? s.mode
          : (/dark/i.test(s.name) ? "dark" : (/light/i.test(s.name) ? "light" : "light"));
  return m==="light" ? 0 : (m==="dark" ? 1 : 2);
};

function sortSetsFor(g){
  if (g.type === "mode") return g.sets.slice().sort((a,b)=>modeRank(a)-modeRank(b));
  if (g.type === "breakpoint"){
    return g.sets.slice().sort((a,b)=>{
      const av = a.min ?? bpMinFromName(a.name);
      const bv = b.min ?? bpMinFromName(b.name);
      if (av == null && bv == null) return 0;
      if (av == null) return -1;    // mobile first
      if (bv == null) return 1;
      return av - bv;               // ascending min
    });
  }
  if (g.type === "other" && g.defaultSetId){
    const d = g.defaultSetId;
    const def = g.sets.find(x=>x.id===d);
    const rest = g.sets.filter(x=>x.id!==d);
    return def ? [def, ...rest] : g.sets.slice();
  }
  return g.sets.slice();
}

/* ----- Merge helpers ----- */
function deepMerge(a,b){
  const isObj = x => x && typeof x === "object" && !Array.isArray(x);
  if (isLeaf(a) || isLeaf(b)) return JSON.parse(JSON.stringify(b));
  if (isObj(a) && isObj(b)){
    const o = JSON.parse(JSON.stringify(a));
    for (const k of Object.keys(b)){
      o[k] = k in o ? deepMerge(o[k], b[k]) : JSON.parse(JSON.stringify(b[k]));
    }
    return o;
  }
  return JSON.parse(JSON.stringify(b));
}

/* ----- Emitters ----- */

function cssComment(txt){ return `/* ${txt} */`; }

function varsFromTokens(obj, refMap, options){
  const flat = [];
  flatten(obj, [], flat, { excludePriv: options.excludePriv });
  const css = [];
  for (const it of flat){
    const raw = leafVal(it.value);
    // Skip style bundles (objects or arrays) when emitting variables
    if (typeof raw === "object") continue;

    let vOut;
    if (typeof raw === "string" && /\{[^}]+\}/.test(raw)){
      if (options.resolveRefs){
        const res = resolveFully(raw, refMap);
        vOut = withUnits(it.path, res, options.unitOpts);
      } else {
        vOut = replaceRefsWithVars(
          raw,
          refMap,
          it.path,
          {
            prefixParts: options.prefixParts,
            fmt: options.fmt,
            emitFallback: options.emitFallback,
            unitOpts: options.unitOpts
          }
        );
      }
    } else {
      vOut = withUnits(it.path, raw, options.unitOpts);
    }

    const nameParts = [...options.prefixParts, ...it.path];
    css.push(`  --${toCase(nameParts, options.fmt)}: ${vOut};`);
  }
  return css;
}

function boxShadowToCss(val, refMap, options){
  const arr = Array.isArray(val) ? val : [val];
  const segs = [];
  for (const o of arr){
    if (!o || typeof o !== "object") continue;
    const asCss = (k) => {
      const v = o[k];
      if (typeof v === "string" && /\{[^}]+\}/.test(v)){
        return replaceRefsWithVars(v, refMap, ["boxShadow", k], {
          prefixParts: options.prefixParts,
          fmt: options.fmt,
          emitFallback: options.emitFallback,
          unitOpts: options.unitOpts
        });
      }
      return withUnits(["boxShadow", k], v ?? 0, options.unitOpts);
    };
    const p = [];
    if ("inset" in o && o.inset) p.push("inset");
    p.push(asCss("x") || "0", asCss("y") || "0", asCss("blur") || "0", asCss("spread") || "0");
    let color = o.color;
    if (typeof color === "string" && /\{[^}]+\}/.test(color)){
      color = replaceRefsWithVars(color, refMap, ["boxShadow","color"], {
        prefixParts: options.prefixParts,
        fmt: options.fmt,
        emitFallback: options.emitFallback,
        unitOpts: options.unitOpts
      });
    }
    p.push(color || "currentColor");
    segs.push(p.join(" "));
  }
  return `  box-shadow: ${segs.join(", ")};`;
}

function classesFromTokens(obj, refMap, options){
  const flat = [];
  flatten(obj, [], flat, { excludePriv: options.excludePriv });
  const blocks = [];

  for (const it of flat){
    const node = it.node || {};
    const val = it.value;
    if (!(node && typeof val === "object" && node.type)) continue;

    const t = String(node.type).toLowerCase();
    const props = [];

    if (t === "typography"){
      for (const k of Object.keys(val)){
        let v = val[k];
        if (typeof v === "string" && /\{[^}]+\}/.test(v)){
          v = replaceRefsWithVars(v, refMap, [...it.path, k], {
            prefixParts: options.prefixParts,
            fmt: options.fmt,
            emitFallback: options.emitFallback,
            unitOpts: options.unitOpts
          });
        } else {
          v = withUnits([...it.path, k], v, options.unitOpts);
        }
        props.push(`  ${toCSSProp(k)}: ${v};`);
      }
    } else if (t === "boxshadow"){
      props.push(boxShadowToCss(val, refMap, options));
    } else {
      for (const k of Object.keys(val)){
        let v = val[k];
        if (typeof v === "string" && /\{[^}]+\}/.test(v)){
          v = replaceRefsWithVars(v, refMap, [...it.path, k], {
            prefixParts: options.prefixParts,
            fmt: options.fmt,
            emitFallback: options.emitFallback,
            unitOpts: options.unitOpts
          });
        } else {
          v = withUnits([...it.path, k], v, options.unitOpts);
        }
        props.push(`  ${toCSSProp(k)}: ${v};`);
      }
    }

    const prefix = t === "typography" ? "text" : (t === "boxshadow" ? "elevation" : "style");
    const cls = "." + toCase([prefix, ...it.path], options.fmt);
    blocks.push(`${cls} {\n${props.join("\n")}\n}`);
  }

  return blocks;
}

/* ----- Main formatter ----- */

export default function ({ dictionary, platform, options={} }){
  // Platform options we support
  const {
    // casing / naming
    prefix = "",
    selector = ":root",
    case: casing = "kebab",
    joiner = "-",
    // numbers/units
    numPx = false,
    fontRem = false,
    remBase = 16,
    // refs
    emitVarRefs = true,       // we always emit var(); resolveRefs only used to produce raw fallback if requested
    resolveRefs = false,
    emitFallback = true,
    // hygiene
    excludePriv = true,
    // auto ordering + manual attributes
    autoSort = true,
    attrManual = false,
    // collections payload (required for correct grouping)
    collections = [],
    // inline tokens (optional) to merge on top of Global for Base + fallback resolution
    inline = null
  } = options;

  const fmt = { casing, joiner };
  const prefixParts = prefix ? [prefix] : [];
  const unitOpts = { numPx, fontSizeRem: fontRem, remBase };

  /** Build groups with inferred types */
  const groups = (collections || []).map(g => {
    const type = inferType(g.name);
    const sets = (g.sets || []).map(s => {
      const t = inferTypeFromBoth(g.name, s.name);
      return {
        ...s,
        _type: t,
        // allow "min" (number) on set to override default BP thresholds
        min: (t === "breakpoint" && Number.isFinite(s.min)) ? Number(s.min) : (t==="breakpoint" ? (bpMinFromName(s.name) ?? undefined) : undefined),
      };
    });

    // mark default set for "other" when named "default" (case-insensitive) or provided by config
    let defaultSetId = g.defaultSetId;
    if (!defaultSetId && type === "other"){
      const def = sets.find(s => /^default$/i.test(s.name));
      if (def) defaultSetId = def.id || def.name;
    }

    // If the collection itself was "other" but every set inferred to a specific typed group,
    // split them virtually by type to preserve desired ordering.
    return { id: g.id || g.name, name: g.name, type, sets, defaultSetId, active: g.active !== false };
  });

  // Split & normalize into typed buckets
  const typed = [];
  for (const g of groups){
    // Partition per set-inferred type so "raw" with sets {breakpoint, colorTheme, mode, styles}
    // become separate virtual groups
    const by = new Map();
    for (const s of (g.sets || [])){
      const t = s._type || g.type || "other";
      if (!by.has(t)) by.set(t, []);
      by.get(t).push(s);
    }
    for (const [t, sets] of by.entries()){
      typed.push({
        id: `${g.id}:${t}`,
        name: g.name,
        type: t,
        active: g.active !== false,
        sets,
        defaultSetId: t==="other" ? g.defaultSetId : undefined
      });
    }
  }

  // Build Base: Global + Inline + each active Other collection's default set (for fallbacks and base block)
  const active = typed.filter(g => g.active !== false);
  const globals = active.filter(g => g.type==="global");
  let base = {};
  for (const g of globals){
    for (const s of sortSetsFor(g)){
      if (s.active === false) continue;
      base = deepMerge(base, s.data || {});
    }
  }
  if (inline && typeof inline === "object"){
    base = deepMerge(base, inline);
  }
  // Add Other defaults into Base
  const otherDefaults = [];
  for (const g of active.filter(x=>x.type==="other")){
    const sets = sortSetsFor(g);
    const def = g.defaultSetId
      ? sets.find(s => (s.id || s.name) === g.defaultSetId)
      : sets.find(s => /^default$/i.test(s.name));
    if (def && def.active !== false){
      base = deepMerge(base, def.data || {});
      otherDefaults.push({ g, def });
    }
  }

  // Reference map built from Base (so fallbacks reflect final cascaded values)
  const baseFlat = flatten(base, [], [], { excludePriv });
  const baseMap = buildMap(baseFlat);

  const emitOpts = {
    prefixParts, fmt, unitOpts,
    resolveRefs, emitFallback,
    excludePriv
  };

  const out = [];

  // 1) Base
  out.push(cssComment("Base: Global + inline + defaults"));
  const baseLines = varsFromTokens(base, baseMap, emitOpts);
  out.push(`${selector} {\n${baseLines.join("\n")}\n}`);

  // Helper to emit a set’s variables with an optional wrapper
  const emitSet = (label, wrapper, objLines) => {
    if (!objLines.length) return;
    if (!wrapper) {
      out.push(`${cssComment(label)}\n${selector} {\n${objLines.join("\n")}\n}`);
    } else if (/^@media/.test(wrapper)) {
      out.push(`${cssComment(label)}\n${wrapper} {\n  ${selector} {\n${objLines.map(l=>"  "+l).join("\n")}\n  }\n}`);
    } else {
      out.push(`${cssComment(label)}\n${wrapper} {\n${objLines.join("\n")}\n}`);
    }
  };

  // Ordered emission
  const typeSeq = ["breakpoint", "other", "mode", "styles"];

  // 2) Breakpoints
  for (const g of active.filter(x=>x.type==="breakpoint").sort((a,b)=>sortTypeOrder(a.type)-sortTypeOrder(b.type))){
    const sets = sortSetsFor(g);
    for (const s of sets){
      if (s.active === false) continue;
      const mergedRef = buildMap(flatten(deepMerge(base, s.data || {}), [], [], { excludePriv }));
      const lines = varsFromTokens(s.data || {}, mergedRef, emitOpts);
      const min = s.min;
      if (min == null){
        emitSet(`Breakpoint default — ${g.name}/${s.name}`, "", lines);
      } else {
        emitSet(`Breakpoint min-width ${min}px — ${g.name}/${s.name}`, `@media (min-width: ${min}px)`, lines);
      }
    }
    // Manual duplicates for breakpoints, if requested (after standard media blocks)
    if (attrManual){
      for (const s of sets){
        if (s.active === false) continue;
        const mergedRef = buildMap(flatten(deepMerge(base, s.data || {}), [], [], { excludePriv }));
        const lines = varsFromTokens(s.data || {}, mergedRef, emitOpts);
        const label = slug(s.name) || "mobile";
        emitSet(`Breakpoint manual ${label} — ${g.name}/${s.name}`, `[data-breakpoint="${label}"]`, lines);
      }
    }
  }

  // 3) Other collections
  for (const g of active.filter(x=>x.type==="other")){
    const sets = sortSetsFor(g);
    for (const s of sets){
      if (s.active === false) continue;
      const mergedRef = buildMap(flatten(deepMerge(base, s.data || {}), [], [], { excludePriv }));
      const lines = varsFromTokens(s.data || {}, mergedRef, emitOpts);
      const isDefault = g.defaultSetId
        ? ((s.id || s.name) === g.defaultSetId)
        : /^default$/i.test(s.name);
      const alias = (s.alias && s.alias.trim()) || s.name;
      const label = `Other ${g.name} — ${isDefault ? "default" : `set ${alias}`}`;
      const wrap = isDefault ? "" : `[data-${kebab(g.name)}="${kebab(alias)}"]`;
      emitSet(label, wrap, lines);

      if (attrManual && isDefault){
        emitSet(`Other manual default ${g.name}=${alias} — ${g.name}/${s.name}`,
          `[data-${kebab(g.name)}="${kebab(alias)}"]`,
          lines
        );
      }
    }
  }

  // 4) Mode
  for (const g of active.filter(x=>x.type==="mode")){
    const sets = sortSetsFor(g);
    for (const s of sets){
      if (s.active === false) continue;
      const mergedRef = buildMap(flatten(deepMerge(base, s.data || {}), [], [], { excludePriv }));
      const lines = varsFromTokens(s.data || {}, mergedRef, emitOpts);
      const rank = modeRank(s);
      const mode = rank===1 ? "dark" : "light";
      const wrap = `[data-theme="${mode}"]`;
      const label = `Mode ${mode} — ${g.name}/${s.name}`;
      emitSet(label, wrap, lines);
    }
  }

  // 5) Styles (utility classes)
  for (const g of active.filter(x=>x.type==="styles")){
    const sets = sortSetsFor(g);
    for (const s of sets){
      if (s.active === false) continue;
      const mergedRef = buildMap(flatten(deepMerge(base, s.data || {}), [], [], { excludePriv }));
      const blocks = classesFromTokens(s.data || {}, mergedRef, emitOpts);
      if (!blocks.length) continue;
      out.push(`${cssComment(`Styles: ${g.name}/${s.name}`)}\n${blocks.join("\n\n")}`);
    }
  }

  return out.join("\n\n");
}

/* Example platform config:
  "css:collections": {
    "buildPath": "dist/",
    "files": [{
      "destination": "tokens.css",
      "format": "./scripts/format-css-collections.mjs",
      "options": {
        "prefix": "",
        "selector": ":root",
        "case": "kebab",
        "joiner": "-",
        "numPx": true,
        "fontRem": false,
        "remBase": 16,
        "emitFallback": true,
        "excludePriv": true,
        "autoSort": true,
        "attrManual": false,
        // IMPORTANT: pass the pre-grouped collections (name, sets) the way your loader prepares them:
        // Each set: { id, name, data, active?, alias?, mode?, min? } ; collection: { name, sets, active?, defaultSetId? }
        "collections": "<injected by your build>",
        // Optionally merge inline JSON on top of Global before computing fallbacks:
        "inline": "<injected map or null>"
      }
    }]
  }
*/
