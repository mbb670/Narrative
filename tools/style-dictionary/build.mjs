// tools/style-dictionary/build.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import StyleDictionaryNS from "style-dictionary";

const StyleDictionary = StyleDictionaryNS?.default ?? StyleDictionaryNS;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const DEFAULT_CONFIG_REL = "sd-configs/css.mjs";
const FORMATTER_REL = "tools/style-dictionary/formats/format-css-collections.mjs";
const FORMAT_NAME = "narrative/css-collections";

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function importIfExists(absPath) {
  if (!(await fileExists(absPath))) return null;
  try { return await import(pathToFileURL(absPath).href); }
  catch (e) { console.warn(`[tokens] Could not import ${absPath}\nReason: ${e?.message || e}`); return null; }
}

async function loadFormatter() {
  const abs = path.resolve(repoRoot, FORMATTER_REL);
  const mod = await importIfExists(abs);
  if (!mod) throw new Error(`Formatter not found at ${FORMATTER_REL}`);
  const fn = mod.default || mod.formatter || mod.format;
  if (typeof fn !== "function") throw new Error(`Formatter at ${FORMATTER_REL} must export a function (default / formatter / format).`);
  return fn;
}

async function loadConfig() {
  const rel = process.env.SD_CONFIG || DEFAULT_CONFIG_REL;
  const abs = path.resolve(repoRoot, rel);

  let cfg;
  if (await fileExists(abs)) {
    const mod = await importIfExists(abs);
    if (mod) cfg = mod.default ?? mod;
  } else {
    console.warn(`[tokens] Config not found at ${abs}. Using fallback config.`);
  }

  if (!cfg) {
    cfg = {
      source: ["raw/**/*.json", "tokens/**/*.json"],
      platforms: {
        css: {
          buildPath: "resolved/",
          files: [{ destination: "tokens.css", format: FORMAT_NAME }],
        },
      },
    };
    console.warn(`[tokens] Using fallback config. Create ${DEFAULT_CONFIG_REL} or set SD_CONFIG to customize.`);
  }

  if (cfg.platforms && typeof cfg.platforms === "object") {
    for (const [k, p] of Object.entries(cfg.platforms)) {
      if (!p.buildPath) continue;
      let bp = p.buildPath;
      if (!bp.endsWith("/")) bp += "/";
      cfg.platforms[k].buildPath = bp;
    }
  }
  return cfg;
}

function registerFormatCompat(SD, name, fn) {
  try { SD.registerFormat({ name, formatter: fn }); }
  catch { SD.registerFormat({ name, format: fn }); }
}

async function cleanOutputDirs(config) {
  const platforms = Object.values(config.platforms ?? {});
  const buildPaths = [...new Set(platforms.map(p => p?.buildPath).filter(Boolean).map(bp => path.resolve(repoRoot, bp)))];
  for (const outDir of buildPaths) {
    await fs.rm(outDir, { recursive: true, force: true });
    await fs.mkdir(outDir, { recursive: true });
  }
}

async function run() {
  console.log("🧩 tokens: starting build");
  const formatter = await loadFormatter();
  const config = await loadConfig();

  registerFormatCompat(StyleDictionary, FORMAT_NAME, formatter);

  const dict = new (StyleDictionary)(config);

  await cleanOutputDirs(config);
  await dict.buildAllPlatforms();

  const platforms = Object.values(config.platforms ?? {});
  const outDirs = [...new Set(platforms.map(p => p?.buildPath).filter(Boolean))];
  console.log(`✅ tokens: build complete → ${outDirs.join(", ") || "(no outputs)"}`);
}

run().catch(e => { console.error("❌ Token build failed:", e); process.exit(1); });
