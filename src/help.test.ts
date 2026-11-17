import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
const M = require('./markup');
const D = require('./draw');

const help = fs.readFileSync(path.join(__dirname, '..', 'help.md'), 'utf8');
const fences = [...help.matchAll(/^```(\w+)\n([\s\S]*?)^```$/gm)].map((m) => ({ lang: m[1], body: m[2] }));
const PARSE: Record<string, (s: string) => unknown> = { map: M.parseMap, mem: M.parseMem, timeline: M.parseTimeline, compare: M.parseCompare, flow: M.parseFlow, svg: (t: string) => D.parseDrawing(t) };

test('help page: every block parses (none falls back to plain code)', () => {
  assert.deepStrictEqual(fences.map((f) => f.lang).sort(), ['compare', 'flow', 'map', 'mem', 'svg', 'timeline']);
  for (const f of fences) assert.ok(PARSE[f.lang](f.body), `${f.lang} block does not parse`);
});

test('help page: every map node is a heading of the page', () => {
  const headings = [...help.matchAll(/^#{1,6}\s+(.*)$/gm)].map((m) => m[1]);
  const map = M.parseMap(fences.find((f) => f.lang === 'map')!.body) as { label: string; target?: string }[];
  for (const n of map) assert.ok(M.findHeading(n.target ?? n.label, headings) >= 0, `map node "${n.label}" has no heading`);
});

test('help page: every color and size tag is a known name; one callout of a known kind', () => {
  for (const m of help.matchAll(/\{([a-z ]+)\}/g)) assert.strictEqual(M.tagKind(m[1]).kind, 'style', m[1]);
  const callouts = [...help.matchAll(/^> \[!(\w+)\]/gm)].map((m) => m[1]);
  assert.deepStrictEqual(callouts, ['tip']);
  assert.ok('tip' in M.CALLOUTS);
});

test('help page: paragraphs are one line each (the renderer keeps line breaks)', () => {
  const plain = (l: string) => !!l.trim() && !/^\s*(#|\||>|```|- |\* |\d+\. )/.test(l);
  let fence = false;
  const lines = help.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('```')) fence = !fence;
    if (!fence && i > 0 && plain(lines[i]) && plain(lines[i - 1]) && !lines[i - 1].startsWith('```')) assert.fail(`hard wrap at line ${i + 1}: ${lines[i]}`);
  }
});
