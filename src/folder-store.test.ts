import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pickStartFolder, readSavedFolder, saveFolder } from './folder-store';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'clade-folder-'));

test('a saved folder is read back', () => {
  const d = tmp();
  const file = path.join(d, 'data', 'folder.json');
  saveFolder(file, d);
  assert.strictEqual(readSavedFolder(file), d);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['folder.json']); // no temp file left
});

test('no file, a broken file, a relative path or a deleted folder read as null', () => {
  const d = tmp();
  const file = path.join(d, 'folder.json');
  assert.strictEqual(readSavedFolder(file), null);
  fs.writeFileSync(file, '{not json');
  assert.strictEqual(readSavedFolder(file), null);
  fs.writeFileSync(file, JSON.stringify({ folder: 'relative/dir' }));
  assert.strictEqual(readSavedFolder(file), null);
  fs.writeFileSync(file, JSON.stringify({ folder: 42 }));
  assert.strictEqual(readSavedFolder(file), null);
  const gone = path.join(d, 'gone');
  fs.mkdirSync(gone);
  saveFolder(file, gone);
  fs.rmdirSync(gone);
  assert.strictEqual(readSavedFolder(file), null);
});

test('a file in place of the folder reads as null', () => {
  const d = tmp();
  const notDir = path.join(d, 'plain.txt');
  fs.writeFileSync(notDir, 'x');
  const file = path.join(d, 'folder.json');
  fs.writeFileSync(file, JSON.stringify({ folder: notDir }));
  assert.strictEqual(readSavedFolder(file), null);
});

test('the command-line folder wins, then the saved one, else null', () => {
  const a = tmp();
  const b = tmp();
  assert.strictEqual(pickStartFolder({ arg: a, saved: b }), a);
  assert.strictEqual(pickStartFolder({ arg: path.join(a, 'missing'), saved: b }), b);
  assert.strictEqual(pickStartFolder({ arg: null, saved: b }), b);
  assert.strictEqual(pickStartFolder({ saved: null }), null);
});
