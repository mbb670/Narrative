// tools/style-dictionary/build.mjs
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import StyleDictionary from 'style-dictionary';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');

// --- 1) Load our formatter (support function default OR object exports)
async function loadFormatter() {
  const mod = await import(pathToFileURL(path.resolve(__dirname, './formats/format-css-collections.mjs')));
  const candidate =
    mod.default && typeof mod.default === 'function' ? mod.default :
    mod.formatter && typeof mod.formatter === 'function' ? mod.formatter :
    mod.format && typeof mod.format === 'function' ? mod.format :
    null;

  if (!candidate) {
    throw new Error(
      'format-css-collections.mjs must export a function (default) or an object with a `formatter` or `format` function.'
    );
  }
  return candidate;
}

// --- 2) Resolve SD config (two levels up from this file)
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
    // Fallback config builds raw tokens with our formatter
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

(async function run() {
  // Register formatter robustly
  const formatter = await loadFormatter();
  StyleDictionary.registerFormat({
    name: 'narrative/css-collections',
    formatter,
  });

  // Load config & build
  const config = await loadConfig();
  const SD = StyleDictionary.extend(config);
  await SD.buildAllPlatforms();

  console.log(
    `✅ Built tokens with format "narrative/css-collections". Using config: ${path.relative(repoRoot, configPath)}`
  );
})().catch((e) => {
  console.error('❌ Token build failed:', e);
  process.exit(1);
});
