import registerFormatName from '../tools/style-dictionary/register-formats.mjs';

export default {
  // IMPORTANT: only the raw sources here
  source: [
    'raw/**/*.json',      // <- your actual tokens
    'tokens/**/*.json'    // (keep if you have some here)
  ],

  // No transforms that resolve references.
  platforms: {
    css: {
      transforms: [],          // don't use 'resolveReferences' or groups that include it
      buildPath: 'resolved/',  // wherever you want the CSS written
      files: [
        {
          destination: 'tokens.css',
          format: 'narrative/css-collections' // <- our formatter
        }
      ]
    }
  }
};
