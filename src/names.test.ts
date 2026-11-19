import { test } from 'node:test';
import * as assert from 'node:assert';
import { cleanName, parseNames, setName } from './names';

const A = '11111111-2222-3333-4444-555555555555';
const B = '66666666-7777-8888-9999-000000000000';

test('chat names: set, change and clear; the file holds only checked ids and one-line names', () => {
  let f = setName(null, A, '  Lighthouse\nstory  ');
  assert.deepStrictEqual(parseNames(f), { [A]: 'Lighthouse story' });
  f = setName(f, B, 'Primes');
  f = setName(f, A, 'Story');
  assert.deepStrictEqual(parseNames(f), { [A]: 'Story', [B]: 'Primes' });
  f = setName(f, A, '   ');
  assert.deepStrictEqual(parseNames(f), { [B]: 'Primes' });
  assert.throws(() => setName(f, '--resume', 'x'), /not a session id/);
});

test('chat names: a broken or hand-edited file never throws; bad entries are left out', () => {
  assert.deepStrictEqual(parseNames('{ nope'), {});
  assert.deepStrictEqual(parseNames('[1]'), {});
  assert.deepStrictEqual(parseNames(JSON.stringify({ names: { [A]: 5, 'not-an-id': 'x', [B]: 'ok' } })), { [B]: 'ok' });
  assert.strictEqual(cleanName('x'.repeat(100)).length, 60);
  assert.strictEqual(cleanName('a\u0007b'), 'a b');
});
