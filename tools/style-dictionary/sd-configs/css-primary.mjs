export default {
  // All raw token JSON
  source: ["tokens/raw/**/*.json"],

  // If you have shared includes, add them here:
  // include: ["tokens/shared/**/*.json"],

  platforms: {
    css: {
      transformGroup: "css",
      buildPath: "tokens/resolved/",
      files: [
        {
          destination: "tokens-test.css",
          format: "narrative/css-collections",
        },
      ],
    },
  },
};
