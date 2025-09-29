// Custom formatter to emit one CSS file composed by folder "collections"
const HEADER = '/* Base: Global + inline + defaults */';
const STYLES_HEADER = '/* Styles (utility classes) */';

const BP_MIN = { mobile: 0, tablet: 640, desktop: 1024 };
const BP_MEDIA = {
  tablet: `@media (min-width: ${BP_MIN.tablet}px)`,
  desktop: `@media (min-width: ${BP_MIN.desktop}px)`
};

const SECTION_TITLES = {
  global: '/* Base: Global + inline + defaults */',
  breakpoint_mobile: '/* Breakpoint default — breakpoint/mobile */',
  breakpoint_tablet: '/* Breakpoint min-width 640px — breakpoint/tablet */',
  breakpoint_desktop: '/* Breakpoint min-width 1024px — breakpoint/desktop */',
  mode_light: '/* Mode light — mode/light */',
  mode_dark: '/* Mode dark — mode/dark */',
  styles: STYLES_HEADER,
  other_default: '/* Other colorTheme — default */',
};

function isCssVarToken(t) {
  // Only emit CSS variables for tokens that look like design tokens (skip aliases that SD already resolves)
  return typeof t.value !== 'object';
}

function cssVarLine(name, value) {
  return `  --${name}: ${value};`;
}

function toVarName(token) {
  // Use SD's final "name" (already kebab-cased under transformGroup 'css')
  // Strip any leading underscores, just in case
  return token.name.replace(/^_+/, '');
}

function classifyToken(token) {
  // Decide collection from the token's source file path (folder name)
  const fp = token.filePath || '';
  if (fp.includes('/global/')) return { type: 'global' };
  if (fp.includes('/breakpoint/')) {
    if (fp.includes('/mobile/')) return { type: 'breakpoint', bp: 'mobile' };
    if (fp.includes('/tablet/')) return { type: 'breakpoint', bp: 'tablet' };
    if (fp.includes('/desktop/')) return { type: 'breakpoint', bp: 'desktop' };
    // default to mobile if unspecified
    return { type: 'breakpoint', bp: 'mobile' };
  }
  if (fp.includes('/mode/')) {
    if (fp.includes('/light/')) return { type: 'mode', theme: 'light' };
    if (fp.includes('/dark/')) return { type: 'mode', theme: 'dark' };
  }
  if (fp.includes('/styles/')) return { type: 'styles' };
  return { type: 'other' };
}

// Group tokens
function bucketize(tokens) {
  const buckets = {
    global: [],
    breakpoint: { mobile: [], tablet: [], desktop: [] },
    mode: { light: [], dark: [] },
    styles: [],
    other: []
  };

  for (const t of tokens) {
    const c = classifyToken(t);
    if (c.type === 'global') buckets.global.push(t);
    else if (c.type === 'breakpoint') buckets.breakpoint[c.bp].push(t);
    else if (c.type === 'mode') buckets.mode[c.theme].push(t);
    else if (c.type === 'styles') buckets.styles.push(t);
    else buckets.other.push(t);
  }
  // sort for stable output
  const byPath = (a, b) => (a.path.join('/') > b.path.join('/') ? 1 : -1);
  buckets.global.sort(byPath);
  buckets.breakpoint.mobile.sort(byPath);
  buckets.breakpoint.tablet.sort(byPath);
  buckets.breakpoint.desktop.sort(byPath);
  buckets.mode.light.sort(byPath);
  buckets.mode.dark.sort(byPath);
  buckets.styles.sort(byPath);
  buckets.other.sort(byPath);
  return buckets;
}

function emitRootBlock(lines) {
  return `:root {\n${lines.join('\n')}\n}`;
}

function emitSectionComment(title) {
  return `\n${title}\n`;
}

function emitBreakpointBlock(bp, lines) {
  if (bp === 'mobile') {
    return emitRootBlock(lines);
  }
  const media = bp === 'tablet' ? BP_MEDIA.tablet : BP_MEDIA.desktop;
  return `${media} {\n  :root {\n${lines.map(l => l.replace(/^  /, '    ')).join('\n')}\n  }\n}\n`;
}

function isElevationClass(token) {
  return token.name.startsWith('elevation-') || token.path.includes('elevation');
}

function isTextClass(token) {
  return token.name.startsWith('text-') || token.path.includes('text');
}

