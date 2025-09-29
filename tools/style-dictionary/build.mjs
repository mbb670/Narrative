// tools/style-dictionary/build.mjs
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import StyleDictionaryNS from "style-dictionary";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../");

// ---------------- helpers ----------------
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
const toURL = (p) => pathToFileURL(p);
const dynImport = (p) => import(toURL(p).href);

async function loadFormatter() {
  const fmtPath = path.resolve(__dirname, "./formats/format-css-collections.mjs");
  const mod = await dynImport(fmtPath);

  // Try common export shapes
  const pick = (x) => {
    if (!x) return null;
    if (typeof x === "function") return x;
    if (typeof x.formatter === "function") return x.formatter; // SD v3
    if (typeof x.format === "function") return x.format;       // SD v2
    return null;
  };

  const fn = pick(mod?.default) || pick(mod);
  if (!fn) {
    throw new Error(
      "format-css-collections.mjs must export a formatter function (default), " +
      "or an object with `formatter` (v3) or `format` (v2)."
    );
  }
  return fn;
}

async function loadConfig() {
  // Allow env override; default to repo’s sd-configs/css.mjs if present
  const rel = nonEmpty(process.env.SD_CONFIG) ? process.env.SD_CONFIG.trim() : "sd-configs/css.mjs";
  const cfgPath = path.resolve(repoRoot, rel);

  try {
    const stat = await fs.stat(cfgPath);
    if (stat.isDirectory()) throw new Error(`Path points to a directory, not a module: ${cfgPath}`);
    const mod = await dynImport(cfgPath);
    if (!mod?.default) throw new Error(`No default export in ${cfgPath}`);
    return mod.default;
  } catch (err) {
    console.warn(
      `[tokens] Could not import config at ${cfgPath}. Using a minimal default config.\n` +
      `Reason: ${err?.message ?? err}`
    );
    return {
      // Fallback sources so the build keeps going
      source: ["raw/**/*.json", "tokens/**/*.json"],
      platforms: {
        css: {
          buildPath: "resolved/",
          files: [{ destination: "tokens.css", format: "narrative/css-collections" }],
        },
      },
    };
  }
}

function registerFormatCompat(StyleDictionary, name, formatterFn) {
  // Try v3 first
  try {
    StyleDictionary.registerFormat({ name, formatter: formatterFn });
    return "v3";
  } catch {
    // Fallback to v2
    StyleDictionary.registerFormat({ name, format: formatterFn });
    return "v2";
  }
}

// Create an instance no matter which API surface we have
function createDictionary(StyleDictionary, config) {
  if (typeof StyleDictionary.extend === "function") {
    // v2 API
    return StyleDictionary.extend(config);
  }

  // v3: default export is a class
  try {
    return new StyleDictionary(config);
  } catch {
    // Some builds expose a factory
    if (typeof StyleDictionary.create === "function") {
      return StyleDictionary.create(config);
    }
    if (typeof StyleDictionary === "function") {
      // As a last resort, callable factory (non-class)
      return StyleDictionary(config);
    }
  }

  throw new Error("Unsupported Style Dictionary export: no extend/create and cannot construct with `new`.");
}

// ---------------- run ----------------
(async () => {
  const SDNS = StyleDictionaryNS?.default ?? StyleDictionaryNS;

  const formatter = await loadFormatter();
  const config = await loadConfig();

  registerFormatCompat(SDNS, "narrative/css-collections", formatter);
  const dict = createDictionary(SDNS, config);

  // 🔥 clean output so results always refresh
  const outDir = path.resolve(repoRoot, "resolved");
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  await dict.buildAllPlatforms();
  console.log(`✅ Built tokens into ${outDir}`);
})().catch((e) => {
  console.error("❌ Token build failed:", e);
  process.exit(1);
});
