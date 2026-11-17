import { test } from 'node:test';
import * as assert from 'node:assert';
import { applySettings, clampZoom, DEFAULT_SETTINGS, effortInText, modeInText, MODES, parseSettings, startFlags, validModel, zoomStep } from './settings';

test('settings: broken, missing or wrong values fall back to defaults', () => {
  assert.deepStrictEqual(parseSettings(null), DEFAULT_SETTINGS);
  assert.deepStrictEqual(parseSettings('{ nope'), DEFAULT_SETTINGS);
  assert.deepStrictEqual(parseSettings('[1]'), DEFAULT_SETTINGS);
  assert.deepStrictEqual(parseSettings(JSON.stringify({ zoom: 'big', model: '--dangerously-skip-permissions', effort: 'off', mode: 'bypassPermissions', toolsOpen: 1, showAccount: 'no', extra: true })), DEFAULT_SETTINGS);
  assert.deepStrictEqual(parseSettings(JSON.stringify({ zoom: 1.3, model: 'sonnet', effort: 'high', mode: 'plan', toolsOpen: true, showAccount: false })), { zoom: 1.3, model: 'sonnet', effort: 'high', mode: 'plan', toolsOpen: true, showAccount: false });
  assert.deepStrictEqual(applySettings({ ...DEFAULT_SETTINGS, model: 'opus' }, { effort: 'max', mode: 'dontAsk' }), { ...DEFAULT_SETTINGS, model: 'opus', effort: 'max' });
});

test('settings: zoom steps of 10% between 50% and 200%', () => {
  assert.strictEqual(zoomStep(1, 1), 1.1);
  assert.strictEqual(zoomStep(1.1, -1), 1);
  assert.strictEqual(zoomStep(2, 1), 2);
  assert.strictEqual(zoomStep(0.5, -1), 0.5);
  assert.strictEqual(zoomStep(1.7, 0), 1);
  assert.strictEqual(clampZoom(9), 2);
  assert.strictEqual(clampZoom(0.1), 0.5);
  let z = 1;
  for (let i = 0; i < 3; i++) z = zoomStep(z, 1);
  assert.strictEqual(z, 1.3); // no float drift
});

test('settings: flags for claude; nothing for "default"', () => {
  assert.deepStrictEqual(startFlags({ model: '', effort: '', mode: '' }), []);
  assert.deepStrictEqual(startFlags({ model: 'sonnet', effort: 'high', mode: 'plan' }), ['--model', 'sonnet', '--effort', 'high', '--permission-mode', 'plan']);
  assert.deepStrictEqual(startFlags({ model: 'claude-opus-5-5[1m]', effort: '', mode: 'manual' }), ['--model', 'claude-opus-5-5[1m]', '--permission-mode', 'manual']);
  assert.deepStrictEqual(startFlags({ model: '--help', effort: 'off' as any, mode: 'bypassPermissions' as any }), []);
  assert.ok(!MODES.includes('bypassPermissions' as any) && !MODES.includes('dontAsk' as any));
});

test('settings: model names can never be a flag or two words', () => {
  for (const ok of ['fable', 'sonnet', 'claude-opus-5-5', 'claude-sonnet-5-5[1m]', 'us.anthropic.claude-3']) assert.ok(validModel(ok), ok);
  for (const bad of ['', '-x', '--model', 'a b', 'a;b', 'a\nb', 'a/b', '$(x)', 'x'.repeat(81), 5, null]) assert.ok(!validModel(bad), String(bad));
});

test('settings: the mode and effort are read back from the terminal text', () => {
  assert.strictEqual(modeInText('  ⏸ manual mode on · ? for shortcuts'), 'manual');
  assert.strictEqual(modeInText('⏵⏵ accept edits on (shift+tab to cycle)'), 'acceptEdits');
  assert.strictEqual(modeInText('⏸ plan mode on (shift+tab to cycle)'), 'plan');
  assert.strictEqual(modeInText('⏵⏵ auto mode on (shift+tab to cycle)'), 'auto');
  assert.strictEqual(modeInText('manual mode on ... later ... plan mode on'), 'plan'); // the last one named wins
  assert.strictEqual(modeInText('bypass permissions on'), 'other');
  assert.strictEqual(modeInText('nothing here'), null);
  assert.strictEqual(effortInText('   ◐ medium · /effort   ...   ● high · /effort'), 'high');
  assert.strictEqual(effortInText('no corner'), null);
});
