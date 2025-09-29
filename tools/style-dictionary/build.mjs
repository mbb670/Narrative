// tools/style-dictionary/build.mjs
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import StyleDictionary from 'style-dictionary';

// 1) Register our formatter
import cssCollectionsFormatter from './formats/format-css-collections.mjs';
StyleDictionary.registerFormat({
  name: 'narrative/css-collections',
  formatter: cssCollectionsFormatter,
});

// 2) Resolve repo paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');

// Allow override via env var: SD_CONFIG=sd-configs/other.mjs
const configPath = path.resolve(
  repoRoot,
  process.env.SD_CONFIG ?? 'sd-configs/css.mjs'
);

async function loadConfig() {
  try {
    // Helpful check + readable error if path is wrong
    await fs.access(configPath);
    const mod = await import(pathToFileURL(configPath));
    if (!mod?.default) {
      throw new Error(`No default export in ${configPath}`);
    }
    return mod.default;
  } catch (err) {
    console.warn(
      `[tokens] Could not import config at ${configPath}. Using a minimal default config.\n` +
      `Reason: ${err?.message ?? err}`
    );

    // 3) Fallback default config (raw sources; no ref-resolving transforms)
    return {
      source: [
        'raw/**/*.json',
        'tokens/**/*.json',
      ],
      platforms: {
        css: {
          transforms: [], // keep refs as var(--...), do not resolve
          buildPath: 'resolved/',
          files: [
            {
              destination: 'tokens.css',
              format: 'narrative/css-collections',
            },
          ],
        },
      },
    };
  }
}

(async function run() {
  const config = await loadConfig();

  // 4) Build
  const SD = StyleDictionary.extend(config);
  await SD.buildAllPlatforms();

  console.log(
    `✅ Built tokens with format "narrative/css-collections". ` +
    `Config: ${path.relative(repoRoot, configPath)}`
  );
})().catch((e) => {
  console.error('❌ Token build failed:', e);
  process.exit(1);
});
