import { test } from 'node:test';
import * as assert from 'node:assert';
const M = require('./markup');

const MEM = `stack main
  x: int = 5 @0x7ffc10
  {blue}p{/}: int* -> x @0x7ffc18
  arr: int[3] = 1, 2, 3 @0x7ffc20
  s: struct Point @0x7ffc30
    x: int = 2
    y: int = 7
  buf: char* -> heap.block1
  q: int* -> arr[1]
  n: Node* -> null
heap
  block1: char[8] = "hi, there" @0x5500a0`;

test('mem: every line form', () => {
  const r = M.parseMem(MEM);
  assert.deepStrictEqual(r.map((x: any) => [x.kind, x.name, x.vars.length]), [['stack', 'main', 7], ['heap', '', 1]]);
  const [x, p, arr, s, buf, q, n] = r[0].vars;
  assert.deepStrictEqual([x.name, x.type, x.value, x.addr, x.id], ['x', 'int', '5', '0x7ffc10', '0/x']);
  assert.deepStrictEqual([p.name, p.tone, p.type, p.target, p.value, p.addr], ['p', 'blue', 'int*', 'x', '', '0x7ffc18']);
  assert.deepStrictEqual([arr.cells, arr.value], [['1', '2', '3'], '']);
  assert.deepStrictEqual(s.fields.map((f: any) => [f.id, f.type, f.value]), [['0/s/x', 'int', '2'], ['0/s/y', 'int', '7']]);
  assert.deepStrictEqual([buf.target, q.target, n.target], ['heap.block1', 'arr[1]', 'null']);
  const b = r[1].vars[0];
  assert.deepStrictEqual([b.type, b.value, b.cells], ['char[8]', '"hi, there"', null]); // a string is one value, not cells
  assert.deepStrictEqual(M.parseMem('heap\n  only_a_name')[0].vars[0], { id: '0/only_a_name', name: 'only_a_name', type: '', value: '', target: '', addr: '', tone: '', cells: null, fields: [] });
  assert.deepStrictEqual(M.memCells(`'a', "b,c", 3`), ["'a'", '"b,c"', '3']);
});

test('mem: pointers resolve to boxes, fields, cells, null or nothing', () => {
  const r = M.parseMem(MEM + '\nstack helper\n  x: int = 9\n  r: int* -> x\n  m: int* -> main.x\n  f: int* -> s.y\n  h: char* -> block1\n  z: int* -> nowhere\n  big: int* -> arr[99]');
  assert.strictEqual(M.memTarget(r, 0, 'x'), '0/x');
  assert.strictEqual(M.memTarget(r, 0, 'heap.block1'), '1/block1');
  assert.strictEqual(M.memTarget(r, 0, 'arr[1]'), '0/arr[1]');
  assert.strictEqual(M.memTarget(r, 0, 'null'), 'null');
  assert.strictEqual(M.memTarget(r, 2, 'x'), '2/x'); // own region first
  assert.strictEqual(M.memTarget(r, 2, 'main.x'), '0/x');
  assert.strictEqual(M.memTarget(r, 2, 's.y'), '0/s/y'); // a field, found in another region
  assert.strictEqual(M.memTarget(r, 2, 'block1'), '1/block1');
  assert.strictEqual(M.memTarget(r, 2, 'nowhere'), '');
  assert.strictEqual(M.memTarget(r, 2, 'arr[99]'), '0/arr'); // no such cell: the array itself
  assert.strictEqual(M.memTarget(r, 0, ''), '');
});

