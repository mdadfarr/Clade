import { test } from 'node:test';
import * as assert from 'node:assert';
import { stripStyleTags } from './session';
const M = require('./markup');
const H = require('./highlight');

test('tags: every tone and size name parses, alone and together', () => {
  for (const t of M.TONE_NAMES) assert.deepStrictEqual(M.tagKind(t), { kind: 'style', tone: t, size: '' });
  for (const s of M.SIZE_NAMES) assert.deepStrictEqual(M.tagKind(s), { kind: 'style', tone: '', size: s });
  assert.deepStrictEqual(M.tagKind('warn big'), { kind: 'style', tone: 'warn', size: 'big' });
  assert.deepStrictEqual(M.tagKind('small teal'), { kind: 'style', tone: 'teal', size: 'small' });
  assert.deepStrictEqual(M.TONE_NAMES.length + M.SIZE_NAMES.length, 13);
});

test('tags: unknown names are dropped (text shows plain), never styled', () => {
  for (const a of ['red', 'huge', 'accent bold', 'blue green', 'big small', 'fx=dither', 'fx=nope']) assert.deepStrictEqual(M.tagKind(a), { kind: 'drop' }, a);
});

test('tags: hex and other things are not tags; old tags are told apart', () => {
  for (const a of ['#ff0000', 'accent  big', 'Accent', 'a b c', '', 'x^2', 'color:red', 'accent;']) assert.deepStrictEqual(M.tagKind(a), { kind: 'text' }, a);
  assert.deepStrictEqual(M.tagKind('c=#e8a33d s=1.4'), { kind: 'old' });
  assert.deepStrictEqual(M.tagKind('s=2'), { kind: 'old' });
});

test('tags: stripTags for Copy keeps LaTeX and unclosed braces', () => {
  const src = '{accent}key{/} and {warn big}care{/} {c=#fff s=2}old{/} {nope}plain{/} $\\frac{1}{2}$ {x} {accent}open';
  const want = 'key and care old plain $\\frac{1}{2}$ {x} {accent}open';
  assert.strictEqual(M.stripTags(src), want);
  assert.strictEqual(stripStyleTags(src), want); // the main process copy uses the same rule
  assert.strictEqual(M.stripTags('# {fx=dither}Title{/}'), '# Title');
});

test('fx: only a whole heading, only known effects', () => {
  assert.deepStrictEqual(M.parseFxHeading('{fx=title}Big Title{/}'), { fx: 'title', text: 'Big Title' });
  assert.deepStrictEqual(M.parseFxHeading('{fx=dither}Big Title{/}'), { fx: 'title', text: 'Big Title' }); // old chats: the same big title
  assert.deepStrictEqual(M.parseFxHeading(' {fx=gradient}A{/} '), { fx: null, text: 'A' }); // removed effect: plain heading
  assert.deepStrictEqual(M.FX_NAMES, ['title', 'dither', 'mono']);
  assert.deepStrictEqual(M.parseFxHeading('{fx=mono}STEP{/}').fx, 'title');
  assert.deepStrictEqual(M.parseFxHeading('{fx=sparkle}A{/}'), { fx: null, text: 'A' }); // unknown: plain heading
  assert.strictEqual(M.parseFxHeading('Intro {fx=dither}A{/}').fx, null); // only part of the heading
  assert.strictEqual(M.parseFxHeading('{fx=dither}A{/} and {accent}b{/}').fx, null);
  assert.strictEqual(M.parseFxHeading('{fx=dither}A').fx, null);
  assert.strictEqual(M.parseFxHeading('{fx=url(x)}A{/}').fx, null);
});

test('map: levels, targets, tone', () => {
  const nodes = M.parseMap('Variables\n  ints -> Whole numbers\n  {blue}floats{/}\n\tstrings\n    chars\nLoops');
  assert.deepStrictEqual(nodes, [
    { depth: 0, label: 'Variables', target: 'Variables', tone: '' },
    { depth: 1, label: 'ints', target: 'Whole numbers', tone: '' },
    { depth: 1, label: 'floats', target: 'floats', tone: 'blue' },
    { depth: 1, label: 'strings', target: 'strings', tone: '' },
    { depth: 2, label: 'chars', target: 'chars', tone: '' },
    { depth: 0, label: 'Loops', target: 'Loops', tone: '' },
  ]);
  assert.strictEqual(M.parseMap('{red}x{/}')[0].tone, ''); // unknown color: plain node
});

