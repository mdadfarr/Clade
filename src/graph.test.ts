import { test } from 'node:test';
import * as assert from 'node:assert';
import { buildGraph, layoutGraph } from './graph';
import { cutSession, parseSession, takeLabel } from './session';

// ---- labels ----

test('label tag: removed from the text, last one wins, spacing tidied', () => {
  assert.deepStrictEqual(takeLabel('Hello there.\n\n{label=Greeting reply}'), { text: 'Hello there.', label: 'Greeting reply' });
  assert.deepStrictEqual(takeLabel('a {label=x} b\n{label=  y z }'), { text: 'a  b', label: 'y z' });
  assert.deepStrictEqual(takeLabel('no tag'), { text: 'no tag', label: '' });
});

let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const SID = '11111111-1111-4111-8111-111111111111';
/** A session file: each pair is (user text, assistant text). */
function file(pairs: [string, string][], sessionId = SID, start: string | null = null): { text: string; uuids: string[] } {
  const lines: string[] = [];
  const uuids: string[] = [];
  let parent = start;
  pairs.forEach(([u, a], i) => {
    const uu = uid();
    const au = uid();
    const t = new Date(Date.UTC(2026, 10, 16, 10, 0, n)).toISOString(); // later files, later times
    lines.push(JSON.stringify({ type: 'user', uuid: uu, parentUuid: parent, sessionId, timestamp: t, message: { content: u } }));
    lines.push(JSON.stringify({ type: 'assistant', uuid: au, parentUuid: uu, sessionId, timestamp: t, message: { stop_reason: 'end_turn', content: [{ type: 'text', text: a }] } }));
    uuids.push(uu, au);
    parent = au;
  });
  return { text: lines.join('\n') + '\n', uuids };
}

test('label: taken from the reply, kept out of chat items and Copy; missing: first three words', () => {
  const chat = parseSession(file([['hi', 'Hello **there** friend.\n{label=Warm greeting}'], ['more', '## Plan: do it now please']]).text);
  assert.strictEqual(chat.replies[0].label, 'Warm greeting');
  assert.strictEqual(chat.replies[0].copy, 'Hello **there** friend.');
  assert.ok(!chat.items.some((i) => i.text.includes('{label=')));
  assert.strictEqual(chat.replies[1].label, 'Plan: do it');
});

// ---- graph ----

const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const C = '44444444-4444-4444-8444-444444444444';

test('graph: a chain, a branch forking at a reply, a retry beside the reply it replaces', () => {
  const main = file([['q1', 'r1 {label=one}'], ['q2', 'r2 {label=two}'], ['q3', 'r3 {label=three}']], A);
  const mainChat = parseSession(main.text);
  // Branch from reply 1: cut at reply 1's end, then one new exchange.
  const cutB = cutSession(main.text, mainChat.replies[0].forkUuid!, B);
  const branchB = cutB + file([['q4', 'r4 {label=four}']], B, main.uuids[1]).text;
  // Retry of reply 3: cut at reply 2's end (reply 3's retryCut), then the message again.
  const cutC = cutSession(main.text, mainChat.replies[2].retryCut!, C);
  const branchC = cutC + file([['q3', 'r3 again {label=three bis}']], C, main.uuids[3]).text;
  const branches = [
    { id: B, parent: A, forkUuid: mainChat.replies[0].forkUuid!, forkWords: 'r1', created: '2026-11-16T11:00:00Z' },
    { id: C, parent: A, forkUuid: mainChat.replies[2].retryCut!, forkWords: 'retry: q3', created: '2026-11-16T12:00:00Z' },
  ];
  const g = buildGraph(
    [A, B, C].map((id, i) => ({ id, chat: parseSession([main.text, branchB, branchC][i]) })),
    branches,
    B,
  );
  const label = (id: string | null) => g.nodes.find((x) => x.id === id)?.label;
  assert.deepStrictEqual(g.nodes.map((x) => [x.label, label(x.parent) ?? null]), [
    ['one', null],
    ['two', 'one'],
    ['three', 'two'],
    ['four', 'one'], // the branch forks at reply 1
    ['three bis', 'two'], // the retry is a sibling of reply 3
  ]);
  assert.strictEqual(label(g.current), 'four');
  assert.ok(g.nodes.every((x) => x.canBranch));

  const pos = new Map(layoutGraph(g.nodes).map((p) => [p.node.label, [p.x, p.y]]));
  assert.deepStrictEqual(pos.get('one'), [0, 0]);
  assert.deepStrictEqual(pos.get('two'), [0, 1]);
  assert.deepStrictEqual(pos.get('three'), [0, 2]);
  assert.deepStrictEqual(pos.get('three bis'), [1, 2]); // beside the reply it replaces
  assert.deepStrictEqual(pos.get('four'), [2, 1]);
});

test('graph: an empty new branch points at its fork reply; a retry of a first reply sits beside it', () => {
  const main = file([['q1', 'r1 {label=one}']], A);
  const mainChat = parseSession(main.text);
  const retryFirst = file([['q1', 'r1 again {label=one bis}']], C);
  const g = buildGraph(
    [{ id: A, chat: mainChat }, { id: B, chat: null }, { id: C, chat: parseSession(retryFirst.text) }],
    [
      { id: B, parent: A, forkUuid: mainChat.replies[0].forkUuid!, forkWords: 'r1', created: '2026-11-16T11:00:00Z' },
      { id: C, parent: A, forkUuid: '', forkWords: 'retry: q1', created: '2026-11-16T12:00:00Z' },
    ],
    B,
  );
  assert.strictEqual(g.nodes.find((x) => x.id === g.current)?.label, 'one');
  const bis = g.nodes.find((x) => x.label === 'one bis')!;
  assert.strictEqual(bis.parent, null);
  assert.strictEqual(bis.beside, g.nodes[0].id);
  const pos = new Map(layoutGraph(g.nodes).map((p) => [p.node.label, [p.x, p.y]]));
  assert.deepStrictEqual([pos.get('one'), pos.get('one bis')], [[0, 0], [1, 0]]);
});

test('layout: a long chat does not overflow the stack', () => {
  const nodes = Array.from({ length: 20000 }, (_, i) => ({
    id: `n${i}`, session: A, reply: `n${i}`, parent: i ? `n${i - 1}` : null, beside: null, label: '', first: '', created: '', canBranch: true,
  }));
  const out = layoutGraph(nodes);
  assert.strictEqual(out.length, 20000);
  assert.deepStrictEqual([out[19999].x, out[19999].y], [0, 19999]);
});
