import { test } from 'node:test';
import * as assert from 'node:assert';
import { CLAUDE_MD, MD_END, MD_START } from './claude-md';

test('CLAUDE.md section order: replies, color, drawing, blocks, artifacts, label, design.json', () => {
  const heads = CLAUDE_MD.split('\n').filter((l) => l.startsWith('## '));
  assert.deepStrictEqual(heads, [
    '## How to write replies (the chat view renders them)',
    '## Color (required in every section)',
    '## Drawing (you can draw in the reply)',
    '## Blocks (the app draws them)',
    '## Artifacts',
    '## Reply label (required, every reply)',
    '## design.json (app appearance)',
  ]);
  assert.ok(CLAUDE_MD.startsWith(MD_START) && CLAUDE_MD.trimEnd().endsWith(MD_END));
});

test('the color rule: 1 to 3 per section, short phrases, good and bad examples; old lines gone', () => {
  assert.match(CLAUDE_MD, /Every section that has a heading uses at least 1 and at most 3 colored\nphrases\. A reply with no heading uses 1 to 3 in total\./);
  assert.match(CLAUDE_MD, /short phrases of 1 to 4 words, never a whole sentence/);
  assert.match(CLAUDE_MD, /Bad \(plain: no color at all\)/);
  assert.match(CLAUDE_MD, /Bad \(too much: whole sentences, more than 3\)/);
  assert.doesNotMatch(CLAUDE_MD, /At most 3 colored phrases per section/);
  assert.doesNotMatch(CLAUDE_MD, /Use the other\s+colors only to tell apart/);
});

test('the nesting rule and the reply label rule are still there', () => {
  assert.match(CLAUDE_MD, /Nesting is a hard rule\./);
  assert.match(CLAUDE_MD, /End EVERY reply with a label tag/);
});

test('drawing: inline svg is the rule; the good example draws; no .svg files for quick pictures; no dither', () => {
  const D = require('./draw');
  assert.match(CLAUDE_MD, /DRAW IT right in the\nreply with a fenced `svg` block/);
  assert.match(CLAUDE_MD, /Do NOT write an \.svg file for it/);
  assert.match(CLAUDE_MD, /Bad \(a file for a quick picture\)/);
  assert.match(CLAUDE_MD, /`mem` is just one case of drawing/);
  const ex = /```svg\n([\s\S]*?)\n```/.exec(CLAUDE_MD);
  assert.ok(ex, 'good example present');
  const d = D.parseDrawing(ex![1]);
  assert.ok(d, 'the good example is a valid drawing');
  assert.strictEqual(d.width, 360);
  assert.doesNotMatch(CLAUDE_MD, /fx=dither|fx=mono|halftone/);
  assert.match(CLAUDE_MD, /\{fx=title\}/);
});
