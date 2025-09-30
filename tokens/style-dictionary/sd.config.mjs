import StyleDictionary from "style-dictionary";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.cwd();
const RAW_DIR = path.join(REPO_ROOT, "tokens", "raw");

// ---- naming helpers ----
const COLLAPSE = new Map([
  ["fontSize", "fontsize"],
  ["fontFamily", "fontfamily"],
  ["lineHeight", "lineheight"],
  ["letterSpacing", "letterspacing"],
  ["fontStretch", "fontstretch"]
]);
const seg = (s) => COLLAPSE.get(s) ?? String(s).toLowerCase();
const varNameFromPath = (arr) => `--${arr.map(seg).join("-")}`;

// turn "{a.b.c}" into "var(--a-b-c)"
const refToVar = (val) => {
  if (typeof val === "string") {
    const m = val.match(/^\{([^}]+)\}$/);
    if (m) return `var(--${m[1].split(".").map(seg).join("-")})`;
  }
  return val;
};

// Proper CSS property casing: camelCase → kebab-case (and normalize spaces/_)
const prop = (s) =>
  String(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();

// ---- math & reference resolver ----
// Replace all "{x.y}" with "var(--x-y)"
// turn "{a.b.c}" → "var(--a-b-c)" (global, anywhere in the string)
const replaceRefs = (str) =>
  String(str).replace(/\{([^}]+)\}/g, (_, p) => `var(--${p.split(".").map(seg).join("-")})`);

// Decide if expression needs calc(): treat + - * / as math, but ignore hyphens inside var names
const needsCalcWrap = (expr) => {
  const t = String(expr).trim();
  if (/^calc\(/i.test(t)) return false; // already calc()

  // plain number or unit (e.g., 12, 1.5rem, 100%)
  if (/^[+-]?\d+(\.\d+)?([a-z%]+)?$/i.test(t)) return false;

  // *** FIX: only skip if the ENTIRE string is a single var(), not just starts with one
  if (/^var\(--[a-z0-9-]+\)$/i.test(t)) return false;

  // Hide var(...) so hyphens inside names don't count as "minus"
  const masked = t.replace(/var\(--[a-z0-9-]+\)/gi, "X");

  // Any arithmetic operator (or unary minus before X) means we need calc()
  if (/[+\-*/]/.test(masked) || /^-\s*X/.test(masked)) return true;

  // Parentheses next to operators (complex expressions)
  if (/\)\s*[-+*/]/.test(masked) || /[-+*/]\s*\(/.test(masked)) return true;

  return false;
};

// Master resolver: replace refs first; then wrap with calc() only when needed
const resolveValue = (val) => {
  if (typeof val !== "string") return val;
  const withRefs = replaceRefs(val.trim());
  return needsCalcWrap(withRefs) ? `calc(${withRefs})` : withRefs;
};


// ---- fs utils ----
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const listFiles = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f))
    : [];
const listDirs = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];

// ---- flatten primitives ----
const flattenValues = (obj, prefix = [], out = []) => {
  if (
    obj &&
    typeof obj === "object" &&
    "value" in obj &&
    (typeof obj.value !== "object" || obj.value === null)
  ) {
    out.push({ path: prefix, value: obj.value });
    return out;
  }
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      if (k === "value") continue;
      flattenValues(v, prefix.concat(k), out);
    }
  }
  return out;
};

// ---- styles (typography / boxShadow / generic) ----
const collectStyleBlocks = (stylesJson) => {
  const blocks = [];

  const walk = (node, p = []) => {
    if (!node || typeof node !== "object") return;

    if ("value" in node && node.value && typeof node.value === "object" && !Array.isArray(node.value)) {
      const type = node.type || "";
      const classSuffix = p.map(seg).join("-");

      if (type === "typography") {
        const rules = Object.entries(node.value)
          .map(([k, v]) => `  ${prop(k)}: ${resolveValue(v)};`)
          .join("\n");
        blocks.push(`.text-${classSuffix} {\n${rules}\n}`);
        return;
      }

      if (type === "boxShadow") {
        const toShadow = (obj) =>
          ["x", "y", "blur", "spread", "color"].map((k) => resolveValue(obj?.[k])).filter(Boolean).join(" ");
        const shadow = Array.isArray(node.value) ? node.value.map(toShadow).join(", ") : toShadow(node.value);
        const cls = p[0] === "elevation" ? `.elevation-${p.slice(1).map(seg).join("-")}` : `.${classSuffix}`;
        blocks.push(`${cls} {\n  box-shadow: ${shadow};\n}`);
        return;
      }

      const rules = Object.entries(node.value)
        .map(([k, v]) => `  ${prop(k)}: ${resolveValue(v)};`)
        .join("\n");
      blocks.push(`.${classSuffix} {\n${rules}\n}`);
      return;
    }

    for (const [k, v] of Object.entries(node)) {
      if (k === "value") continue;
      walk(v, p.concat(k));
    }
  };

  walk(stylesJson, []);
  return blocks;
};