test('map: broken blocks give null (shown as code)', () => {
  assert.strictEqual(M.parseMap(''), null);
  assert.strictEqual(M.parseMap('  indented first'), null);
  assert.strictEqual(M.parseMap('a\n b'), null); // a 1-space step
  assert.strictEqual(M.parseMap('a\n  b\n      c'), null); // skips a level (step 2, then 6)
  assert.strictEqual(M.parseMap('a\n -> nothing'), null); // no label
  assert.strictEqual(M.parseMap('x'.repeat(61)), null);
  assert.strictEqual(M.parseMap(Array(41).fill('n').join('\n')), null);
  assert.strictEqual(M.parseMap(Array(40).fill('n').join('\n')).length, 40);
  assert.strictEqual(M.parseMap('a\n  b\n    c\n      d\n        e\n          f\n            g'), null); // 7 levels
  assert.strictEqual(M.parseMap('a\n  b\n    c\n      d\n        e\n          f').length, 6);
});

test('map: heading matching ignores case, tags and punctuation; exact wins over prefix', () => {
  const heads = ['Whole numbers (ints)', '{fx=dither}Variables{/}', '2. Text values', 'Text'];
  assert.strictEqual(M.findHeading('variables', heads), 1);
  assert.strictEqual(M.findHeading('Whole numbers', heads), 0);
  assert.strictEqual(M.findHeading('text', heads), 3);
  assert.strictEqual(M.findHeading('2 text', heads), 2);
  assert.strictEqual(M.findHeading('floats', heads), -1);
  assert.strictEqual(M.findHeading('!!', heads), -1);
  assert.strictEqual(M.findHeading('Var', heads), -1); // a prefix must end at a word
});

test('table: cells, alignment, bars in code and math', () => {
  const t = M.parseTable(['| Name | Cost | Note |', '|:--|--:|:-:|', '| a | 1 | `x|y` |', 'b | 2 | $|v|$ | extra', '| c |', '', 'after'], 0);
  assert.deepStrictEqual(t.align, ['left', 'right', 'center']);
  assert.deepStrictEqual(t.head, ['Name', 'Cost', 'Note']);
  assert.deepStrictEqual(t.rows, [['a', '1', '`x|y`'], ['b', '2', '$|v|$'], ['c', '', '']]);
  assert.strictEqual(t.next, 5);
  assert.deepStrictEqual(M.tableCells('a \\| b | c'), ['a | b', 'c']);
});

test('table: a broken separator is not a table', () => {
  assert.strictEqual(M.parseTable(['| a | b |', '| x | y |'], 0), null);
  assert.strictEqual(M.parseTable(['| a | b |', '|---|'], 0), null); // wrong column count
  assert.strictEqual(M.parseTable(['a or b', '---'], 0), null);
  assert.strictEqual(M.parseTable(['| a |'], 0), null);
});

test('callouts: four kinds, anything else is a plain quote', () => {
  assert.deepStrictEqual(M.calloutOf('[!note]'), { kind: 'note', rest: '' });
  assert.deepStrictEqual(M.calloutOf('[!WARNING] Back up first'), { kind: 'warning', rest: 'Back up first' });
  for (const k of ['note', 'tip', 'warning', 'important']) assert.ok(M.TONE_NAMES.includes(M.CALLOUTS[k].tone));
  assert.strictEqual(M.calloutOf('[!danger] x'), null);
  assert.strictEqual(M.calloutOf('just a quote'), null);
});

test('tool lines and composer keys', () => {
  assert.deepStrictEqual(M.toolNames('Tools: Read, Edit, Read'), ['Read', 'Edit', 'Read']);
  assert.strictEqual(M.toolNames('Interrupted'), null);
  assert.strictEqual(M.sendsOnKey('Enter', false, false, 'hi'), true);
  assert.strictEqual(M.sendsOnKey('Enter', true, false, 'hi'), false); // Shift+Enter: new line
  assert.strictEqual(M.sendsOnKey('Enter', false, true, 'hi'), false); // composing
  assert.strictEqual(M.sendsOnKey('Enter', false, false, '  \n'), false);
  assert.strictEqual(M.sendsOnKey('a', false, false, 'hi'), false);
});

