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
  onChat(cb: (chat: ChatView) => void): void;
  onToggleTerm(cb: () => void): void;
  branch(replyId?: string, from?: string): void;
  retry(replyId: string): void;
  copy(text: string): void;
  onNote(cb: (text: string) => void): void;
  onPrefill(cb: (text: string) => void): void;
  openSession(id: string): void;
  onGraph(cb: (graph: GraphData) => void): void;
  onToggleGraph(cb: () => void): void;
  onTermReset(cb: () => void): void;
  onCards(cb: (cards: Card[]) => void): void;
  onShowTerm(cb: (why: string) => void): void;
  answerCard(id: string, answer: object): void;
};
interface Card {
  id: string;
  session: string;
  kind: 'permission' | 'question';
  tool: string;
  title: string;
  targetLabel: string;
  target: string;
  note: string;
  preview: { kind: 'text' | 'diff' | 'json'; text: string }[];
  rules: { label: string; destination: string }[];
  questions: { question: string; header: string; options: { label: string; description: string }[]; multiSelect: boolean }[];
  arrived: number;
  expires: number;
  expired: boolean;
}
interface ChatView {
  items: { role: string; text: string; reply?: number }[];
  replies?: { id: string; copy: string; branch: boolean; retry: boolean }[];
  working: boolean;
  canBranch?: boolean;
}
interface GNode {
  id: string;
  session: string;
  reply: string;
  parent: string | null;
  label: string;
  first: string;
  canBranch: boolean;
  x: number; // column
  y: number; // row
}
interface GraphData {
  nodes: GNode[];
  current: string | null;
  session: string;
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
// Hidden by default; Cmd+J (or anything unclear) shows it.
function showTerm(on: boolean): void {
  document.body.classList.toggle('showterm', on);
  refit();
  if (on) term.focus();
  else (byId('input') as HTMLInputElement).focus();
}
api.onToggleTerm(() => showTerm(!document.body.classList.contains('showterm')));
api.onShowTerm((why) => {
  showTerm(true);
  showNote(why, 10000);
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
let chat: ChatView = { items: [], working: false };
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
  // Claude's side of each exchange goes in one .reply box, with the action row under its last item.
  const groups = new Map<number, HTMLElement>();
  const lastOf = new Map<number, number>();
  chat.items.forEach((item, i) => item.reply !== undefined && lastOf.set(item.reply, i));
  chat.items.forEach((item, i) => {
    let parent = col;
    if (item.reply !== undefined) {
      if (!groups.has(item.reply)) {
        const g = add(col, 'div', 'reply');
        g.dataset.reply = chat.replies?.[item.reply]?.id ?? '';
        groups.set(item.reply, g);
      }
      parent = groups.get(item.reply)!;
    }
    const box = add(parent, 'div', item.role);
    if (item.role === 'claude') {
      const bg = (getComputedStyle(box).backgroundColor.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      markdown(box, item.text, (bg.length === 3 ? bg : [0, 0, 0]) as RGB);
    } else box.textContent = item.text;
    if (item.reply !== undefined && lastOf.get(item.reply) === i) actions(parent, item.reply);
  });
  byId('working').hidden = !busy();
  stick = keep;
  toBottom();
  scrollToReply();
  renderToolbar();
}

// ---- Copy / Retry / Branch under a reply. Clicks only ask the main process, which re-checks everything. ----
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const ICONS: Record<string, string[]> = {
  copy: ['M5.5 5.5h7v8h-7z', 'M3.5 10.5v-8h7'],
  retry: ['M13 8a5 5 0 1 1-1.6-3.7', 'M13 2v3h-3'],
  branch: [circle(4.5, 3, 1.5), circle(4.5, 13, 1.5), circle(11.5, 5, 1.5), 'M4.5 4.5v7', 'M11.5 6.5c0 3-7 2.5-7 5'],
};

function iconButton(row: HTMLElement, icon: string, tip: string, off: string, onClick: (b: HTMLElement) => void): void {
  const b = add(row, 'button', 'act');
  b.setAttribute('aria-label', icon);
  b.setAttribute('aria-disabled', String(!!off)); // not "disabled", so the tooltip still shows on hover
  b.title = off || tip;
  const s = svg(b, 'svg', { viewBox: '0 0 16 16', width: 15, height: 15 });
  for (const d of ICONS[icon]) svg(s, 'path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  b.addEventListener('click', () => {
    if (b.getAttribute('aria-disabled') !== 'true' && !busy()) onClick(b);
  });
}

function actions(parent: HTMLElement, k: number): void {
  const r = chat.replies?.[k];
  if (!r?.copy) return; // no text of Claude's own (e.g. only a usage-limit notice): no buttons
  const row = add(parent, 'div', 'actions' + (k === chat.replies!.length - 1 ? ' newest' : ''));
  const why = busy() ? 'Disabled while Claude is working' : '';
  iconButton(row, 'copy', 'Copy', why, (b) => {
    api.copy(r.copy);
    b.title = 'Copied';
    b.classList.add('done');
  });
  iconButton(row, 'retry', 'Retry: new branch without this reply, then send your message again', why || (r.retry ? '' : 'Retry is not possible here'), () => api.retry(r.id));
  iconButton(row, 'branch', 'Branch: new branch that ends at this reply', why || (r.branch ? '' : 'Branch is not possible here'), () => api.branch(r.id));
}

// ---- reply graph (Cmd+G). One node per reply. Clicks only ask the main process to switch or branch;
// it re-checks everything. Only the nodes in view are drawn. ----
const busy = () => sent || chat.working;
const SVG = 'http://www.w3.org/2000/svg';
const svg = (parent: Element, tag: string, attrs: Record<string, string | number>) => {
  const e = parent.appendChild(document.createElementNS(SVG, tag));
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

let graph: GraphData = { nodes: [], current: null, session: '', error: null };
let byNode = new Map<string, GNode>();
let graphOpen = false;
const view = { s: 1, tx: 0, ty: 0 }; // screen = world * s + t
const NW = 132; // node size and spacing, world units
const NH = 26;
const COLW = 164;
const ROWH = 52;
const ZOOM_OPEN = 3; // zooming in past this over a node opens it
const gview = byId('graphview');
const gsvg = byId('graphsvg') as unknown as SVGSVGElement;
const gpop = byId('graphpop');
const at = (n: GNode) => ({ x: n.x * COLW, y: n.y * ROWH });
const shortLabel = (s: string) => (s.length > 20 ? s.slice(0, 19) + '…' : s);

function renderToolbar(): void {
  const btn = byId('branch') as HTMLButtonElement;
  btn.disabled = busy() || !chat.canBranch;
  btn.title = busy() ? 'Disabled while Claude is working' : chat.canBranch ? 'Fork this session at its last reply' : 'Send a message first';
  byId('treenote').textContent = graph.error ? `branches.json unreadable (${graph.error}); branches show as separate chats` : '';
}

let frame = 0;
function drawSoon(): void {
  if (!frame) frame = requestAnimationFrame(() => {
    frame = 0;
    drawGraph();
  });
}

function drawGraph(): void {
  if (!graphOpen) return;
  const W = gsvg.clientWidth;
  const H = gsvg.clientHeight;
  const x0 = -view.tx / view.s;
  const x1 = (W - view.tx) / view.s;
  const y0 = -view.ty / view.s;
  const y1 = (H - view.ty) / view.s;
  const seen = (ax: number, ay: number, bx: number, by: number) => bx > x0 && ax < x1 && by > y0 && ay < y1;
  gsvg.replaceChildren();
  const root = svg(gsvg, 'g', { transform: `translate(${view.tx} ${view.ty}) scale(${view.s})` });
  const lines = svg(root, 'g', {});
  const boxes = svg(root, 'g', {});
  for (const n of graph.nodes) {
    const p = at(n);
    const q = n.parent ? byNode.get(n.parent) : undefined;
    if (q) {
      const a = at(q);
      if (seen(Math.min(a.x, p.x), a.y, Math.max(a.x, p.x) + NW, p.y + NH)) {
        const ax = a.x + NW / 2;
        const ay = a.y + NH;
        const px = p.x + NW / 2;
        const my = (ay + p.y) / 2;
        svg(lines, 'path', { d: `M${ax} ${ay} C${ax} ${my} ${px} ${my} ${px} ${p.y}`, class: 'gline' });
      }
    }
    if (!seen(p.x, p.y, p.x + NW, p.y + NH)) continue;
    const g = svg(boxes, 'g', { class: 'gnode' + (n.id === graph.current ? ' current' : ''), 'data-node': n.id });
    svg(g, 'rect', { x: p.x, y: p.y, width: NW, height: NH, rx: 7 });
    if (view.s > 0.35) svg(g, 'text', { x: p.x + 10, y: p.y + 17 }).textContent = shortLabel(n.label || '…');
  }
}

/** Center the view on a node (the current reply when the graph opens). */
function centerOn(id: string | null): void {
  const n = (id && byNode.get(id)) || graph.nodes[graph.nodes.length - 1];
  view.s = 1;
  const p = n ? at(n) : { x: 0, y: 0 };
  view.tx = gsvg.clientWidth / 2 - (p.x + NW / 2);
  view.ty = gsvg.clientHeight / 2 - (p.y + NH / 2);
}

function openGraph(on: boolean): void {
  graphOpen = on;
  gview.hidden = !on;
  hidePop();
  if (on) {
    centerOn(graph.current);
    drawGraph();
  }
}

let wantReply = ''; // reply id to show once its session's chat is on screen
let scrollUntil = 0;
function scrollToReply(): void {
  if (!wantReply) return;
  if (Date.now() > scrollUntil) return void (wantReply = '');
  const group = Array.from(document.querySelectorAll<HTMLElement>('#items .reply')).find((g) => g.dataset.reply === wantReply);
  if (!group) return;
  wantReply = '';
  const target = (group.previousElementSibling as HTMLElement | null) ?? group; // the user message above the reply
  target.scrollIntoView({ block: 'start' });
  stick = false;
  group.classList.add('flash');
  setTimeout(() => group.classList.remove('flash'), 1200);
}

/** Click (or zoom into) a node: switch to its session and scroll to the reply. */
function openNode(n: GNode): void {
  openGraph(false);
  wantReply = n.reply;
  scrollUntil = Date.now() + 15000;
  if (n.session === graph.session) return scrollToReply();
  if (busy()) {
    wantReply = '';
    return showNote('Cannot switch sessions while Claude is working.', 6000);
  }
  api.openSession(n.session);
}

// Hover: first line of the reply, and a "Branch from here" button.
let popTimer: number | undefined;
let popNode: GNode | null = null;
function hidePop(): void {
  clearTimeout(popTimer);
  gpop.hidden = true;
  popNode = null;
}
function showPop(n: GNode): void {
  clearTimeout(popTimer);
  if (popNode === n && !gpop.hidden) return;
  popNode = n;
  gpop.replaceChildren();
  add(gpop, 'div', 'gfirst').textContent = n.first || '(no text)';
  const b = add(gpop, 'button', 'gbranch') as HTMLButtonElement;
  b.textContent = 'Branch from here';
  const why = busy() ? 'Disabled while Claude is working' : n.canBranch ? '' : 'Branch is not possible here';
  b.disabled = !!why;
  b.title = why || 'New branch that ends at this reply';
  b.addEventListener('click', () => {
    if (busy() || !n.canBranch) return;
    api.branch(n.reply, n.session);
    openGraph(false);
  });
  const p = at(n);
  // to the right of the node, so it hides no other reply in the same column
  gpop.style.left = `${gsvg.getBoundingClientRect().left - gview.getBoundingClientRect().left + (p.x + NW) * view.s + view.tx + 8}px`;
  gpop.style.top = `${gsvg.getBoundingClientRect().top - gview.getBoundingClientRect().top + p.y * view.s + view.ty}px`;
  gpop.hidden = false;
}
const popLater = () => {
  clearTimeout(popTimer);
  popTimer = window.setTimeout(hidePop, 250);
};
gpop.addEventListener('pointerenter', () => clearTimeout(popTimer));
gpop.addEventListener('pointerleave', popLater);

/** The node under a screen point (hit test in graph space, so redraws under the pointer do not matter). */
function nodeAtPoint(clientX: number, clientY: number): GNode | null {
  const r = gsvg.getBoundingClientRect();
  const wx = (clientX - r.left - view.tx) / view.s;
  const wy = (clientY - r.top - view.ty) / view.s;
  return (
    graph.nodes.find((n) => {
      const p = at(n);
      return wx >= p.x && wx <= p.x + NW && wy >= p.y && wy <= p.y + NH;
    }) ?? null
  );
}
gsvg.addEventListener('pointermove', (e) => {
  if (drag) return;
  const n = nodeAtPoint(e.clientX, e.clientY);
  if (n) showPop(n);
  else if (popNode) popLater();
});
gsvg.addEventListener('pointerleave', () => popNode && popLater());

// Pan by dragging; a press without a drag on a node is a click.
let drag: { x: number; y: number; tx: number; ty: number; node: GNode | null; moved: boolean } | null = null;
gsvg.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, node: nodeAtPoint(e.clientX, e.clientY), moved: false };
  try {
    gsvg.setPointerCapture(e.pointerId);
  } catch {
    // pointer already gone
  }
});
gsvg.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  if (!drag.moved) hidePop();
  drag.moved = true;
  view.tx = drag.tx + dx;
  view.ty = drag.ty + dy;
  drawSoon();
});
gsvg.addEventListener('pointerup', () => {
  const d = drag;
  drag = null;
  if (d && !d.moved && d.node) openNode(d.node);
});

