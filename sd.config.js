/** @type {import('style-dictionary').Config} */
module.exports = {
  source: ["tokens/raw/**/*.json"],

  platforms: {
    css: {
      transformGroup: "css",
      buildPath: "tokens/resolved/",
      files: [
        {
          destination: "tokens-test.css",
          format: "css/variables",
          options: { selector: ":root", outputReferences: true }
        }
      ]
    },
    js: {
      transformGroup: "js",
      buildPath: "tokens/resolved/",
      files: [
        {
          destination: "tokens-test.js",
          format: "javascript/es6",
          options: { outputReferences: true }
        }
      ]
    }
  }
};
