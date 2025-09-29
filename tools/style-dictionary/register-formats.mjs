import StyleDictionary from 'style-dictionary';
import collectionsFormatter from './formats/format-css-collections.mjs';

StyleDictionary.registerFormat({
  name: 'narrative/css-collections',
  formatter: collectionsFormatter,
});

export default 'narrative/css-collections';