// ---- var blocks ----
const varDeclsFromFile = (filePath) => {
  const json = readJson(filePath);
  const vars = flattenValues(json);
  if (!vars.length) return "";
  return vars
    .slice()
    .sort((a, b) => varNameFromPath(a.path).localeCompare(varNameFromPath(b.path)))
    .map(({ path: p, value }) => `  ${varNameFromPath(p)}: ${resolveValue(value)};`)
    .join("\n");
};
const blockWithDecls = (selector, decls) => (decls ? `${selector} {\n${decls}\n}` : "");
const varsBlockFromFile = (filePath) => blockWithDecls(":root", varDeclsFromFile(filePath));

// ---- breakpoint min detection ----
const normalizeUnit = (v) => {
  if (typeof v === "number") return `${v}px`;
  if (typeof v !== "string") return null;
  if (/^\{.+\}$/.test(v)) return null;
  if (/^\d+(\.\d+)?(px|rem|em|vw|vh|vmin|vmax|cqmin|cqmax|cqi)$/.test(v)) return v;
  if (/^\d+(\.\d+)?$/.test(v)) return `${v}px`;
  return null;
};
const extractBreakpointMin = (filePath, fallbackPx) => {
  try {
    if (!fs.existsSync(filePath)) return fallbackPx;
    const json = readJson(filePath);
    const flat = flattenValues(json);
    const cand = flat.find((t) => {
      const last = String(t.path[t.path.length - 1]).toLowerCase();
      return last === "min" || last === "minwidth";
    });
    const norm = cand ? normalizeUnit(cand.value) : null;
    return norm || fallbackPx;
  } catch {
    return fallbackPx;
  }
};

