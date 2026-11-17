// What Claude may write beyond plain markdown: color and size tags, heading effects, maps, tables
// and callouts. Pure parsers, no DOM. Plain script: loaded by index.html before md.js (global
// functions there) and by the tests through require().
//
// Every name is looked up in a fixed list. Nothing Claude writes ever becomes a style value.

const TONE_NAMES = ['accent', 'muted', 'good', 'warn', 'bad', 'blue', 'green', 'orange', 'purple', 'pink', 'teal'];
const SIZE_NAMES = ['big', 'small'];
// One effect: the big title (`title`). `dither` and `mono` are older names from chats written before
// round 4; they draw the same big title. (gradient was removed earlier and shows as a plain heading.)
const FX_NAMES = ['title', 'dither', 'mono'];

type TagKind =
  | { kind: 'style'; tone: string; size: string } // '' = not set
  | { kind: 'old' } // {c=#hex s=1.4}: old chats only, handled by the renderer's old parser
  | { kind: 'drop' } // looks like a tag but is not one we know: show the inner text plain
  | { kind: 'text' }; // not a tag at all: show as written

/** What the text between { and } of `{...}inner{/}` means. */
function tagKind(attrs: string): TagKind {
  if (/^(c|s)=\S+( (c|s)=\S+)?$/.test(attrs)) return { kind: 'old' };
  if (/^fx=[a-z]+$/.test(attrs)) return { kind: 'drop' }; // an effect outside a whole # or ## heading
  if (!/^[a-z]+( [a-z]+)?$/.test(attrs)) return { kind: 'text' };
  let tone = '';
  let size = '';
  for (const w of attrs.split(' ')) {
    if (TONE_NAMES.includes(w) && !tone) tone = w;
    else if (SIZE_NAMES.includes(w) && !size) size = w;
    else return { kind: 'drop' };
  }
  return { kind: 'style', tone, size };
}

/** A heading's text: `{fx=NAME}whole text{/}` gives the effect ('title' for every known name, null if none or unknown) and the inner text. */
function parseFxHeading(text: string): { fx: string | null; text: string } {
  const m = /^\{fx=([a-z]+)\}([^]*)\{\/\}$/.exec(text.trim());
  if (!m || m[2].includes('{/}')) return { fx: null, text };
  return { fx: FX_NAMES.includes(m[1]) ? 'title' : null, text: m[2] };
}

/** Remove every tag (new, old, effects), keeping the inner text. For Copy, labels and heading matching. */
function stripTags(s: string): string {
  return s.replace(/\{(?:(?:c|s)=[^\s{}]+(?: (?:c|s)=[^\s{}]+)?|fx=[a-z]+|[a-z]+(?: [a-z]+)?)\}([^]*?)\{\/\}/g, '$1');
}

// ---- maps ----
interface MapNode {
  depth: number;
  label: string;
  target: string; // heading text to jump to (the label when no "-> target" is given)
  tone: string; // '' or one of TONE_NAMES
}
const MAP_MAX_NODES = 40;
const MAP_MAX_DEPTH = 6; // levels 0..5
const MAP_MAX_LABEL = 60;

/** The indent step of a map block: the smallest space indent used (2, 3 or 4), or 2 when only tabs or
 * nothing is indented. A tab is always one level. null: a step the format does not allow. */
function mapIndentStep(lines: string[]): number | null {
  const spaces = lines.map((l) => /^( *)/.exec(l)![1].length).filter((n) => n > 0);
  if (!spaces.length) return 2;
  const step = Math.min(...spaces);
  return step >= 2 && step <= 4 ? step : null;
}

/** The lines of a ```map block. null = broken (then the block is shown as plain code). The indent step
 * is measured: 2, 3 or 4 spaces per level, or a tab; every indent must be a whole number of steps. */
function parseMap(src: string): MapNode[] | null {
  const nodes: MapNode[] = [];
  let prev = -1;
  const lines = src.split('\n').filter((l) => l.trim());
  if (lines.some((l) => /^[ \t]*/.exec(l)![0].includes(' ') && /^[ \t]*/.exec(l)![0].includes('\t'))) return null; // tabs and spaces in one indent
  const step = mapIndentStep(lines);
  if (step === null) return null;
  for (const line of lines) {
    const lead = /^[ \t]*/.exec(line)![0];
    if (!lead.includes('\t') && lead.length % step) return null; // a step that is not the block's step
    const depth = lead.includes('\t') ? lead.length : lead.length / step;
    if (depth > prev + 1 || depth >= MAP_MAX_DEPTH || (prev < 0 && depth !== 0)) return null;
    const arrow = line.indexOf('->');
    let label = (arrow < 0 ? line : line.slice(0, arrow)).trim();
    const target = arrow < 0 ? '' : line.slice(arrow + 2).trim();
    let tone = '';
    const tag = /^\{([a-z]+)\}([^{}]*)\{\/\}$/.exec(label);
    if (tag) {
      if (TONE_NAMES.includes(tag[1])) tone = tag[1];
      label = tag[2].trim();
    }
    if (!label || label.length > MAP_MAX_LABEL || target.length > 200) return null;
    nodes.push({ depth, label, target: target || label, tone });
    if (nodes.length > MAP_MAX_NODES) return null;
    prev = depth;
  }
  return nodes.length ? nodes : null;
}

