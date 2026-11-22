import { test } from 'node:test';
import * as assert from 'node:assert';

const L = require('./layout') as typeof Lay;
const p = (id: string): LNode => ({ t: 'pane', id });
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const S3 = '33333333-3333-4333-8333-333333333333';
const near = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9);

test('splitting a pane right or down makes a 2-pane split of that direction', () => {
  const r = L.insertBeside(p('pa'), 'pa', 'pb', 'right');
  assert.deepStrictEqual(r, { t: 'split', dir: 'row', kids: [p('pa'), p('pb')], sizes: [0.5, 0.5] });
  const d = L.insertBeside(p('pa'), 'pa', 'pb', 'top');
  assert.deepStrictEqual(d, { t: 'split', dir: 'col', kids: [p('pb'), p('pa')], sizes: [0.5, 0.5] });
});

test('splitting inside a split of the same direction adds a sibling (a strip), taking half the target share', () => {
  let r = L.insertBeside(p('pa'), 'pa', 'pb', 'right');
  r = L.insertBeside(r, 'pb', 'pc', 'right');
  assert.strictEqual(r.t, 'split');
  assert.deepStrictEqual(L.paneIds(r), ['pa', 'pb', 'pc']);
  assert.ok(r.t === 'split' && near(r.sizes, [0.5, 0.25, 0.25]));
});

test('splits nest to any depth, giving a grid', () => {
  let r = L.insertBeside(p('pa'), 'pa', 'pb', 'right');
  r = L.insertBeside(r, 'pa', 'pc', 'bottom');
  r = L.insertBeside(r, 'pb', 'pd', 'bottom');
  assert.deepStrictEqual(r, {
    t: 'split', dir: 'row', sizes: [0.5, 0.5],
    kids: [{ t: 'split', dir: 'col', kids: [p('pa'), p('pc')], sizes: [0.5, 0.5] }, { t: 'split', dir: 'col', kids: [p('pb'), p('pd')], sizes: [0.5, 0.5] }],
  });
  r = L.insertBeside(r, 'pd', 'pe', 'right'); // a third level
  assert.deepStrictEqual(L.paneIds(r), ['pa', 'pc', 'pb', 'pd', 'pe']);
  const inner = L.at(r, [1, 1]);
  assert.ok(inner && inner.t === 'split' && inner.dir === 'row');
});

test('a new pane at the outer edge: a new column at the right, every pane giving up the same part', () => {
  let r = L.insertBeside(p('pa'), 'pa', 'pb', 'right');
  r = L.appendRoot(r, 'pc', 'right');
  assert.deepStrictEqual(L.paneIds(r), ['pa', 'pb', 'pc']);
  assert.ok(r.t === 'split' && near(r.sizes, [1 / 3, 1 / 3, 1 / 3]));
  const g = L.appendRoot(L.insertBeside(p('pa'), 'pa', 'pb', 'bottom'), 'pc', 'right');
  assert.ok(g.t === 'split' && g.dir === 'row' && g.kids[0].t === 'split' && near(g.sizes, [0.5, 0.5]));
  assert.throws(() => L.appendRoot(g, 'pa', 'right'));
});

test('closing a pane gives its share to its siblings and removes a split left with one pane', () => {
  let r = L.insertBeside(p('pa'), 'pa', 'pb', 'right');
  r = L.insertBeside(r, 'pb', 'pc', 'right'); // .5 .25 .25
  const two = L.removePane(r, 'pa')!;
  assert.ok(two.t === 'split' && near(two.sizes, [0.5, 0.5]));
  const one = L.removePane(two, 'pb');
  assert.deepStrictEqual(one, p('pc'));
  assert.strictEqual(L.removePane(p('pc'), 'pc'), null);
  // a nested split that collapses merges into its parent if they now go the same way
  let g = L.insertBeside(p('pa'), 'pa', 'pb', 'right');
  g = L.insertBeside(g, 'pb', 'pc', 'bottom');
  g = L.insertBeside(g, 'pc', 'pd', 'right');
  const m = L.removePane(g, 'pb')!; // the column now holds only the row [pc, pd]: it merges into the root row
  assert.ok(m.t === 'split' && m.dir === 'row');
  assert.deepStrictEqual(L.paneIds(m), ['pa', 'pc', 'pd']);
  assert.ok(m.t === 'split' && near(m.sizes, [0.5, 0.25, 0.25]));
});

test('moving a pane beside another, and swapping on the center', () => {
  let r = L.insertBeside(p('pa'), 'pa', 'pb', 'right');
  r = L.insertBeside(r, 'pb', 'pc', 'right');
  const moved = L.movePane(r, 'pa', 'pc', 'bottom');
  assert.deepStrictEqual(L.paneIds(moved), ['pb', 'pc', 'pa']);
  const col = L.at(moved, [1]);
  assert.ok(col && col.t === 'split' && col.dir === 'col');
  assert.strictEqual(L.movePane(r, 'pa', 'pa', 'left'), r);
  const sw = L.swapPanes(r, 'pa', 'pc');
  assert.deepStrictEqual(L.paneIds(sw), ['pc', 'pb', 'pa']);
  assert.ok(sw.t === 'split' && r.t === 'split' && near(sw.sizes, r.sizes));
});

test('the input tree is never changed', () => {
  const r = L.insertBeside(p('pa'), 'pa', 'pb', 'right');
  const copy = JSON.stringify(r);
  L.insertBeside(r, 'pa', 'pc', 'bottom');
  L.removePane(r, 'pa');
  L.movePane(r, 'pa', 'pb', 'top');
  L.withSizes(r, [], [0.2, 0.8]);
  assert.strictEqual(JSON.stringify(r), copy);
});

