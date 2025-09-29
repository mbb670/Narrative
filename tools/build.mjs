// tools/build.mjs
import StyleDictionary from "style-dictionary";
import { readdir } from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import formatterCSS from "./format-token-test.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(__dirname, "../sd-configs");

// Register custom formatter
StyleDictionary.registerFormat({
  name: "custom/css-token-test",
  formatter: formatterCSS
});

// Helper: import an ESM config file and return the default export
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
  console.error("No configs found in sd-configs/. Add a *.mjs file.");
  process.exit(1);
}

for (const cfgPath of toBuild) {
  const cfg = await loadConfig(cfgPath);
  const SD = StyleDictionary.extend(cfg);
  console.log(`\nBuilding with config: ${path.basename(cfgPath)}\n`);
  SD.buildAllPlatforms();
}