test('mem: broken blocks give null (shown as code)', () => {
  assert.strictEqual(M.parseMem(''), null);
  assert.strictEqual(M.parseMem('x: int = 5'), null); // no region
  assert.strictEqual(M.parseMem('stack main'), null); // no boxes
  assert.strictEqual(M.parseMem('pile\n  x: int'), null); // unknown region
  assert.strictEqual(M.parseMem('heap extra\n  x: int'), null); // only a stack frame has a name
  assert.strictEqual(M.parseMem('heap\n   x: int'), null); // odd indent
  assert.strictEqual(M.parseMem('heap\n    x: int'), null); // a field with no struct above it
  assert.strictEqual(M.parseMem('heap\n  : int = 5'), null); // no name
  assert.strictEqual(M.parseMem('heap\n  x: int ='), null); // nothing after =
  assert.strictEqual(M.parseMem('heap\n  p: int* -> x\n    f: int'), null); // a pointer has no fields
  assert.strictEqual(M.parseMem('heap\n  a\n    b\n      c\n        d'), null); // 4 levels
  assert.strictEqual(M.parseMem('heap\n' + Array(61).fill('  v: int').join('\n')), null);
  assert.strictEqual(M.parseMem('heap\n' + Array(60).fill('  v: int').join('\n'))[0].vars.length, 60);
  assert.strictEqual(M.parseMem('heap\n' + Array(31).fill('  p: int* -> v').join('\n')), null); // too many arrows
  assert.strictEqual(M.parseMem(Array(9).fill('heap\n  v').join('\n')), null); // too many regions
  assert.strictEqual(M.parseMem('heap\n  ' + 'n'.repeat(41)), null);
});

test('timeline: entries, tone, limits', () => {
  assert.deepStrictEqual(M.parseTimeline('1972: C is created\n{accent}1989{/}: ANSI C: the standard\n10:30: lunch'), [
    { when: '1972', what: 'C is created', tone: '' },
    { when: '1989', what: 'ANSI C: the standard', tone: 'accent' },
    { when: '10:30', what: 'lunch', tone: '' },
  ]);
  assert.strictEqual(M.parseTimeline('1972: only one'), null);
  assert.strictEqual(M.parseTimeline('1972: a\nno colon here'), null);
  assert.strictEqual(M.parseTimeline('1972: a\n: b'), null);
  assert.strictEqual(M.parseTimeline(Array(31).fill('1: a').join('\n')), null);
});

test('compare: columns and rows must line up', () => {
  assert.deepStrictEqual(M.parseCompare('vs: Stack | Heap\nSpeed: very fast | slower\nFreed: automatically | by `free(p)`'), {
    cols: ['Stack', 'Heap'],
    rows: [{ aspect: 'Speed', cells: ['very fast', 'slower'] }, { aspect: 'Freed', cells: ['automatically', 'by `free(p)`'] }],
  });
  assert.strictEqual(M.parseCompare('Stack | Heap\nSpeed: a | b'), null); // no vs: line
  assert.strictEqual(M.parseCompare('vs: Only\nSpeed: a'), null);
  assert.strictEqual(M.parseCompare('vs: A | B | C | D | E\nx: 1 | 2 | 3 | 4 | 5'), null);
  assert.strictEqual(M.parseCompare('vs: A | B\nSpeed: a | b | c'), null); // wrong number of cells
  assert.strictEqual(M.parseCompare('vs: A | B'), null); // no rows
  assert.strictEqual(M.parseCompare('vs: A | B\n' + Array(21).fill('x: 1 | 2').join('\n')), null);
});

test('flow: nodes in order of mention, labels, loops', () => {
  const f = M.parseFlow('Read input -> Valid?\nValid? -> Save : yes\nValid? -> Show error : no\nShow error -> Read input\nSave -> Done');
  assert.deepStrictEqual(f.nodes, ['Read input', 'Valid?', 'Save', 'Show error', 'Done']);
  assert.deepStrictEqual(f.edges, [
    { from: 0, to: 1, label: '' },
    { from: 1, to: 2, label: 'yes' },
    { from: 1, to: 3, label: 'no' },
    { from: 3, to: 0, label: '' }, // an arrow back up
    { from: 2, to: 4, label: '' },
  ]);
  assert.strictEqual(M.parseFlow('just a line'), null);
  assert.strictEqual(M.parseFlow('A -> B -> C'), null); // one arrow per line
  assert.strictEqual(M.parseFlow('A -> '), null);
  assert.strictEqual(M.parseFlow(''), null);
  assert.strictEqual(M.parseFlow(Array.from({ length: 21 }, (_, i) => `n${i} -> n${i + 1}`).join('\n')), null);
  assert.strictEqual(M.parseFlow('A -> A'), null); // a single node looping is not a flow
});
