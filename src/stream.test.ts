import { test } from 'node:test';
import * as assert from 'node:assert';
import { SCREENS } from './stream.fixtures';
const S = require('./stream');

const P1 = 'Tea old drink. Made from leaves of Camellia sinensis. Green, black, white, oolong all same plant, different processing.';
const P2 = 'Water temperature matter. Green tea too hot turn bitter. Black tea handle boiling water fine. Steep time also change taste. Long steep, strong and tannic.';

test('stream: the growing reply is read off real terminal screens', () => {
  const at = (name: string) => S.replyOnScreen(SCREENS[name], 100);
  assert.strictEqual(at('thinking').blocks, 0); // the spinner and its tip are not reply text
  assert.strictEqual(at('thinking').text, '');
  assert.deepStrictEqual([at('para1').blocks, at('para1').text], [1, P1]); // wrapping undone
  assert.strictEqual(at('para2').text, `${P1}\n\n${P2}`);
  assert.ok(at('para3').text.startsWith(`${P1}\n\n${P2}\n\nTea culture big across world.`));
  assert.ok(at('para3').text.includes('print("Hello, world!")'));
  assert.ok(at('done').text.includes('│ Green'));
  assert.ok(!at('done').text.includes('Cooked for')); // the status line is left out
  assert.ok(!at('done').text.includes('manual mode'));
});

test('stream: turns are told apart by the user line', () => {
  assert.ok(S.replyOnScreen(SCREENS.before, 100).user.startsWith('@"/tmp/x/branchtest/my docs/sea life.txt"') || S.replyOnScreen(SCREENS.before, 100).user.startsWith('@"'));
  assert.ok(S.replyOnScreen(SCREENS.para1, 100).user.startsWith('Write three short paragraphs about tea'));
});

const box = ['────────────────────', '❯ ', '────────────────────', '  ⏸ manual mode on'];
test('stream: tool calls are not text blocks; a text block after one is', () => {
  const screen = ['❯ read it', '', '⏺ I will read the file.', '', '⏺ Read(notes.txt)', '  ⎿  Read 2 lines', '', '⏺ The first word is', '  Zebra.', '', '✻ Thinking…', ...box];
  assert.deepStrictEqual(S.replyOnScreen(screen, 100), { blocks: 2, text: 'The first word is\nZebra.', user: 'read it' });
  const running = ['❯ read it', '', '⏺ I will read the file.', '', '⏺ Read(notes.txt)', '', ...box];
  assert.deepStrictEqual(S.replyOnScreen(running, 100), { blocks: 1, text: '', user: 'read it' }); // nothing to preview while a tool runs
});

test('stream: no chat on screen gives null; the label is never shown', () => {
  assert.strictEqual(S.replyOnScreen(['Do you trust this folder?', '❯ No, exit', '  Yes'], 100), null);
  assert.strictEqual(S.replyOnScreen([], 100), null);
  assert.strictEqual(S.replyOnScreen(box, 100), null); // no user message yet
  assert.strictEqual(S.unwrapScreenText(['Done.', '', '{label=Fix login'], 100), 'Done.');
  assert.strictEqual(S.unwrapScreenText(['Done.', '{label=Fix login bug}'], 100), 'Done.');
  assert.strictEqual(S.unwrapScreenText(['- one', '- two', '1. three'], 100), '- one\n- two\n1. three'); // list lines stay apart
  assert.strictEqual(S.unwrapScreenText(['x'.repeat(80), 'tail'], 100), `${'x'.repeat(80)} tail`);
  assert.strictEqual(S.unwrapScreenText(['short line', 'next line'], 100), 'short line\nnext line');
});
