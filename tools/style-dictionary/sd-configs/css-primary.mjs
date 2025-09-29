// tools/style-dictionary/sd-configs/css-primary.mjs
// Primary SD config that builds a single CSS file using the custom format above.

export default {
  // All your token JSON sits under tokens/raw/**/*
  source: ["tokens/raw/**/*.json"],

  platforms: {
    css: {
      // Keep transforms minimal so names/values stay as in the JSON
      transforms: ["attribute/cti", "name/cti/kebab"],

      buildPath: "tokens/resolved/",
      files: [
        {
          destination: "tokens-test.css",
          format: "css/collections"
        }
      ]
    }
  }
};
