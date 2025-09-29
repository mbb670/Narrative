import StyleDictionary from "style-dictionary";
import { readdir } from "node:fs/promises";
import path from "node:path";
import url from "node:url";

// import the generic formatter
import cssCollectionsFormatter from "./formats/format-css-collections.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(__dirname, "./sd-configs");

// Register the formatter (v4 expects { name, format })
StyleDictionary.registerFormat({
  name: "custom/css-collections",
  format: cssCollectionsFormatter
});

async function loadConfig(filePath) {
  const mod = await import(url.pathToFileURL(filePath).href);
  return mod.default || mod;
}

const only = process.env.SD_CONFIG && process.env.SD_CONFIG.trim();
const toBuild = [];

if (only) {
  toBuild.push(path.resolve(CONFIG_DIR, only));
} else {
  const files = await readdir(CONFIG_DIR);
  for (const f of files) {
    if (f.endsWith(".mjs") || f.endsWith(".js")) {
      toBuild.push(path.resolve(CONFIG_DIR, f));
    }
  }
}

if (!toBuild.length) {
  console.error("No configs found in tools/style-dictionary/sd-configs/. Add a *.mjs file.");
  process.exit(1);
}

for (const cfgPath of toBuild) {
  const cfg = await loadConfig(cfgPath);
  console.log(`\nBuilding with config: ${path.basename(cfgPath)}\n`);
  const sd = new StyleDictionary(cfg);   // v4: instantiate, then build
  await sd.buildAllPlatforms();
}