// ---------- BASE formatter (tokens-test.css) ----------
StyleDictionary.registerFormat({
  name: "nw/css-collections",
  format: () => {
    let css = `/* Auto-generated by Style Dictionary. Do not edit directly. */\n\n`;

    // 1) Global
    const globalFiles = listFiles(path.join(RAW_DIR, "global")).sort((a, b) =>
      a.localeCompare(b, "en", { sensitivity: "base" })
    );
    if (globalFiles.length) {
      css += `/* Base: Global + inline + defaults */\n`;
      for (const f of globalFiles) {
        const block = varsBlockFromFile(f);
        if (block) css += block + "\n\n";
      }
    }

    // 2–4) Breakpoints
    const bpDir = path.join(RAW_DIR, "breakpoint");
    const mobile = path.join(bpDir, "mobile.json");
    const tablet = path.join(bpDir, "tablet.json");
    const desktop = path.join(bpDir, "desktop.json");

    if (fs.existsSync(mobile)) {
      css += `/* Breakpoint default — breakpoint/mobile */\n${varsBlockFromFile(mobile)}\n\n`;
    }
    if (fs.existsSync(tablet)) {
      const min = extractBreakpointMin(tablet, "640px");
      const inner = varsBlockFromFile(tablet).replace(/^/gm, "  ");
      css += `/* Breakpoint min-width ${min} — breakpoint/tablet */\n@media (min-width: ${min}) {\n${inner}\n}\n\n`;
    }
    if (fs.existsSync(desktop)) {
      const min = extractBreakpointMin(desktop, "1024px");
      const inner = varsBlockFromFile(desktop).replace(/^/gm, "  ");
      css += `/* Breakpoint min-width ${min} — breakpoint/desktop */\n@media (min-width: ${min}) {\n${inner}\n}\n\n`;
    }

    // 5–9) Other collections
    const topDirs = listDirs(RAW_DIR)
      .filter((d) => !["global", "breakpoint", "mode", "styles"].includes(d))
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    for (const col of topDirs) {
      const dir = path.join(RAW_DIR, col);
      const files = listFiles(dir).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
      const def = files.find((f) => path.basename(f).toLowerCase() === "default.json");
      if (def) {
        css += `/* Other ${col} — default */\n${varsBlockFromFile(def)}\n\n`;
      }
      for (const f of files) {
        if (f === def) continue;
        const setName = path.basename(f, ".json");
        const block = varsBlockFromFile(f).replace(/^:root\s+\{/, `[data-${col}="${setName}"] {`);
        css += `/* Other ${col} — set ${setName} */\n${block}\n\n`;
      }
    }

    // 10–11) Mode (BASE = root for light, data-mode for everything else ONLY)
    const modeDir = path.join(RAW_DIR, "mode");
    if (fs.existsSync(modeDir)) {
      const modeFiles = listFiles(modeDir).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
      const light = modeFiles.find((f) => path.basename(f).toLowerCase() === "light.json");
      if (light) {
        css += `/* Mode light — mode/light */\n${varsBlockFromFile(light)}\n\n`;
      }
      for (const f of modeFiles) {
        if (f === light) continue;
        const setName = path.basename(f, ".json");
        const block = blockWithDecls(`[data-mode="${setName}"]`, varDeclsFromFile(f));
        css += `/* Mode ${setName} — mode/${setName} */\n${block}\n\n`;
      }
    }

    // 12) Styles
    const stylesFile = path.join(RAW_DIR, "styles", "styles.json");
    if (fs.existsSync(stylesFile)) {
      const stylesJson = readJson(stylesFile);
      const blocks = collectStyleBlocks(stylesJson);
      if (blocks.length) {
        css += `/* Styles: styles/styles */\n` + blocks.join("\n\n") + "\n\n";
      }
    }

    return css.trim() + "\n";
  },
});

// ---------- EXTENDED formatter (extended-test.css) ----------
StyleDictionary.registerFormat({
  name: "nw/css-collections-extended",
  format: () => {
    let css = `/* Auto-generated by Style Dictionary. Do not edit directly. */\n\n`;

    // 1) Global
    const globalFiles = listFiles(path.join(RAW_DIR, "global")).sort((a, b) =>
      a.localeCompare(b, "en", { sensitivity: "base" })
    );
    if (globalFiles.length) {
      css += `/* Base: Global + inline + defaults */\n`;
      for (const f of globalFiles) {
        const block = varsBlockFromFile(f);
        if (block) css += block + "\n\n";
      }
    }

    // 2–4) Breakpoints + manual [data-breakpoint=...] wrappers
    const bpDir = path.join(RAW_DIR, "breakpoint");
    const mobile = path.join(bpDir, "mobile.json");
    const tablet = path.join(bpDir, "tablet.json");
    const desktop = path.join(bpDir, "desktop.json");

    if (fs.existsSync(mobile)) {
      css += `/* Breakpoint default — breakpoint/mobile */\n${varsBlockFromFile(mobile)}\n\n`;
    }
    if (fs.existsSync(tablet)) {
      const min = extractBreakpointMin(tablet, "640px");
      const inner = varsBlockFromFile(tablet).replace(/^/gm, "  ");
      css += `/* Breakpoint min-width ${min} — breakpoint/tablet */\n@media (min-width: ${min}) {\n${inner}\n}\n\n`;
    }
    if (fs.existsSync(desktop)) {
      const min = extractBreakpointMin(desktop, "1024px");
      const inner = varsBlockFromFile(desktop).replace(/^/gm, "  ");
      css += `/* Breakpoint min-width ${min} — breakpoint/desktop */\n@media (min-width: ${min}) {\n${inner}\n}\n\n`;
    }
    if (fs.existsSync(mobile)) {
      css += `/* Breakpoint manual mobile — breakpoint/mobile */\n` +
             blockWithDecls(`[data-breakpoint="mobile"]`, varDeclsFromFile(mobile)) + "\n\n";
    }
    if (fs.existsSync(tablet)) {
      css += `/* Breakpoint manual tablet — breakpoint/tablet */\n` +
             blockWithDecls(`[data-breakpoint="tablet"]`, varDeclsFromFile(tablet)) + "\n\n";
    }
    if (fs.existsSync(desktop)) {
      css += `/* Breakpoint manual desktop — breakpoint/desktop */\n` +
             blockWithDecls(`[data-breakpoint="desktop"]`, varDeclsFromFile(desktop)) + "\n\n";
    }

    // 5–9) Other collections (+ manual default attr)
    const topDirs = listDirs(RAW_DIR)
      .filter((d) => !["global", "breakpoint", "mode", "styles"].includes(d))
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    for (const col of topDirs) {
      const dir = path.join(RAW_DIR, col);
      const files = listFiles(dir).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

      const def = files.find((f) => path.basename(f).toLowerCase() === "default.json");
      if (def) {
        css += `/* Other ${col} — default */\n${varsBlockFromFile(def)}\n\n`;
        css += `/* Other manual default ${col}=default — ${col}/default */\n` +
               blockWithDecls(`[data-${col}="default"]`, varDeclsFromFile(def)) + "\n\n";
      }
      for (const f of files) {
        if (f === def) continue;
        const setName = path.basename(f, ".json");
        const block = varsBlockFromFile(f).replace(/^:root\s+\{/, `[data-${col}="${setName}"] {`);
        css += `/* Other ${col} — set ${setName} */\n${block}\n\n`;
      }
    }

    // 10–11) Mode (EXTENDED = root for light, PLUS manual attr for light, and data-mode for others)
    const modeDir = path.join(RAW_DIR, "mode");
    if (fs.existsSync(modeDir)) {
      const modeFiles = listFiles(modeDir).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
      const light = modeFiles.find((f) => path.basename(f).toLowerCase() === "light.json");
      if (light) {
        css += `/* Mode light — mode/light (root default) */\n${varsBlockFromFile(light)}\n\n`;
        const decls = varDeclsFromFile(light);
        css += `/* Mode light — mode/light (manual attr) */\n` +
               blockWithDecls(`[data-mode="light"]`, decls) + "\n\n";
      }
      for (const f of modeFiles) {
        if (f === light) continue;
        const setName = path.basename(f, ".json");
        const decls = varDeclsFromFile(f);
        css += `/* Mode ${setName} — mode/${setName} */\n` +
               blockWithDecls(`[data-mode="${setName}"]`, decls) + "\n\n";
      }
    }

    // 12) Styles
    const stylesFile = path.join(RAW_DIR, "styles", "styles.json");
    if (fs.existsSync(stylesFile)) {
      const stylesJson = readJson(stylesFile);
      const blocks = collectStyleBlocks(stylesJson);
      if (blocks.length) {
        css += `/* Styles: styles/styles */\n` + blocks.join("\n\n") + "\n\n";
      }
    }

    return css.trim() + "\n";
  },
});

// ---------- Zeroheight (DTCG) export helpers (improved alias rebasing) ----------
const isPlainObj = (v) => v && typeof v === "object" && !Array.isArray(v);

// Keep track of your "other collection" folder names so we can prioritize defaults
let __OTHER_COLLECTIONS = new Set();

// Convert raw node → DTCG ($value/$type/$description)
const toDTCG = (node) => {
  if (!isPlainObj(node)) return node;

  const hasValue = Object.prototype.hasOwnProperty.call(node, "value");
  const has$Value = Object.prototype.hasOwnProperty.call(node, "$value");

  // Token
  if (hasValue || has$Value) {
    const val = hasValue ? node.value : node.$value;
    const out = { $value: val };
    if (typeof node.type === "string") out.$type = node.type;
    if (typeof node.$type === "string") out.$type = node.$type;
    if (typeof node.description === "string") out.$description = node.description;
    if (typeof node.$description === "string") out.$description = node.$description;
    return out;
  }

  // Group (carry optional metadata)
  const out = {};
  if (typeof node.type === "string") out.$type = node.type;
  if (typeof node.$type === "string") out.$type = node.$type;
  if (typeof node.description === "string") out.$description = node.$description;
  if (typeof node.$description === "string") out.$description = node.$description;

  for (const [k, v] of Object.entries(node)) {
    if (k === "type" || k === "description" || k === "$type" || k === "$description") continue;
    out[k] = toDTCG(v);
  }
  return out;
};

// Deep merge groups safely; tokens ($value) overwrite entirely
const mergeDTCG = (base, extra) => {
  if (!isPlainObj(base)) return toDTCG(extra);
  if (!isPlainObj(extra)) return base;

  const isToken = (o) => isPlainObj(o) && Object.prototype.hasOwnProperty.call(o, "$value");

  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (!(k in out)) {
      out[k] = toDTCG(v);
      continue;
    }
    if (isToken(out[k]) || isToken(v)) {
      out[k] = toDTCG(v); // token overwrite
    } else {
      out[k] = mergeDTCG(out[k], v); // group merge
    }
  }
  return out;
};

// Build one unified DTCG object for Zeroheight
const buildZeroheightObject = () => {
  let zh = {};

  // 1) Global → merge into top-level
  for (const f of listFiles(path.join(RAW_DIR, "global")).sort()) {
    zh = mergeDTCG(zh, toDTCG(readJson(f)));
  }

  // Helper: place a file into a group path like ["breakpoint","mobile"]
  const putInPath = (obj, pathArr, content) => {
    let cursor = obj;
    for (const seg of pathArr.slice(0, -1)) {
      cursor[seg] = cursor[seg] && isPlainObj(cursor[seg]) ? cursor[seg] : {};
      cursor = cursor[seg];
    }
    const leaf = pathArr[pathArr.length - 1];
    cursor[leaf] = mergeDTCG(cursor[leaf] || {}, content);
  };

  // 2) Breakpoints → breakpoint.mobile/tablet/desktop
  const bpDir = path.join(RAW_DIR, "breakpoint");
  for (const f of listFiles(bpDir).sort()) {
    const name = path.basename(f, ".json");
    putInPath(zh, ["breakpoint", name], toDTCG(readJson(f)));
  }

  // 3) Modes → mode.light/dark/…
  const modeDir = path.join(RAW_DIR, "mode");
  for (const f of listFiles(modeDir).sort()) {
    const name = path.basename(f, ".json");
    putInPath(zh, ["mode", name], toDTCG(readJson(f)));
  }

  // 4) Styles → styles group
  const stylesDir = path.join(RAW_DIR, "styles");
  for (const f of listFiles(stylesDir).sort()) {
    zh.styles = mergeDTCG(zh.styles || {}, toDTCG(readJson(f)));
  }

  // 5) Other collections → <collection>.<set>
  const others = listDirs(RAW_DIR).filter((d) => !["global", "breakpoint", "mode", "styles"].includes(d));
  __OTHER_COLLECTIONS = new Set(others); // remember for priority
  for (const col of others.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))) {
    const dir = path.join(RAW_DIR, col);
    for (const f of listFiles(dir).sort()) {
      const setName = path.basename(f, ".json");
      putInPath(zh, [col, setName], toDTCG(readJson(f)));
    }
  }

  return zh;
};

