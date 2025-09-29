/**
 * format-css-collections.mjs
 * Style Dictionary v4 custom formatter that:
 *  - Groups tokens by folder: global | breakpoint | mode | styles | other
 *  - Emits sections in readable, “expected” CSS blocks
 *  - Canonicalizes last token segment (font-family → fontfamily, etc.)
 *  - Builds breakpoints (mobile base, tablet ≥640, desktop ≥1024)
 *  - Builds modes ([data-theme="light|dark"])
 *  - Builds “other” themes (colorTheme/fontTheme), with data-* attributes
 *  - Builds style utility classes when a token’s value is an object
 */

const BP_MIN = { mobile: 0, tablet: 640, desktop: 1024 };

const CANON_LEAF = new Map([
  ["font-family", "fontfamily"],
  ["font-weight", "fontweight"],
  ["letter-spacing", "letterspacing"],
  ["line-height", "lineheight"],
]);

// ---------- small helpers ----------
const kebab = (s) =>
  String(s)
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/-+/g, "-")
    .toLowerCase();

const canonLeaf = (name) => {
  const parts = name.split("-");
  // Walk from the end and replace the first leaf match
  for (let i = parts.length; i > 0; i--) {
    const tail = parts.slice(i - 1).join("-");
    if (CANON_LEAF.has(tail)) {
      parts.splice(i - 1, parts.length - (i - 1), CANON_LEAF.get(tail));
      break;
    }
  }
  return parts.join("-");
};

const varName = (token) => canonLeaf(kebab(token.name || token.path?.join("-") || ""));

const byNameAsc = (a, b) => varName(a).localeCompare(varName(b));

const cssProp = (p) => kebab(p);

// Styles: derive a property if value is scalar and token doesn't specify one
const inferScalarProp = (t) => {
  const n = varName(t);
  if (/\belevation\b|\bshadow\b|\bfocus\b/i.test(n)) return "box-shadow";
  return "value";
};

// Pull “folder/type” segments from file path *after* tokens/raw/
const pathSegs = (filePath = "") => {
  const p = String(filePath).replace(/\\/g, "/");
  const i = p.lastIndexOf("/tokens/raw/");
  const sub = i >= 0 ? p.slice(i + "/tokens/raw/".length) : p;
  return sub.split("/").filter(Boolean);
};

const classify = (filePath = "") => {
  const p = filePath.replace(/\\/g, "/");
  if (p.includes("/global/")) return "global";
  if (p.includes("/breakpoint/")) return "breakpoint";
  if (p.includes("/mode/")) return "mode";
  if (p.includes("/styles/")) return "styles";
  return "other";
};

// Write helpers
const IND = (n) => "  ".repeat(n);
const rule = (name, value, i = 2) => `${IND(i)}--${name}: ${value};\n`;

const start = (title) => (title ? `/* ${title} */\n` : "");
const open = (sel, i = 0) => `${IND(i)}${sel} {\n`;
const close = (i = 0) => `${IND(i)}}\n`;

const joinShadow = (v) => (Array.isArray(v) ? v.join(", ") : v);

// Emit a utility class from a token whose value is an object
const emitClassFromObject = (sel, obj, i = 0) => {
  let out = open(sel, i);
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      // nested object → flatten one level with --custom-props?
      // Here we stringify directly (advanced schemas can be added later)
      out += `${IND(i + 1)}/* unsupported nested: ${k} */\n`;
      continue;
    }
    const val = Array.isArray(v) ? joinShadow(v) : v;
    out += `${IND(i + 1)}${cssProp(k)}: ${val};\n`;
  }
  out += close(i);
  return out;
};

// Emit a utility class from a scalar (infer a property)
const emitClassFromScalar = (sel, prop, value, i = 0) => {
  return `${open(sel, i)}${IND(i + 1)}${cssProp(prop)}: ${value};\n${close(i)}`;
};

