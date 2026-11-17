// Draws Claude's reply text (markdown plus the tags in markup.ts) as DOM nodes. Plain script, loaded
// by index.html before renderer.js. Text from Claude only ever goes in as text nodes: nothing is
// used as HTML, no style value comes from the text, and nothing is run.
declare const katex: any;

const byId = (id: string) => document.getElementById(id) as HTMLElement;
const add = (parent: HTMLElement, tag: string, cls = '') => {
  const e = parent.appendChild(document.createElement(tag));
  if (cls) e.className = cls;
  return e;
};
const SVG = 'http://www.w3.org/2000/svg';
const svg = (parent: Element, tag: string, attrs: Record<string, string | number>) => {
  const e = parent.appendChild(document.createElementNS(SVG, tag));
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
/** A small stroked icon from path data (16 x 16 grid). */
function icon(parent: Element, paths: string[], size = 15, width = 1.4): Element {
  const s = svg(parent, 'svg', { viewBox: '0 0 16 16', width: size, height: size });
  for (const d of paths) svg(s, 'path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  return s;
}

type RGB = [number, number, number];
interface MdOptions {
  bg: RGB; // page background, for the contrast check of old {c=#hex} tags
  effects: boolean; // design.json effects.enabled
  copy(text: string): void; // the Copy button of a code block (user click only)
  saveDrawing?(svg: string, name: string): void; // the Save button of a drawing (user click only)
}

function luminance([r, g, b]: RGB): number {
  const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function hexToRgb(hex: string): RGB {
  const h = hex.length === 4 ? hex.replace(/[0-9a-f]/gi, '$&$&') : hex;
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

// Old chats only: "c=#e8a33d s=1.4" -> { c, s }. Anything else -> null (shown as written).
function parseStyle(attrs: string): { c?: string; s?: number } | null {
  const out: { c?: string; s?: number } = {};
  const parts = attrs.trim().split(/\s+/);
  if (parts.length > 2) return null;
  for (const part of parts) {
    const c = /^c=(#[0-9a-f]{3}|#[0-9a-f]{6})$/i.exec(part);
    const n = /^s=(\d+(\.\d+)?)$/.exec(part);
    if (c && out.c === undefined) out.c = c[1];
    else if (n && out.s === undefined && +n[1] >= 0.8 && +n[1] <= 2.5) out.s = +n[1];
    else return null;
  }
  return out;
}

function math(parent: HTMLElement, tex: string, display: boolean): void {
  const el = add(parent, display ? 'div' : 'span', display ? 'mathblock' : '');
  try {
    katex.render(tex, el, { displayMode: display, throwOnError: true });
  } catch {
    el.textContent = display ? `$$${tex}$$` : `$${tex}$`; // could not parse: show the raw text
  }
}

// inline code | $$math$$ | $math$ | **bold** | *italic* | [text](url) | {tag}text{/}
const INLINE =
  /(?<code>`[^`\n]+`)|(?<dmath>\$\$[^$]+\$\$)|(?<imath>\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d))|(?<bold>\*\*[^*]+\*\*)|(?<ital>(?<![\w*])\*(?![\s*])[^*\n]+?(?<![\s*])\*(?![\w*]))|\[(?<ltext>[^\]\n]+)\]\((?<lurl>https?:\/\/[^)\s]+)\)|\{(?<attrs>[^{}\n]*)\}(?<inner>[^]*?)\{\/\}/g;

function inline(parent: HTMLElement, s: string, o: MdOptions): void {
  let pos = 0;
  const text = (t: string) => t && parent.appendChild(document.createTextNode(t));
  for (const m of s.matchAll(INLINE)) {
    const g = m.groups!;
    text(s.slice(pos, m.index));
    pos = m.index + m[0].length;
    if (g.code) add(parent, 'code').textContent = g.code.slice(1, -1);
    else if (g.dmath) math(parent, g.dmath.slice(2, -2), true);
    else if (g.imath) math(parent, g.imath.slice(1, -1), false);
    else if (g.bold) inline(add(parent, 'b'), g.bold.slice(2, -2), o);
    else if (g.ital) inline(add(parent, 'i'), g.ital.slice(1, -1), o);
    else if (g.ltext) {
      // a link is shown, never followed: the app does not open web pages
      const u = add(parent, 'u');
      u.title = g.lurl;
      inline(u, g.ltext, o);
    } else {
      const kind = tagKind(g.attrs);
      if (kind.kind === 'style') {
        const span = add(parent, 'span', [kind.tone && `t-${kind.tone}`, kind.size && `s-${kind.size}`].filter(Boolean).join(' '));
        inline(span, g.inner, o);
      } else if (kind.kind === 'drop') inline(parent, g.inner, o);
      else if (kind.kind === 'old' && parseStyle(g.attrs)) {
        const style = parseStyle(g.attrs)!;
        const span = add(parent, 'span');
        if (style.s) span.style.fontSize = `${style.s}em`;
        if (style.c && contrast(hexToRgb(style.c), o.bg) >= 4.5) span.style.color = style.c; // unreadable colors are ignored
        inline(span, g.inner, o);
      } else text(m[0]);
    }
  }
  text(s.slice(pos));
}

const COPY_ICON = ['M5.5 5.5h7v8h-7z', 'M3.5 10.5v-8h7'];

function codeBlock(parent: HTMLElement, code: string, lang: string, o: MdOptions): void {
  const box = add(parent, 'div', 'code');
  const head = add(box, 'div', 'codehead');
  add(head, 'span').textContent = /^[\w+#.-]{1,20}$/.test(lang) ? lang : 'text';
  const btn = add(head, 'button', 'codecopy');
  icon(btn, COPY_ICON, 13);
  const label = add(btn, 'span');
  label.textContent = 'Copy';
  btn.addEventListener('click', () => {
    o.copy(code);
    label.textContent = 'Copied';
    setTimeout(() => (label.textContent = 'Copy'), 1500);
  });
  const pre = add(box, 'pre');
  for (const tok of tokenize(code, lang)) {
    if (tok.k) add(pre, 'span', `k-${tok.k}`).textContent = tok.t;
    else pre.appendChild(document.createTextNode(tok.t));
  }
}

// ---- maps: a small tree; each node jumps to the heading it names (resolved in finishReply) ----
const MAP_ROW = 34;
const MAP_STEP = 26;

function mapBlock(parent: HTMLElement, nodes: MapNode[]): void {
  const box = add(parent, 'div', 'map');
  const tree = mapTree(nodes);
  const folded = new Set<number>();
  const rows: HTMLElement[] = [];
  const counts: HTMLElement[] = [];
  const refold = () => {
    const show = mapVisible(nodes, folded);
    rows.forEach((r, i) => (r.hidden = !show[i]));
    counts.forEach((c) => (c.hidden = !folded.has(Number(c.dataset.node))));
  };
  nodes.forEach((n, i) => {
    const row = add(box, 'div', 'mapnode');
    rows.push(row);
    row.style.paddingLeft = `${n.depth * MAP_STEP}px`;
    // Lines in the tree style: a vertical down from each parent; a child that has a later sibling
    // gets a straight stub (├─), the last child a rounded corner (└─).
    const s = svg(row, 'svg', { width: n.depth * MAP_STEP, height: MAP_ROW });
    for (let l = 0; l < n.depth; l++) {
      const x = l * MAP_STEP + 12;
      let more = false; // does a later node at level l+1 come before this subtree at level l ends?
      for (let j = i + 1; j < nodes.length && nodes[j].depth > l; j++) if (nodes[j].depth === l + 1) more = true;
      const end = n.depth * MAP_STEP - 2;
      if (l === n.depth - 1) svg(s, 'path', { d: more ? `M${x} 0V${MAP_ROW}M${x} ${MAP_ROW / 2}H${end}` : `M${x} 0V${MAP_ROW / 2 - 6}q0 6 6 6H${end}` });
      else if (more) svg(s, 'path', { d: `M${x} 0V${MAP_ROW}` });
    }
    const kids = tree[i].below > 0;
    if (kids) {
      const t = add(row, 'button', 'mapfold');
      t.setAttribute('aria-label', `Fold ${n.label}`);
      t.setAttribute('aria-expanded', 'true');
      icon(t, ['M4 6l4 4 4-4'], 12, 1.8);
      t.addEventListener('click', () => {
        if (folded.has(i)) folded.delete(i);
        else folded.add(i);
        t.classList.toggle('folded', folded.has(i));
        t.setAttribute('aria-expanded', String(!folded.has(i)));
        refold();
      });
    }
    const pill = add(row, 'button', 'mappill' + (n.depth === 0 ? ' root' : '') + (kids ? ' parent' : '') + (n.tone ? ` t-${n.tone}` : ''));
    pill.textContent = n.label;
    pill.dataset.target = n.target;
    if (kids) {
      const c = add(row, 'span', 'mapcount');
      c.textContent = String(tree[i].below);
      c.title = `${tree[i].below} folded`;
      c.dataset.node = String(i);
      c.hidden = true;
      counts.push(c);
    }
  });
}

function tableBlock(parent: HTMLElement, t: Table, o: MdOptions): void {
  const table = add(add(parent, 'div', 'tablebox'), 'table');
  const cell = (row: HTMLElement, tag: string, text: string, i: number) => {
    const c = add(row, tag);
    if (t.align[i]) c.style.textAlign = t.align[i]; // one of left/center/right, from the fixed parser
    inline(c, text, o);
  };
  const hr = add(add(table, 'thead'), 'tr');
  t.head.forEach((h, i) => cell(hr, 'th', h, i));
  const body = add(table, 'tbody');
  for (const r of t.rows) {
    const tr = add(body, 'tr');
    r.forEach((c, i) => cell(tr, 'td', c, i));
  }
}

/** Draw markdown source into parent. */
function renderMarkdown(parent: HTMLElement, src: string, o: MdOptions): void {
  const lines = src.split('\n');
  let list: HTMLElement | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) inline(add(parent, 'p'), para.join('\n'), o);
    para = [];
  };
  const block = () => {
    flush();
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    let m: RegExpExecArray | null;
    let table: Table | null;
    if (t.startsWith('```')) {
      block();
      const lang = t.slice(3).trim();
      const code: string[] = [];
      while (++i < lines.length && !lines[i].trimStart().startsWith('```')) code.push(lines[i]);
      // The drawn blocks: plain lines that the app parses. A block that does not fit its format shows as written.
      const text = code.join('\n');
      const nodes = lang === 'map' ? parseMap(text) : null;
      const mem = lang === 'mem' ? parseMem(text) : null;
      const timeline = lang === 'timeline' ? parseTimeline(text) : null;
      const compare = lang === 'compare' ? parseCompare(text) : null;
      const flow = lang === 'flow' ? parseFlow(text) : null;
      const drawing = lang === 'svg' || lang === 'draw';
      if (drawing && drawingBlock(parent, text, o)) {
        // drawn in place (draw.ts checks it; a broken one falls through to a code block)
      } else if (nodes) mapBlock(parent, nodes);
      else if (mem) memBlock(parent, mem);
      else if (timeline) timelineBlock(parent, timeline, o);
      else if (compare) compareBlock(parent, compare, o);
      else if (flow) flowBlock(parent, flow);
      else codeBlock(parent, text, lang, o);
    } else if (t.startsWith('$$') && !t.includes('$$', 2)) {
      // block math over several lines, until the closing $$
      block();
      const tex = [t.slice(2)];
      while (++i < lines.length && !lines[i].includes('$$')) tex.push(lines[i]);
      if (i < lines.length) tex.push(lines[i].split('$$')[0]);
      math(parent, tex.join('\n'), true);
    } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      block();
      const level = Math.min(m[1].length, 4);
      const h = add(parent, 'h' + level);
      const fx = parseFxHeading(m[2]);
      if (fx.fx && level <= 2 && o.effects) {
        h.classList.add('fx'); // the big title; its hover glow is CSS only (app.css)
        inline(h, fx.text, o);
      } else inline(h, m[2], o); // an effect tag anywhere else is dropped by inline()
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      block();
      add(parent, 'hr');
    } else if (t.startsWith('>')) {
      block();
      const quote: string[] = [];
      for (; i < lines.length && lines[i].trim().startsWith('>'); i++) quote.push(lines[i].trim().replace(/^> ?/, ''));
      i--;
      const call = calloutOf(quote[0] ?? '');
      if (call) {
        const box = add(parent, 'div', 'callout');
        box.style.setProperty('--c', `var(--t-${CALLOUTS[call.kind].tone})`); // tone name from the fixed table
        add(box, 'div', 'calloutlabel').textContent = CALLOUTS[call.kind].label;
        renderMarkdown(box, [call.rest, ...quote.slice(1)].join('\n'), o);
      } else renderMarkdown(add(parent, 'blockquote'), quote.join('\n'), o);
    } else if ((table = parseTable(lines, i))) {
      block();
      tableBlock(parent, table, o);
      i = table.next - 1;
    } else if ((m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line))) {
      flush();
      const tag = /\d/.test(m[1]) ? 'OL' : 'UL';
      if (list?.tagName !== tag) list = add(parent, tag);
      inline(add(list, 'li'), m[2], o);
    } else if (!t) {
      flush();
    } else {
      list = null;
      para.push(line);
    }
  }
  flush();
}

// ---- after a whole reply (or document) is drawn: effects and map links ----

/** root: one reply (all its text parts) or one document. Only the first effect heading keeps its effect. */
function finishReply(root: HTMLElement, _o?: unknown): void {
  const fx = Array.from(root.querySelectorAll<HTMLElement>('h1.fx, h2.fx'));
  fx.slice(1).forEach((h) => (h.className = ''));
  const heads = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3, h4'));
  const texts = heads.map((h) => h.textContent ?? '');
  for (const pill of Array.from(root.querySelectorAll<HTMLElement>('.mappill'))) {
    const at = findHeading(pill.dataset.target ?? '', texts);
    if (at < 0) {
      pill.title = 'No section with this name';
      continue;
    }
    pill.classList.add('link');
    pill.title = `Go to "${texts[at].trim()}"`;
    pill.addEventListener('click', () => {
      heads[at].scrollIntoView({ behavior: 'smooth', block: 'start' });
      heads[at].classList.remove('flashh');
      void heads[at].offsetWidth; // restart the flash
      heads[at].classList.add('flashh');
    });
  }
}