const kinds = (code: string, lang: string) => H.tokenize(code, lang).filter((t: any) => t.k).map((t: any) => [t.k, t.t]);
test('highlight: the tokens joined are always the input', () => {
  const samples: [string, string][] = [
    ['const a = "x\\"y"; // note\n/* block\n */ let b = 0x1F + 2.5e3;', 'ts'],
    ['def f(x):\n    """doc\n    string"""\n    return x # c\n', 'python'],
    ['{"a": [1, true, null], "b": "c"}', 'json'],
    ['echo "$HOME" # hi\nif [ -f x ]; then exit 1; fi', 'bash'],
    ['<!-- c --><a href="x">t</a>', 'html'],
    ['a { color: #abc; margin: 4px !important } /* c */', 'css'],
    ["SELECT name FROM t WHERE id = 3 -- c\n", 'sql'],
    ['fn main() { let s = "unclosed\n}', 'rust'],
    ['whatever <<>> 123', 'unknownlang'],
    ['', 'js'],
  ];
  for (const [code, lang] of samples) assert.strictEqual(H.tokenize(code, lang).map((t: any) => t.t).join(''), code, lang);
});

test('highlight: comments, strings, numbers, keywords', () => {
  assert.deepStrictEqual(kinds('const a = "x\\"y"; // note', 'js'), [['kw', 'const'], ['str', '"x\\"y"'], ['com', '// note']]);
  assert.deepStrictEqual(kinds('x = 3 # c\ns = """a\nb"""', 'py'), [['num', '3'], ['com', '# c'], ['str', '"""a\nb"""']]);
  assert.deepStrictEqual(kinds('{"a": true, "n": -1.5}', 'json'), [['str', '"a"'], ['kw', 'true'], ['str', '"n"'], ['num', '1.5']]);
  assert.deepStrictEqual(kinds('select Name from t1 -- c', 'sql'), [['kw', 'select'], ['kw', 'from'], ['com', '-- c']]);
  assert.deepStrictEqual(kinds('"// not a comment" /* c */ id2', 'c'), [['str', '"// not a comment"'], ['com', '/* c */']]);
  assert.deepStrictEqual(kinds('color: #abc; /* x */', 'css'), [['com', '/* x */']]);
  assert.deepStrictEqual(kinds('echo $# done', 'bash').map((k: string[]) => k[0]), ['kw', 'kw']); // $# is not a comment
  assert.deepStrictEqual(kinds('"open\nreturn', 'js'), [['str', '"open'], ['kw', 'return']]); // an unclosed string ends with its line
});

test('highlight: unknown language and very long code stay plain', () => {
  assert.deepStrictEqual(H.tokenize('if x', 'brainfuzz'), [{ t: 'if x', k: '' }]);
  const long = Array(2002).fill('let a = 1;').join('\n');
  assert.deepStrictEqual(H.tokenize(long, 'js'), [{ t: long, k: '' }]);
  assert.ok(H.langOf('TypeScript') && H.langOf('c++') && !H.langOf(''));
});

test('map indent step: 2, 3, 4 spaces and tabs give the same tree', () => {
  const shape = (step: string) => M.parseMap(['Ruby variables', `${step}Five kinds`, `${step}${step}Local`, `${step}${step}Instance`, `${step}Naming`].join('\n'));
  const two = shape('  ');
  assert.deepStrictEqual(two.map((n: { depth: number }) => n.depth), [0, 1, 2, 2, 1]);
  for (const s of ['   ', '    ', '\t']) assert.deepStrictEqual(shape(s), two, JSON.stringify(s));
});

test('map indent step: mixed steps and odd indents are rejected', () => {
  assert.strictEqual(M.parseMap('a\n  b\n   c'), null); // steps of 2 and 3
  assert.strictEqual(M.parseMap('a\n   b\n    c'), null); // step 3, then 4
  assert.strictEqual(M.parseMap('a\n\t  b'), null); // a tab and spaces in one indent
  assert.strictEqual(M.parseMap('a\n      b'), null); // a 6-space step
});

test('map fold: parents, counts below, and what shows when folded', () => {
  const nodes = M.parseMap('Root\n  A\n    A1\n    A2\n      A2x\n  B\n    B1\nOther');
  assert.deepStrictEqual(M.mapTree(nodes).map((t: { parent: number; below: number }) => [t.parent, t.below]), [
    [-1, 6], [0, 3], [1, 0], [1, 1], [3, 0], [0, 1], [5, 0], [-1, 0],
  ]);
  const show = (folded: number[]) => M.mapVisible(nodes, new Set(folded)).map((v: boolean, i: number) => (v ? nodes[i].label : '')).filter(Boolean).join(' ');
  assert.strictEqual(show([]), 'Root A A1 A2 A2x B B1 Other');
  assert.strictEqual(show([1]), 'Root A B B1 Other'); // A folded: all below A hides
  assert.strictEqual(show([3]), 'Root A A1 A2 B B1 Other');
  assert.strictEqual(show([1, 3]), 'Root A B B1 Other'); // a fold inside a fold
  assert.strictEqual(show([0]), 'Root Other');
});
