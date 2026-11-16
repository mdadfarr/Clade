import { test } from 'node:test';
import * as assert from 'node:assert';
import { DEFAULT_DESIGN, parseDesign } from './design';
import { parseSession } from './session';

const good = {
  terminal: { background: '#002200', textColor: '#ffffff', fontSize: 14 },
  window: { background: 'darkgreen' },
  panels: [
    {
      id: 'todo', side: 'left', size: 220, visible: true,
      blocks: [{ type: 'heading', text: 'To do' }, { type: 'text', text: 'hi' }, { type: 'list', items: ['a', 'b'] }],
    },
  ],
  chat: { font: 'Georgia, serif', fontSize: 16, width: 700 },
  userBox: { background: '#114411', textColor: 'white' },
  claudeBox: { background: '#222222', textColor: '#eeeeee' },
  headings: {
    h1: { size: 28, weight: 800, color: '#ffcc00' },
    h2: { size: 22, weight: 700, color: 'inherit' },
    h3: { size: 18, weight: 600, color: 'rgb(200,200,255)' },
  },
  body: { size: 15 },
  bold: { color: '#ffaa00' },
  code: { background: '#000000' },
};
const bad = (change: (d: any) => void, pattern: RegExp) => {
  const d = structuredClone(good);
  change(d);
  assert.throws(() => parseDesign(JSON.stringify(d)), pattern);
};

test('default design is valid', () => assert.deepStrictEqual(parseDesign(JSON.stringify(DEFAULT_DESIGN)), DEFAULT_DESIGN));
test('good design passes', () => assert.deepStrictEqual(parseDesign(JSON.stringify(good)), good));
test('bad JSON', () => assert.throws(() => parseDesign('{ nope'), /bad JSON/));
test('unknown top key', () => bad((d) => (d.script = 'x'), /unknown key "script"/));
test('unknown panel key', () => bad((d) => (d.panels[0].onClick = 'x'), /unknown key "onClick"/));
test('unknown block type', () => bad((d) => (d.panels[0].blocks[0].type = 'button'), /type must be/));
test('bad side', () => bad((d) => (d.panels[0].side = 'top'), /side must be/));
test('missing key', () => bad((d) => delete d.window, /missing key "window"/));
test('color cannot be url()', () => bad((d) => (d.window.background = 'url(http://x)'), /must be a color/));
test('chat sections may be left out', () => {
  const { chat, userBox, claudeBox, headings, body, bold, code, ...old } = good;
  const d = parseDesign(JSON.stringify(old));
  assert.deepStrictEqual(d.chat, DEFAULT_DESIGN.chat);
  assert.deepStrictEqual(d.headings, DEFAULT_DESIGN.headings);
  assert.deepStrictEqual(d.code, DEFAULT_DESIGN.code);
});
test('heading needs all keys', () => bad((d) => delete d.headings.h2.weight, /missing key "weight" in headings.h2/));
test('unknown heading level', () => bad((d) => (d.headings.h4 = d.headings.h3), /unknown key "h4"/));
test('bad heading weight', () => bad((d) => (d.headings.h1.weight = 'bold'), /headings.h1.weight/));
test('bad code background', () => bad((d) => (d.code.background = 'url(x)'), /must be a color/));
test('unknown chat key', () => bad((d) => (d.chat.color = 'red'), /unknown key "color" in chat/));
test('bad chat font', () => bad((d) => (d.chat.font = 'url(x)'), /chat.font/));
test('bad box color', () => bad((d) => (d.userBox.background = 'url(http://x)'), /must be a color/));

const line = (o: unknown) => JSON.stringify(o);
test('session: messages, tools, working flag', () => {
  const start = [
    line({ type: 'user', isMeta: true, message: { content: 'hidden' } }),
    line({ type: 'user', message: { content: '<command-name>/model</command-name>' } }),
    line({ type: 'user', message: { content: 'make it green' } }),
  ];
  const st = parseSession(start.join('\n'));
  assert.deepStrictEqual([st.items.map((i) => [i.role, i.text]), st.working], [[['user', 'make it green']], true]);
  const mid = [
    ...start,
    line({ type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: 'x' }] } }),
    line({ type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'text', text: 'On it.' }] } }),
    line({ type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Read' }] } }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'secret file text' }] } }),
    line({ type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Edit' }] } }),
    '{"type":"assistant","message":{"content":[{"type":"te', // half-written line
  ];
  const m = parseSession(mid.join('\n'));
  assert.deepStrictEqual(m.items.slice(1).map((i) => [i.role, i.text]), [['claude', 'On it.'], ['tool', 'Tools: Read, Edit']]);
  assert.strictEqual(m.working, true);
  const done = [...mid.slice(0, -1), line({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '**Done**' }] } })];
  const e = parseSession(done.join('\n'));
  assert.strictEqual(e.working, false);
  assert.deepStrictEqual([e.items.at(-1)?.role, e.items.at(-1)?.text], ['claude', '**Done**']);
});

import { firstWords, parseBranches } from './branches';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
test('session: lastUuid, first, stop at fork point', () => {
  const file = [
    line({ type: 'user', uuid: 'u1', timestamp: 't1', message: { content: 'first question' } }),
    line({ type: 'assistant', uuid: 'a1', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'first answer' }] } }),
    line({ type: 'user', uuid: 'u2', message: { content: 'second question' } }),
    line({ type: 'assistant', uuid: 'a2', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'second answer' }] } }),
    line({ type: 'last-prompt', uuid: 'x' }),
  ].join('\n');
  const all = parseSession(file);
  assert.strictEqual(all.lastUuid, 'a2');
  assert.strictEqual(all.first, 'first question');
  assert.strictEqual(all.created, 't1');
  const cut = parseSession(file, 'a1');
  assert.deepStrictEqual(cut.items.map((i) => i.text), ['first question', 'first answer']);
  assert.strictEqual(cut.working, false);
});
test('branches: valid file', () => {
  const s = [{ id: B, parent: A, forkUuid: 'a2', forkWords: 'second answer', created: '2026-01-01T00:00:00Z' }];
  assert.deepStrictEqual(parseBranches(JSON.stringify({ sessions: s })), s);
});
test('branches: broken files throw', () => {
  assert.throws(() => parseBranches('{'), /bad JSON/);
  assert.throws(() => parseBranches('[]'), /expected/);
  const ok = { id: B, parent: A, forkUuid: 'a2', forkWords: 'w', created: 'c' };
  assert.throws(() => parseBranches(JSON.stringify({ sessions: [{ ...ok, id: '--dangerously-skip-permissions' }] })), /session id/);
  assert.throws(() => parseBranches(JSON.stringify({ sessions: [{ ...ok, extra: 1 }] })), /unknown key/);
  assert.throws(() => parseBranches(JSON.stringify({ sessions: [{ ...ok, created: 5 }] })), /must be a string/);
});
test('firstWords', () => {
  assert.strictEqual(firstWords('one two\nthree four five six seven'), 'one two three four five six …');
  assert.strictEqual(firstWords('short'), 'short');
});