test('divider drag moves share between its two neighbours only, never below the minimum', () => {
  assert.ok(near(L.dragDivider([0.25, 0.25, 0.5], 0, 0.1, 0.1, 0.1), [0.35, 0.15, 0.5]));
  assert.ok(near(L.dragDivider([0.25, 0.25, 0.5], 0, 0.9, 0.1, 0.1), [0.4, 0.1, 0.5]));
  assert.ok(near(L.dragDivider([0.25, 0.25, 0.5], 1, -1, 0.1, 0.1), [0.25, 0.1, 0.65]));
  assert.ok(near(L.equalPair([0.1, 0.5, 0.4], 0), [0.3, 0.3, 0.4]));
});

test('minimum size of nested splits', () => {
  let r = L.insertBeside(p('pa'), 'pa', 'pb', 'right');
  r = L.insertBeside(r, 'pb', 'pc', 'bottom');
  assert.strictEqual(L.minSize(r, 'row', 200, 100, 6), 406);
  assert.strictEqual(L.minSize(r, 'col', 200, 100, 6), 206);
});

test('drop zones: the middle swaps, elsewhere the nearest edge', () => {
  assert.strictEqual(L.dropZone(0.5, 0.5), 'center');
  assert.strictEqual(L.dropZone(0.05, 0.5), 'left');
  assert.strictEqual(L.dropZone(0.95, 0.4), 'right');
  assert.strictEqual(L.dropZone(0.5, 0.1), 'top');
  assert.strictEqual(L.dropZone(0.6, 0.9), 'bottom');
});

test('edge zones: always the nearest edge, also in the middle', () => {
  assert.strictEqual(L.edgeZone(0.45, 0.5), 'left');
  assert.strictEqual(L.edgeZone(0.55, 0.5), 'right');
  assert.strictEqual(L.edgeZone(0.5, 0.45), 'top');
  assert.strictEqual(L.edgeZone(0.9, 0.95), 'bottom');
});

test('pane rectangles follow the shares, with dividers between children', () => {
  let r = L.insertBeside(p('pa'), 'pa', 'pb', 'right');
  r = L.insertBeside(r, 'pb', 'pc', 'bottom');
  assert.deepStrictEqual(L.rects(r, 1005, 605, 5), {
    pa: { x: 0, y: 0, w: 500, h: 605 },
    pb: { x: 505, y: 0, w: 500, h: 300 },
    pc: { x: 505, y: 305, w: 500, h: 300 },
  });
  assert.deepStrictEqual(L.rects(p('pa'), 800, 600, 5), { pa: { x: 0, y: 0, w: 800, h: 600 } });
});

test('focus order wraps both ways', () => {
  let r = L.insertBeside(p('pa'), 'pa', 'pb', 'right');
  r = L.insertBeside(r, 'pb', 'pc', 'right');
  assert.strictEqual(L.nextPane(r, 'pc', 1), 'pa');
  assert.strictEqual(L.nextPane(r, 'pa', -1), 'pc');
  assert.strictEqual(L.nextPane(r, 'pb', 1), 'pc');
});

test('a saved workspace is read back, and anything that does not fit is refused', () => {
  let r = L.insertBeside(p('pa'), 'pa', 'pb', 'right');
  r = L.insertBeside(r, 'pb', 'pc', 'bottom');
  const ws: LWorkspace = { v: 1, root: r, panes: { pa: { session: S1 }, pb: { session: S2, branchOf: S1 }, pc: { session: S3 } }, focus: 'pc', max: 'pb' };
  assert.deepStrictEqual(L.parseWorkspace(JSON.stringify(ws)), ws);
  assert.strictEqual(L.parseWorkspace(null), null);
  assert.strictEqual(L.parseWorkspace('{'), null);
  assert.strictEqual(L.parseWorkspace(JSON.stringify({ ...ws, v: 2 })), null);
  assert.strictEqual(L.parseWorkspace(JSON.stringify({ ...ws, panes: { ...ws.panes, pc: { session: 'x' } } })), null);
  assert.strictEqual(L.parseWorkspace(JSON.stringify({ ...ws, panes: { ...ws.panes, pc: { session: S1 } } })), null); // same chat twice
  assert.strictEqual(L.parseWorkspace(JSON.stringify({ ...ws, root: { t: 'split', dir: 'row', kids: [p('pa'), p('pa')], sizes: [1, 1] } })), null);
  assert.strictEqual(L.parseWorkspace(JSON.stringify({ ...ws, root: { t: 'pane', id: '../x' } })), null);
  // bad sizes become equal shares; an unknown focus falls back to the first pane; max needs 2+ panes
  const bad = L.parseWorkspace(JSON.stringify({ v: 1, root: { t: 'split', dir: 'row', kids: [p('pa'), p('pb')], sizes: [-1, 'x'] }, panes: { pa: { session: S1 }, pb: { session: S2 } }, focus: 'zz', max: 'zz' }))!;
  assert.ok(bad.root.t === 'split' && near(bad.root.sizes, [0.5, 0.5]));
  assert.strictEqual(bad.focus, 'pa');
  assert.strictEqual(bad.max, null);
  const one = L.parseWorkspace(JSON.stringify({ v: 1, root: p('pa'), panes: { pa: { session: S1 } }, focus: 'pa', max: 'pa' }))!;
  assert.strictEqual(one.max, null);
});
