#!/usr/bin/env node
/**
 * Build tokens → CSS using Style Dictionary v4 (ESM).
 * - Registers our custom format(s)
 * - Loads a single explicit config (no directory imports)
 * - Builds ONLY the CSS platform
 */

import path from "node:path";
import url from "node:url";
import StyleDictionary from "style-dictionary";

import registerFormats from "./register-formats.mjs"; // registers narrative/css-collections

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Absolute path to the SD config we want to run
const CONFIG_PATH = path.resolve(__dirname, "./sd-configs/css-primary.mjs");

async function run() {
  try {
    // Register any custom formats/filters/transforms FIRST
    registerFormats(StyleDictionary);

    // Import the config module (can export an object or a factory fn)
    const mod = await import(url.pathToFileURL(CONFIG_PATH));
    let config = mod.default ?? mod;

    if (typeof config === "function") {
      // Optional: pass env/context if your factory needs it
      config = await config({
        repoRoot: path.resolve(__dirname, "../../.."),
        tokensRoot: path.resolve(__dirname, "../../..", "tokens"),
      });
    }

    // v4 API: instantiate and build
    const sd = new StyleDictionary(config);

    // Build only the css platform we define in css-primary.mjs
    await sd.buildPlatform("css");

    console.log(
      `[tokens] ✅ CSS built to ${config.platforms.css.buildPath}${config.platforms.css.files[0].destination}`
    );
  } catch (err) {
    console.error("[tokens] ❌ Token build failed:", err);
    process.exit(1);
  }
}

run();
