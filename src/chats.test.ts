import { test } from 'node:test';
import * as assert from 'node:assert';
import { buildChats, chatTitle, dateGroup, rootOf } from './chats';
import { parseSession } from './session';

const line = (o: unknown) => JSON.stringify(o);
const session = (first: string, created = '2026-11-10T10:00:00Z') =>
  parseSession([line({ type: 'user', uuid: 'u' + first, timestamp: created, message: { content: first } }), line({ type: 'assistant', uuid: 'a' + first, message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] } })].join('\n'));
const br = (id: string, parent: string) => ({ id, parent, forkUuid: 'x', forkWords: 'w', created: '2026-11-10T11:00:00Z' });
const NOW = new Date(2026, 10, 16, 15, 0).getTime();
const H = 3_600_000;

test('chats: branches and retries never add a line', () => {
  const sessions = [
    { id: 'A', chat: session('plan the trip'), mtime: NOW - 5 * H },
    { id: 'A1', chat: session('plan the trip'), mtime: NOW - 2 * H },
    { id: 'A2', chat: session('plan the trip'), mtime: NOW - 3 * H },
    { id: 'A1a', chat: session('plan the trip'), mtime: NOW - 4 * H }, // a branch of a branch
    { id: 'B', chat: session('fix the bug'), mtime: NOW - 1 * H },
  ];
  const rows = buildChats(sessions, [br('A1', 'A'), br('A2', 'A'), br('A1a', 'A1')], 'A2', NOW);
  assert.deepStrictEqual(rows.map((r) => [r.id, r.title, r.branches, r.open, r.current]), [
    ['B', 'fix the bug', 0, 'B', false],
    ['A', 'plan the trip', 3, 'A1', true], // a click opens the session changed last
  ]);
});

test('chats: order by newest change, date groups', () => {
  const D = 24 * H;
  const sessions = [
    { id: 'old', chat: session('old one'), mtime: NOW - 30 * D },
    { id: 'week', chat: session('this week'), mtime: NOW - 3 * D },
    { id: 'yday', chat: session('yesterday'), mtime: NOW - 20 * H },
    { id: 'now', chat: session('today'), mtime: NOW - H },
  ];
  assert.deepStrictEqual(buildChats(sessions, [], 'now', NOW).map((r) => [r.id, r.group]), [['now', 'Today'], ['yday', 'Yesterday'], ['week', 'Previous 7 days'], ['old', 'Earlier']]);
  assert.strictEqual(dateGroup(NOW - 16 * H, NOW), 'Yesterday'); // 23:00 the day before
  assert.strictEqual(dateGroup(NOW + H, NOW), 'Today');
});

test('chats: a deleted root keeps its branches together; the oldest stands in', () => {
  const sessions = [
    { id: 'X1', chat: session('second', '2026-11-12T10:00:00Z'), mtime: NOW - 2 * H },
    { id: 'X2', chat: session('first', '2026-11-11T10:00:00Z'), mtime: NOW - 3 * H },
  ];
  const rows = buildChats(sessions, [br('X1', 'gone'), br('X2', 'gone')], '', NOW);
  assert.deepStrictEqual(rows.map((r) => [r.id, r.title, r.branches, r.open]), [['gone', 'first', 1, 'X1']]);
});

test('chats: empty sessions are hidden, except the current one', () => {
  const sessions = [
    { id: 'E', chat: null, mtime: 0 },
    { id: 'C', chat: null, mtime: 0 },
  ];
  assert.deepStrictEqual(buildChats(sessions, [], 'C', NOW).map((r) => [r.id, r.title, r.group]), [['C', 'New chat', 'Today']]);
});

test('chats: rootOf survives a loop in branches.json; long titles are cut', () => {
  assert.strictEqual(rootOf('a', [br('a', 'b'), br('b', 'a')]), 'a');
  assert.strictEqual(rootOf('c', [br('c', 'b'), br('b', 'a')]), 'a');
  assert.strictEqual(chatTitle('x'.repeat(60)).length, 40);
  assert.strictEqual(chatTitle('  short\n one '), 'short one');
});

test("chats: a name given in the app wins, then Claude Code's /rename, then the first words; long names are cut", () => {
  const renamed = parseSession([line({ type: 'user', uuid: 'u1', message: { content: 'fix the bug' } }), line({ type: 'custom-title', customTitle: 'Bug hunt', sessionId: 'B' })].join('\n'));
  const sessions = [
    { id: 'A', chat: session('plan the trip'), mtime: NOW - 2 * H },
    { id: 'B', chat: renamed, mtime: NOW - 1 * H },
    { id: 'C', chat: session('third one'), mtime: NOW - 3 * H },
  ];
  const long = 'A very long name that will not fit in the chat list at all';
  const rows = buildChats(sessions, [], 'A', NOW, { A: 'Trip', C: long });
  assert.deepStrictEqual(rows.map((r) => [r.id, r.title, r.named]), [['B', 'Bug hunt', false], ['A', 'Trip', true], ['C', chatTitle(long), true]]);
  assert.strictEqual(rows[2].name, long); // a rename starts from the whole name
});
