import { test } from 'node:test';
import * as assert from 'node:assert';
import { loginShellPath, mergePaths, parsePathOutput } from './shell-path';

test('the PATH is read between the marks, other start-up output is ignored', () => {
  assert.strictEqual(parsePathOutput('Welcome!\n__CLADE_PATH__/a/bin:/usr/bin__CLADE_PATH__\nbye'), '/a/bin:/usr/bin');
  assert.strictEqual(parsePathOutput('no marks here'), null);
  assert.strictEqual(parsePathOutput('__CLADE_PATH____CLADE_PATH__'), null);
});

test('login entries come first, each entry once, empty ones dropped', () => {
  assert.strictEqual(mergePaths('/home/u/.local/bin:/usr/bin', '/usr/bin:/bin::'), '/home/u/.local/bin:/usr/bin:/bin');
  assert.strictEqual(mergePaths(null, '/usr/bin:/bin'), '/usr/bin:/bin');
  assert.strictEqual(mergePaths(null, undefined), '');
});

test('a shell that does not exist gives null', () => {
  assert.strictEqual(loginShellPath('/no/such/shell'), null);
});

test('a real shell gives a PATH', () => {
  const p = loginShellPath('/bin/sh');
  assert.ok(p && p.includes('/'));
});
