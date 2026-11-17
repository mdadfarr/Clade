// Inline drawings: a fenced ```svg (or ```draw) block in a reply is drawn in place as a picture.
// This file is the pure part: a strict parser of a small SVG subset, the color mapping, the size of the
// picture, the live-preview split and the "save as file" text. Plain script: loaded by index.html
// (globals) and by the tests through require().
//
// Safety: the source is never handed to the browser's parser. It is read here into a tree of plain
// objects, and only names on the lists below survive: no script, no event handler, no link, no style
// text, no external image or font, no reference outside the drawing itself. The page then makes each
// node with createElementNS and setAttribute (diagrams.ts). Anything malformed gives null, and the block
// shows as code.

const DRAW_MAX_CHARS = 60_000;
const DRAW_MAX_NODES = 2000;
const DRAW_MAX_DEPTH = 30;

/** Elements that are drawn. Anything else (script, foreignObject, image, use, a, style, animate, gradients,
 *  filters, patterns, nested svg, ...) is dropped with everything inside it. */
const DRAW_ELEMENTS = ['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'defs', 'marker'];
const DRAW_TEXT_ELEMENTS = ['text', 'tspan', 'title', 'desc'];

/** The colors a drawing may use, by name. Each is one of the app's own colors (a CSS variable), so a
 *  drawing follows light and dark mode and the accent. */
const DRAW_COLORS: Record<string, string> = {
  text: '--text', muted: '--muted-text', bg: '--bg', surface: '--surface', raised: '--raised', border: '--border',
  accent: '--t-accent', good: '--t-good', warn: '--t-warn', bad: '--t-bad',
  blue: '--t-blue', green: '--t-green', orange: '--t-orange', purple: '--t-purple', pink: '--t-pink', teal: '--t-teal',
};

const NUM = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const LENGTH = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?(px|em|%)?$/;
const NUM_LIST = /^[-+0-9.eE,\s]{1,20000}$/;
const ID = /^[A-Za-z][\w-]{0,40}$/;

type DrawCheck = RegExp | string[];
/** Attributes that are kept, with the shape their value must have. Color and marker attributes are
 *  handled on their own. Everything else (on*, href, xlink:href, style, class, font-family, filter,
 *  clip-path, mask, ...) is dropped. */
const DRAW_ATTRS: Record<string, DrawCheck> = {
  x: LENGTH, y: LENGTH, x1: LENGTH, y1: LENGTH, x2: LENGTH, y2: LENGTH, cx: LENGTH, cy: LENGTH, r: LENGTH, rx: LENGTH, ry: LENGTH,
  width: LENGTH, height: LENGTH, dx: NUM_LIST, dy: NUM_LIST, rotate: NUM_LIST,
  'stroke-width': LENGTH, 'font-size': LENGTH, opacity: NUM, 'fill-opacity': NUM, 'stroke-opacity': NUM,
  'stroke-dasharray': /^(none|[-+0-9.eE,\s]{1,200})$/, 'stroke-dashoffset': NUM, pathLength: NUM,
  d: /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]{1,20000}$/,
  points: NUM_LIST,
  transform: /^(\s*(translate|rotate|scale|skewX|skewY|matrix)\s*\([-+0-9.eE,\s]{0,200}\)[\s,]*){1,10}$/,
  viewBox: /^\s*[-+0-9.eE]+([\s,]+[-+0-9.eE]+){3}\s*$/,
  preserveAspectRatio: /^(none|x(Min|Mid|Max)Y(Min|Mid|Max))(\s+(meet|slice))?$/,
  'text-anchor': ['start', 'middle', 'end'],
  'dominant-baseline': ['auto', 'middle', 'central', 'hanging', 'alphabetic', 'mathematical', 'text-top', 'text-bottom', 'ideographic'],
  'alignment-baseline': ['auto', 'middle', 'central', 'hanging', 'alphabetic', 'mathematical', 'baseline'],
  'font-weight': /^(normal|bold|bolder|lighter|[1-9]00)$/,
  'font-style': ['normal', 'italic'],
  'stroke-linecap': ['butt', 'round', 'square'],
  'stroke-linejoin': ['miter', 'round', 'bevel'],
  'fill-rule': ['nonzero', 'evenodd'],
  orient: /^(auto|auto-start-reverse|[-+]?\d+(\.\d+)?)$/,
  markerUnits: ['strokeWidth', 'userSpaceOnUse'],
  markerWidth: LENGTH, markerHeight: LENGTH, refX: LENGTH, refY: LENGTH,
};
const DRAW_COLOR_ATTRS = ['fill', 'stroke'];
const DRAW_MARKER_ATTRS = ['marker-start', 'marker-mid', 'marker-end'];

