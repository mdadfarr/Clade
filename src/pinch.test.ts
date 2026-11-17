import { test } from 'node:test';
import * as assert from 'node:assert';

const P = require('./pinch') as {
  pinchZoom: typeof pinchZoom;
  graphShown: typeof graphShown;
  settleTo: typeof settleTo;
  smooth: typeof smooth;
  fillScale: typeof fillScale;
  ENTER_S: number;
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('pinch zoom: fingers together (deltaY > 0) zoom out, apart zoom in, and a pinch back undoes it', () => {
  assert.ok(P.pinchZoom(2, 10) < 2);
  assert.ok(P.pinchZoom(2, -10) > 2);
  assert.ok(near(P.pinchZoom(P.pinchZoom(3, 25), -25), 3));
  // many small events give the same zoom as one big one: the move is smooth, not stepped
  let s = 7.5;
  for (let i = 0; i < 40; i++) s = P.pinchZoom(s, 1.5);
  assert.ok(near(s, P.pinchZoom(7.5, 60)));
});

test('graph shown: all of it at or below ENTER_S, none at the fill zoom, gradual in between', () => {
  const fill = 7.5;
  assert.strictEqual(P.graphShown(1, P.ENTER_S, fill), 1);
  assert.strictEqual(P.graphShown(P.ENTER_S, P.ENTER_S, fill), 1);
  assert.strictEqual(P.graphShown(fill, P.ENTER_S, fill), 0);
  assert.strictEqual(P.graphShown(20, P.ENTER_S, fill), 0);
  const mid = Math.sqrt(P.ENTER_S * fill); // half way on a log scale
  assert.ok(near(P.graphShown(mid, P.ENTER_S, fill), 0.5));
  // strictly decreasing through the band
  const steps = Array.from({ length: 11 }, (_, i) => P.graphShown(P.ENTER_S * Math.pow(fill / P.ENTER_S, i / 10), P.ENTER_S, fill));
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i] < steps[i - 1]);
  // a window so small that one box fills it below ENTER_S: no band, no crash
  assert.strictEqual(P.graphShown(1, P.ENTER_S, 2), 1);
  assert.strictEqual(P.graphShown(2, P.ENTER_S, 2), 0);
});

test('settle: a move stopped half way goes to the nearer end', () => {
  assert.strictEqual(P.settleTo(0.2), 'chat');
  assert.strictEqual(P.settleTo(0.7), 'graph');
  assert.strictEqual(P.settleTo(0.5), 'graph');
});

test('smooth: 0 and 1 fixed, symmetric, increasing', () => {
  assert.strictEqual(P.smooth(0), 0);
  assert.strictEqual(P.smooth(1), 1);
  assert.ok(near(P.smooth(0.5), 0.5));
  assert.ok(P.smooth(0.25) < 0.25 && P.smooth(0.75) > 0.75);
});

test('fill scale: the node fills the view with a margin, limited by the tighter side', () => {
  assert.ok(near(P.fillScale(1100, 600, 132, 26), (1100 / 132) * 0.9));
  assert.ok(near(P.fillScale(400, 52, 132, 26), 2 * 0.9));
  assert.strictEqual(P.fillScale(0, 0, 132, 26), 1); // view not laid out yet
});
