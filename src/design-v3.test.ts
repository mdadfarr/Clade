import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { contrastRatio, DEFAULT_DESIGN, fromV2, MIN_CONTRAST, OLD_FORMAT_NOTE, parseDesign, readDesign, TONES } from './design';
import { DEFAULT_DESIGN_V2 } from './design-v2';
import { DEFAULT_DESIGN_V1 } from './design-v1';

const bad = (change: (d: any) => void, pattern: RegExp) => {
  const d = structuredClone(DEFAULT_DESIGN) as any;
  change(d);
  assert.throws(() => parseDesign(JSON.stringify(d)), pattern);
};

test('v3: default design is valid', () => assert.deepStrictEqual(parseDesign(JSON.stringify(DEFAULT_DESIGN)), DEFAULT_DESIGN));

test('v3: accent is cyan as a fill and in dark, a darker shade of it as text on light', () => {
  const c = DEFAULT_DESIGN.colors;
  assert.deepStrictEqual(c.tones.accent, { light: '#00787A', dark: '#00E2E6' });
  assert.deepStrictEqual([c.light.accentFill, c.dark.accentFill], ['#00E2E6', '#00E2E6']);
  assert.ok(contrastRatio('#00E2E6', c.light.background) < 2); // why cyan is never text on light
  for (const th of ['light', 'dark'] as const) {
    assert.ok(contrastRatio(c.tones.accent[th], c[th].background) >= MIN_CONTRAST);
    assert.ok(contrastRatio(c[th].accentOn, c[th].accentFill) >= MIN_CONTRAST);
    for (const t of TONES) assert.ok(contrastRatio(c.tones[t][th], c[th].background) >= MIN_CONTRAST, `${t} ${th}`);
  }
});

test('v3: text on the accent fill must be readable', () =>
  bad((d) => (d.colors.light.accentOn = '#ffffff'), /colors\.light\.accentOn has contrast \d\.\d on colors\.light\.accentFill/));

test('v3: type and spacing scales are plain numbers with limits', () => {
  const t = DEFAULT_DESIGN.type;
  assert.ok(t.h1.size > t.h2.size && t.h2.size > t.h3.size && t.h3.size > t.h4.size - 1 && t.h4.size >= t.body && t.fx.size > t.h1.size);
  assert.ok(t.body >= 19);
  bad((d) => (d.type.body = '19px'), /type\.body must be a number/);
  bad((d) => (d.type.h4 = 19), /type\.h4 must be an object/);
  bad((d) => (d.space.paragraph = -1), /space\.paragraph must be a number from 0 to 200/);
  bad((d) => delete d.space.block, /missing key "block" in space/);
  bad((d) => (d.space.gutter = 4), /unknown key "gutter" in space/);
});

test('v3: no gradient setting left; unknown keys and versions rejected', () => {
  bad((d) => (d.effects.gradientTo = 'pink'), /unknown key "gradientTo" in effects/);
  bad((d) => (d.script = 'x'), /unknown key "script"/);
  bad((d) => (d.version = 4), /version must be 3/);
  bad((d) => (d.colors.tones.accent.light = '#00E2E6'), /colors\.tones\.accent\.light has contrast 1\.\d/);
});

test('v3: an untouched version 2 file becomes the new default', () => {
  const r = readDesign(JSON.stringify(DEFAULT_DESIGN_V2));
  assert.strictEqual(r.note, OLD_FORMAT_NOTE);
  assert.deepStrictEqual(r.design, DEFAULT_DESIGN);
  assert.deepStrictEqual(readDesign(JSON.stringify(DEFAULT_DESIGN_V1)).design, DEFAULT_DESIGN); // version 1 too
  assert.strictEqual(readDesign(JSON.stringify(DEFAULT_DESIGN)).note, null);
});

test('v3: a changed version 2 file keeps what was changed', () => {
  const o = structuredClone(DEFAULT_DESIGN_V2);
  o.theme = 'dark';
  o.type.body = 21;
  o.type.h2 = { size: 26, weight: 500 };
  o.layout.chatWidth = 900;
  o.colors.tones.accent = { light: '#8a3aa8', dark: '#d39bf0' };
  o.colors.dark.background = '#000000';
  o.effects.enabled = false;
  const d = fromV2(o);
  assert.deepStrictEqual([d.theme, d.type.body, d.type.h2, d.layout.chatWidth, d.effects.enabled], ['dark', 21, { size: 26, weight: 500 }, 900, false]);
  assert.deepStrictEqual(d.colors.tones.accent, { light: '#8a3aa8', dark: '#d39bf0' });
  assert.strictEqual(d.colors.dark.background, '#000000');
  assert.strictEqual(d.colors.dark.accentFill, '#00E2E6'); // new keys get their defaults
  assert.deepStrictEqual([d.type.h1, d.type.code, d.space], [DEFAULT_DESIGN.type.h1, DEFAULT_DESIGN.type.code, DEFAULT_DESIGN.space]); // untouched: new defaults
});

test('no gradients anywhere in the stylesheet', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');
  assert.ok(!/gradient\s*\(/i.test(css), 'a gradient() is in app.css');
  assert.ok(!/background-clip\s*:\s*text/i.test(css));
});

test('effects: glow optional (0-1, default 0.5); an old dither key loads and is dropped; its 64 px title grows', () => {
  const base = structuredClone(DEFAULT_DESIGN) as any;
  const withEffects = (effects: unknown, fx = base.type.fx) => JSON.stringify({ ...base, type: { ...base.type, fx }, effects });
  assert.strictEqual(parseDesign(withEffects({ enabled: true })).effects.glow, 0.5);
  assert.strictEqual(parseDesign(withEffects({ enabled: true, glow: 0 })).effects.glow, 0);
  assert.throws(() => parseDesign(withEffects({ enabled: true, glow: 1.5 })), /effects\.glow/);
  assert.throws(() => parseDesign(withEffects({ enabled: true, fps: 60 })), /unknown key "fps"/);
  const old = parseDesign(withEffects({ enabled: true, dither: { variant: 'wave', speed: 1, dotSize: 5, cursorRadius: 90 } }, { size: 64, weight: 800 }));
  assert.deepStrictEqual(old.effects, { enabled: true, glow: 0.5 });
  assert.deepStrictEqual(old.type.fx, { size: 88, weight: 800 });
  // a size the user chose is kept, and without the old key 64 stays 64
  assert.strictEqual(parseDesign(withEffects({ enabled: true, dither: 'anything' }, { size: 70, weight: 800 })).type.fx.size, 70);
  assert.strictEqual(parseDesign(withEffects({ enabled: true }, { size: 64, weight: 800 })).type.fx.size, 64);
  assert.deepStrictEqual(DEFAULT_DESIGN.effects, { enabled: true, glow: 0.5 });
  assert.deepStrictEqual(DEFAULT_DESIGN.type.fx, { size: 88, weight: 800 });
});