// ---------- formatter ----------
export default function formatter({ dictionary }) {
  // Buckets
  const buckets = {
    global: [],
    breakpoint: [],
    mode: [],
    styles: [],
    other: [],
  };

  // Indexers for detailed grouping
  const bp = { mobile: [], tablet: [], desktop: [] };
  const modes = { light: [], dark: [] };
  const other = {
    colorTheme: { default: [], variants: {} }, // variants[name]=[]
    fontTheme: { default: [], variants: {} },
    misc: [], // anything else in "other"
  };
  const styles = new Map(); // key = "folder/sub", value = tokens[]

  // Distribute tokens
  for (const t of dictionary.allTokens) {
    const col = classify(t.filePath || t.file?.path || "");
    buckets[col].push(t);

    if (col === "breakpoint") {
      const seg = pathSegs(t.filePath);
      // tokens/raw/breakpoint/<mobile|tablet|desktop>/...
      const variant = seg[1] || "mobile";
      (bp[variant] || bp.mobile).push(t);
      continue;
    }

    if (col === "mode") {
      const seg = pathSegs(t.filePath);
      const variant = seg[1] || "light";
      (modes[variant] || modes.light).push(t);
      continue;
    }

    if (col === "styles") {
      const seg = pathSegs(t.filePath);
      // Expect: styles/<section>/<subsection>/<file>.json
      const sect = seg[1] || "styles";
      const sub = seg[2] || "styles";
      const key = `${sect}/${sub}`;
      if (!styles.has(key)) styles.set(key, []);
      styles.get(key).push(t);
      continue;
    }

    if (col === "other") {
      const seg = pathSegs(t.filePath);
      // other/<themeType>/<variant>/...
      const themeType = seg[0] || "misc";
      if (themeType === "colorTheme" || themeType === "fontTheme") {
        const variant = seg[1] || "default";
        if (variant === "default") {
          other[themeType].default.push(t);
        } else {
          if (!other[themeType].variants[variant])
            other[themeType].variants[variant] = [];
          other[themeType].variants[variant].push(t);
        }
      } else {
        other.misc.push(t);
      }
    }
  }

  // ---------- Emit CSS ----------
  let out = "";

  // GLOBAL BASE
  buckets.global.sort(byNameAsc);
  out += start("Base: Global + inline + defaults");
  out += open(":root", 0);
  for (const t of buckets.global) {
    out += rule(varName(t), t.value, 1);
  }
  out += close(0);
  out += "\n";

  // BREAKPOINTS
  // “Breakpoint default — breakpoint/mobile”
  if (bp.mobile.length) {
    out += start("Breakpoint default — breakpoint/mobile");
    out += open(":root", 0);
    for (const t of bp.mobile.sort(byNameAsc)) {
      out += rule(varName(t), t.value, 1);
    }
    out += close(0);
    out += "\n";
  }
  // tablet ≥640
  if (bp.tablet.length) {
    out += start("Breakpoint min-width 640px — breakpoint/tablet");
    out += `@media (min-width: ${BP_MIN.tablet}px) {\n`;
    out += open(":root", 1);
    for (const t of bp.tablet.sort(byNameAsc)) {
      out += rule(varName(t), t.value, 2);
    }
    out += close(1);
    out += "}\n\n";
  }
  // desktop ≥1024
  if (bp.desktop.length) {
    out += start("Breakpoint min-width 1024px — breakpoint/desktop");
    out += `@media (min-width: ${BP_MIN.desktop}px) {\n`;
    out += open(":root", 1);
    for (const t of bp.desktop.sort(byNameAsc)) {
      out += rule(varName(t), t.value, 2);
    }
    out += close(1);
    out += "}\n\n";
  }

  // OTHER: colorTheme
  const emitThemeBlock = (hdr, selector, tokens) => {
    if (!tokens?.length) return "";
    let s = start(hdr);
    s += open(selector, 0);
    for (const t of tokens.sort(byNameAsc)) s += rule(varName(t), t.value, 1);
    s += close(0);
    s += "\n";
    return s;
  };

  // colorTheme default (:root)
  out += emitThemeBlock("Other colorTheme — default", ":root", other.colorTheme.default);
  // colorTheme variants ([data-colorTheme="name"])
  for (const [name, toks] of Object.entries(other.colorTheme.variants)) {
    out += emitThemeBlock(
      `Other colorTheme — set ${name}`,
      `[data-colorTheme="${name}"]`,
      toks
    );
  }

  // fontTheme default (:root)
  out += emitThemeBlock("Other fontTheme — default", ":root", other.fontTheme.default);
  // fontTheme variants
  for (const [name, toks] of Object.entries(other.fontTheme.variants)) {
    out += emitThemeBlock(
      `Other fontTheme — set ${name}`,
      `[data-fontTheme="${name}"]`,
      toks
    );
  }

  // MODES
  if (modes.light.length) {
    out += start("Mode light — mode/light");
    out += open('[data-theme="light"]', 0);
    for (const t of modes.light.sort(byNameAsc)) {
      out += rule(varName(t), t.value, 1);
    }
    out += close(0);
    out += "\n";
  }

  if (modes.dark.length) {
    out += start("Mode dark — mode/dark");
    out += open('[data-theme="dark"]', 0);
    for (const t of modes.dark.sort(byNameAsc)) {
      out += rule(varName(t), t.value, 1);
    }
    out += close(0);
    out += "\n";
  }

  // STYLES / utility classes
  if (styles.size) {
    out += start("Styles (utility classes)");
    for (const [section, toks] of [...styles.entries()].sort()) {
      out += `/* Styles: ${section} */\n`;
      for (const t of toks) {
        const cls = "." + kebab(t.name);
        const v = t.value;

        if (v && typeof v === "object" && !Array.isArray(v)) {
          out += emitClassFromObject(cls, v, 0);
        } else {
          const prop =
            t.attributes?.cssProperty ||
            t.original?.attributes?.cssProperty ||
            inferScalarProp(t);
          const val = Array.isArray(v) ? joinShadow(v) : v;
          out += emitClassFromScalar(cls, prop, val, 0);
        }
      }
      out += "\n";
    }
  }

  return out.trimEnd() + "\n";
}
