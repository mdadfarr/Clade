// Plain script (no imports). Terminal, FitAddon and katex come from <script> tags, api from preload.
declare const Terminal: any;
declare const FitAddon: any;
declare const katex: any;
declare const api: {
  start(cols: number, rows: number): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  send(text: string): void;
  onData(cb: (data: string) => void): void;
  onDesign(cb: (design: any, error: string | null) => void): void;
  onChat(cb: (chat: { items: { role: string; text: string }[]; working: boolean }) => void): void;
  onToggleTerm(cb: () => void): void;
  branch(): void;
  openSession(id: string): void;
  onTree(cb: (tree: Tree) => void): void;
  onTermReset(cb: () => void): void;
};
interface TreeNode {
  id: string;
  parent: string | null;
  label: string;
  full: string;
  created: string;
  empty: boolean;
}
interface Tree {
  nodes: TreeNode[];
  current: string;
  error: string | null;
}

const byId = (id: string) => document.getElementById(id) as HTMLElement;
const add = (parent: HTMLElement, tag: string, cls = '') => {
  const e = parent.appendChild(document.createElement(tag));
  if (cls) e.className = cls;
  return e;
};

// ---- terminal strip ----
const term = new Terminal({ fontFamily: 'Menlo, monospace' });
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open(byId('term'));
term.onData((d: string) => api.write(d));
api.onData((d) => term.write(d));

function refit(): void {
  fit.fit();
  api.resize(term.cols, term.rows);
}
window.addEventListener('resize', refit);
api.onTermReset(() => term.reset());
api.onToggleTerm(() => {
  document.body.classList.toggle('bigterm');
  refit();
});

// ---- chat text. Parsed here into DOM nodes; nothing from Claude is ever used as HTML or run. ----
type RGB = [number, number, number];

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

// "c=#e8a33d s=1.4" -> { c, s }. Anything else -> null (the tag is then shown as plain text).
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

// inline code | $$math$$ | $math$ | **bold** | {c=.. s=..}text{/}
const INLINE = /(`[^`\n]+`)|(\$\$[^$]+\$\$)|(\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d))|(\*\*[^*]+\*\*)|\{([^{}\n]*)\}([^]*?)\{\/\}/g;

function inline(parent: HTMLElement, s: string, bg: RGB): void {
  let pos = 0;
  const text = (t: string) => t && parent.appendChild(document.createTextNode(t));
  for (const m of s.matchAll(INLINE)) {
    text(s.slice(pos, m.index));
    pos = m.index + m[0].length;
    if (m[1]) add(parent, 'code').textContent = m[1].slice(1, -1);
    else if (m[2]) math(parent, m[2].slice(2, -2), true);
    else if (m[3]) math(parent, m[3].slice(1, -1), false);
    else if (m[4]) inline(add(parent, 'b'), m[4].slice(2, -2), bg);
    else {
      const style = parseStyle(m[5]);
      if (!style) {
        text(m[0]);
        continue;
      }
      const span = add(parent, 'span');
      if (style.s) span.style.fontSize = `${style.s}em`;
      if (style.c && contrast(hexToRgb(style.c), bg) >= 4.5) span.style.color = style.c; // unreadable colors are ignored
      inline(span, m[6], bg);
    }
  }
  text(s.slice(pos));
}

function markdown(parent: HTMLElement, src: string, bg: RGB): void {
  const lines = src.split('\n');
  let list: HTMLElement | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) inline(add(parent, 'p'), para.join('\n'), bg);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    let m: RegExpExecArray | null;
    if (t.startsWith('```')) {
      flush();
      list = null;
      const code: string[] = [];
      while (++i < lines.length && !lines[i].trimStart().startsWith('```')) code.push(lines[i]);
      add(parent, 'pre').textContent = code.join('\n');
    } else if (t.startsWith('$$') && !t.includes('$$', 2)) {
      // block math over several lines, until the closing $$
      flush();
      list = null;
      const tex = [t.slice(2)];
      while (++i < lines.length && !lines[i].includes('$$')) tex.push(lines[i]);
      if (i < lines.length) tex.push(lines[i].split('$$')[0]);
      math(parent, tex.join('\n'), true);
    } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      flush();
      list = null;
      inline(add(parent, 'h' + Math.min(m[1].length, 3)), m[2], bg);
    } else if ((m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line))) {
      flush();
      const tag = /\d/.test(m[1]) ? 'OL' : 'UL';
      if (list?.tagName !== tag) list = add(parent, tag);
      inline(add(list, 'li'), m[2], bg);
    } else if (!t) {
      flush();
    } else {
      list = null;
      para.push(line);
    }
  }
  flush();
}