// Flatten all token paths: "a.b.c" → node with $value
const buildTokenIndex = (root) => {
  const index = new Map();
  const walk = (obj, pathArr) => {
    if (!isPlainObj(obj)) return;
    const isToken = Object.prototype.hasOwnProperty.call(obj, "$value");
    if (isToken) {
      index.set(pathArr.join("."), obj);
      return;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("$")) continue;
      walk(v, pathArr.concat(k));
    }
  };
  walk(root, []);
  return index;
};

// Ranking function for candidate paths (lower is better)
const pathPriority = (pathStr) => {
  const parts = pathStr.split(".");
  const first = parts[0];
  const second = parts[1];

  // Reserved group names we want to de-prioritize vs globals
  const reserved = new Set(["breakpoint", "mode", "styles", ...__OTHER_COLLECTIONS]);

  // 0: global/top-level (first segment NOT a reserved group)
  if (!reserved.has(first)) return 0;

  // 1: breakpoint.mobile.*
  if (first === "breakpoint" && second === "mobile") return 1;

  // 2: mode.light.*
  if (first === "mode" && second === "light") return 2;

  // 3: <collection>.default.*  (for any 'other' collection name)
  if (__OTHER_COLLECTIONS.has(first) && second === "default") return 3;

  // 10+: others (breakpoint tablet/desktop, other modes, other sets)
  if (first === "breakpoint") return 10;
  if (first === "mode") return 11;
  if (__OTHER_COLLECTIONS.has(first)) return 12;

  // styles or anything else
  return 20;
};

