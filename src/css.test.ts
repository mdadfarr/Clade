import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

// Checks on app.css itself: rules that fixed bugs must stay.
const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** Declarations of the rule whose selector list is exactly `sel` (first match). */
function rule(sel: string): string {
  const re = new RegExp(`(^|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm');
  const m = css.match(re);
  assert.ok(m, `no rule for ${sel}`);
  return m![2];
}

test('table cells wrap at word boundaries, not anywhere, and keep a minimum width', () => {
  const cells = rule('.claude th, .claude td');
  assert.match(cells, /overflow-wrap:\s*normal/);
  assert.match(cells, /word-break:\s*normal/);
  assert.match(cells, /min-width:\s*7ch/);
  assert.match(rule('.claude td code, .claude th code'), /white-space:\s*nowrap/);
  assert.match(rule('.tablebox'), /overflow-x:\s*auto/);
  // The reply keeps `anywhere` (long paths), so the cells must override it.
  assert.match(rule('.claude'), /overflow-wrap:\s*anywhere/);
});

test('focus ring: the system ring is off, the app ring is accent and keyboard only', () => {
  assert.match(css, /:where\([^)]*button[^)]*\):focus\s*\{\s*outline:\s*none;?\s*\}/);
  const ring = css.match(/:where\([^)]*button[^)]*\):focus-visible\s*\{([^}]*)\}/);
  assert.ok(ring);
  assert.match(ring![1], /outline:\s*2px solid var\(--t-accent\)/);
});

test('the jump arrow is not centered over the reading column', () => {
  const jump = rule('#jump');
  assert.doesNotMatch(jump, /left:\s*50%/);
  assert.match(jump, /right:/);
});

test('dropdowns: every select in the app gets the theme colors, and the page states its color scheme', () => {
  const src = path.join(__dirname, '..', 'src');
  const files = fs.readdirSync(src).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  // Every place that makes a select or option (listed so a new one is seen in review).
  const sites: string[] = [];
  for (const f of files)
    fs.readFileSync(path.join(src, f), 'utf8').split('\n').forEach((l, i) => /['"`](select|option|optgroup)['"`]|<select/.test(l) && sites.push(`${f}:${i + 1}`));
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<select/); // none in the page itself; all come from renderer.ts
  assert.deepStrictEqual(sites.map((s) => s.split(':')[0]), ['renderer.ts', 'renderer.ts']); // the one select helper in Settings
  // The rule covers every select and option, wherever it is, with explicit text and background colors.
  const r = rule('select, option, optgroup');
  assert.match(r, /(^|;)\s*color:\s*var\(--text\)/);
  assert.match(r, /background-color:\s*var\(--surface\)/);
  assert.match(rule(':root'), /color-scheme:\s*light dark/);
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  assert.match(fs.readFileSync(path.join(src, 'renderer.ts'), 'utf8'), /documentElement\.style\.colorScheme = theme/);
});

test('selected text is a neutral tint, never the accent (a red accent made selections look like errors)', () => {
  const sel = rule('::selection');
  assert.match(sel, /var\(--text\)/);
  assert.doesNotMatch(sel, /accent|--t-/);
});

test('big title: no canvas or dots left; a soft accent glow on hover, none with Reduce motion', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', 'src', 'md.ts'), 'utf8');
  assert.doesNotMatch(md, /canvas|halftone|dither/i);
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'src', 'halftone.ts')));
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'), /halftone/);
  assert.match(rule('.claude h1.fx, .claude h2.fx'), /font-size:\s*clamp\(var\(--h1-size\), 11cqi, var\(--fx-size\)\)/);
  const hover = rule('.claude h1.fx:hover, .claude h2.fx:hover');
  assert.match(hover, /text-shadow:[^;]*var\(--t-accent\)[^;]*var\(--fx-glow\)/);
  assert.doesNotMatch(hover, /gradient/);
  assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*\.claude h1\.fx[^{]*\{\s*text-shadow:\s*none/);
});
