// sd-configs/token-test.mjs
export default {
  source: ["tokens/raw/**/*.json"],
  platforms: {
    cssTokenTest: {
      transformGroup: "css",
      buildPath: "tokens/resolved/",
      files: [
        {
          destination: "tokens-test.css",
          format: "custom/css-primary"   // <- updated to the new registered name
        }
      ]
    }
  }
};
