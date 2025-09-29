// tools/style-dictionary/build.mjs
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import StyleDictionaryNS from "style-dictionary";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../");

// ---------- helpers
function nonEmpty(v) {
  return typeof v === "string" && v.trim().length > 0;
}

async function importModule(p) {
  return import(pathToFileURL(p));
}

// Get a formatter function regardless of how the format file exports it
async function loadFormatter() {
  const formatPath = path.resolve(__dirname, "./formats/format-css-collections.mjs");
  const mod = await importModule(formatPath);

  const pickFn = (obj) => {
    if (!obj) return null;
    if (typeof obj === "function") return obj;
    if (typeof obj.format === "function") return obj.format;      // SD v2 style
    if (typeof obj.formatter === "function") return obj.formatter; // SD v3 style
    return null;
  };

  const fn =
    pickFn(mod?.default) ||
    pickFn(mod) ||
    null;

  if (!fn) {
    throw new Error(
      "format-css-collections.mjs must export a formatter function (default), " +
      "or an object with `format` (v2) or `formatter` (v3)."
    );
  }
  return fn;
}

// Resolve SD config (env override, with safe fallback)
async function loadConfig() {
  const rel = nonEmpty(process.env.SD_CONFIG) ? process.env.SD_CONFIG.trim() : "sd-configs/css.mjs";
  const configPath = path.resolve(repoRoot, rel);

  try {
    const stat = await fs.stat(configPath);
    if (stat.isDirectory()) {
      throw new Error(`Path points to a directory, not a module: ${configPath}`);
    }
    const cfg = await importModule(configPath);
    if (!cfg?.default) throw new Error(`No default export in ${configPath}`);
    return cfg.default;
  } catch (err) {
    console.warn(
      `[tokens] Could not import config at ${configPath}. Using a minimal default config.\n` +
      `Reason: ${err?.message ?? err}`
    );
    // Minimal, but enough to prove the pipeline works
    return {
      source: ["raw/**/*.json", "tokens/**/*.json"],
      platforms: {
        css: {
          transforms: [],
          buildPath: "resolved/",
          files: [{ destination: "tokens.css", format: "narrative/css-collections" }],
        },
      },
    };
  }
}

// Register format in a way that works on v2 and v3
function registerFormatCompat(sd, name, fn) {
  // Try v3 (expects `formatter`)
  try {
    sd.registerFormat({ name, formatter: fn });
    return "v3";
  } catch (_) {
    // Fallback to v2 (expects `format`)
    sd.registerFormat({ name, format: fn });
    return "v2";
  }
}

// Create a dictionary from config regardless of API surface
function createDictionary(sd, config) {
  if (typeof sd.extend === "function") return sd.extend(config); // classic API
  if (typeof sd.create === "function") return sd.create(config); // alt API
  if (typeof sd === "function") return sd(config);               // callable export
  throw new Error("Unsupported Style Dictionary export: cannot find extend/create/callable");
}

// ---------- run
(async function run() {
  // Some installs export as default, some as namespace
  const StyleDictionary = StyleDictionaryNS?.default ?? StyleDictionaryNS;

  const formatter = await loadFormatter();
  const config = await loadConfig();
  const regMode = registerFormatCompat(StyleDictionary, "narrative/css-collections", formatter);

  const SD = createDictionary(StyleDictionary, config);
  await SD.buildAllPlatforms();

  console.log(`✅ Built tokens using ${regMode}-style format registration.`);
})().catch((e) => {
  console.error("❌ Token build failed:", e);
  process.exit(1);
});
