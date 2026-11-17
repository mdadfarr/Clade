import { test } from 'node:test';
import * as assert from 'node:assert';
import { contrastRatio, DEFAULT_DESIGN, parseDesign, Roles, TONES } from './design';
import { ACCENT_NAMES, ACCENTS, applyLook, BASE, DEFAULT_LOOK, lookColors, matchLook } from './themes';
import * as fs from 'fs';
import * as path from 'path';

const FLOOR = 4.5;
const MODES = ['light', 'dark'] as const;
const tones = DEFAULT_DESIGN.colors.tones;

// Where each color is drawn. Body and muted text: on every ground. Colored text (tones and the accent):
// replies on the background, code and diffs on the code background, notes and errors on surfaces.
// `raised` only holds hover rows, code headers and icons, so only body and muted text are checked there.
const TEXT_GROUNDS = ['background', 'surface', 'raised', 'codeBackground'] as const;
const COLOR_GROUNDS = ['background', 'surface', 'codeBackground'] as const;

test('every accent x light/dark: all text reads at 4.5 or more where it is drawn', () => {
  const fails: string[] = [];
  let checks = 0;
  const check = (what: string, fg: string, bg: string) => {
    checks++;
    const r = contrastRatio(fg, bg);
    if (r < FLOOR) fails.push(`${what}: ${fg} on ${bg} = ${r.toFixed(2)}`);
  };
  for (const ac of ACCENT_NAMES)
      for (const m of MODES) {
        const c = lookColors({ accent: ac });
        const r: Roles = c[m];
        const at = `${ac}/${m}`;
        for (const g of TEXT_GROUNDS) {
          check(`${at} text on ${g}`, r.text, r[g]);
          check(`${at} mutedText on ${g}`, r.mutedText, r[g]);
        }
        for (const g of COLOR_GROUNDS) {
          check(`${at} accent text on ${g}`, c.accent[m], r[g]);
          for (const t of TONES) if (t !== 'accent') check(`${at} tone ${t} on ${g}`, tones[t][m], r[g]);
        }
        check(`${at} userText on userBubble`, r.userText, r.userBubble);
        check(`${at} accentOn on accentFill`, r.accentOn, r.accentFill);
      }
  assert.deepStrictEqual(fails, []);
  assert.ok(checks > 9 * 2 * 40);
});

test('every look applied to the default design passes the file validator as is', () => {
    for (const accent of ACCENT_NAMES) {
      const d = applyLook(DEFAULT_DESIGN, { accent });
      assert.deepStrictEqual(parseDesign(JSON.stringify(d)), d);
    }
});

test('picking writes exactly the stored values and the accent name; nothing else changes', () => {
  const base = structuredClone(DEFAULT_DESIGN);
  base.type.body = 21;
  base.layout.chatWidth = 900;
  base.colors.tones.bad = { light: '#a02020', dark: '#ff9a90' };
  const d = applyLook(base, { accent: 'red' });
  assert.deepStrictEqual(d.colors.light, { ...BASE.light, accentFill: ACCENTS.red.fill, accentOn: ACCENTS.red.on });
  assert.deepStrictEqual(d.colors.dark, { ...BASE.dark, accentFill: ACCENTS.red.fill, accentOn: ACCENTS.red.on });
  assert.deepStrictEqual(d.colors.tones.accent, { light: ACCENTS.red.light, dark: ACCENTS.red.dark });
  assert.deepStrictEqual(d.look, { accent: 'red' });
  const rest = (x: typeof d) => ({ ...x, colors: { tones: { ...x.colors.tones, accent: null } }, look: null });
  assert.deepStrictEqual(rest(d), rest(base)); // sizes, other tones, everything else untouched
  assert.strictEqual(base.look?.accent, 'cyan'); // the input is not changed
});

test('the default design is the base surfaces with Cyan, and reset brings it back', () => {
  assert.deepStrictEqual(DEFAULT_LOOK, { accent: 'cyan' });
  assert.deepStrictEqual(matchLook(DEFAULT_DESIGN), DEFAULT_LOOK);
  assert.deepStrictEqual(applyLook(applyLook(DEFAULT_DESIGN, { accent: 'green' }), DEFAULT_LOOK), DEFAULT_DESIGN);
});

test('a hand-edited color shows as Custom; editing it back to the stored value matches again', () => {
  const d = applyLook(DEFAULT_DESIGN, { accent: 'blue' });
  assert.deepStrictEqual(matchLook(d), { accent: 'blue' });
  const edited = structuredClone(d);
  edited.colors.dark.surface = '#202020';
  assert.strictEqual(matchLook(edited), 'custom');
  const tone = structuredClone(d);
  tone.colors.tones.accent.light = '#1F63B6';
  assert.strictEqual(matchLook(tone), 'custom');
  const upper = structuredClone(d);
  upper.colors.light.text = upper.colors.light.text.toUpperCase();
  assert.deepStrictEqual(matchLook(upper), { accent: 'blue' }); // hex case does not matter
});