// Find best canonical path for an alias, using priorities & tie-breaks
const chooseBest = (cands, selfPath) => {
  // Avoid self-alias
  const filtered = cands.filter((p) => p !== selfPath);
  const ranked = filtered
    .map((p) => ({ p, score: pathPriority(p), len: p.split(".").length }))
    .sort((a, b) => a.score - b.score || a.len - b.len || a.p.localeCompare(b.p));
  return ranked.length ? ranked[0].p : null;
};

const findCanonicalAlias = (alias, index, selfPath) => {
  if (index.has(alias) && alias !== selfPath) return alias;

  // Collect matches by suffix (allow exact or endsWith)
  const matches = [];
  for (const k of index.keys()) {
    if (k === alias || k.endsWith("." + alias)) matches.push(k);
  }
  if (!matches.length) return alias;

  // If unique, take it; else choose by priority
  if (matches.length === 1 && matches[0] !== selfPath) return matches[0];

  const best = chooseBest(matches, selfPath);
  return best || alias;
};

// Rewrite every {…} inside $value (strings, arrays, or nested objects) to canonical paths
const rebaseAliasesInPlace = (root) => {
  const index = buildTokenIndex(root);

  const rewriteString = (str, selfPath) =>
    str.replace(/\{([^}]+)\}/g, (_, raw) => `{${findCanonicalAlias(raw.trim(), index, selfPath)}}`);

  const rewriteDeep = (val, selfPath) => {
    if (typeof val === "string") return rewriteString(val, selfPath);
    if (Array.isArray(val)) return val.map((v) => rewriteDeep(v, selfPath));
    if (val && typeof val === "object") {
      const out = Array.isArray(val) ? [] : {};
      for (const [k, v] of Object.entries(val)) {
        // don't touch DTCG metadata keys inside composite values if they exist
        if (k.startsWith("$")) { out[k] = v; continue; }
        out[k] = rewriteDeep(v, selfPath);
      }
      return out;
    }
    return val;
  };

  const walk = (obj, pathArr = []) => {
    if (!obj || typeof obj !== "object") return;
    if (Object.prototype.hasOwnProperty.call(obj, "$value")) {
      const selfPath = pathArr.join(".");
      obj.$value = rewriteDeep(obj.$value, selfPath);
      return;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("$")) continue;
      walk(v, pathArr.concat(k));
    }
  };

  walk(root, []);
  return root;
};