interface DrawNode {
  tag: string;
  attrs: [string, string][]; // checked attributes; ids and marker references already carry the prefix
  colors: [string, string][]; // ['fill' | 'stroke', color name from DRAW_COLORS or 'none']
  kids: (DrawNode | string)[]; // strings only inside text elements
}
interface Drawing {
  root: DrawNode;
  width: number; // the viewBox size: the picture is shown this many CSS pixels wide (at most the column)
  height: number;
}

// ---- colors ----

// CSS color names Claude is likely to write, as hex (the rest give null and the attribute is dropped).
const DRAW_CSS_NAMES: Record<string, string> = {
  black: '#000000', white: '#ffffff', gray: '#808080', grey: '#808080', darkgray: '#a9a9a9', darkgrey: '#a9a9a9', lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3', silver: '#c0c0c0', dimgray: '#696969', whitesmoke: '#f5f5f5', gainsboro: '#dcdcdc',
  red: '#ff0000', darkred: '#8b0000', crimson: '#dc143c', firebrick: '#b22222', tomato: '#ff6347', salmon: '#fa8072', coral: '#ff7f50',
  orange: '#ffa500', darkorange: '#ff8c00', gold: '#ffd700', yellow: '#ffff00', goldenrod: '#daa520', brown: '#a52a2a', sienna: '#a0522d',
  green: '#008000', darkgreen: '#006400', lime: '#00ff00', limegreen: '#32cd32', forestgreen: '#228b22', seagreen: '#2e8b57', olive: '#808000',
  teal: '#008080', cyan: '#00ffff', aqua: '#00ffff', turquoise: '#40e0d0', darkcyan: '#008b8b',
  blue: '#0000ff', navy: '#000080', darkblue: '#00008b', royalblue: '#4169e1', steelblue: '#4682b4', dodgerblue: '#1e90ff', skyblue: '#87ceeb',
  lightblue: '#add8e6', cornflowerblue: '#6495ed',
  purple: '#800080', indigo: '#4b0082', violet: '#ee82ee', magenta: '#ff00ff', fuchsia: '#ff00ff', orchid: '#da70d6', plum: '#dda0dd',
  pink: '#ffc0cb', hotpink: '#ff69b4', deeppink: '#ff1493', lavender: '#e6e6fa', beige: '#f5f5dc', ivory: '#fffff0', lightyellow: '#ffffe0',
  lightgreen: '#90ee90', lightpink: '#ffb6c1', mistyrose: '#ffe4e1', honeydew: '#f0fff0', aliceblue: '#f0f8ff', azure: '#f0ffff',
};

function drawRgb(v: string): [number, number, number] | null {
  let m = /^#([0-9a-f]{3,4})$/i.exec(v);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*([,/]\s*[\d.]+%?\s*)?\)$/i.exec(v);
  if (m) return [+m[1], +m[2], +m[3]].map((n) => Math.min(255, n)) as [number, number, number];
  return null;
}

/**
 * A color as written in the drawing -> one of the app's colors. A name from DRAW_COLORS is kept; 'none'
 * and 'transparent' give 'none'; 'currentColor' is the text color. Any other color (hex, rgb(), a CSS
 * name) goes to the nearest app color: grays by lightness (so black text stays readable in dark mode
 * and a white box becomes the page background), colors by hue. A pale color becomes its tone at low
 * opacity (`alpha`), so a pastel box behind text stays a light tint. null: not a color (dropped).
 */
function drawColor(raw: string): { name: string; alpha?: number } | null {
  const v = raw.trim().toLowerCase();
  if (Object.hasOwn(DRAW_COLORS, v)) return { name: v };
  if (v === 'none' || v === 'transparent') return { name: 'none' };
  if (v === 'currentcolor') return { name: 'text' };
  const rgb = drawRgb(Object.hasOwn(DRAW_CSS_NAMES, v) ? DRAW_CSS_NAMES[v] : v);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((n) => n / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  if (s < 0.2 || l < 0.1 || l > 0.95) {
    if (l < 0.3) return { name: 'text' };
    if (l < 0.6) return { name: 'muted' };
    if (l < 0.82) return { name: 'border' };
    if (l < 0.95) return { name: 'raised' };
    return { name: 'bg' };
  }
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  const name = h < 15 || h >= 345 ? 'bad' : h < 40 ? 'orange' : h < 70 ? 'warn' : h < 160 ? 'green' : h < 195 ? 'teal' : h < 255 ? 'blue' : h < 290 ? 'purple' : 'pink';
  return l > 0.75 ? { name, alpha: 0.18 } : { name };
}

// ---- the parser ----

const DRAW_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ', deg: '°', times: '×', middot: '·', minus: '−' };
/** Entities in text and attribute values. An unknown one stays as written. */
function drawDecode(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : all;
    }
    return Object.hasOwn(DRAW_ENTITIES, e) ? DRAW_ENTITIES[e] : all;
  });
}