test('old files stay valid: no look key is fine, and the old default colors count as Cyan', () => {
  const old = structuredClone(DEFAULT_DESIGN) as any;
  delete old.look;
  Object.assign(old.colors.light, { surface: '#f0ede6', raised: '#e7e3da', codeBackground: '#efece4' });
  const parsed = parseDesign(JSON.stringify(old));
  assert.strictEqual(parsed.look, undefined);
  assert.deepStrictEqual(matchLook(parsed), DEFAULT_LOOK);
  // a recorded look whose colors were changed is Custom, even if they equal the old default
  assert.strictEqual(matchLook({ ...parsed, look: { accent: 'cyan' } }), 'custom');
});

test('look key: only known accents, no extra keys; an old theme name is accepted and dropped', () => {
  const bad = (look: unknown, msg: RegExp) => assert.throws(() => parseDesign(JSON.stringify({ ...DEFAULT_DESIGN, look })), msg);
  for (const theme of ['paper', 'slate', 'sand', 'ink', 'neon'])
    assert.deepStrictEqual(parseDesign(JSON.stringify({ ...DEFAULT_DESIGN, look: { theme, accent: 'red' } })).look, { accent: 'red' });
  bad({ theme: 'paper', accent: 'lime' }, /look\.accent/);
  bad({ theme: 'paper', accent: 'cyan', extra: 1 }, /unknown key "extra" in look/);
  bad('paper', /look must be an object/);
});

test('accent table values (plan 3, section 5)', () => {
  assert.deepStrictEqual(
    ACCENT_NAMES.map((a) => [a, ACCENTS[a].fill, ACCENTS[a].light, ACCENTS[a].dark, ACCENTS[a].on]),
    [
      ['cyan', '#00E2E6', '#00787A', '#00E2E6', '#1d1c1a'],
      ['mint', '#5EDFA4', '#1B7A50', '#5EDFA4', '#1d1c1a'],
      ['blue', '#6CB2FF', '#1F63B5', '#7DB8FF', '#1d1c1a'],
      ['violet', '#A99BFF', '#5B4BC4', '#B3A7FF', '#1d1c1a'],
      ['pink', '#FFB7C5', '#B83A63', '#FFB7C5', '#1d1c1a'],
      ['coral', '#FF9478', '#B3401F', '#FF9478', '#1d1c1a'],
      ['amber', '#F4B740', '#8F5A00', '#F4B740', '#1d1c1a'],
      ['green', '#069902', '#057B02', '#06A802', '#1d1c1a'],
      ['red', '#C20000', '#C20000', '#FF4D4D', '#FFFFFF'],
    ],
  );
});

test('old file from the four-theme days (Sand, Red, dither keys) loads without errors and shows as Custom', () => {
  const old = structuredClone(DEFAULT_DESIGN) as any;
  old.look = { theme: 'sand', accent: 'red' };
  old.colors.light = { ...old.colors.light, background: '#f5efe3', surface: '#faf6ee', raised: '#ebe2d1', border: '#d6cab3', text: '#2a241b', mutedText: '#6b604e', userBubble: '#ebe2d1', userText: '#2a241b', codeBackground: '#f9f5ec', accentFill: '#C20000', accentOn: '#FFFFFF' };
  old.colors.tones.accent = { light: '#C20000', dark: '#FF4D4D' };
  old.effects = { enabled: true, dither: { variant: 'wave', speed: 1, dotSize: 5, cursorRadius: 90 } };
  const d = parseDesign(JSON.stringify(old));
  assert.deepStrictEqual(d.look, { accent: 'red' });
  assert.strictEqual(matchLook(d), 'custom'); // its colors are kept as they are
  assert.deepStrictEqual(matchLook(applyLook(d, { accent: 'red' })), { accent: 'red' }); // one accent click: base surfaces
});

test('no theme picker is left in the code', () => {
  const src = path.join(__dirname, '..', 'src');
  for (const f of ['themes.ts', 'main.ts', 'renderer.ts', 'design.ts', 'claude-md.ts']) {
    const t = fs.readFileSync(path.join(src, f), 'utf8');
    assert.doesNotMatch(t, /THEME_NAMES|THEMES\b|isThemeName|looktile|'slate'|'sand'|"slate"/, f);
  }
});
