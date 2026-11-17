import { test } from 'node:test';
import * as assert from 'node:assert';
const U = require('./usage');

// The /usage screen of Claude Code 2.1.326, as the hidden terminal held it (2026-11-17).
const SCREEN = `▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
   Settings  Status   Config   Usage   Stats

   Current session
   ████▌                                              9% used
   Resets 10:30pm (America/Toronto)

   Current week (all models)
   ██████████████████████████████████▌                69% used
   Resets Nov 22 at 1pm (America/Toronto)

   Current week (Fable)
   ████████████████████████████████████████████▌      97% used
   Resets Nov 22 at 1pm (America/Toronto)

   What's contributing to your usage?
   Approximate · sessions on this machine only

   87%  Start fresh when you switch tasks · run /clear
   16%  Turn off skills you don't use · 16k tokens per request

   Skills                  % of usage
   /caveman:caveman                1%

   f to fix 1 of 3 · d to day · w to week`.split('\n');

test('usage: every limit with its percent and reset time; tips and tables are not limits', () => {
  assert.deepStrictEqual(U.parseUsage(SCREEN), [
    { title: 'Current session', percent: 9, resets: '10:30pm (America/Toronto)' },
    { title: 'Current week (all models)', percent: 69, resets: 'Nov 22 at 1pm (America/Toronto)' },
    { title: 'Current week (Fable)', percent: 97, resets: 'Nov 22 at 1pm (America/Toronto)' },
  ]);
});

test('usage: not the usage screen, or not drawn yet: null', () => {
  assert.strictEqual(U.parseUsage(['❯ hello', '⏺ Hi there']), null);
  assert.strictEqual(U.parseUsage(SCREEN.slice(0, 3)), null);
  assert.strictEqual(U.parseUsage([]), null);
  // a bar without a title above it is skipped
  assert.strictEqual(U.parseUsage(['████ 12% used']), null);
});

test('usage: bar levels', () => {
  assert.deepStrictEqual([0, 80, 80.5, 95, 96, 100].map(U.usageLevel), ['ok', 'ok', 'warn', 'warn', 'bad', 'bad']);
});
