// Generates public/tokens.css from a design system's tokens.json.
// Usage: node tools/gen-tokens.js design-system/tokens.json public/tokens.css
//
// The stylesheets reference a fixed set of variable names. A token set is free to
// name its tokens differently, so ALIASES below maps each name the CSS uses onto an
// ordered list of candidates; the first candidate the set actually defines wins.
// A name the set defines itself is never aliased. This is what lets one generator
// serve more than one token set without editing every selector.
const fs = require('fs');

const [, , src, out] = process.argv;
const t = JSON.parse(fs.readFileSync(src, 'utf8'));
const themes = t.color.themes.map(x => x.id);
const [first, ...rest] = themes;

const resolve = (v, theme) => (typeof v === 'string' ? v : (v[theme] ?? v[first]));

// Every token name this set actually defines, across all families.
const defined = new Set();
for (const [key, fam] of Object.entries(t)) {
  if (key === 'type' || !fam || !Array.isArray(fam.tokens)) continue;
  for (const tok of fam.tokens) defined.add(tok.name);
}

const ALIASES = {
  // Short names inherited from the first system.
  ink:        ['band-ink', 'ink-900'],
  ink2:       ['band-raised', 'ink-800'],
  paper:      ['bg-canvas'],
  card:       ['bg-raised', 'bg-surface'],
  text:       ['label-primary', 'text-primary'],
  mute:       ['label-secondary', 'text-secondary'],
  onDark:     ['label-on-ink', 'on-ink'],
  onDarkMute: ['label-on-ink-secondary', 'on-ink-secondary'],
  blue:       ['accent'],
  blueD:      ['accent-on-ink', 'accent-bright'],
  blueText:   ['accent-text', 'accent-bright'],
  line:       ['separator-on-ink', 'separator'],
  lineD:      ['separator'],
  radius:     ['radius-lg'],
  // Names the stylesheets use directly that a given set may not define.
  'bg-raised':              ['bg-surface'],
  'bg-raised-2':            ['bg-elevated'],
  'bg-sunken':              ['bg-void'],
  'band-ink':               ['ink-900'],
  'band-raised':            ['ink-800'],
  'band-raised-2':          ['ink-700'],
  'label-primary':          ['text-primary'],
  'label-secondary':        ['text-secondary'],
  'label-tertiary':         ['text-tertiary'],
  'label-on-ink':           ['on-ink'],
  'label-on-ink-secondary': ['on-ink-secondary'],
  'accent-text':            ['accent-bright'],
  'accent-deep':            ['accent'],
  'accent-on-ink':          ['accent-bright'],
  'on-accent-secondary':    ['on-accent'],
  'separator-on-ink':       ['separator'],
  'glass-ink':              ['glass-nav'],
  'glass-sheet':            ['glass-nav'],
  'scrim-hero':             ['scrim'],
  'shadow-hero':            ['shadow-panel'],
  'shadow-xs':              ['shadow-card'],
};

// Per-theme families: color + shadow.
// `color-scheme` is emitted with them so the browser's own widgets — the date
// picker, the select popup, scrollbars — follow the theme instead of staying light.
const perTheme = theme => {
  const lines = [`  color-scheme: ${theme};`];
  for (const tok of t.color.tokens) lines.push(`  --${tok.name}: ${resolve(tok.value, theme)};`);
  if (t.shadow) for (const tok of t.shadow.tokens) lines.push(`  --${tok.name}: ${resolve(tok.value, theme)};`);
  return lines.join('\n');
};

const STATIC = Object.keys(t).filter(
  k => k !== 'color' && k !== 'shadow' && k !== 'type' && t[k] && Array.isArray(t[k].tokens)
);

const L = [];
L.push(`/* ${t.name} — generated from ${src}. Do not edit by hand. */`);
L.push(`/* Regenerate: node tools/gen-tokens.js ${src} ${out} */`);
L.push('');

L.push(`:root,\n:root[data-theme="${first}"] {`);
L.push(perTheme(first));
L.push('}');
L.push('');

for (const theme of rest) {
  L.push(`@media (prefers-color-scheme: ${theme}) {`);
  L.push(`  :root:not([data-theme="${first}"]) {`);
  L.push(perTheme(theme).replace(/^ {2}/gm, '    '));
  L.push('  }');
  L.push('}');
  L.push('');
  L.push(`:root[data-theme="${theme}"] {`);
  L.push(perTheme(theme));
  L.push('}');
  L.push('');
}

L.push(':root {');
for (const fam of STATIC) {
  L.push(`  /* ${fam} */`);
  for (const tok of t[fam].tokens) L.push(`  --${tok.name}: ${tok.value};`);
}
L.push('  /* font families */');
for (const [k, v] of Object.entries(t.type.families)) L.push(`  --font-${k}: ${v};`);
L.push('}');
L.push('');

L.push('/* type styles */');
for (const g of t.type.groups) {
  for (const s of g.styles) {
    const fam = s.family || g.family;
    const d = [
      `font-family: var(--font-${fam})`,
      `font-size: ${s.fontSize}`,
      `line-height: ${s.lineHeight}`,
      `font-weight: ${s.fontWeight}`,
    ];
    if (s.letterSpacing !== undefined) d.push(`letter-spacing: ${s.letterSpacing}`);
    L.push(`.${s.name} { ${d.join('; ')}; }`);
  }
}
L.push('');

// Compatibility aliases: only for names this set does not define itself.
const emitted = [], unresolved = [];
for (const [name, candidates] of Object.entries(ALIASES)) {
  if (defined.has(name)) continue;
  const hit = candidates.find(c => defined.has(c));
  if (hit) emitted.push(`  --${name}: var(--${hit});`);
  else unresolved.push(name);
}
if (emitted.length) {
  L.push('/* Compatibility aliases — names the stylesheets use that this token set');
  L.push('   does not define itself. Generated, not hand-maintained. */');
  L.push(':root {');
  L.push(emitted.join('\n'));
  L.push('}');
  L.push('');
}

fs.writeFileSync(out, L.join('\n'), 'utf8');
console.log(
  `wrote ${out}: ${t.color.tokens.length} colors x ${themes.length} themes, ` +
  `${STATIC.map(f => t[f].tokens.length).reduce((a, b) => a + b, 0)} scale tokens, ` +
  `${t.type.groups.reduce((a, g) => a + g.styles.length, 0)} type styles, ` +
  `${emitted.length} aliases`
);
if (unresolved.length) {
  console.warn('WARNING: no source token for: ' + unresolved.join(', '));
  process.exitCode = 1;
}
