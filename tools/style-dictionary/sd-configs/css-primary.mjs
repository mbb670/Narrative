/**
 * Primary SD config that compiles all JSON in tokens/raw into one CSS file.
 * Output: tokens/resolved/tokens-test.css
 */
export default {
  source: ["tokens/raw/**/*.json"],

  // You can add "include" here if you have shared sets you want merged in.
  // include: ["tokens/shared/**/*.json"],

  platforms: {
    css: {
      // The built-in transform group for CSS variables
      transformGroup: "css",
      // IMPORTANT: write only inside tokens/resolved/
      buildPath: "tokens/resolved/",
      files: [
        {
          destination: "tokens-test.css",
          format: "narrative/css-collections", // our custom formatter
        },
      ],
    },
  },
};