function emitStyles(tokens) {
  // Very light opinionated mapper: if a token resolves to a valid CSS declaration list, emit it.
  // Expect tokens shaped like:
  //   { name: 'elevation-elevation-action', value: '0 1px 4px 0 rgba(16, 16, 14, 0.08)' }
  // or
  //   { name: 'text-display-regular-lg-font-size', value: 'var(--display-fontsize-lg)' } etc.
  // If you already store full classes in tokens, just output directly.

  const rules = [];
  const classBuckets = new Map();

  for (const t of tokens) {
    if (!isCssVarToken(t)) continue;

    // Try to detect "*.box-shadow" or "*-shadow" values → elevation classes
    if (isElevationClass(t)) {
      rules.push(`.${t.name} {\n  box-shadow: ${t.value};\n}`);
      continue;
    }

    // Text classes: group properties by the class name prefix (before the last dash that is a property key)
    if (isTextClass(t)) {
      // Expect names like: text-display-regular-lg-font-size, text-display-regular-lg-font-weight, ...
      const parts = t.name.split('-');
      if (parts.length > 3) {
        const cls = parts.slice(0, -2).join('-'); // crude but works with your naming
        const propKey = parts.slice(-2).join('-'); // e.g., font-size
        const map = classBuckets.get(cls) ?? new Map();
        map.set(propKey, t.value);
        classBuckets.set(cls, map);
      }
    }
  }

  for (const [cls, propMap] of classBuckets) {
    const decl = [];
    for (const [k, v] of propMap) {
      // convert dashed end to valid CSS property
      decl.push(`  ${k}: ${v};`);
    }
    rules.push(`.${cls} {\n${decl.join('\n')}\n}`);
  }

  if (!rules.length) return '';
  return `${STYLES_HEADER}\n${rules.join('\n\n')}\n`;
}

export default {
  name: 'css/collections',
  format: ({ dictionary }) => {
    const buckets = bucketize(dictionary.allTokens);

    const out = [];

    // GLOBAL
    if (buckets.global.length) {
      const lines = [];
      for (const t of buckets.global) {
        if (!isCssVarToken(t)) continue;
        lines.push(cssVarLine(toVarName(t), t.value));
      }
      out.push(emitSectionComment(SECTION_TITLES.global));
      out.push(emitRootBlock(lines));
    }

    // BREAKPOINTS
    const emitBp = (bp) => {
      const set = buckets.breakpoint[bp];
      if (!set.length) return;
      const lines = [];
      for (const t of set) {
        if (!isCssVarToken(t)) continue;
        lines.push(cssVarLine(toVarName(t), t.value));
      }
      const titleKey =
        bp === 'mobile' ? 'breakpoint_mobile' :
        bp === 'tablet' ? 'breakpoint_tablet' : 'breakpoint_desktop';
      out.push(emitSectionComment(SECTION_TITLES[titleKey]));
      out.push(emitBreakpointBlock(bp, lines));
    };
    emitBp('mobile');
    emitBp('tablet');
    emitBp('desktop');

    // MODES (themes)
    const emitMode = (theme) => {
      const set = buckets.mode[theme];
      if (!set.length) return;
      const lines = [];
      for (const t of set) {
        if (!isCssVarToken(t)) continue;
        lines.push(cssVarLine(toVarName(t), t.value));
      }
      const selector = `[data-theme="${theme}"]`;
      const body = `  --builder-mode: ${theme === 'light' ? 'Light' : 'Dark'};`;
      out.push(emitSectionComment(
        theme === 'light' ? SECTION_TITLES.mode_light : SECTION_TITLES.mode_dark
      ));
      out.push(`${selector} {\n${lines.join('\n')}\n${body}\n}`);
    };
    emitMode('light');
    emitMode('dark');

    // OTHER (e.g., colorTheme/fontTheme sets from folders other than the four reserved ones)
    if (buckets.other.length) {
      out.push(emitSectionComment(SECTION_TITLES.other_default));
      // Group by top-level token path head to avoid mixing themes/styles
      const groups = new Map();
      for (const t of buckets.other) {
        const head = t.path?.[0] ?? 'other';
        (groups.get(head) ?? groups.set(head, []).get(head)).push(t);
      }
      // Default :root block for other/default-ish variables
      const rootLines = [];
      const deferredBlocks = [];
      for (const [groupName, toks] of groups) {
        // If tokens look like selector-scoped sets (e.g., data-colorTheme or data-fontTheme),
        // look for a 'selector' attribute (custom) or infer from path.
        const selectorTokens = toks.filter(tt => (tt.attributes && tt.attributes.selector));
        if (selectorTokens.length) {
          const selMap = new Map();
          for (const tt of selectorTokens) {
            const sel = tt.attributes.selector;
            const arr = selMap.get(sel) ?? [];
            arr.push(tt);
            selMap.set(sel, arr);
          }
          for (const [sel, arr] of selMap) {
            const lines = arr.filter(isCssVarToken).map(tt => cssVarLine(toVarName(tt), tt.value));
            deferredBlocks.push(`${sel} {\n${lines.join('\n')}\n}`);
          }
        } else {
          // Otherwise just put them in :root
          for (const tt of toks) {
            if (!isCssVarToken(tt)) continue;
            rootLines.push(cssVarLine(toVarName(tt), tt.value));
          }
        }
      }
      if (rootLines.length) out.push(emitRootBlock(rootLines));
      if (deferredBlocks.length) out.push(deferredBlocks.join('\n\n'));
    }

    // STYLES (utility classes)
    if (buckets.styles.length) {
      out.push(emitStyles(buckets.styles));
    }

    return out.filter(Boolean).join('\n\n');
  }
};
