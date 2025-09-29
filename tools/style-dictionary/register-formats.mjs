/**
 * Register custom Style Dictionary formats/filters/transforms
 * exported by our local format modules.
 */
import cssCollections from "./formats/format-css-collections.mjs";

export default function registerFormats(StyleDictionary) {
  StyleDictionary.registerFormat({
    name: "narrative/css-collections",
    formatter: cssCollections, // MUST be 'formatter' not 'format'
  });
}