// Zoom: trackpad pinch (wheel + ctrlKey) or Cmd+scroll, around the pointer. Plain scroll pans.
gsvg.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    hidePop();
    if (!e.ctrlKey && !e.metaKey) {
      view.tx -= e.deltaX;
      view.ty -= e.deltaY;
      return drawSoon();
    }
    const r = gsvg.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const old = view.s;
    const s = Math.min(6, Math.max(0.15, old * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))));
    view.tx = mx - ((mx - view.tx) * s) / old;
    view.ty = my - ((my - view.ty) * s) / old;
    view.s = s;
    if (old < ZOOM_OPEN && s >= ZOOM_OPEN) {
      const hit = nodeAtPoint(e.clientX, e.clientY);
      if (hit) return openNode(hit);
    }
    drawSoon();
  },
  { passive: false },
);
window.addEventListener('resize', drawSoon);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && graphOpen) openGraph(false);
});

api.onGraph((g) => {
  graph = g;
  byNode = new Map(g.nodes.map((n) => [n.id, n]));
  renderToolbar();
  drawSoon();
});
api.onToggleGraph(() => openGraph(!graphOpen));
byId('graphbtn').addEventListener('click', () => openGraph(!graphOpen));
byId('graphclose').addEventListener('click', () => openGraph(false));
byId('branch').addEventListener('click', () => {
  if (!busy() && chat.canBranch) api.branch();
});

