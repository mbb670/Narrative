// tools/style-dictionary/register-formats.mjs
import StyleDictionary from "style-dictionary";
import cssCollections from "./formats/format-css-collections.mjs";

export default function registerFormats() {
  const fmts = [cssCollections];

  fmts.forEach((f) => {
    if (!f || typeof f.name !== "string" || typeof f.format !== "function") {
      throw new Error(
        `Invalid format export. Expected { name: string, format: function }`
      );
    }
    StyleDictionary.registerFormat(f);
  });
}