interface DrawRaw {
  tag: string;
  attrs: [string, string][];
  kids: (DrawRaw | string)[];
}

/** Well-formed XML into a raw tree, or null. Comments and one leading <?xml?> are skipped; DOCTYPE,
 *  CDATA, other processing instructions, stray text outside the root and unclosed tags fail. */
function drawTree(src: string): DrawRaw | null {
  if (src.length > DRAW_MAX_CHARS) return null;
  const top: DrawRaw = { tag: '#top', attrs: [], kids: [] };
  const stack: DrawRaw[] = [top];
  let count = 0;
  let i = 0;
  const TAG = /<([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_:][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;
  const ATTR = /\s+([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/g;
  const CLOSE = /<\/([A-Za-z_][\w:.-]*)\s*>/y;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const text = src.slice(i, lt < 0 ? src.length : lt);
    if (text) {
      if (stack.length === 1) {
        if (text.trim()) return null; // text outside the root
      } else stack[stack.length - 1].kids.push(drawDecode(text));
    }
    if (lt < 0) break;
    i = lt;
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      if (end < 0) return null;
      i = end + 3;
      continue;
    }
    if (src.startsWith('<?xml', i) && stack.length === 1 && !top.kids.length) {
      const end = src.indexOf('?>', i);
      if (end < 0) return null;
      i = end + 2;
      continue;
    }
    CLOSE.lastIndex = i;
    let m = CLOSE.exec(src);
    if (m) {
      if (stack.length === 1 || stack[stack.length - 1].tag !== m[1]) return null;
      stack.pop();
      i = CLOSE.lastIndex;
      continue;
    }
    TAG.lastIndex = i;
    m = TAG.exec(src);
    if (!m) return null; // <!DOCTYPE, <![CDATA[, <?other, or a broken tag
    if (++count > DRAW_MAX_NODES || stack.length > DRAW_MAX_DEPTH) return null;
    const node: DrawRaw = { tag: m[1], attrs: [], kids: [] };
    const seen = new Set<string>();
    for (const a of m[2].matchAll(ATTR)) {
      if (seen.has(a[1])) return null; // a repeated attribute is not well-formed
      seen.add(a[1]);
      node.attrs.push([a[1], drawDecode(a[2] ?? a[3] ?? '')]);
    }
    stack[stack.length - 1].kids.push(node);
    if (!m[3]) stack.push(node);
    i = TAG.lastIndex;
  }
  if (stack.length !== 1) return null; // still open: half-written
  const roots = top.kids.filter((k): k is DrawRaw => typeof k !== 'string');
  return roots.length === 1 && top.kids.every((k) => typeof k !== 'string' || !k.trim()) ? roots[0] : null;
}

/**
 * Parse a drawing. prefix: put in front of every id (and every reference to one), so ids of two
 * drawings, or of a drawing and the app, never meet. null: not a drawing this app can show.
 */
function parseDrawing(src: string, prefix = ''): Drawing | null {
  const raw = drawTree(src.trim());
  if (!raw || raw.tag !== 'svg') return null;
  const ids = new Set<string>();
  const collect = (n: DrawRaw) => {
    if (!DRAW_ELEMENTS.includes(n.tag)) return;
    for (const [k, v] of n.attrs) if (k === 'id' && ID.test(v)) ids.add(v);
    for (const c of n.kids) if (typeof c !== 'string') collect(c);
  };
  collect(raw);
  let drawn = 0;
  const clean = (n: DrawRaw, isRoot: boolean): DrawNode | null => {
    if (!DRAW_ELEMENTS.includes(n.tag) || (n.tag === 'svg' && !isRoot)) return null;
    const out: DrawNode = { tag: n.tag, attrs: [], colors: [], kids: [] };
    for (const [k, v] of n.attrs) {
      if (k === 'id') {
        if (ID.test(v)) out.attrs.push(['id', prefix + v]);
      } else if (DRAW_COLOR_ATTRS.includes(k)) {
        const c = drawColor(v);
        if (!c) continue;
        out.colors.push([k, c.name]);
        if (c.alpha !== undefined && !n.attrs.some(([a]) => a === `${k}-opacity` || a === 'opacity')) out.attrs.push([`${k}-opacity`, String(c.alpha)]);
      } else if (DRAW_MARKER_ATTRS.includes(k)) {
        const ref = /^url\(\s*#([A-Za-z][\w-]{0,40})\s*\)$/.exec(v.trim());
        if (ref && ids.has(ref[1])) out.attrs.push([k, `url(#${prefix}${ref[1]})`]);
      } else if (Object.hasOwn(DRAW_ATTRS, k)) {
        const check = DRAW_ATTRS[k];
        const val = v.trim();
        if (Array.isArray(check) ? check.includes(val) : check.test(val)) out.attrs.push([k, val]);
      }
    }
    for (const c of n.kids) {
      if (typeof c === 'string') {
        if (DRAW_TEXT_ELEMENTS.includes(n.tag) && c) out.kids.push(c);
      } else {
        const k = clean(c, false);
        if (k) out.kids.push(k);
      }
    }
    if (n.tag !== 'svg' && n.tag !== 'defs' && n.tag !== 'title' && n.tag !== 'desc') drawn++;
    return out;
  };
  const root = clean(raw, true)!;
  const size = drawSize(root.attrs);
  if (!size || !drawn) return null; // no size, or nothing left to draw
  root.attrs = root.attrs.filter(([k]) => k !== 'width' && k !== 'height' && k !== 'viewBox');
  root.attrs.push(['viewBox', size.viewBox]);
  return { root, width: size.width, height: size.height };
}

/** The picture's size from the root's viewBox, or else its plain width and height. */
function drawSize(attrs: [string, string][]): { width: number; height: number; viewBox: string } | null {
  const get = (k: string) => attrs.find(([a]) => a === k)?.[1];
  const vb = get('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) return { width: vb[2], height: vb[3], viewBox: vb.join(' ') };
  const w = Number(/^[\d.]+(px)?$/.test(get('width') ?? '') ? parseFloat(get('width')!) : NaN);
  const h = Number(/^[\d.]+(px)?$/.test(get('height') ?? '') ? parseFloat(get('height')!) : NaN);
  if (w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h)) return { width: w, height: h, viewBox: `0 0 ${w} ${h}` };
  return null;
}

/** The size a half-written drawing will have, read from its opening tag once that is complete. */
function drawPendingSize(partial: string): { width: number; height: number } | null {
  const m = /<svg\b([^<>]*)>/.exec(partial);
  if (!m) return null;
  const attrs: [string, string][] = [];
  for (const a of m[1].matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs.push([a[1], a[2] ?? a[3] ?? '']);
  const s = drawSize(attrs);
  return s ? { width: s.width, height: s.height } : null;
}

// ---- live preview: the reply as Claude Code's terminal shows it has the SVG source as plain lines (no
// fence). Those lines are replaced by a quiet box of the drawing's size. ----
type DrawPreviewPart = { kind: 'text'; text: string } | { kind: 'draw'; width: number | null; height: number | null; done: boolean };

function drawPreviewParts(text: string): DrawPreviewPart[] {
  const out: DrawPreviewPart[] = [];
  const lines = text.split('\n');
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) out.push({ kind: 'text', text: buf.join('\n') });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!/^(```\s*(svg|draw)\s*$|<svg[\s>]|<svg$|<\?xml)/.test(t)) {
      if (!/^```\s*$/.test(t) || !out.length || out[out.length - 1].kind !== 'draw' || buf.length) buf.push(lines[i]);
      continue;
    }
    flush();
    const src: string[] = [];
    let done = false;
    for (; i < lines.length; i++) {
      src.push(lines[i]);
      if (/<\/svg>/.test(lines[i])) {
        done = true;
        break;
      }
    }
    const size = drawPendingSize(src.join(' '));
    out.push({ kind: 'draw', width: size?.width ?? null, height: size?.height ?? null, done });
  }
  flush();
  return out;
}

// ---- save as file: the drawing on its own, with the app's colors written in as they are now ----
const drawEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** palette: color name -> hex (read from the page when the user clicks Save). font: the interface font. */
function drawSerialize(d: Drawing, palette: Record<string, string>, font: string): string {
  const node = (n: DrawNode, root: boolean): string => {
    const attrs = [...n.attrs];
    for (const [k, name] of n.colors) attrs.push([k, name === 'none' ? 'none' : (palette[name] ?? '#000000')]);
    if (root) {
      attrs.unshift(['xmlns', 'http://www.w3.org/2000/svg'], ['width', String(d.width)], ['height', String(d.height)]);
      if (!n.colors.some(([k]) => k === 'fill')) attrs.push(['fill', palette.text ?? '#000000']);
      attrs.push(['font-family', font.replace(/[^\w\s,.-]/g, '')]);
    }
    const open = `<${n.tag}${attrs.map(([k, v]) => ` ${k}="${drawEsc(v)}"`).join('')}`;
    if (!n.kids.length) return `${open}/>`;
    return `${open}>${n.kids.map((k) => (typeof k === 'string' ? drawEsc(k) : node(k, false))).join('')}</${n.tag}>`;
  };
  return node(d.root, true) + '\n';
}

if (typeof module !== 'undefined')
  module.exports = { parseDrawing, drawColor, drawTree, drawPendingSize, drawPreviewParts, drawSerialize, DRAW_COLORS, DRAW_ELEMENTS, DRAW_ATTRS };
