// tools/style-dictionary/build.mjs
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import StyleDictionary from 'style-dictionary';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');

// ---- Load our formatter regardless of export shape
async function loadFormatter() {
  const modUrl = pathToFileURL(path.resolve(__dirname, './formats/format-css-collections.mjs'));
  const mod = await import(modUrl);

  const tryGet = (obj) => {
    if (!obj) return null;
    if (typeof obj === 'function') return obj;
    if (typeof obj.format === 'function') return obj.format;
    if (typeof obj.formatter === 'function') return obj.formatter;
    return null;
  };

  const candidate =
    tryGet(mod.default) || tryGet(mod) ||
    null;

  if (!candidate) {
    throw new Error(
      'format-css-collections.mjs must export a formatter function (default), ' +
      'or an object with a `format` or `formatter` function.'
    );
  }
  return candidate;
}

// ---- Resolve SD config (keeps your existing path; falls back if missing)
const configPath = path.resolve(
  repoRoot,
  process.env.SD_CONFIG ?? 'sd-configs/css.mjs'
);

async function loadConfig() {
  try {
    await fs.access(configPath);
    const cfg = await import(pathToFileURL(configPath));
    if (!cfg?.default) throw new Error(`No default export in ${configPath}`);
    return cfg.default;
  } catch (err) {
    console.warn(
      `[tokens] Could not import config at ${configPath}. Using a minimal default config.\n` +
      `Reason: ${err?.message ?? err}`
    );
    return {
      source: ['raw/**/*.json', 'tokens/**/*.json'],
      platforms: {
        css: {
          transforms: [],
          buildPath: 'resolved/',
          files: [{ destination: 'tokens.css', format: 'narrative/css-collections' }],
        },
      },
    };
  }
}

// ---- Register format for SD v3 (formatter) and v2 (format)
function registerFormatCompat(fn) {
  // Try v3 first
  try {
    StyleDictionary.registerFormat({ name: 'narrative/css-collections', formatter: fn });
    return 'v3';
  } catch (_) {
    // Fall back to v2 API
    StyleDictionary.registerFormat({ name: 'narrative/css-collections', format: fn });
    return 'v2';
  }
}

(async function run() {
  const formatter = await loadFormatter();
  const sdVersion = registerFormatCompat(formatter);

  const config = await loadConfig();
  const SD = StyleDictionary.extend(config);
  await SD.buildAllPlatforms();

  console.log(`✅ Built tokens with "narrative/css-collections" using Style Dictionary ${sdVersion}-style registration.`);
})().catch((e) => {
  console.error('❌ Token build failed:', e);
  process.exit(1);
});
