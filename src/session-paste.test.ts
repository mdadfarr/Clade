import { test } from 'node:test';
import * as assert from 'node:assert';
import { cutSession, isInjected, parseSession, unwrapPasted } from './session';

// Shapes as Claude Code 2.1.327 writes them (made-up text).
const line = (o: object) => JSON.stringify(o);
const user = (uuid: string, parent: string | null, content: unknown) =>
  line({ type: 'user', uuid, parentUuid: parent, timestamp: '2026-11-18T12:00:00Z', message: { role: 'user', content } });
const said = (uuid: string, parent: string, text: string) =>
  line({ type: 'assistant', uuid, parentUuid: parent, message: { role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }] } });
const PASTE = '\n\n<pasted_content id="66c4">\nthe group part is due next week.\nmake me the schedule\n</pasted_content id="66c4">\n';

test('a long paste is shown as the text inside the tags (it used to be dropped)', () => {
  const chat = parseSession([user('u1', null, 'plan my week'), said('a1', 'u1', 'Plan one'), user('u2', 'a1', PASTE), said('a2', 'u2', 'Schedule')].join('\n'));
  assert.deepStrictEqual(chat.items.filter((i) => i.role === 'user').map((i) => i.text), ['plan my week', 'the group part is due next week.\nmake me the schedule']);
  assert.strictEqual(chat.replies.length, 2);
  assert.strictEqual(chat.replies[1].userText, 'the group part is due next week.\nmake me the schedule'); // Retry sends the text, not the tags
  assert.strictEqual(chat.replies[0].forkUuid, 'a1'); // Branch works on the reply before it
});

test('a chat whose first message is a paste has a first message (listed, branchable), and the reply belongs to it', () => {
  const chat = parseSession([user('u1', null, PASTE), said('a1', 'u1', 'Schedule')].join('\n'));
  assert.strictEqual(chat.first, 'the group part is due next week.\nmake me the schedule');
  assert.strictEqual(chat.replies.length, 1);
  assert.strictEqual(chat.items.find((i) => i.role === 'claude')?.reply, 0);
  assert.strictEqual(chat.replies[0].forkUuid, 'a1');
});

test('typed text around a paste, and text-block content, keep everything but the tags', () => {
  assert.strictEqual(unwrapPasted('see this:\n<pasted_content id="1">\nline a\nline b\n</pasted_content id="1">\nthanks').trim(), 'see this:\nline a\nline b\nthanks');
  const chat = parseSession(user('u1', null, [{ type: 'text', text: PASTE }]));
  assert.strictEqual(chat.first, 'the group part is due next week.\nmake me the schedule');
});

test("Claude Code's own lines stay hidden; any other text starting with < is a real message", () => {
  for (const s of ['<command-name>/usage</command-name>', '<local-command-stdout>x</local-command-stdout>', '<system-reminder>x</system-reminder>', '<bash-input>ls</bash-input>', '<command-message>x</command-message>'])
    assert.ok(isInjected(s), s);
  for (const s of ['<div> is an html tag', '<3 thanks', '<T> generics in C++?']) assert.ok(!isInjected(s), s);
  const chat = parseSession([user('u1', null, '<command-name>/usage</command-name>'), user('u2', 'u1', '<T> generics in C++?'), said('a2', 'u2', 'Templates.')].join('\n'));
  assert.deepStrictEqual(chat.items.filter((i) => i.role === 'user').map((i) => i.text), ['<T> generics in C++?']);
});

test('branch after two tool calls in one message: the side answer is kept, the cut no longer refuses', () => {
  // Shape Claude Code writes: call A -> call B -> answer B -> reply; answer A hangs off call A.
  const L = (o: object) => JSON.stringify({ sessionId: 'old', ...o });
  const tu = (id: string) => ({ type: 'tool_use', id, name: 'AskUserQuestion', input: {} });
  const tr = (id: string) => ({ type: 'tool_result', tool_use_id: id, content: 'answered' });
  const file = [
    L({ type: 'user', uuid: 'u1', parentUuid: null, message: { role: 'user', content: 'plan my day' } }),
    L({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', message: { role: 'assistant', stop_reason: 'tool_use', content: [tu('A')] } }),
    L({ type: 'assistant', uuid: 'a2', parentUuid: 'a1', message: { role: 'assistant', stop_reason: 'tool_use', content: [tu('B')] } }),
    L({ type: 'user', uuid: 'rA', parentUuid: 'a1', message: { role: 'user', content: [tr('A')] } }),
    L({ type: 'user', uuid: 'rB', parentUuid: 'a2', message: { role: 'user', content: [tr('B')] } }),
    L({ type: 'assistant', uuid: 'a3', parentUuid: 'rB', message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Plan' }] } }),
    L({ type: 'system', uuid: 's1', parentUuid: 'a3', subtype: 'turn_duration' }),
  ].join('\n');
  const chat = parseSession(file);
  assert.strictEqual(chat.replies[0].forkUuid, 's1');
  const cut = cutSession(file, 's1', 'new');
  const uuids = cut.trim().split('\n').map((l) => JSON.parse(l).uuid);
  assert.deepStrictEqual(uuids, ['u1', 'a1', 'a2', 'rA', 'rB', 'a3', 's1']); // file order, answer A included
  assert.ok(cut.trim().split('\n').every((l) => JSON.parse(l).sessionId === 'new'));
  // a cut before the answers still refuses
  assert.throws(() => cutSession(file, 'a2', 'new'), /between a tool call and its result/);
});
