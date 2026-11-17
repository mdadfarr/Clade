import { test } from 'node:test';
import * as assert from 'node:assert';
import { contrastRatio, DEFAULT_DESIGN_V2 as DEFAULT_DESIGN, MIN_CONTRAST, OLD_FORMAT_NOTE, parseDesignV2 as parseDesign, readDesignV2 as readDesign, resolveTheme, TONES } from './design-v2';
import { DEFAULT_DESIGN_V1 } from './design-v1';

const bad = (change: (d: any) => void, pattern: RegExp) => {
  const d = structuredClone(DEFAULT_DESIGN) as any;
  change(d);
  assert.throws(() => parseDesign(JSON.stringify(d)), pattern);
};

test('v2: default design is valid', () => assert.deepStrictEqual(parseDesign(JSON.stringify(DEFAULT_DESIGN)), DEFAULT_DESIGN));
test('v2: every default text color and tone passes the contrast floor in both themes', () => {
  for (const theme of ['light', 'dark'] as const) {
    const r = DEFAULT_DESIGN.colors[theme];
    for (const fg of [r.text, r.mutedText, ...TONES.map((t) => DEFAULT_DESIGN.colors.tones[t][theme])]) {
      assert.ok(contrastRatio(fg, r.background) >= MIN_CONTRAST, `${fg} on ${r.background}`);
    }
    assert.ok(contrastRatio(r.userText, r.userBubble) >= MIN_CONTRAST);
  }
});
test('v2: contrast ratio', () => {
  assert.strictEqual(Math.round(contrastRatio('#000', '#ffffff')), 21);
  assert.strictEqual(contrastRatio('#abc', '#aabbcc'), 1);
});
test('v2: unreadable tone is rejected, with the key named', () =>
  bad((d) => (d.colors.tones.warn.light = '#f0e0a0'), /colors\.tones\.warn\.light has contrast \d\.\d on colors\.light\.background \(needs 4\.5\)/));
test('v2: unreadable text is rejected', () => bad((d) => (d.colors.dark.text = '#333333'), /colors\.dark\.text has contrast/));
test('v2: tone names are fixed', () => {
  bad((d) => (d.colors.tones.red = { light: '#b3302a', dark: '#ff8f85' }), /unknown key "red" in colors\.tones/);
  bad((d) => delete d.colors.tones.teal, /missing key "teal" in colors\.tones/);
});
test('v2: colors are hex only', () => {
  bad((d) => (d.colors.light.background = 'url(http://x)'), /must be a hex color/);
  bad((d) => (d.colors.tones.blue.dark = 'blue'), /must be a hex color/);
});
test('v2: theme, fonts, unknown keys', () => {
  bad((d) => (d.theme = 'auto'), /theme must be/);
  bad((d) => (d.fonts.reply = 'url(x)'), /fonts\.reply/);
  bad((d) => (d.script = 'x'), /unknown key "script"/);
  bad((d) => (d.effects.gradientTo = 'red'), /gradientTo must be one of/);
  bad((d) => (d.version = 3), /version must be 2/);
  bad((d) => (d.layout.sidebarWidth = 20), /layout\.sidebarWidth/);
});
test('v2: old format converts, keeps sizes and panels, drops colors', () => {
  const old = structuredClone(DEFAULT_DESIGN_V1) as any;
  old.body.size = 20;
  old.headings.h1 = { size: 40, weight: 800, color: '#ffcc00' };
  old.chat = { font: 'Georgia, serif', fontSize: 16, width: 900 };
  old.window.background = 'darkgreen';
  old.panels = [{ id: 'todo', side: 'left', size: 220, visible: true, blocks: [{ type: 'text', text: 'hi' }] }];
  const { design, note } = readDesign(JSON.stringify(old));
  assert.strictEqual(note, OLD_FORMAT_NOTE);
  assert.deepStrictEqual([design.type.body, design.type.h1, design.type.ui, design.layout.chatWidth], [20, { size: 40, weight: 800 }, 16, 900]);
  assert.deepStrictEqual([design.fonts.reply, design.fonts.ui], ['Georgia, serif', 'Georgia, serif']);
  assert.deepStrictEqual(design.panels, old.panels);
  assert.deepStrictEqual(design.colors, DEFAULT_DESIGN.colors);
  assert.strictEqual(readDesign(JSON.stringify(DEFAULT_DESIGN)).note, null);
  assert.deepStrictEqual(readDesign(JSON.stringify(DEFAULT_DESIGN_V1)).design, DEFAULT_DESIGN); // untouched old default = new default
  assert.throws(() => readDesign(JSON.stringify({ ...old, script: 1 })), /unknown key "script"/);
});
test('v2: resolveTheme', () => {
  assert.deepStrictEqual([resolveTheme('system', true), resolveTheme('system', false), resolveTheme('light', true), resolveTheme('dark', false)], ['dark', 'light', 'light', 'dark']);
});
