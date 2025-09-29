// tools/style-dictionary/sd-configs/css-primary.mjs
// SD v4 config – no legacy transforms; we compute names ourselves in the format.
// Keep references (var(--...)) with outputReferences: true.

export default {
  source: ["tokens/raw/**/*.json"],
  platforms: {
    css: {
      // No transforms necessary; our formatter builds names from token.path
      buildPath: "tokens/resolved/",
      files: [
        {
          destination: "tokens-test.css",
          format: "css/collections",
          options: { outputReferences: true },
        },
      ],
    },
  },
};
