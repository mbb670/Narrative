// Primary build config (v3-style). Writes to tokens/resolved/tokens-test.css
export default {
  // Optional, but useful while debugging collisions etc.
  log: { verbosity: 'verbose' },

  // Your raw token JSON
  source: ['tokens/raw/**/*.json'],

  platforms: {
    css: {
      // Use SD's built-in css transformGroup to avoid 'name/cti/kebab' errors
      transformGroup: 'css',

      // Output folder relative to repo root
      buildPath: 'tokens/resolved/',

      files: [
        {
          destination: 'tokens-test.css',
          // <-- this is the custom format we register below
          format: 'css/collections',

          // You can pass options down to the formatter here if desired
          options: {
            // e.g., classPrefix: '', etc.
          }
        }
      ]
    }
  }
};
