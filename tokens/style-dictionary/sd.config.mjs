// Minimal Style Dictionary v4 config to merge all raw tokens into a single CSS vars file
export default {
  // Merge EVERY json token file under tokens/raw
  source: ['tokens/raw/**/*.json'],

  // One simple platform: CSS variables
  platforms: {
    css: {
      transformGroup: 'css',
      buildPath: 'tokens/resolved/',
      files: [
        {
          destination: 'tokens-test.css',
          format: 'css/variables',
          options: {
            showFileHeader: true,
            // keep references like {color.brand} as links when possible
            outputReferences: true
          }
        }
      ]
    }
  }
};