// ---- permission and question cards. One at a time, oldest first. A click only asks the main
// process, which checks it against the card; the app never answers by itself. ----
let cards: Card[] = [];
let shownCard = ''; // "id|expired" of the card on screen
let clicked = ''; // id of the card just answered (its buttons are off until it goes)
let ticker: number | undefined;
const cardBox = byId('cards');
const PREVIEW_LINES = 40;

function cardButton(row: HTMLElement, label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = add(row, 'button', 'card-btn' + (cls ? ' ' + cls : '')) as HTMLButtonElement;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function preview(parent: HTMLElement, pv: Card['preview'][number]): void {
  const pre = add(parent, 'pre', 'card-preview');
  const lines = pv.text.split('\n');
  if (!pv.text) add(pre, 'span', 'more').textContent = '(empty)';
  for (const l of lines.slice(0, PREVIEW_LINES)) {
    const cls = pv.kind === 'diff' ? (l.startsWith('- ') ? 'del' : l.startsWith('+ ') ? 'ins' : '') : '';
    add(pre, 'span', cls).textContent = l + '\n';
  }
  if (lines.length > PREVIEW_LINES) add(pre, 'span', 'more').textContent = `… ${lines.length - PREVIEW_LINES} more lines`;
}

function buildCard(c: Card): void {
  const box = add(cardBox, 'div', 'card' + (c.expired ? ' expired' : ''));
  const send = (answer: object) => {
    if (clicked === c.id || c.expired || timeLeft(c.expires, Date.now()).level === 'expired') return;
    clicked = c.id;
    box.classList.add('sent');
    api.answerCard(c.id, answer);
    setTimeout(() => {
      // still here (the main process refused it): buttons back on
      if (clicked === c.id && cards[0]?.id === c.id) {
        clicked = '';
        box.classList.remove('sent');
      }
    }, 3000);
  };
  add(box, 'div', 'card-title').textContent = c.title; // the raw tool name is not shown
  if (c.target) {
    add(box, 'div', 'card-label').textContent = c.targetLabel;
    add(box, 'pre', 'card-target').textContent = c.target;
  }
  if (c.note) add(box, 'div', 'card-note').textContent = c.note;
  for (const pv of c.preview) preview(box, pv);

  const chosen: Record<string, string> = {};
  const multi = c.questions.some((q) => q.multiSelect);
  let sendAnswers: HTMLButtonElement | null = null;
  for (const q of c.questions) {
    const qe = add(box, 'div', 'question');
    if (q.header) add(qe, 'div', 'q-header').textContent = q.header;
    add(qe, 'div', 'q-text').textContent = q.question;
    if (q.multiSelect) add(qe, 'div', 'card-note').textContent = 'Several answers allowed: the app cannot send these. Answer in the terminal.';
    const opts = add(qe, 'div', 'q-options');
    for (const o of q.options) {
      const b = add(opts, 'button', 'q-option') as HTMLButtonElement;
      add(b, 'span').textContent = o.label;
      if (o.description) add(b, 'span', 'q-desc').textContent = o.description;
      b.disabled = multi;
      b.addEventListener('click', () => {
        chosen[q.question] = o.label;
        for (const x of Array.from(opts.children)) x.classList.toggle('chosen', x === b);
        if (c.questions.length === 1) send({ action: 'answer', answers: { ...chosen } });
        else if (sendAnswers) sendAnswers.disabled = Object.keys(chosen).length !== c.questions.length;
      });
    }
  }

  const row = add(box, 'div', 'card-buttons');
  if (c.kind === 'permission') {
    cardButton(row, 'Allow once', 'allow', () => send({ action: 'allow' }));
    const reason = add(row, 'input', 'card-reason') as HTMLInputElement;
    reason.placeholder = 'Reason for Deny (optional)';
    const deny = () => send({ action: 'deny', reason: reason.value });
    cardButton(row, 'Deny', 'deny', deny);
    reason.addEventListener('keydown', (e) => e.key === 'Enter' && !e.isComposing && deny());
    c.rules.forEach((r, i) => {
      const b = cardButton(row, `Always allow ${r.label}`, 'always', () => send({ action: 'always', rule: i }));
      b.title = `Allows this call and saves the rule ${r.label} for ${r.destination}, as Claude Code suggested it.`;
    });
  } else {
    if (c.questions.length > 1 && !multi) {
      sendAnswers = cardButton(row, 'Send answers', 'allow', () => send({ action: 'answer', answers: { ...chosen } }));
      sendAnswers.disabled = true;
    }
    cardButton(row, 'Answer in terminal', '', () => send({ action: 'terminal' })).title = 'For "Type something", "Chat about this" and anything the buttons cannot send';
  }
  add(box, 'div', 'card-expired').textContent = 'Expired, answer in the terminal';

  // Time bar: the used time fills in from the right edge; full = time is up.
  add(add(box, 'div', 'timer-track'), 'div', 'timer-fill');
  const foot = add(box, 'div', 'card-foot');
  add(foot, 'span', 'queue');
  add(foot, 'span', 'timer-text');
}

/** Time bar of the card on screen, and the time left of the cards waiting behind it. */
function tick(): void {
  const head = cards[0];
  if (!head) return;
  const now = Date.now();
  const t = timeLeft(head.expires, now);
  if (t.level === 'expired' && !head.expired) {
    head.expired = true; // the main process sends the same at the same moment
    showTerm(true);
    renderCards();
    return;
  }
  const fill = cardBox.querySelector('.timer-fill') as HTMLElement | null;
  if (fill) {
    fill.style.width = `${(1 - t.fraction) * 100}%`;
    fill.style.backgroundColor = t.level === 'normal' ? 'var(--timer-fill)' : 'var(--timer-urgent)';
  }
  const text = cardBox.querySelector('.timer-text');
  if (text) text.textContent = head.expired ? 'Expired' : t.text;
  const queue = cardBox.querySelector('.queue') as HTMLElement | null;
  if (queue) {
    const rest = cards.slice(1);
    queue.textContent = rest.length ? `${rest.length} more waiting: ` + rest.map((c) => (c.expired ? 'expired' : timeLeft(c.expires, now).text)).join(', ') : '';
  }
}

function renderCards(): void {
  const head = cards[0];
  const key = head ? `${head.id}|${head.expired}` : '';
  if (key !== shownCard) {
    shownCard = key;
    cardBox.replaceChildren();
    if (head) buildCard(head);
  }
  if (!head) {
    clearInterval(ticker); // closed early or answered: the timer stops
    ticker = undefined;
    return;
  }
  ticker ??= window.setInterval(tick, 250);
  tick();
  toBottom();
}

api.onCards((c) => {
  cards = c;
  renderCards();
});

const note = byId('note');
let noteTimer: number | undefined;
function showNote(text: string, ms: number): void {
  note.textContent = text;
  note.hidden = false;
  clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => (note.hidden = true), ms);
}
api.onNote((t) => showNote(t, 10000));
api.onPrefill((t) => {
  input.value = t; // never sent by the app: the user presses Enter
  input.focus();
  showNote('Retry: Claude was not ready, so nothing was sent. Your message is in the box below. Press Enter to send it.', 20000);
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
  css.setProperty('--window-bg', d.window.background);
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
  css.setProperty('--timer-track', d.timer.track);
  css.setProperty('--timer-fill', d.timer.fill);
  css.setProperty('--timer-urgent', d.timer.urgent);
  css.setProperty('--graph-node', d.graph.node);
  css.setProperty('--graph-line', d.graph.line);
  css.setProperty('--graph-current', d.graph.current);
  css.setProperty('--graph-label', d.graph.label);
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