/** For each map node: its parent's index (-1 for a root) and how many nodes hang under it. */
function mapTree(nodes: MapNode[]): { parent: number; below: number }[] {
  const out = nodes.map(() => ({ parent: -1, below: 0 }));
  const stack: number[] = [];
  nodes.forEach((n, i) => {
    while (stack.length && nodes[stack[stack.length - 1]].depth >= n.depth) stack.pop();
    out[i].parent = stack.length ? stack[stack.length - 1] : -1;
    for (const a of stack) out[a].below++;
    stack.push(i);
  });
  return out;
}

/** Which map nodes show when the nodes in `folded` are folded: a node hides when any parent above it is folded. */
function mapVisible(nodes: MapNode[], folded: Set<number>): boolean[] {
  const tree = mapTree(nodes);
  return nodes.map((_, i) => {
    for (let p = tree[i].parent; p >= 0; p = tree[p].parent) if (folded.has(p)) return false;
    return true;
  });
}

/** Heading text reduced for matching: no tags, markdown marks or punctuation, lower case, single spaces. */
function normHeading(s: string): string {
  return stripTags(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Index of the heading a map node points to: an exact match, else the first that starts with it. -1 = none. */
function findHeading(target: string, headings: string[]): number {
  const t = normHeading(target);
  if (!t) return -1;
  const norm = headings.map(normHeading);
  const exact = norm.indexOf(t);
  return exact >= 0 ? exact : norm.findIndex((h) => h.startsWith(t + ' '));
}

// ---- tables ----
interface Table {
  align: ('' | 'left' | 'center' | 'right')[];
  head: string[];
  rows: string[][];
  next: number; // index of the first line after the table
}

/** Cells of one table row. `\|` is a literal bar; bars inside `code` or $math$ do not split. */
function tableCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let quote = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
    } else if (ch === '`' || ch === '$') {
      quote = s.indexOf(ch, i + 1) >= 0 ? ch : '';
      cur += ch;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** A pipe table starting at lines[i] (header row, separator row, body rows). null = not a table. */
function parseTable(lines: string[], i: number): Table | null {
  if (i + 1 >= lines.length || !lines[i].includes('|')) return null;
  const head = tableCells(lines[i]);
  const sep = tableCells(lines[i + 1]);
  if (!lines[i + 1].includes('-') || sep.length !== head.length || !sep.every((c) => /^:?-+:?$/.test(c))) return null;
  const align = sep.map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
  const rows: string[][] = [];
  let n = i + 2;
  for (; n < lines.length && lines[n].trim() && lines[n].includes('|'); n++) {
    const cells = tableCells(lines[n]).slice(0, head.length);
    while (cells.length < head.length) cells.push('');
    rows.push(cells);
  }
  return { align, head, rows, next: n };
}

// ---- callouts ----
const CALLOUTS: Record<string, { label: string; tone: string }> = {
  note: { label: 'Note', tone: 'blue' },
  tip: { label: 'Tip', tone: 'good' },
  warning: { label: 'Warning', tone: 'warn' },
  important: { label: 'Important', tone: 'accent' },
};

/** First line of a quote: "[!note]" (any case, optional text after it) -> its kind and the rest. null = a plain quote. */
function calloutOf(firstLine: string): { kind: string; rest: string } | null {
  const m = /^\[!([a-zA-Z]+)\]\s*(.*)$/.exec(firstLine.trim());
  const kind = m?.[1].toLowerCase();
  return m && kind && kind in CALLOUTS ? { kind, rest: m[2] } : null;
}

// ---- mem: memory boxes (stack frames, heap, globals) with pointer arrows ----
interface MemVar {
  id: string; // unique in the block, e.g. "0/s/y"
  name: string;
  type: string;
  value: string; // '' when it has a target, cells or fields instead
  target: string; // what a pointer points to, as written ('' if none)
  addr: string;
  tone: string;
  cells: string[] | null; // an array's values
  fields: MemVar[];
}
interface MemRegion {
  kind: string; // stack, heap, globals, code
  name: string; // a stack frame's function name ('' otherwise)
  vars: MemVar[];
}
const MEM_KINDS = ['stack', 'heap', 'globals', 'code'];
const MEM_MAX_BOXES = 60;
const MEM_MAX_REGIONS = 8;
const MEM_MAX_ARROWS = 30;
const MEM_MAX_CELLS = 12;

/** Values of an array: split at commas that are not inside quotes. */
function memCells(value: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  for (const ch of value) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** The lines of a ```mem block. null = broken (then the block is shown as plain code). */
function parseMem(src: string): MemRegion[] | null {
  const regions: MemRegion[] = [];
  const stack: MemVar[] = []; // the variable at each depth, for fields
  let boxes = 0;
  let arrows = 0;
  for (const raw of src.split('\n')) {
    if (!raw.trim()) continue;
    const line = raw.replace(/\t/g, '  ').replace(/\s+$/, '');
    const indent = line.length - line.trimStart().length;
    if (indent % 2) return null;
    const depth = indent / 2;
    const text = line.trim();
    if (depth === 0) {
      const m = /^(stack|heap|globals|code)(?:\s+(\S.{0,39}))?$/.exec(text);
      if (!m || (m[1] !== 'stack' && m[2]) || regions.length >= MEM_MAX_REGIONS) return null;
      regions.push({ kind: m[1], name: m[2] ?? '', vars: [] });
      stack.length = 0;
      continue;
    }
    if (!regions.length || depth > 3 || depth > stack.length + 1) return null;
    let rest = text;
    let addr = '';
    const a = /\s@([0-9A-Za-z_]{1,20})$/.exec(rest);
    if (a) {
      addr = a[1];
      rest = rest.slice(0, a.index);
    }
    let value = '';
    let target = '';
    const op = /\s(->|=)\s/.exec(rest);
    if (!op && /\s(->|=)$/.test(rest)) return null; // nothing after the sign
    if (op) {
      const right = rest.slice(op.index + op[0].length).trim();
      if (!right) return null;
      if (op[1] === '->') target = right;
      else value = right;
      rest = rest.slice(0, op.index);
    }
    const colon = rest.indexOf(':');
    let name = (colon < 0 ? rest : rest.slice(0, colon)).trim();
    const type = colon < 0 ? '' : rest.slice(colon + 1).trim();
    let tone = '';
    const tag = /^\{([a-z]+)\}([^{}]*)\{\/\}$/.exec(name);
    if (tag) {
      if (TONE_NAMES.includes(tag[1])) tone = tag[1];
      name = tag[2].trim();
    }
    if (!name || name.length > 40 || type.length > 40 || value.length > 120 || target.length > 60 || /[{}]/.test(name)) return null;
    const isArray = /\[\d*\]$/.test(type) && value !== '' && !/^["']/.test(value);
    const parent = depth > 1 ? stack[depth - 2] : null;
    const region = regions[regions.length - 1];
    const v: MemVar = { id: `${regions.length - 1}/${parent ? parent.id.split('/').slice(1).join('/') + '/' : ''}${name}`, name, type, value: isArray ? '' : value, target, addr, tone, cells: isArray ? memCells(value) : null, fields: [] };
    if (parent && (parent.cells || parent.target)) return null; // only a plain box can hold fields
    (parent ? parent.fields : region.vars).push(v);
    stack.length = depth - 1;
    stack.push(v);
    if (++boxes > MEM_MAX_BOXES || (target && ++arrows > MEM_MAX_ARROWS)) return null;
  }
  return regions.length && boxes ? regions : null;
}

/**
 * Where a pointer points. Returns the id of the box ("0/x"), of an array cell ("0/arr[1]"), 'null'
 * for a null pointer, or '' when nothing has that name.
 * A plain name is looked up in the pointer's own region first, then in the others.
 */
function memTarget(regions: MemRegion[], from: number, target: string): string {
  const t = target.trim();
  if (/^(null|NULL|nullptr|nil|0)$/.test(t)) return 'null';
  const m = /^(.*?)(?:\[(\d+)\])?$/.exec(t);
  if (!m || !m[1]) return '';
  let parts = m[1].split('.').map((p) => p.trim());
  let order = [from, ...regions.map((_r, i) => i).filter((i) => i !== from)];
  const named = regions.map((r, i) => (r.name === parts[0] || (r.kind !== 'stack' && r.kind === parts[0]) ? i : -1)).filter((i) => i >= 0);
  if (parts.length > 1 && named.length) {
    order = named;
    parts = parts.slice(1);
  }
  for (const ri of order) {
    let list = regions[ri]?.vars ?? [];
    let v: MemVar | undefined;
    for (const p of parts) {
      v = list.find((x) => x.name === p);
      if (!v) break;
      list = v.fields;
    }
    if (!v) continue;
    if (m[2] === undefined) return v.id;
    return v.cells && +m[2] < v.cells.length ? `${v.id}[${m[2]}]` : v.id; // a cell that is not drawn: point at the array
  }
  return '';
}

// ---- timeline ----
interface TimelineEntry {
  when: string;
  what: string;
  tone: string;
}
/** `when: what` per line. 2 to 30 entries. null = broken. */
function parseTimeline(src: string): TimelineEntry[] | null {
  const out: TimelineEntry[] = [];
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf(': ');
    if (at <= 0) return null;
    let when = line.slice(0, at).trim();
    const what = line.slice(at + 2).trim();
    let tone = '';
    const tag = /^\{([a-z]+)\}([^{}]*)\{\/\}$/.exec(when);
    if (tag) {
      if (TONE_NAMES.includes(tag[1])) tone = tag[1];
      when = tag[2].trim();
    }
    if (!when || !what || when.length > 30 || what.length > 200) return null;
    out.push({ when, what, tone });
  }
  return out.length >= 2 && out.length <= 30 ? out : null;
}

// ---- compare ----
interface Compare {
  cols: string[];
  rows: { aspect: string; cells: string[] }[];
}
/** First line `vs: A | B` (2 to 4 names), then `aspect: a | b` per line (1 to 20). null = broken. */
function parseCompare(src: string): Compare | null {
  const lines = src.split('\n').map((l) => l.trim()).filter(Boolean);
  const head = /^vs:\s*(.+)$/.exec(lines[0] ?? '');
  if (!head) return null;
  const cols = head[1].split('|').map((c) => c.trim());
  if (cols.length < 2 || cols.length > 4 || cols.some((c) => !c || c.length > 40)) return null;
  const rows: Compare['rows'] = [];
  for (const line of lines.slice(1)) {
    const at = line.indexOf(': ');
    if (at <= 0) return null;
    const cells = tableCells(line.slice(at + 2));
    if (cells.length !== cols.length || line.slice(0, at).length > 40 || cells.some((c) => c.length > 200)) return null;
    rows.push({ aspect: line.slice(0, at).trim(), cells });
  }
  return rows.length >= 1 && rows.length <= 20 ? { cols, rows } : null;
}

// ---- flow ----
interface Flow {
  nodes: string[]; // in the order first mentioned; one ending with "?" is a decision
  edges: { from: number; to: number; label: string }[];
}
/** One arrow per line: `from -> to`, optional ` : label`. 2 to 20 nodes, up to 30 arrows. null = broken. */
function parseFlow(src: string): Flow | null {
  const nodes: string[] = [];
  const edges: Flow['edges'] = [];
  const node = (name: string) => {
    const at = nodes.indexOf(name);
    return at >= 0 ? at : nodes.push(name) - 1;
  };
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.+?)\s*->\s*(.+?)(?:\s+:\s+(.+))?$/.exec(line);
    if (!m) return null;
    const [from, to, label] = [m[1].trim(), m[2].trim(), (m[3] ?? '').trim()];
    if (!from || !to || from.length > 50 || to.length > 50 || label.length > 30 || to.includes('->')) return null;
    edges.push({ from: node(from), to: node(to), label });
    if (nodes.length > 20 || edges.length > 30) return null;
  }
  return nodes.length >= 2 ? { nodes, edges } : null;
}

// ---- tool lines ----
/** "Tools: Read, Edit, Read" -> the names. Anything else (e.g. "Interrupted") -> null. */
function toolNames(text: string): string[] | null {
  return text.startsWith('Tools: ') ? text.slice(7).split(', ').filter(Boolean) : null;
}

// ---- composer ----
/** Enter sends; Shift+Enter makes a new line; nothing is sent while composing (IME) or when empty. */
function sendsOnKey(key: string, shift: boolean, composing: boolean, text: string): boolean {
  return key === 'Enter' && !shift && !composing && text.trim() !== '';
}


if (typeof module !== 'undefined')
  module.exports = { mapTree, mapVisible, mapIndentStep, parseMem, memTarget, memCells, parseTimeline, parseCompare, parseFlow, TONE_NAMES, SIZE_NAMES, FX_NAMES, tagKind, parseFxHeading, stripTags, parseMap, normHeading, findHeading, tableCells, parseTable, calloutOf, CALLOUTS, toolNames, sendsOnKey };
