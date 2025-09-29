// ESM entry for building tokens with Style Dictionary v3
import StyleDictionary from 'style-dictionary';
import registerFormats from './register-formats.mjs';
import config from './sd-configs/css-primary.mjs';

async function run() {
  try {
    registerFormats();                // <-- important: register BEFORE building
    const sd = new StyleDictionary(config);  // v3 constructor API
    await sd.buildAllPlatforms();
    console.log('[tokens] Build complete.');
  } catch (err) {
    console.error('[tokens] Token build failed:', err);
    process.exit(1);
  }
}

run();
