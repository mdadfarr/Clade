import { test } from 'node:test';
import * as assert from 'node:assert';
import { countReply } from './colorcount';

test('sections, colors per section, uncolored sections, label', () => {
  const r = countReply(
    [
      'Intro line with {accent}a key{/}.',
      '## Local variables',
      'A {accent}local variable{/} lives in one method. Reading one raises {bad}NameError{/}.',
      '## Globals',
      'No color here.',
      '### Constants',
      '{warn big}reassigning warns{/} and {good}it works{/} and {blue}one{/} and {teal}two{/}',
      '{label=Ruby vars}',
    ].join('\n'),
  );
  assert.deepStrictEqual(r.sections, [
    { heading: 'Local variables', colors: 2 },
    { heading: 'Globals', colors: 0 },
    { heading: 'Constants', colors: 4 },
  ]);
  assert.strictEqual(r.headings, 3);
  assert.strictEqual(r.colors, 7);
  assert.strictEqual(r.uncolored, 1);
  assert.strictEqual(r.label, true);
  assert.strictEqual(r.pass, false);
});

test('phrase length: more than 4 words is long; markdown marks do not count as words', () => {
  const r = countReply('{accent}A local variable lives inside one method.{/} {good}`x` is **fast**{/}');
  assert.deepStrictEqual(r.long, ['A local variable lives inside one method.']);
  assert.strictEqual(r.pass, false);
});

test('a reply without headings passes with 1 to 3 colors in total', () => {
  assert.strictEqual(countReply('Use {accent}a range{/} and {warn}check the bound{/}.').pass, true);
  assert.strictEqual(countReply('Plain text only.').pass, false);
  assert.strictEqual(countReply('{good}a{/} {good}b{/} {good}c{/} {good}d{/}').pass, false);
});

test('code and blocks are not prose: tags inside them are not counted; blocks are listed', () => {
  const r = countReply(
    [
      '## Pointers',
      'A {accent}pointer{/} holds an address.',
      '```c',
      'int x = 5; // {bad}not a tag here{/}',
      '```',
      '```mem',
      'stack main',
      '  x: int = 5',
      '```',
      '| a | b |',
      '|---|---|',
      '> [!warning]',
      '> careful',
    ].join('\n'),
  );
  assert.strictEqual(r.colors, 1);
  assert.deepStrictEqual(r.blocks, ['callout', 'mem', 'table']);
  assert.strictEqual(r.pass, true);
  assert.strictEqual(r.label, false);
});

test('map: found, and its depth below the root at any indent step', () => {
  const two = countReply('```map\nRuby variables\n  Five kinds\n    Local\n    Instance\n  Naming\n```');
  assert.deepStrictEqual([two.map, two.mapDepth], [true, 2]);
  const flat = countReply('```map\nRuby variables\n  Kinds\n  Local\n  Instance\n```');
  assert.deepStrictEqual([flat.map, flat.mapDepth], [true, 1]);
  const four = countReply('```map\nRoot\n    A\n        B\n```');
  assert.strictEqual(four.mapDepth, 2);
  assert.deepStrictEqual([countReply('no map').map, countReply('no map').mapDepth], [false, 0]);
});
