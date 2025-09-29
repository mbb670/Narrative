// tools/style-dictionary/build.mjs
import StyleDictionary from 'style-dictionary';
import './register-formats.mjs';            // registers css/collections
import config from './sd-configs/css-primary.mjs';

async function run() {
  try {
    const sd = new StyleDictionary(config); // SD v4 constructor
    await sd.buildAllPlatforms();
    console.log('[tokens] Build complete.');
  } catch (err) {
    console.error('[tokens] Token build failed:', err);
    process.exit(1);
  }
}
run();
