import StyleDictionary from 'style-dictionary';
import * as cssCollections from './format-css-collections.mjs';

export default function registerFormats(sd = StyleDictionary) {
  sd.registerFormat({
    name: cssCollections.name,
    formatter: cssCollections.formatter,
  });
}
