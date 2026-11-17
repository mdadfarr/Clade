import { test } from 'node:test';
import * as assert from 'node:assert';
const D = require('./draw');

const FBD = `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg">
  <title>Box on a ramp</title>
  <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="text"/></marker></defs>
  <line x1="20" y1="200" x2="300" y2="40" stroke="muted" stroke-width="2"/>
  <rect x="140" y="90" width="50" height="40" fill="surface" stroke="text" transform="rotate(-30 165 110)"/>
  <line x1="165" y1="110" x2="165" y2="190" stroke="bad" stroke-width="2.5" marker-end="url(#arrow)"/>
  <text x="172" y="185" fill="bad" font-size="13">W = 49 N</text>
</svg>`;

const tags = (n: any): string[] => [n.tag, ...n.kids.filter((k: any) => typeof k !== 'string').flatMap(tags)];
const all = (n: any): any[] => [n, ...n.kids.filter((k: any) => typeof k !== 'string').flatMap(all)];

test('drawing: a free-body diagram parses; size from viewBox; ids and marker refs get the prefix', () => {
  const d = D.parseDrawing(FBD, 'dw1-');
  assert.ok(d);
  assert.strictEqual(d.width, 320);
  assert.strictEqual(d.height, 240);
  assert.deepStrictEqual(tags(d.root), ['svg', 'title', 'defs', 'marker', 'path', 'line', 'rect', 'line', 'text']);
  const nodes = all(d.root);
  assert.deepStrictEqual(nodes.find((n) => n.tag === 'marker').attrs.find(([k]: string[]) => k === 'id'), ['id', 'dw1-arrow']);
  assert.ok(nodes.some((n) => n.attrs.some(([k, v]: string[]) => k === 'marker-end' && v === 'url(#dw1-arrow)')));
  assert.deepStrictEqual(nodes.find((n) => n.tag === 'text').kids, ['W = 49 N']);
  assert.deepStrictEqual(nodes.find((n) => n.tag === 'text').colors, [['fill', 'bad']]);
});

test('drawing: scripts, handlers, links, styles, external images and fonts never survive', () => {
  const evil = `<svg viewBox="0 0 10 10" onload="alert(1)" style="background:url(http://x)">
    <script>alert(1)</script>
    <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
    <image href="http://example.com/a.png" width="10" height="10"/>
    <use href="#a"/>
    <a href="javascript:alert(1)"><rect width="5" height="5"/></a>
    <style>@import url(http://x); rect{fill:red}</style>
    <animate attributeName="x" to="5"/>
    <linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient>
    <rect id="a" width="5" height="5" onclick="x()" fill="url(#g)" font-family="Comic Sans" class="x" xlink:href="http://x" filter="url(#f)"/>
    <circle cx="5" cy="5" r="2" marker-end="url(http://x/#m)" transform="translate(1,1) expression(x)"/>
  </svg>`;
  const d = D.parseDrawing(evil, 'p-');
  assert.ok(d);
  assert.deepStrictEqual(tags(d.root), ['svg', 'rect', 'circle']);
  const text = JSON.stringify(d.root);
  for (const bad of ['onload', 'onclick', 'script', 'alert', 'http', 'href', 'style', 'url(', 'Comic', 'class', 'filter', 'expression'])
    assert.ok(!text.includes(bad), bad);
});

test('drawing: anything malformed, half-written or without size is null (shown as code)', () => {
  for (const src of [
    '',
    '<svg viewBox="0 0 10 10"><rect width="1" height="1"/>', // half-written
    '<svg viewBox="0 0 10 10"><rect width="1" height="1"></svg>', // unclosed child
    '<svg><rect width="1" height="1"/></svg>', // no size
    '<svg viewBox="0 0 10 10"></svg>', // nothing to draw
    '<svg viewBox="0 0 10 10"><script>x</script></svg>', // nothing left to draw
    '<!DOCTYPE svg><svg viewBox="0 0 10 10"><rect width="1" height="1"/></svg>',
    '<svg viewBox="0 0 10 10"><![CDATA[x]]><rect width="1" height="1"/></svg>',
    '<svg viewBox="0 0 10 10" a="1" a="2"><rect width="1" height="1"/></svg>',
    'text <svg viewBox="0 0 10 10"><rect width="1" height="1"/></svg>',
    '<g><rect width="1" height="1"/></g>', // root is not svg
    '<svg viewBox="0 0 10 10"><rect width="1" height="1"/></svg><svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
    `<svg viewBox="0 0 10 10">${'<g>'.repeat(40)}<rect width="1" height="1"/>${'</g>'.repeat(40)}</svg>`, // too deep
    `<svg viewBox="0 0 10 10">${'<rect width="1" height="1"/>'.repeat(2100)}</svg>`, // too many nodes
  ])
    assert.strictEqual(D.parseDrawing(src), null, src.slice(0, 60));
  // width and height without a viewBox are fine; comments and an xml line are skipped
  const d = D.parseDrawing('<?xml version="1.0"?><!-- hi --><svg width="200" height="100"><rect width="1" height="1"/></svg>');
  assert.strictEqual(d.width, 200);
  assert.deepStrictEqual(d.root.attrs, [['viewBox', '0 0 200 100']]);
});