// ---- chat view ----
const messages = byId('messages');
let chat: { items: { role: string; text: string }[]; working: boolean; canBranch?: boolean } = { items: [], working: false };
let sent = false; // the user just pressed Enter and the session file has not caught up yet
let stick = true; // keep the newest message in view unless the user scrolled up

const toBottom = () => {
  if (stick) messages.scrollTop = messages.scrollHeight;
};
messages.addEventListener('scroll', () => {
  stick = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 40;
});
new ResizeObserver(toBottom).observe(messages); // window or terminal strip resized
new ResizeObserver(toBottom).observe(byId('items')); // content grew (new message, fonts loaded)

function renderChat(): void {
  const col = byId('items');
  const keep = stick;
  col.replaceChildren();
  for (const item of chat.items) {
    const box = add(col, 'div', item.role);
    if (item.role === 'claude') {
      const bg = (getComputedStyle(box).backgroundColor.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      markdown(box, item.text, (bg.length === 3 ? bg : [0, 0, 0]) as RGB);
    } else box.textContent = item.text;
  }
  byId('working').hidden = !busy();
  stick = keep;
  toBottom();
  renderTree();
}

// ---- branch tree (SVG). Clicks only ask the main process to switch; it re-checks everything. ----
const busy = () => sent || chat.working;
let tree: Tree = { nodes: [], current: '', error: null };
const SVG = 'http://www.w3.org/2000/svg';
const svg = (parent: Element, tag: string, attrs: Record<string, string | number>) => {
  const e = parent.appendChild(document.createElementNS(SVG, tag));
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

function renderTree(): void {
  const btn = byId('branch') as HTMLButtonElement;
  btn.disabled = busy() || !chat.canBranch;
  btn.title = busy() ? 'Disabled while Claude is working' : chat.canBranch ? 'Fork this session at its last message' : 'Send a message first';
  byId('treenote').textContent = tree.error ? `branches.json unreadable (${tree.error}); showing each session as its own tree` : '';

  // Order: roots by created time, each followed by its children (depth first). A visited set guards against loops.
  const byTime = (a: TreeNode, b: TreeNode) => a.created.localeCompare(b.created);
  const kids = new Map<string | null, TreeNode[]>();
  for (const n of tree.nodes) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const rows: { n: TreeNode; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (n: TreeNode, depth: number) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    rows.push({ n, depth });
    for (const k of (kids.get(n.id) ?? []).sort(byTime)) walk(k, depth + 1);
  };
  for (const n of (kids.get(null) ?? []).sort(byTime)) walk(n, 0);
  for (const n of tree.nodes) walk(n, 0); // anything left (a loop in branches.json) becomes a root

  const X = (d: number) => 14 + d * 18;
  const Y = (r: number) => 16 + r * 28;
  const pos = new Map(rows.map((r, i) => [r.n.id, { x: X(r.depth), y: Y(i) }]));
  const graph = byId('graph');
  graph.replaceChildren();
  const root = svg(graph, 'svg', { width: Math.max(...rows.map((r) => X(r.depth)), 0) + 220, height: Y(rows.length) });
  for (const { n } of rows) {
    const p = n.parent && pos.get(n.parent);
    const c = pos.get(n.id)!;
    if (p) svg(root, 'path', { d: `M${p.x} ${p.y} V${c.y} H${c.x}`, fill: 'none', stroke: '#888', 'stroke-width': 1.5 });
  }
  for (const { n } of rows) {
    const { x, y } = pos.get(n.id)!;
    const isCurrent = n.id === tree.current;
    const g = svg(root, 'g', { class: 'node' + (isCurrent ? ' current' : '') + (busy() ? ' busy' : '') });
    svg(g, 'title', {}).textContent =
      `${n.full}\n${n.created ? new Date(n.created).toLocaleString() : ''}` +
      (isCurrent ? '\n(current session)' : busy() ? '\nDisabled while Claude is working' : '\nClick to switch to this session');
    svg(g, 'rect', { x: x - 8, y: y - 12, width: 220, height: 24, rx: 4, class: 'hit' });
    svg(g, 'circle', { cx: x, cy: y, r: isCurrent ? 6 : 5, class: n.empty ? 'dot empty' : 'dot' });
    svg(g, 'text', { x: x + 12, y: y + 4 }).textContent = n.label;
    g.addEventListener('click', () => {
      if (!isCurrent && !busy()) api.openSession(n.id);
    });
  }
}

api.onTree((t) => {
  tree = t;
  renderTree();
});
byId('branch').addEventListener('click', () => {
  if (!busy() && chat.canBranch) api.branch();
});

api.onChat((c) => {
  chat = c;
  sent = false;
  renderChat();
});

const input = byId('input') as HTMLInputElement;
input.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || !input.value.trim()) return;
  api.send(input.value);
  input.value = '';
  sent = true;
  stick = true;
  renderChat();
});

