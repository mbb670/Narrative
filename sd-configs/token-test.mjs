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
          format: "custom/css-token-test" // provided by our formatter module
        }
      ]
    }
  }
};
