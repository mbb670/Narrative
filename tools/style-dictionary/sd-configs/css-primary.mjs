// A preset that emits tokens-test.css using the generic CSS format.
// Add more presets beside this file as needed.
export default {
  source: ["tokens/raw/**/*.json"],
  platforms: {
    cssPrimary: {
      transformGroup: "css",
      buildPath: "tokens/resolved/",
      files: [
        {
          destination: "tokens-test.css",
          format: "custom/css-collections"  // uses the registered formatter
        }
      ]
    }
  }
};