test('drawing colors: app names stay; other colors go to the nearest app color', () => {
  for (const n of Object.keys(D.DRAW_COLORS)) assert.deepStrictEqual(D.drawColor(n), { name: n });
  const name = (v: string) => D.drawColor(v)?.name ?? null;
  assert.strictEqual(name('none'), 'none');
  assert.strictEqual(name('currentColor'), 'text');
  assert.strictEqual(name('black'), 'text');
  assert.strictEqual(name('#333'), 'text');
  assert.strictEqual(name('#888888'), 'muted');
  assert.strictEqual(name('white'), 'bg');
  assert.strictEqual(name('#e33'), 'bad');
  assert.strictEqual(name('rgb(0, 128, 0)'), 'green');
  assert.strictEqual(name('#1f63b5'), 'blue');
  assert.strictEqual(name('orange'), 'orange');
  assert.strictEqual(name('purple'), 'purple');
  assert.deepStrictEqual(D.drawColor('#ffe4e1'), { name: 'bad', alpha: 0.18 }); // pastel: a light tint
  assert.strictEqual(D.drawColor('url(#g)'), null);
  assert.strictEqual(D.drawColor('var(--x)'), null);
  // a pastel fill gets an opacity unless one is given
  const d = D.parseDrawing('<svg viewBox="0 0 10 10"><rect width="1" height="1" fill="lightblue"/><rect width="1" height="1" fill="lightblue" fill-opacity="0.5"/></svg>');
  assert.deepStrictEqual(d.root.kids[0].attrs, [['width', '1'], ['height', '1'], ['fill-opacity', '0.18']]);
  assert.deepStrictEqual(d.root.kids[1].attrs, [['width', '1'], ['height', '1'], ['fill-opacity', '0.5']]);
});

test('drawing preview: the SVG source is replaced by a box of the right size', () => {
  const parts = D.drawPreviewParts('Here is the diagram.\n\n<svg viewBox="0 0 320 240">\n  <line x1="0"/>\n</svg>\n\nThree forces.');
  assert.deepStrictEqual(parts.map((p: any) => p.kind), ['text', 'draw', 'text']);
  assert.deepStrictEqual(parts[1], { kind: 'draw', width: 320, height: 240, done: true });
  const half = D.drawPreviewParts('Text\n<svg viewBox="0 0 400 100">\n  <rect');
  assert.deepStrictEqual(half[1], { kind: 'draw', width: 400, height: 100, done: false });
  assert.deepStrictEqual(D.drawPreviewParts('Text\n<svg view')[1], { kind: 'draw', width: null, height: null, done: false }); // size not on screen yet
  assert.deepStrictEqual(D.drawPreviewParts('no drawing here'), [{ kind: 'text', text: 'no drawing here' }]);
  // the placeholder and the final picture have the same size
  const d = D.parseDrawing(FBD);
  assert.deepStrictEqual([d.width, d.height], [D.drawPendingSize(FBD).width, D.drawPendingSize(FBD).height]);
});

test('drawing save: a standalone SVG with the colors written in; no script can come back', () => {
  const d = D.parseDrawing(FBD, 'dw2-');
  const palette = Object.fromEntries(Object.keys(D.DRAW_COLORS).map((k, i) => [k, `#0000${String(i).padStart(2, '0')}`]));
  const out = D.drawSerialize(d, palette, 'Inter, sans-serif');
  assert.match(out, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="320" height="240"/);
  assert.match(out, /fill="#0000\d\d"/);
  assert.doesNotMatch(out, /fill="bad"|var\(/);
  assert.match(out, /font-family="Inter, sans-serif"/);
  assert.ok(D.parseDrawing(out)); // the saved file is itself a valid drawing
  const tricky = D.parseDrawing('<svg viewBox="0 0 10 10"><text x="1" y="5">&lt;script&gt;a &amp; b</text></svg>');
  assert.match(D.drawSerialize(tricky, palette, 'x'), /&lt;script&gt;a &amp; b/);
});