// Infer $type from token path: fontFamily/fontWeight
const applyNameBasedTypeHints = (root) => {
  const walk = (obj, pathArr = []) => {
    if (!obj || typeof obj !== "object") return;

    if (Object.prototype.hasOwnProperty.call(obj, "$value")) {
      const isComposite = obj.$value && typeof obj.$value === "object";
      if (!isComposite) {
        const lowerSegs = pathArr.map((s) => String(s).toLowerCase());
        if (lowerSegs.includes("fontfamily")) {
          obj.$type = "fontFamily";
        } else if (lowerSegs.includes("fontweight")) {
          obj.$type = "fontWeight";
        }
      }
      return;
    }

    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("$")) continue; // skip DTCG metadata
      walk(v, pathArr.concat(k));
    }
  };

  walk(root, []);
  return root;
};



StyleDictionary.registerFormat({
  name: "nw/zeroheight-json",
  format: () => {
    const unified = buildZeroheightObject();
    const rebased = rebaseAliasesInPlace(unified);
    const finalObj = applyNameBasedTypeHints(rebased);   // <— add this line
    return JSON.stringify(finalObj, null, 2) + "\n";
  },
});


// ---- build all files ----
  export default {
    source: ["tokens/raw/**/*.json"],
    platforms: {
      css: {
        transformGroup: "css",
        buildPath: "tokens/resolved/",
        files: [
          { destination: "tokens.css",       format: "nw/css-collections" },
          { destination: "extended-test.css", format: "nw/css-collections-extended" }
        ]
      },

      // NEW: Zeroheight unified JSON
      zeroheight: {
        // No SD transforms needed; our formatter builds from raw files directly
        buildPath: "tokens/resolved/",
        files: [
          { destination: "zeroheight.json", format: "nw/zeroheight-json" }
        ]
      }
    }
  };
