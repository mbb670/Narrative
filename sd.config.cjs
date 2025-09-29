// sd.config.cjs
// Reads from tokens/raw/** and writes to tokens/resolved/
// Edit the "platforms" section to add/remove outputs.
// You can keep dropping new JSON files inside tokens/raw/* and they'll be picked up.

const path = require("path");

/** @type {import('style-dictionary').Config} */
module.exports = {
  // All your token sources
  source: [
    "tokens/raw/**/*.json"
  ],

  // (Optional) You can include pre-resolved tokens or shared pieces if needed:
  // include: ["tokens/shared/**/*.json"],

  // Where to put the generated files
  // We'll keep your existing 'resolved' folder and overwrite on every build.
  platforms: {
    css: {
      transformGroup: "css",
      buildPath: "tokens/resolved/",
      files: [
        {
          destination: "tokens-test.css",
          format: "css/variables",
          options: {
            // Add a top-level :root selector; Style Dictionary handles scoping.
            selector: ":root",
            outputReferences: true // lets SD reference other vars when possible
          }
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
          options: {
            // creates: export const tokens = { ... }
            // You can import this in demos for quick usage.
            outputReferences: true
          }
        }
      ]
    }

    // Add more outputs here anytime, for example:
    // "scss": { transformGroup: "scss", buildPath: "tokens/resolved/", files: [{ destination: "_tokens.scss", format: "scss/variables" }] },
    // "json": { transformGroup: "js",  buildPath: "tokens/resolved/", files: [{ destination: "tokens.json",  format: "json" }] },
  }
};
