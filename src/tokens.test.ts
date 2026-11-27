import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { ACCENT_NAMES, ACCENTS, BACKGROUNDS, BASE } from './themes';
import { DEFAULT_DESIGN, designOverrides, parseDesign } from './design';

const root = path.join(__dirname, '..');
const tokens = fs.readFileSync(path.join(root, 'tokens.css'), 'utf8');

/** The declarations of one rule, by its exact selector. */
function rule(selector: string): Record<string, string> {
  const m = new RegExp(`(^|\\n)${selector.replace(/[[\]().*+?^$|]/g, '\\$&')}\\s*\\{`).exec(tokens);
  assert.ok(m, `no rule ${selector}`);
  const at = m.index;
  const body = tokens.slice(tokens.indexOf('{', at) + 1, tokens.indexOf('}', at));
  const out: Record<string, string> = {};
  for (const m of body.replace(/\/\*[^]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim().toLowerCase();
  return out;
}

test('tokens.css and the design.json copy in themes.ts hold the same surfaces', () => {
  for (const [theme, base] of [['dark', BASE.dark], ['ivory', BASE.light]] as const) {
    const r = rule(`body[data-theme='${theme}']`);
    const pairs: [string, string][] = [
      ['--bg', base.background], ['--text-1', base.text], ['--text-2', base.mutedText], ['--sidebar-bg', base.surface], ['--surface', base.surface],
      ['--row-active', base.raised], ['--raised', base.raised], ['--user-bubble', base.userBubble], ['--code-bg', base.codeBackground],
    ];
    for (const [k, v] of pairs) assert.strictEqual(r[k], v, `${theme} ${k}`);
    assert.strictEqual(r['--border'], base.border, `${theme} border`);
  }
});

test('DESIGN.md values, exactly (sampled from Claude chat)', () => {
  const ivory = rule(`body[data-theme='ivory']`);
  const want: Record<string, string> = {
    '--bg': '#ffffff', '--sidebar-bg': '#fafafa', '--input-bg': '#ffffff', '--row-new': '#e0e0e0', '--row-active': '#e0e0e0', '--text-1': '#191919',
    '--text-3': '#646464', '--text-ctl': '#666666', '--border': '#dcdcdc', '--sidebar-divider': '#e5e5e5', '--footer-divider': '#dcdcdc', '--scrollbar': '#b0b0b0',
    '--input-shadow': '0 4px 20px rgba(0, 0, 0, 0.06)',
  };
  for (const [k, v] of Object.entries(want)) assert.strictEqual(ivory[k], v, `ivory ${k}`);
  const dark = rule(`body[data-theme='dark']`);
  const wantDark: Record<string, string> = {
    '--bg': '#191919', '--sidebar-bg': '#1f1f1f', '--input-bg': '#303030', '--row-new': '#404040', '--row-active': '#404040', '--text-1': '#f0f0f0',
    '--text-3': '#9e9e9e', '--text-ctl': '#9c9c9c', '--border': '#414141', '--sidebar-divider': '#302f2f', '--footer-divider': '#3a3a3a', '--scrollbar': '#6d6d6d',
    '--input-shadow': '0 4px 20px rgba(0, 0, 0, 0.25)',
  };
  for (const [k, v] of Object.entries(wantDark)) assert.strictEqual(dark[k], v, `dark ${k}`);
  const root = rule(':root');
  for (const [k, v] of Object.entries({ '--sidebar-width': '272px', '--chat-width': '720px', '--r-new': '10px', '--r-row': '8px', '--r-bubble': '16px', '--r-code': '10px', '--r-input': '20px', '--r-send': '10px', '--avatar-size': '28px', '--body-size': '17px', '--msg-size': '15px', '--code-size': '13px', '--body-lh': '1.65', '--lh': '1.55' }))
    assert.strictEqual(root[k], v, k);
  assert.strictEqual(rule(`body[data-theme='ivory'][data-accent='default']`)['--accent'], '#d97757');
  assert.strictEqual(rule(`body[data-theme='dark'][data-accent='default']`)['--accent'], '#d97757');
  // the send button is a deeper shade of the default accent; with any other accent it is the accent
  for (const t of ['ivory', 'dark']) assert.strictEqual(rule(`body[data-theme='${t}'][data-accent='default']`)['--send'], '#c6623f', t);
  assert.match(tokens, /\nbody \{ --send: var\(--accent\); \}/);
  assert.doesNotMatch(tokens, /--border:\s*rgba|#42413e/i); // the dark border is solid
});

test('tokens.css has every accent, with the fills and text shades of themes.ts', () => {
  for (const a of ACCENT_NAMES) {
    const s = ACCENTS[a];
    const g = rule(`body[data-theme='dark'][data-accent='${a}']`);
    const i = rule(`body[data-theme='ivory'][data-accent='${a}']`);
    assert.deepStrictEqual([g['--accent'], g['--accent-text'], g['--on-accent']], [s.fill, s.dark, s.on].map((x) => x.toLowerCase()), `${a} dark`);
    assert.deepStrictEqual([i['--accent'], i['--accent-text'], i['--on-accent']], [s.fillLight ?? s.fill, s.light, s.onLight ?? s.on].map((x) => x.toLowerCase()), `${a} ivory`);
    for (const r of [g, i]) assert.strictEqual(r['--send'], s.send?.toLowerCase(), `${a} send`);
  }
});

test('the default design sets nothing over the tokens but the color tones; a changed value does', () => {
  const o = designOverrides(DEFAULT_DESIGN, 'dark');
  assert.deepStrictEqual(Object.keys(o).filter((k) => !k.startsWith('--t-')), []);
  const d = structuredClone(DEFAULT_DESIGN);
  d.fonts.reply = 'Georgia, serif';
  d.type.body = 18;
  d.space.exchange = 50;
  assert.deepStrictEqual([designOverrides(d, 'light')['--font-reply'], designOverrides(d, 'light')['--body-size'], designOverrides(d, 'light')['--sp-exchange']], ['Georgia, serif', '18px', '50px']);
});

test('no glass, blur, glows or gradients anywhere; the input box has the only shadow on the page', () => {
  const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8').replace(/\/\*[^]*?\*\//g, '');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const src of [css, tokens.replace(/\/\*[^]*?\*\//g, '')]) {
    assert.doesNotMatch(src, /backdrop-filter|blur\(|gradient\s*\(|--glass/);
  }
  assert.doesNotMatch(html, /glass/);
  assert.ok(!fs.existsSync(path.join(root, 'glass.css')));
  assert.match(css, /\.composer \{[^}]*box-shadow: var\(--input-shadow\)/);
});

test('background: two presets in Settings (the themes); an old "claude" preset still reads; pictures are checked', () => {
  assert.deepStrictEqual(BACKGROUNDS.map((b) => b.id), ['ivory', 'dark']);
  const ok = (background: unknown) => parseDesign(JSON.stringify({ ...DEFAULT_DESIGN, background })).background;
  assert.deepStrictEqual(ok({ preset: 'claude' }), { preset: 'claude' });
  assert.deepStrictEqual(ok({ picture: 'sea view.JPG' }), { picture: 'sea view.JPG' });
  assert.strictEqual(parseDesign(JSON.stringify(DEFAULT_DESIGN)).background, undefined);
  const bad = (background: unknown, msg: RegExp) => assert.throws(() => parseDesign(JSON.stringify({ ...DEFAULT_DESIGN, background })), msg);
  for (const p of ['../x.png', 'a/b.png', '/etc/x.png', 'x.svg', 'x.html', '.x.png', 'x'.repeat(90) + '.png']) bad({ picture: p }, /background\.picture/);
  bad({ preset: 'neon' }, /background\.preset/);
  bad({ preset: 'claude', picture: 'a.png' }, /either "preset" or "picture"/);
  bad({ url: 'http://x' }, /unknown key "url" in background/);
});

test('design.json still wins over the tokens: fonts, sizes, spacing; old defaults count as not set', () => {
  const d = structuredClone(DEFAULT_DESIGN);
  d.fonts.ui = 'Georgia, serif';
  d.type.message = 16;
  d.space.paragraph = 20;
  d.layout.chatWidth = 800;
  const o = designOverrides(d, 'light');
  assert.deepStrictEqual([o['--font-ui'], o['--msg-size'], o['--sp-paragraph'], o['--chat-width']], ['Georgia, serif', '16px', '20px', '800px']);
  const old = structuredClone(DEFAULT_DESIGN);
  old.type.body = 19;
  old.type.h1.weight = 700;
  old.space.exchange = 36;
  assert.deepStrictEqual(Object.keys(designOverrides(old, 'dark')).filter((k) => !k.startsWith('--t-')), []);
});
