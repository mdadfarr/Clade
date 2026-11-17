import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

// Rules about the main process that are easiest to keep by reading its source.
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.ts'), 'utf8');

test('the only web link the app opens is one fixed URL, and nothing from the page reaches it', () => {
  const calls = [...src.matchAll(/shell\.openExternal\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.deepStrictEqual(calls, ['SOURCE_URL']);
  assert.match(src, /const SOURCE_URL = 'https:\/\/github\.com\/mdadfarr\/Clade';/);
  const handler = src.match(/ipcMain\.on\('open-source', \(([^)]*)\)/);
  assert.ok(handler);
  assert.strictEqual(handler![1].trim(), ''); // takes no arguments from the page
});

test('auth status runs only under the no-network sandbox, never login, logout or setup-token', () => {
  const runs = [...src.matchAll(/execFile\(([^,]+),\s*\[([^\]]*)\]/g)].map((m) => [m[1].trim(), m[2].replace(/\s+/g, ' ').trim()]);
  assert.deepStrictEqual(runs, [["'/usr/bin/sandbox-exec'", "'-p', NO_NETWORK_PROFILE, 'claude', 'auth', 'status'"]]);
  assert.doesNotMatch(src, /'(login|logout|setup-token)'/);
});

test('only state, email and plan are sent to the page', () => {
  const sends = [...src.matchAll(/send\('account', ([^)]*)\)/g)].map((m) => m[1].trim());
  assert.ok(sends.length > 0);
  for (const s of sends) assert.strictEqual(s, 'account'); // the parsed Account, never raw output
});
