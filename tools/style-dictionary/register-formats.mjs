// Ensures our custom 'css/collections' format is registered for SD v3
import StyleDictionary from 'style-dictionary';
import cssCollectionsMod from './formats/format-css-collections.mjs';

export default function registerFormats() {
  const mod = cssCollectionsMod?.default ?? cssCollectionsMod;

  // Accept a couple of export shapes safely
  let fmtObj;
  if (typeof mod === 'function') {
    fmtObj = mod(StyleDictionary);            // if the module exports a factory
  } else {
    fmtObj = mod;                              // if it exports the object directly
  }

  if (!fmtObj || !fmtObj.name) {
    throw new Error("[register-formats] format missing 'name'.");
  }

  // SD v3 expects 'format' (not 'formatter')
  const formatFn = fmtObj.format ?? fmtObj.formatter;
  if (typeof formatFn !== 'function') {
    throw new Error("[register-formats] 'format' must be a function.");
  }

  StyleDictionary.registerFormat({
    name: fmtObj.name,
    format: formatFn
  });
}