// ---- design. Already validated by the main process. Text goes in via textContent only. ----
function apply(d: any): void {
  const css = document.body.style;
  css.backgroundColor = d.window.background;
  css.color = d.terminal.textColor;
  css.setProperty('--chat-font', d.chat.font);
  css.setProperty('--chat-size', `${d.chat.fontSize}px`);
  css.setProperty('--chat-width', `${d.chat.width}px`);
  css.setProperty('--user-bg', d.userBox.background);
  css.setProperty('--user-fg', d.userBox.textColor);
  css.setProperty('--claude-bg', d.claudeBox.background);
  css.setProperty('--claude-fg', d.claudeBox.textColor);
  for (const h of ['h1', 'h2', 'h3']) {
    css.setProperty(`--${h}-size`, `${d.headings[h].size}px`);
    css.setProperty(`--${h}-weight`, `${d.headings[h].weight}`);
    css.setProperty(`--${h}-color`, d.headings[h].color);
  }
  css.setProperty('--body-size', `${d.body.size}px`);
  css.setProperty('--bold-color', d.bold.color);
  css.setProperty('--code-bg', d.code.background);
  term.options.theme = { background: d.terminal.background, foreground: d.terminal.textColor, cursor: d.terminal.textColor };
  term.options.fontSize = d.terminal.fontSize;
  byId('term').style.backgroundColor = d.terminal.background;

  for (const side of ['left', 'right', 'bottom']) byId(side).replaceChildren();
  for (const p of d.panels) {
    if (!p.visible) continue;
    const el = add(byId(p.side), 'div', 'panel');
    el.style[p.side === 'bottom' ? 'height' : 'width'] = `${p.size}px`;
    for (const b of p.blocks) {
      if (b.type === 'list') {
        const ul = add(el, 'ul');
        for (const item of b.items) add(ul, 'li').textContent = item;
      } else {
        add(el, b.type === 'heading' ? 'h3' : 'p').textContent = b.text;
      }
    }
  }
}

api.onDesign((d, error) => {
  apply(d);
  renderChat(); // box colors may have changed: redo the contrast checks
  const bar = byId('error');
  bar.textContent = error ? `design.json error (showing last working design): ${error}` : '';
  bar.hidden = !error;
  refit();
});

fit.fit();
api.start(term.cols, term.rows);
input.focus();
