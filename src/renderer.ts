// Plain script (no imports). Terminal and FitAddon come from <script> tags, api from preload; the
// reply renderer and its helpers (byId, add, svg, icon, renderMarkdown...) from md.ts.
declare const Terminal: any;
declare const FitAddon: any;
declare const api: {
  start(cols: number, rows: number): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  send(text: string): void;
  onData(cb: (data: string) => void): void;
  onDesign(cb: (design: any, error: string | null, info: string | null, theme: 'light' | 'dark', looks: Looks) => void): void;
  onChats(cb: (chats: ChatRow[]) => void): void;
  newChat(): void;
  pathOf(file: File): string;
  pickFiles(): Promise<Chip[]>;
  statFiles(paths: string[]): Promise<Chip[]>;
  savePaste(bytes: Uint8Array, mime: string): Promise<Chip | null>;
  stop(): void;
  setOptions(patch: object): void;
  nextMode(): void;
  zoom(dir: number): void;
  onSettings(cb: (s: AppSettings) => void): void;
  onShortcut(cb: (name: string) => void): void;
  skillsList(): Promise<SkillInfo[]>;
  skillSwitch(name: string, on: boolean): Promise<{ skills: SkillInfo[]; error: string }>;
  skillAdd(): Promise<{ skills: SkillInfo[]; error: string }>;
  designSet(patch: object): void;
  onAccount(cb: (a: AccountView) => void): void;
  accountRefresh(): void;
  showUsage(): void;
  usageOpen(): Promise<boolean>;
  usageClose(): void;
  saveDrawing(svg: string, name: string): void;
  openSource(): void;
  helpText(): Promise<string>;
  appVersion(): Promise<string>;
  resetDesign(): void;
  openFolder(): void;
  openArtifact(name: string, version?: number): void;
  stepArtifact(delta: number): void;
  reloadArtifact(): void;
  closeArtifact(): void;
  revealArtifact(): void;
  artifactBounds(b: { x: number; y: number; width: number; height: number } | null): void;
  onArtifacts(cb: (list: Art[]) => void): void;
  onArtifactShown(cb: (shown: ArtShown | null) => void): void;
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
  wheelLog: boolean;
  logWheel(line: string): void;
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
  session: string;
  model: string;
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
  beside: string | null;
  created: string;
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
interface Art {
  name: string;
  type: 'html' | 'svg' | 'md';
  versions: number;
  deleted: boolean;
}
interface ArtShown extends Art {
  version: number;
  latest: boolean;
  text?: string;
}
interface AccountView {
  state: 'in' | 'out' | 'unknown';
  email: string;
  plan: string;
}
interface AppSettings {
  zoom: number;
  model: string;
  effort: string;
  mode: string;
  toolsOpen: boolean;
  showAccount: boolean;
  modeNow: string | null; // read back from Claude Code's status line
  effortNow: string | null;
}
interface SkillInfo {
  name: string;
  description: string;
  where: string;
  on: boolean;
  canSwitch: boolean;
}
interface ChatRow {
  id: string;
  title: string;
  full: string;
  updated: number;
  group: string;
  branches: number;
  open: string; // the session a click opens
  current: boolean;
}


// ---- terminal strip ----
const term = new Terminal({ fontFamily: 'Menlo, monospace' });
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open(byId('term'));
term.onData((d: string) => api.write(d));
api.onData((d) => {
  term.write(d);
  if (busy() && !previewTimer) previewTimer = window.setTimeout(readPreview, 120); // the reply may have grown on the terminal
});

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
  else byId('input').focus();
}
api.onToggleTerm(() => showTerm(!document.body.classList.contains('showterm')));
api.onShowTerm((why) => {
  showTerm(true);
  showNote(why, 10000);
});

// ---- chat view ----
const messages = byId('messages');
let chat: ChatView = { session: '', model: '', items: [], working: false };
let sent = false; // the user just pressed Enter and the session file has not caught up yet
let stick = true; // keep the newest message in view unless the user scrolled up
let look: MdOptions = { bg: [255, 255, 255], effects: true, copy: (t) => api.copy(t), saveDrawing: (svg, name) => api.saveDrawing(svg, name) };
const openTools = new Set<string>(); // tool lines the user unfolded, as "session:item index"

const toBottom = () => {
  if (stick) messages.scrollTop = messages.scrollHeight;
};
let scrollFrame = 0;
messages.addEventListener('scroll', () => {
  const below = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
  stick = below < 40;
  byId('jump').hidden = below < messages.clientHeight; // more than one screen up
  if (!scrollFrame) scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    updateRail();
  });
});
// The jump arrow sits beside the message box when the chat area has room for it there, else on the box's edge.
function placeJump(): void {
  const wrap = byId('composerwrap');
  const box = byId('composer');
  const margin = (wrap.clientWidth - box.offsetWidth) / 2; // free space right of the box
  const tight = margin < 34 + 16 + 8; // button, its gap to the window edge, and air beside the box
  const jump = byId('jump');
  jump.classList.toggle('tight', tight);
  jump.style.setProperty('--jump-right', `${Math.max(8, margin + 14)}px`);
}
new ResizeObserver(placeJump).observe(byId('composerwrap'));
byId('jump').addEventListener('click', () => {
  stick = true;
  messages.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' });
});
new ResizeObserver(toBottom).observe(messages); // window or terminal strip resized
new ResizeObserver(toBottom).observe(byId('items')); // content grew (new message, fonts loaded)

const CHEVRON = ['m6 3.5 4.5 4.5L6 12.5'];

/** A run of tool calls: one quiet line, "Worked on 3 steps"; a click lists the tool names. */
function toolLine(parent: HTMLElement, names: string[], key: string): void {
  const b = add(parent, 'button', 'tools' + (openTools.has(key) !== opts.toolsOpen ? ' open' : '')); // the setting flips the default
  icon(b, CHEVRON, 11, 1.6);
  add(b, 'span', 'count').textContent = names.length === 1 ? 'Worked on 1 step' : `Worked on ${names.length} steps`;
  add(b, 'span', 'names').textContent = names.join(', ');
  b.title = 'Show or hide the tools Claude used';
  b.addEventListener('click', () => {
    if (!openTools.delete(key)) openTools.add(key);
    b.classList.toggle('open');
  });
}

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
    const names = item.role === 'tool' ? toolNames(item.text) : null;
    if (names) toolLine(parent, names, `${chat.session}:${i}`);
    else if (item.role === 'artifact') artifactCard(parent, item.text);
    else {
      const box = add(parent, 'div', item.role);
      if (item.role === 'claude') renderMarkdown(box, item.text, look);
      else box.textContent = item.text;
    }
    if (item.reply !== undefined && lastOf.get(item.reply) === i) {
      finishReply(parent, look); // effects and map links, over all text parts of the reply
      actions(parent, item.reply);
    }
  });
  byId('working').hidden = !busy();
  renderControls();
  const before = !!livePreview;
  readPreview();
  if (before && !livePreview) Array.from(col.querySelectorAll('.claude')).at(-1)?.classList.add('landed'); // the real text took the preview's place
  stick = keep;
  toBottom();
  scrollToReply();
  renderToolbar();
  railFor = null;
  updateRail();
}

// ---- live preview: the reply as it grows on Claude Code's (hidden) terminal. Plain text only, and
// only until the finished block arrives in the session file, which stays the one record. ----
let livePreview = '';
let previewTimer = 0;
let lastSent = ''; // the message just typed, until the session file has it
const head = (s: string) => s.split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 30);

function readPreview(): void {
  previewTimer = 0;
  let next = '';
  if (busy()) {
    const b = term.buffer.active;
    const lines: string[] = [];
    for (let i = Math.max(0, b.length - 500); i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? '');
    const r = replyOnScreen(lines, term.cols);
    const at = chat.items.map((i) => i.role).lastIndexOf('user');
    const userText = sent ? lastSent : at >= 0 ? chat.items[at].text : '';
    // Blocks of this turn the file already has: the preview is only for what is not there yet.
    const inFile = sent || at < 0 ? 0 : chat.items.slice(at + 1).filter((i) => i.role === 'claude' || i.role === 'notice').length;
    if (r && r.text && r.blocks > inFile && userText && head(r.user) === head(userText)) next = r.text;
  }
  livePreview = next;
  const col = byId('items');
  let el = document.getElementById('preview');
  if (!livePreview) return void el?.remove();
  if (!el) {
    el = add(col, 'div', 'claude preview');
    el.id = 'preview';
  } else if (col.lastElementChild !== el) col.appendChild(el);
  el.replaceChildren();
  // A drawing's SVG source is not shown while it is written: a quiet box of its size holds its place.
  for (const part of drawPreviewParts(livePreview)) {
    if (part.kind === 'draw') drawingPlaceholder(el, part.width, part.height);
    else for (const para of part.text.split('\n\n')) if (para.trim()) add(el, 'p').textContent = para;
  }
  toBottom();
}

// ---- Copy / Retry / Branch under a reply. Clicks only ask the main process, which re-checks everything. ----
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const ICONS: Record<string, string[]> = {
  copy: ['M5.5 5.5h7v8h-7z', 'M3.5 10.5v-8h7'],
  retry: ['M13 8a5 5 0 1 1-1.6-3.7', 'M13 2v3h-3'],
  branch: [circle(4.5, 3, 1.5), circle(4.5, 13, 1.5), circle(11.5, 5, 1.5), 'M4.5 4.5v7', 'M11.5 6.5c0 3-7 2.5-7 5'],
  prev: ['M10 3 5 8l5 5'],
  next: ['m6 3 5 5-5 5'],
};

function iconButton(row: HTMLElement, name: string, tip: string, off: string, onClick: (b: HTMLElement) => void): void {
  const b = add(row, 'button', 'act');
  b.setAttribute('aria-label', name);
  b.setAttribute('aria-disabled', String(!!off)); // not "disabled", so the tooltip still shows on hover
  b.title = off || tip;
  icon(b, ICONS[name]);
  b.addEventListener('click', () => {
    if (b.getAttribute('aria-disabled') !== 'true' && !busy()) onClick(b);
  });
}

/** Replies that stand beside this one in the graph: a Retry and the reply it replaced, or branches from the same point. */
function siblingsOf(replyId: string): { all: GNode[]; at: number } | null {
  const n = graph.nodes.find((x) => x.reply === replyId);
  if (!n) return null;
  const root = n.beside ?? n.id;
  const all = graph.nodes
    .filter((m) => (n.parent !== null ? m.parent === n.parent : m.parent === null && (m.id === root || m.beside === root)))
    .sort((a, b) => a.created.localeCompare(b.created));
  return all.length > 1 ? { all, at: all.indexOf(n) } : null;
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
  const sib = siblingsOf(r.id);
  if (!sib) return;
  // Other versions of this reply (a Retry, or branches from the same point): step through them.
  const sw = add(row, 'span', 'switcher');
  const go = (to: number) => () => openNode(sib.all[to]);
  iconButton(sw, 'prev', 'Previous version of this reply', why || (sib.at > 0 ? '' : 'This is the first version'), go(sib.at - 1));
  add(sw, 'span').textContent = `${sib.at + 1} / ${sib.all.length}`;
  iconButton(sw, 'next', 'Next version of this reply', why || (sib.at < sib.all.length - 1 ? '' : 'This is the last version'), go(sib.at + 1));
}

// ---- artifacts: a card in the chat, and a side panel. The page of an .html or .svg artifact is drawn
// by a separate sandboxed view that the main process lays over #artifactbody; this page never loads it. ----
let arts: Art[] = [];
let artShown: ArtShown | null = null;
const ART_KIND: Record<string, string> = { html: 'Page', svg: 'Picture', md: 'Document' };
const ART_ICON = ['M4 2.5h5.5L12 5v8.5H4z', 'M9.5 2.5V5H12'];

/** A file Claude wrote into artifacts/: a card that opens it in the side panel. */
function artifactCard(parent: HTMLElement, name: string): void {
  const info = arts.find((a) => a.name === name);
  const b = add(parent, 'button', 'artcard');
  icon(add(b, 'span', 'articon'), ART_ICON, 18);
  const text = add(b, 'span');
  add(text, 'div', 'artname').textContent = name;
  const kind = ART_KIND[name.slice(name.lastIndexOf('.') + 1)] ?? 'File';
  add(text, 'div', 'artmeta').textContent = !info ? `${kind} · not found in artifacts/` : `${kind} · ${info.versions === 1 ? '1 version' : `${info.versions} versions`}${info.deleted ? ' · file deleted' : ''}`;
  b.title = info ? 'Open in the side panel' : 'This file is not in the artifacts folder any more';
  b.addEventListener('click', () => info && api.openArtifact(name));
}

const artPanel = byId('artifact');
const artBody = byId('artifactbody');
/** Tell the main process where the artifact's view goes, or to hide it while something covers the panel. */
function placeArtifact(): void {
  const covered = graphOpen || !byId('settings').hidden || !artShown || artShown.type === 'md' || artPanel.hidden || (narrow.matches && document.body.classList.contains('sideopen'));
  const r = artBody.getBoundingClientRect();
  api.artifactBounds(covered || r.width < 1 || r.height < 1 ? null : { x: r.left, y: r.top, width: r.width, height: r.height });
}
new ResizeObserver(placeArtifact).observe(artBody);
window.addEventListener('resize', placeArtifact);

api.onArtifacts((list) => {
  arts = list;
  renderChat(); // the cards show version counts
});
api.onArtifactShown((shown) => {
  artShown = shown;
  artPanel.hidden = !shown;
  document.body.classList.toggle('artopen', !!shown);
  artBody.replaceChildren();
  artBody.classList.toggle('md', shown?.type === 'md');
  if (shown) {
    byId('arttitle').textContent = shown.name;
    byId('artver').textContent = `${shown.version} / ${shown.versions}`;
    byId('artprev').style.visibility = shown.version > 1 ? '' : 'hidden';
    byId('artnext').style.visibility = shown.version < shown.versions ? '' : 'hidden';
    byId('artnote').textContent = shown.deleted ? 'The file was deleted. This is a saved version.' : shown.latest ? '' : `Older version ${shown.version} of ${shown.versions}. The file itself holds the newest.`;
    if (shown.type === 'md') {
      const doc = add(artBody, 'div', 'claude');
      renderMarkdown(doc, shown.text ?? '', look);
      finishReply(doc, look);
    }
  }
  placeArtifact();
  refit();
});
byId('artprev').addEventListener('click', () => api.stepArtifact(-1));
byId('artnext').addEventListener('click', () => api.stepArtifact(1));
byId('artreload').addEventListener('click', () => api.reloadArtifact());
byId('artreveal').addEventListener('click', () => api.revealArtifact());
byId('artclose').addEventListener('click', () => api.closeArtifact());
// Drag the panel's left edge to resize it.
byId('artgrip').addEventListener('pointerdown', (down) => {
  const grip = byId('artgrip');
  const start = artPanel.getBoundingClientRect().width;
  grip.setPointerCapture(down.pointerId);
  api.artifactBounds(null); // the view would swallow the pointer while dragging
  const move = (e: PointerEvent) => (artPanel.style.width = `${Math.max(320, Math.min(window.innerWidth * 0.7, start + down.clientX - e.clientX))}px`);
  const up = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    placeArtifact();
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
});

// ---- outline rail: the headings of the reply in view, when the window is wide and the reply long ----
const rail = byId('rail');
let railFor: HTMLElement | null = null;
function updateRail(): void {
  const box = messages.getBoundingClientRect();
  const mid = box.top + box.height / 3;
  const room = box.width >= byId('items').clientWidth + 2 * 190; // space beside the column
  const group = !room ? undefined : Array.from(document.querySelectorAll<HTMLElement>('#items .reply')).find((g) => {
    const r = g.getBoundingClientRect();
    return r.top <= mid && r.bottom >= mid;
  });
  const heads = group ? Array.from(group.querySelectorAll<HTMLElement>('h1, h2, h3, h4')) : [];
  if (!group || heads.length < 3) {
    rail.hidden = true;
    railFor = null;
    return;
  }
  if (railFor !== group) {
    railFor = group;
    rail.replaceChildren();
    for (const h of heads) {
      const b = add(rail, 'button', `railitem l${Math.min(3, +h.tagName[1])}`);
      b.textContent = h.textContent;
      b.title = h.textContent ?? '';
      b.addEventListener('click', () => h.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }
  rail.hidden = false;
  let on = 0;
  heads.forEach((h, i) => h.getBoundingClientRect().top <= mid && (on = i));
  Array.from(rail.children).forEach((b, i) => b.classList.toggle('on', i === on));
}
window.addEventListener('resize', updateRail);


// ---- reply graph (Cmd+G). One node per reply. Clicks only ask the main process to switch or branch;
// it re-checks everything. Only the nodes in view are drawn. ----
const busy = () => sent || chat.working;

let graph: GraphData = { nodes: [], current: null, session: '', error: null };
let byNode = new Map<string, GNode>();
let graphOpen = false;
const view = { s: 1, tx: 0, ty: 0 }; // screen = world * s + t
const NW = 132; // node size and spacing, world units
const NH = 26;
const COLW = 164;
const ROWH = 52;
const ZOOM_MIN = 0.15;
const gview = byId('graphview');
const gsvg = byId('graphsvg') as unknown as SVGSVGElement;
const gpop = byId('graphpop');
const at = (n: GNode) => ({ x: n.x * COLW, y: n.y * ROWH });
const shortLabel = (s: string) => (s.length > 20 ? s.slice(0, 19) + '…' : s);

function renderToolbar(): void {
  byId('treenote').textContent = graph.error ? `branches.json unreadable (${graph.error}); branches show as separate chats` : '';
  renderChats();
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

/** Center the view on a node (the current reply when the graph opens), at zoom 1. */
function centerOn(id: string | null): void {
  const n = (id && byNode.get(id)) || graph.nodes[graph.nodes.length - 1];
  view.s = 1;
  const p = n ? at(n) : { x: 0, y: 0 };
  view.tx = gsvg.clientWidth / 2 - (p.x + NW / 2) * view.s;
  view.ty = gsvg.clientHeight / 2 - (p.y + NH / 2) * view.s;
}

const centerEl = byId('center');
/** How much of the graph shows over the chat, 0..1: the graph fades in and the chat sinks back a little.
 * hideChat: the chat behind is not the one being moved into (another session), so keep it out of sight. */
function setShown(t: number, hideChat = false): void {
  const e = smooth(Math.min(1, Math.max(0, t)));
  gview.style.opacity = e >= 1 ? '' : String(e);
  centerEl.style.transform = e > 0 ? `scale(${1 - 0.25 * e})` : ''; // the chat shrinks back into its reply's box
  centerEl.style.opacity = hideChat ? '0' : '';
}

function openGraph(on: boolean): void {
  endTrip();
  graphOpen = on;
  gview.hidden = !on;
  hidePop();
  placeArtifact(); // the artifact's view lies above the page: hide it under the graph
  setShown(on ? 1 : 0);
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
  // Keep the old chat out of sight until the new one is on screen (onChat shows it again).
  centerEl.style.opacity = '0';
  clearTimeout(revealTimer);
  revealTimer = window.setTimeout(() => (centerEl.style.opacity = ''), 1500);
  api.openSession(n.session);
}
let revealTimer: number | undefined;

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

/** Zoom the graph to s around a screen point of the svg (mx, my). */
function zoomAt(s: number, mx: number, my: number): void {
  const old = view.s;
  view.tx = mx - ((mx - view.tx) * s) / old;
  view.ty = my - ((my - view.ty) * s) / old;
  view.s = s;
  drawSoon();
}

// Cmd+scroll: zoom around the pointer, up to ENTER_S (only a pinch goes further, into a chat).
function zoomGraph(e: WheelEvent): void {
  hidePop();
  const r = gsvg.getBoundingClientRect();
  zoomAt(Math.min(ENTER_S, Math.max(ZOOM_MIN, view.s * Math.exp(-e.deltaY * 0.0025))), e.clientX - r.left, e.clientY - r.top);
}

// ---- pinch: one continuous zoom from the graph into a reply's chat and back (see pinch.ts) ----
// trip: a move between the graph and one reply's chat, in progress. (fx, fy): where that reply's box
// was on screen when the move started; it slides to the middle as it grows. fromChat: started by a
// pinch out of the chat that shows this reply, so ending in the chat just closes the graph.
let trip: { node: GNode; fx: number; fy: number; fromChat: boolean; other: boolean } | null = null;
let pinchEnd: number | undefined;
let anim = 0;
// The chat end of a move: the reply's box at twice the graph's closest zoom (or filling the window, if
// that is less). Not bigger, so a move never shows one giant box.
const fillS = () => Math.min(2 * ENTER_S, fillScale(gsvg.clientWidth, gsvg.clientHeight, NW, NH));

function stopAnim(): void {
  cancelAnimationFrame(anim);
  anim = 0;
}
function endTrip(): void {
  stopAnim();
  clearTimeout(pinchEnd);
  trip = null;
}

/** Show the move at zoom s: the reply's box grows toward the middle while the graph fades. */
function placeTrip(s: number): void {
  if (!trip) return;
  const shown = graphShown(s, ENTER_S, fillS());
  const k = 1 - shown;
  const cx = trip.fx + (gsvg.clientWidth / 2 - trip.fx) * k;
  const cy = trip.fy + (gsvg.clientHeight / 2 - trip.fy) * k;
  const p = at(trip.node);
  view.s = s;
  view.tx = cx - (p.x + NW / 2) * s;
  view.ty = cy - (p.y + NH / 2) * s;
  setShown(shown, trip.other && shown < 1);
  // shrink the chat toward the box (offsets: the chat's layout box, without its own transform)
  const g = gsvg.getBoundingClientRect();
  const row = byId('row').getBoundingClientRect();
  centerEl.style.transformOrigin = `${g.left - row.left + cx - centerEl.offsetLeft}px ${g.top - row.top + cy - centerEl.offsetTop}px`;
  drawSoon();
}

/** The move reached the chat. */
function landInChat(): void {
  const t = trip;
  endTrip();
  if (!t) return;
  if (t.fromChat) openGraph(false); // the chat you were on, as you left it
  else openNode(t.node);
}

/** Animate the zoom to `to` (on a log scale, easing out), then run done. */
function animateTrip(to: number, done: () => void): void {
  stopAnim();
  const from = view.s;
  const t0 = performance.now();
  const step = (now: number) => {
    const u = Math.min(1, (now - t0) / SETTLE_MS);
    placeTrip(from * Math.pow(to / from, 1 - Math.pow(1 - u, 3)));
    if (u < 1) anim = requestAnimationFrame(step);
    else {
      anim = 0;
      done();
    }
  };
  anim = requestAnimationFrame(step);
}

/** The fingers stopped: finish the move to the nearer end. */
function settleTrip(): void {
  if (!trip) return;
  if (settleTo(graphShown(view.s, ENTER_S, fillS())) === 'chat') return animateTrip(fillS(), landInChat);
  // back to the graph: out of the chat it frames the whole neighbourhood (zoom 1), else where the move began
  animateTrip(Math.min(view.s, trip.fromChat ? 1 : ENTER_S), () => {
    trip = null;
    setShown(1);
    drawSoon();
  });
}

function onPinch(e: WheelEvent): void {
  hidePop();
  stopAnim();
  clearTimeout(pinchEnd);
  pinchEnd = window.setTimeout(settleTrip, PINCH_END_MS);
  if (!graphOpen) {
    if (e.deltaY <= 0 || !graph.nodes.length) return; // pinch in on the chat: nothing closer to show
    const n = (graph.current && byNode.get(graph.current)) || graph.nodes[graph.nodes.length - 1];
    openGraph(true); // ends any old trip; the view is laid out from here on
    pinchEnd = window.setTimeout(settleTrip, PINCH_END_MS);
    trip = { node: n, fx: gsvg.clientWidth / 2, fy: gsvg.clientHeight / 2, fromChat: true, other: false };
    placeTrip(fillS()); // starts as the chat: this reply's box fills the window, graph not shown yet
  }
  if (trip) {
    const s = Math.min(fillS(), pinchZoom(view.s, e.deltaY));
    if (s >= fillS()) return landInChat();
    placeTrip(s);
    if (graphShown(s, ENTER_S, fillS()) >= 1) {
      trip = null; // fully in the graph: from here a pinch zooms it around the fingers
      setShown(1);
    }
    return;
  }
  const r = gsvg.getBoundingClientRect();
  const s = Math.min(ENTER_S, Math.max(ZOOM_MIN, pinchZoom(view.s, e.deltaY)));
  zoomAt(s, e.clientX - r.left, e.clientY - r.top);
  if (e.deltaY >= 0 || s < ENTER_S) return;
  // Zoomed in as far as the graph goes, fingers still moving apart: move into the reply under them.
  const hit = nodeAtPoint(e.clientX, e.clientY);
  if (!hit) return;
  const other = hit.session !== graph.session;
  if (other && busy()) return showNote('Cannot switch sessions while Claude is working.', 4000);
  const p = at(hit);
  trip = { node: hit, fx: view.tx + (p.x + NW / 2) * view.s, fy: view.ty + (p.y + NH / 2) * view.s, fromChat: false, other };
}

// Every wheel event of the window. A trackpad pinch (ctrlKey) never zooms the page: it is the
// continuous zoom between the chat and the graph above.
window.addEventListener(
  'wheel',
  (e) => {
    if (api.wheelLog) api.logWheel(`wheel deltaY=${e.deltaY} deltaX=${e.deltaX} ctrlKey=${e.ctrlKey} metaKey=${e.metaKey} deltaMode=${e.deltaMode} graph=${graphOpen} t=${Math.round(e.timeStamp)}`);
    if (e.ctrlKey) {
      e.preventDefault();
      return onPinch(e);
    }
    if (!graphOpen || !(e.target instanceof Node) || !gsvg.contains(e.target)) return; // the chat scrolls as usual
    e.preventDefault();
    if (e.metaKey) return zoomGraph(e);
    hidePop(); // plain scroll pans
    view.tx -= e.deltaX;
    view.ty -= e.deltaY;
    drawSoon();
  },
  { passive: false, capture: true },
);
window.addEventListener('resize', drawSoon);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && graphOpen) openGraph(false);
});

api.onGraph((g) => {
  graph = g;
  byNode = new Map(g.nodes.map((n) => [n.id, n]));
  renderChat(); // the version switchers under replies come from the graph
  drawSoon();
});
api.onToggleGraph(() => openGraph(!graphOpen));
byId('graphbtn').addEventListener('click', () => openGraph(!graphOpen));
byId('graphclose').addEventListener('click', () => openGraph(false));

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

  // Time bar: the used time fills in from the left edge; full = time is up. No time text.
  add(add(box, 'div', 'timer-track'), 'div', 'timer-fill');
  add(box, 'div', 'queue');
}

/** Time bar of the card on screen, and how many cards wait behind it. */
function tick(): void {
  const head = cards[0];
  if (!head) return;
  const t = timeLeft(head.expires, Date.now());
  if (t.level === 'expired' && !head.expired) {
    head.expired = true; // the main process sends the same at the same moment
    showTerm(true);
    renderCards();
    return;
  }
  const fill = cardBox.querySelector('.timer-fill') as HTMLElement | null;
  if (fill) {
    fill.style.width = `${(1 - t.fraction) * 100}%`;
    fill.style.backgroundColor = t.level === 'normal' ? 'var(--muted-text)' : 'var(--t-bad)';
  }
  const queue = cardBox.querySelector('.queue');
  if (queue) queue.textContent = cards.length > 1 ? `${cards.length - 1} more waiting` : '';
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
  growInput();
  input.focus();
  showNote('Retry: Claude was not ready, so nothing was sent. Your message is in the box below. Press Enter to send it.', 20000);
});

// Scroll position per session, while the app runs (-1: was at the bottom).
const scrollPos = new Map<string, number>();
api.onChat((c) => {
  const switched = c.session !== chat.session;
  if (switched && chat.session) scrollPos.set(chat.session, stick ? -1 : messages.scrollTop);
  chat = c;
  sent = false;
  if (switched) {
    const at = scrollPos.get(c.session) ?? -1;
    stick = at < 0 || !!wantReply;
    renderChat();
    if (!stick) messages.scrollTop = at;
  } else renderChat();
  if (centerEl.style.opacity === '0' && !wantReply && !trip) {
    clearTimeout(revealTimer); // the reply moved into is on screen
    centerEl.style.opacity = '';
  }
});

// ---- composer: the text box, attachment chips and one row of controls. Enter sends, Shift+Enter
// makes a new line. Only the user's own key or click sends, stops or changes anything. ----
const input = byId('input') as HTMLTextAreaElement;
const sendBtn = byId('send') as HTMLButtonElement;
const composer = byId('composer');
let chips: Chip[] = [];
let opts: AppSettings = { zoom: 1, model: '', effort: '', mode: '', toolsOpen: false, showAccount: true, modeNow: null, effortNow: null };
const SEND_ICON = ['M8 13V3', 'M3.5 7.5 8 3l4.5 4.5'];
const STOP_ICON = ['M4.5 4.5h7v7h-7z'];
const X_ICON = ['m4.5 4.5 7 7M11.5 4.5l-7 7'];
const CHECK_ICON = ['m3.5 8.5 3 3 6-7'];
const DOWN_ICON = ['m4 6 4 4 4-4'];

/** The round button: Send while there is something to send, Stop while Claude works and the box is empty. */
function updateSend(): void {
  const has = !!input.value.trim() || chips.length > 0;
  const stop = busy() && !has;
  sendBtn.replaceChildren();
  icon(sendBtn, stop ? STOP_ICON : SEND_ICON, 16, 1.8);
  sendBtn.disabled = !has && !stop;
  sendBtn.title = stop ? 'Stop (Esc)' : 'Send (Enter). Shift+Enter makes a new line.';
  sendBtn.setAttribute('aria-label', stop ? 'Stop' : 'Send');
}
function growInput(): void {
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight}px`;
  updateSend();
}
function sendInput(): void {
  if (!input.value.trim() && !chips.length) return;
  lastSent = buildMessage(input.value, chips); // attachments go as paths only; Claude Code reads the files
  api.send(lastSent);
  input.value = '';
  chips = [];
  renderChips();
  growInput();
  sent = true;
  stick = true;
  renderChat();
}
input.addEventListener('input', growInput);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && e.shiftKey) {
    e.preventDefault(); // Claude Code's own key for the next mode
    if (!busy()) api.nextMode();
  } else if (e.key === 'Escape') {
    if (!byId('popover').hidden) closePopover();
    else if (busy()) api.stop();
  } else if (sendsOnKey(e.key, e.shiftKey, e.isComposing, input.value || (chips.length ? 'x' : ''))) {
    e.preventDefault();
    sendInput();
  }
});
sendBtn.addEventListener('click', () => (busy() && !input.value.trim() && !chips.length ? api.stop() : sendInput()));

// ---- attachments: chips above the text box. The app only learns each file's path and size. ----
function renderChips(): void {
  const box = byId('chips');
  box.replaceChildren();
  for (const c of chips) {
    const warn = chipWarning(c);
    const el = add(box, 'span', 'chip' + (warn ? ' warn' : ''));
    el.title = `${c.path}${warn ? `\n${warn}` : ''}`;
    add(el, 'span', 'chipname').textContent = c.name;
    add(el, 'span', 'chipsize').textContent = c.dir ? 'folder' : sizeText(c.size);
    const x = add(el, 'button', 'chipx');
    x.setAttribute('aria-label', `Remove ${c.name}`);
    icon(x, X_ICON, 12, 1.6);
    x.addEventListener('click', () => {
      chips = chips.filter((k) => k !== c);
      renderChips();
    });
  }
  updateSend();
}
function addFiles(more: Chip[]): void {
  const before = chips.length;
  chips = addChips(chips, more);
  if (chips.length - before < more.filter((m) => !chips.slice(0, before).some((c) => c.path === m.path)).length) showNote(`At most ${MAX_CHIPS} files per message.`, 6000);
  renderChips();
  input.focus();
}
const pickFiles = () => void api.pickFiles().then(addFiles);
byId('attach').addEventListener('click', pickFiles);
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  composer.classList.add('dropping');
});
window.addEventListener('dragleave', (e) => !e.relatedTarget && composer.classList.remove('dropping'));
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  composer.classList.remove('dropping');
  const paths = Array.from(e.dataTransfer?.files ?? []).map((f) => api.pathOf(f)).filter(Boolean);
  if (paths.length) void api.statFiles(paths).then(addFiles);
});
// A pasted image is saved into the project's attachments/ folder first, so it has a path to send.
input.addEventListener('paste', (e) => {
  const images = Array.from(e.clipboardData?.items ?? []).filter((i) => i.kind === 'file' && i.type in PASTE_TYPES);
  if (!images.length) return; // text pastes as usual
  e.preventDefault();
  for (const item of images) {
    const file = item.getAsFile();
    if (!file) continue;
    void file.arrayBuffer().then((buf) => api.savePaste(new Uint8Array(buf), item.type)).then((c) => (c ? addFiles([c]) : showNote('The pasted image could not be saved.', 6000)));
  }
});

// ---- pickers: mode, thinking, model, skills. Small lists that open above their button. ----
const MODE_NAMES: [string, string, string][] = [
  ['manual', 'Ask', 'Asks before edits and commands'],
  ['acceptEdits', 'Accept edits', 'Edits files without asking; still asks for commands'],
  ['plan', 'Plan', 'Reads and plans; changes nothing'],
  ['auto', 'Auto', 'Decides by itself when to ask'],
];
const EFFORT_NAMES: [string, string][] = [['', 'Default'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']];
const MODEL_NAMES: [string, string][] = [['', 'Default'], ['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']];
const popover = byId('popover');
let popFor = '';

function closePopover(): void {
  popover.hidden = true;
  popFor = '';
  for (const b of Array.from(document.querySelectorAll('.ctl.open'))) b.classList.remove('open');
}
function popItem(label: string, desc: string, on: boolean, click: () => void): HTMLElement {
  const b = add(popover, 'button', 'popitem' + (on ? ' on' : ''));
  icon(add(b, 'span', 'popcheck'), CHECK_ICON, 13, 1.8);
  const main = add(b, 'span', 'popmain');
  add(main, 'div').textContent = label;
  if (desc) add(main, 'div', 'popdesc').textContent = desc;
  b.addEventListener('click', click);
  return b;
}
const pick = (patch: object) => () => {
  closePopover();
  api.setOptions(patch);
  input.focus();
};

function openPicker(kind: string): void {
  if (popFor === kind) return closePopover();
  const btn = byId(kind === 'effort' ? 'effortbtn' : kind === 'model' ? 'modelbtn' : kind === 'skills' ? 'skillsbtn' : 'modebtn');
  if (btn.getAttribute('aria-disabled') === 'true') return showNote(btn.title, 5000);
  closePopover();
  popFor = kind;
  btn.classList.add('open');
  popover.replaceChildren();
  if (kind === 'mode') {
    add(popover, 'div', 'poptitle').textContent = 'Mode (Shift+Tab for the next one)';
    for (const [id, label, desc] of MODE_NAMES) popItem(label, desc, (opts.modeNow ?? opts.mode) === id, pick({ mode: id }));
    if (opts.modeNow === 'other') add(popover, 'div', 'popnote').textContent = 'Claude Code is in a mode this app does not offer. Change it in the terminal (Cmd+J).';
  } else if (kind === 'effort') {
    add(popover, 'div', 'poptitle').textContent = 'Thinking (Claude Code effort)';
    for (const [id, label] of EFFORT_NAMES) popItem(label, id === '' ? "Claude Code's own setting" : '', opts.effort === id, pick({ effort: id }));
    add(popover, 'div', 'popnote').textContent = 'Higher levels think longer and use more of your limit. Changing it restarts Claude Code on this chat.';
  } else if (kind === 'model') {
    add(popover, 'div', 'poptitle').textContent = 'Model';
    for (const [id, label] of MODEL_NAMES) popItem(label, id === '' ? "Claude Code's own setting" : '', opts.model === id, pick({ model: id }));
    const other = add(popover, 'input', 'popinput') as HTMLInputElement;
    other.placeholder = 'Other: a full model name, then Enter';
    if (opts.model && !MODEL_NAMES.some(([id]) => id === opts.model)) other.value = opts.model;
    other.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (!/^[A-Za-z0-9][A-Za-z0-9._\-\[\]]{0,79}$/.test(other.value.trim())) return showNote('A model name has only letters, digits, dots, dashes and brackets.', 6000);
      pick({ model: other.value.trim() })();
    });
    add(popover, 'div', 'popnote').textContent = chat.model ? `The last reply was written by ${chat.model}. Changing the model restarts Claude Code on this chat.` : 'Changing the model restarts Claude Code on this chat.';
  } else {
    add(popover, 'div', 'poptitle').textContent = 'Skills';
    add(popover, 'div', 'popnote').textContent = 'Loading…';
    void api.skillsList().then((list) => popFor === 'skills' && drawSkills(list, ''));
  }
  const r = btn.getBoundingClientRect();
  const wrap = byId('composerwrap').getBoundingClientRect();
  popover.hidden = false;
  popover.style.left = `${Math.max(8, Math.min(r.left - wrap.left, wrap.width - popover.offsetWidth - 8))}px`;
  popover.style.bottom = `${wrap.bottom - r.top + 6}px`;
}

function drawSkills(list: SkillInfo[], error: string): void {
  popover.replaceChildren();
  add(popover, 'div', 'poptitle').textContent = `Skills Claude Code can see (${list.length})`;
  if (error) add(popover, 'div', 'popnote err').textContent = error;
  if (!list.length) add(popover, 'div', 'popnote').textContent = 'None found in this project or your home folder.';
  for (const s of list) {
    const row = add(popover, 'div', 'popitem');
    const main = add(row, 'span', 'popmain');
    add(main, 'div').textContent = s.name;
    if (s.description) add(main, 'div', 'popdesc').textContent = s.description;
    main.title = `${s.description}\nClick to put /${s.name} in the message box.`;
    main.addEventListener('click', () => {
      input.value = `/${s.name} ${input.value}`;
      closePopover();
      growInput();
      input.focus();
    });
    add(row, 'span', 'poptag').textContent = s.where;
    const sw = add(row, 'button', 'switch' + (s.on ? ' on' : '')) as HTMLButtonElement;
    sw.disabled = !s.canSwitch;
    sw.title = !s.canSwitch ? 'Comes from a plugin: managed outside this project' : s.on ? 'On in this project. Click to turn it off.' : 'Off in this project. Click to turn it on.';
    sw.setAttribute('aria-label', `${s.name} ${s.on ? 'on' : 'off'}`);
    sw.addEventListener('click', () => void api.skillSwitch(s.name, !s.on).then((r) => popFor === 'skills' && drawSkills(r.skills, r.error)));
  }
  popItem('Add from a folder…', 'Copies a skill folder (with a SKILL.md) into this project', false, () => void api.skillAdd().then((r) => popFor === 'skills' && drawSkills(r.skills, r.error)));
  add(popover, 'div', 'popnote').textContent = 'On/off is saved for this project only and applies to new chats, or after Claude Code restarts on this one.';
}

/** Button labels: what is in force now (read back from Claude Code where it can be). */
function renderControls(): void {
  const why = busy() ? 'Disabled while Claude is working' : '';
  const label = (id: string, text: string, tip: string, warn = false) => {
    const b = byId(id);
    b.replaceChildren();
    add(b, 'span').textContent = text;
    icon(b, DOWN_ICON, 11, 1.6);
    b.title = why || tip;
    b.setAttribute('aria-disabled', String(!!why));
    b.classList.toggle('warn', warn);
  };
  const mode = opts.modeNow ?? opts.mode;
  const modeName = MODE_NAMES.find(([id]) => id === mode)?.[1] ?? (mode === 'other' ? 'Other mode' : 'Mode');
  label('modebtn', modeName, 'Permission mode (Cmd+Shift+P; Shift+Tab for the next one)', mode === 'plan');
  const effort = opts.effortNow ?? opts.effort;
  label('effortbtn', `Thinking: ${effort || 'default'}`, 'Thinking level: Claude Code effort (Cmd+Shift+E)');
  const model = opts.model || chat.model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
  label('modelbtn', model || 'Model', 'Model (Cmd+Shift+M)');
  updateSend();
}
byId('modebtn').addEventListener('click', () => openPicker('mode'));
byId('effortbtn').addEventListener('click', () => openPicker('effort'));
byId('modelbtn').addEventListener('click', () => openPicker('model'));
byId('skillsbtn').addEventListener('click', () => openPicker('skills'));
document.addEventListener('pointerdown', (e) => {
  if (!popover.hidden && e.target instanceof Node && !popover.contains(e.target) && !(e.target as Element).closest?.('.ctl')) closePopover();
});

// ---- zoom badge and settings sheet (Cmd+,) ----
let badgeTimer: number | undefined;
api.onSettings((s) => {
  queueMicrotask(renderAccount); // the "Show account name" switch
  const zoomed = s.zoom !== opts.zoom;
  opts = s;
  if (zoomed) {
    const badge = byId('zoombadge');
    badge.textContent = `${Math.round(s.zoom * 100)}%`;
    badge.hidden = false;
    clearTimeout(badgeTimer);
    badgeTimer = window.setTimeout(() => (badge.hidden = true), 2000);
    placeArtifact();
  }
  renderControls();
  if (!byId('settings').hidden && sheetKind === 'settings') drawSettings();
  renderChat(); // tool steps folded or open
});

let designNow: any = null;
interface Looks {
  now: { accent: string } | 'custom';
  accents: { id: string; label: string; fill: string }[];
}
let looks: Looks | null = null;

/** The Accent row (Settings, and the sidebar menu's flyout). A click sends only a stored name. */
function drawLookRows(row: (title: string, hint: string) => HTMLElement): void {
  if (!looks) return;
  const now = looks.now;
  const custom = now === 'custom';
  const ar = row('Accent', custom ? 'Custom: design.json was edited by hand' : '');
  const dots = add(ar, 'div', 'lookdots');
  for (const a of looks.accents) {
    const b = add(dots, 'button', 'lookdot' + (!custom && now.accent === a.id ? ' on' : '')) as HTMLButtonElement;
    b.style.background = a.fill;
    b.title = a.label;
    b.setAttribute('aria-label', `Accent ${a.label}`);
    b.addEventListener('click', () => api.designSet({ look: { accent: a.id } }));
  }
}

function drawSettings(): void {
  const sheet = byId('sheet');
  sheet.replaceChildren();
  add(sheet, 'h2').textContent = 'Settings';
  const row = (title: string, hint: string) => {
    const r = add(sheet, 'div', 'setrow');
    const t = add(r, 'span');
    t.textContent = title;
    if (hint) add(t, 'span', 'sethint').textContent = hint;
    return r;
  };
  const seg = (r: HTMLElement, items: [string, string][], current: string, click: (id: string) => void) => {
    const s = add(r, 'div', 'seg');
    for (const [id, label] of items) {
      const b = add(s, 'button', id === current ? 'on' : '');
      b.textContent = label;
      b.addEventListener('click', () => click(id));
    }
  };
  const select = (r: HTMLElement, items: [string, string][], current: string, change: (id: string) => void) => {
    const s = add(r, 'select') as HTMLSelectElement;
    for (const [id, label] of items) {
      const o = add(s, 'option') as HTMLOptionElement;
      o.value = id;
      o.textContent = label;
    }
    s.value = current;
    s.addEventListener('change', () => change(s.value));
  };
  const toggle = (r: HTMLElement, on: boolean, click: (on: boolean) => void) => {
    const b = add(r, 'button', 'switch' + (on ? ' on' : ''));
    b.addEventListener('click', () => click(!on));
  };
  const ap = row('Appearance', '');
  seg(ap, [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], designNow?.theme ?? 'system', (theme) => api.designSet({ theme }));
  const rl = add(ap, 'button', 'setlink');
  rl.textContent = 'Reset to default';
  rl.title = 'Cyan, System. Sizes, fonts and panels stay as they are.';
  rl.addEventListener('click', () => api.designSet({ resetLook: true }));
  drawLookRows(row);
  const zoom = row('Text size', 'Cmd+Plus, Cmd+Minus, Cmd+0');
  seg(zoom, [['-1', '−'], ['0', `${Math.round(opts.zoom * 100)}%`], ['1', '+']], '', (d) => api.zoom(+d));
  const busyHint = busy() ? ' Wait until Claude has finished to change these.' : '';
  select(row('Model', 'For new chats and this one.' + busyHint), MODEL_NAMES.some(([id]) => id === opts.model) ? MODEL_NAMES : [...MODEL_NAMES, [opts.model, opts.model]], opts.model, (model) => api.setOptions({ model }));
  select(row('Thinking', "Claude Code's effort level."), EFFORT_NAMES, opts.effort, (effort) => api.setOptions({ effort }));
  select(row('Mode', 'What new chats start in.'), [['', 'Default'], ...MODE_NAMES.map(([id, label]) => [id, label] as [string, string])], opts.mode, (mode) => api.setOptions({ mode }));
  toggle(row('Show tool steps unfolded', ''), opts.toolsOpen, (toolsOpen) => api.setOptions({ toolsOpen }));
  toggle(row('Show account name', 'The email in the chat list'), opts.showAccount !== false, (showAccount) => api.setOptions({ showAccount }));
  toggle(row('Big titles', 'Large title with a soft glow under the cursor'), designNow?.effects?.enabled ?? true, (effects) => api.designSet({ effects }));
  toggle(row('Chat list', ''), designNow?.layout?.sidebar ?? true, (sidebar) => api.designSet({ sidebar }));
  const foot = add(sheet, 'div', 'setfoot');
  const btn = (label: string, click: () => void) => {
    const b = add(foot, 'button', 'setbtn');
    b.textContent = label;
    b.addEventListener('click', click);
  };
  btn('Open project folder', () => api.openFolder());
  btn('Reset design', () => api.resetDesign());
  btn('Done', () => openSettings(false));
  // Not built yet, said plainly so nobody looks for it.
  add(sheet, 'h3', 'setlater').textContent = 'Later';
  const later = add(sheet, 'ul', 'setlaterlist');
  for (const t of ['Your own themes']) add(later, 'li').textContent = t;
}
let sheetKind: 'settings' | 'help' = 'settings';
function openSettings(on: boolean): void {
  sheetKind = 'settings';
  byId('settings').hidden = !on;
  if (on) drawSettings();
  placeArtifact(); // the artifact's view lies above the page: hide it under the sheet
}

// ---- help: help.md shipped with the app, drawn by the reply renderer (same tags and blocks) ----
function openHelp(): void {
  sheetKind = 'help';
  const sheet = byId('sheet');
  sheet.replaceChildren();
  byId('settings').hidden = false;
  placeArtifact();
  void api.helpText().then((text) => {
    if (sheetKind !== 'help' || byId('settings').hidden) return;
    sheet.replaceChildren();
    const doc = add(sheet, 'div', 'claude helpdoc');
    renderMarkdown(doc, text, look);
    finishReply(doc, look);
    const foot = add(sheet, 'div', 'setfoot');
    const done = add(foot, 'button', 'setbtn');
    done.textContent = 'Done';
    done.addEventListener('click', () => openSettings(false));
  });
}

// ---- sidebar bottom: the account row and its menu ----
let account: AccountView = { state: 'unknown', email: '', plan: '' };
let appVersion = '';
void api.appVersion().then((v) => (appVersion = v));
function accountText(): string {
  if (account.state === 'out') return 'Not signed in';
  if (account.state === 'in' && opts.showAccount !== false) return account.email;
  return 'Signed in with Claude Code';
}
function renderAccount(): void {
  const text = accountText();
  byId('accttext').textContent = text;
  byId('acct').title = account.state === 'out' ? 'Run claude in the terminal to sign in' : text;
  byId('accticon').textContent = account.state === 'in' && opts.showAccount !== false ? account.email.charAt(0).toUpperCase() : '';
  if (!byId('acctmenu').hidden) drawAccountMenu();
}
api.onAccount((a) => {
  account = a;
  renderAccount();
});
let flyOpen = false; // the Appearance flyout, kept open while picks redraw the menu
function closeAccountMenu(): void {
  flyOpen = false;
  byId('acctmenu').hidden = true;
  byId('acct').setAttribute('aria-expanded', 'false');
}
function drawAccountMenu(): void {
  const m = byId('acctmenu');
  m.replaceChildren();
  const head = add(m, 'div', 'acchead');
  add(head, 'span', 'accname').textContent = accountText();
  if (account.plan && account.state === 'in') add(head, 'span', 'accplan').textContent = account.plan;
  if (account.state === 'out') add(m, 'div', 'popnote').textContent = 'Run claude in the terminal to sign in.';
  const item = (label: string, click: () => void, hint = '', disabled = false) => {
    const b = add(m, 'button', 'accitem') as HTMLButtonElement;
    add(b, 'span').textContent = label;
    if (hint) add(b, 'span', 'acchint').textContent = hint;
    b.disabled = disabled;
    b.addEventListener('click', click);
    return b;
  };
  item('Settings', () => {
    closeAccountMenu();
    openSettings(true);
  }, 'Cmd+,');
  const th = item('Appearance', () => {
    flyOpen = !flyOpen;
    byId('acctflyout').hidden = !flyOpen;
    th.classList.toggle('open', flyOpen);
  }, '›');
  th.classList.toggle('open', flyOpen);
  const fly = add(m, 'div', 'accflyout');
  fly.id = 'acctflyout';
  fly.hidden = !flyOpen;
  const fr = add(fly, 'div', 'flyrow');
  add(fr, 'span', 'flytitle').textContent = 'Appearance';
  const fs = add(fr, 'div', 'seg');
  for (const [id, label] of [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]) {
    const b = add(fs, 'button', id === (designNow?.theme ?? 'system') ? 'on' : '');
    b.textContent = label;
    b.addEventListener('click', () => api.designSet({ theme: id }));
  }
  drawLookRows((title, hint) => {
    const r = add(fly, 'div', 'flyrow');
    const t = add(r, 'span', 'flytitle');
    t.textContent = title;
    if (hint) add(t, 'span', 'sethint').textContent = hint;
    return r;
  });
  drawUsage(m);
  item('Get help', () => {
    closeAccountMenu();
    openHelp();
  });
  add(m, 'div', 'accsep');
  const foot = add(m, 'div', 'accfoot');
  const link = add(foot, 'button', 'acclink');
  link.textContent = 'Source on GitHub';
  link.addEventListener('click', () => {
    closeAccountMenu();
    api.openSource();
  });
  if (appVersion) add(foot, 'span', 'accver').textContent = `v${appVersion}`;
}
// ---- usage bars, read from Claude Code's /usage screen in the hidden terminal (on opening the menu) ----
let usage: { state: 'idle' | 'reading' | 'ok' | 'unavailable'; limits: UsageLimit[]; at: number; why: string } = { state: 'idle', limits: [], at: 0, why: '' };
function screenLines(): string[] {
  const b = term.buffer.active;
  const out: string[] = [];
  for (let i = Math.max(0, b.length - 200); i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? '');
  return out;
}
async function readUsage(): Promise<void> {
  if (usage.state === 'reading') return;
  if (busy()) {
    usage = { ...usage, state: usage.limits.length ? 'ok' : 'unavailable', why: 'Claude is working; usage is read when it has finished.' };
    return;
  }
  usage = { ...usage, state: 'reading', why: '' };
  if (!(await api.usageOpen())) {
    usage = { ...usage, state: usage.limits.length ? 'ok' : 'unavailable', why: 'Claude Code is busy.' };
    return redrawMenu();
  }
  // Wait until the screen shows the same limits twice in a row (it draws in steps), at most 8 s.
  let last = '';
  let found: UsageLimit[] | null = null;
  for (let t = 0; t < 32; t++) {
    await new Promise((r) => setTimeout(r, 250));
    const now = parseUsage(screenLines());
    const key = JSON.stringify(now);
    if (now && key === last) {
      found = now;
      break;
    }
    last = key;
  }
  api.usageClose();
  usage = found ? { state: 'ok', limits: found, at: Date.now(), why: '' } : { state: 'unavailable', limits: [], at: 0, why: 'The numbers could not be read.' };
  redrawMenu();
}
const redrawMenu = (): void => {
  if (!byId('acctmenu').hidden) drawAccountMenu();
};
function drawUsage(m: HTMLElement): void {
  const box = add(m, 'div', 'usage');
  const head = add(box, 'div', 'usagehead');
  add(head, 'span').textContent = 'Usage';
  if (usage.state === 'reading') add(head, 'span', 'acchint').textContent = 'reading…';
  else if (usage.at) add(head, 'span', 'acchint').textContent = new Date(usage.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (usage.state === 'reading' && !usage.limits.length) {
    for (let i = 0; i < 2; i++) add(add(box, 'div', 'usagerow pending'), 'div', 'usagebar');
    return;
  }
  for (const u of usage.limits) {
    const row = add(box, 'div', 'usagerow');
    const top = add(row, 'div', 'usagetop');
    add(top, 'span', 'usagetitle').textContent = u.title.replace(/^Current /, '').replace(/^week/, 'Week').replace(/^session/, 'Session');
    add(top, 'span', 'usagepct').textContent = `${Math.round(u.percent)}% used`;
    const bar = add(row, 'div', `usagebar ${usageLevel(u.percent)}`);
    bar.setAttribute('role', 'meter');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(Math.round(u.percent)));
    bar.setAttribute('aria-label', u.title);
    add(bar, 'span').style.width = `${u.percent}%`;
    if (u.resets) add(row, 'div', 'usagereset').textContent = `Resets ${u.resets}`;
  }
  if (usage.state === 'unavailable' || usage.why) {
    if (!usage.limits.length) add(box, 'div', 'usagenone').textContent = 'Usage unavailable';
    if (usage.why) add(box, 'div', 'acchint').textContent = usage.why;
    if (!usage.limits.length) {
      const b = add(box, 'button', 'acclink') as HTMLButtonElement;
      b.textContent = 'Open /usage in the terminal';
      b.disabled = busy();
      b.addEventListener('click', () => {
        closeAccountMenu();
        api.showUsage();
      });
    }
  }
}

byId('acct').addEventListener('click', () => {
  const m = byId('acctmenu');
  if (!m.hidden) return closeAccountMenu();
  api.accountRefresh(); // at most once a minute; the answer redraws the row
  void readUsage(); // once per opening, never on a timer
  drawAccountMenu();
  m.hidden = false;
  byId('acct').setAttribute('aria-expanded', 'true');
});
window.addEventListener('pointerdown', (e) => {
  if (!byId('acctmenu').hidden && e.target instanceof Node && !byId('acctwrap').contains(e.target)) closeAccountMenu();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !byId('acctmenu').hidden) closeAccountMenu();
});
byId('settings').addEventListener('pointerdown', (e) => e.target === byId('settings') && openSettings(false));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !byId('settings').hidden) openSettings(false);
});
api.onShortcut((name) => {
  if (name === 'settings') openSettings(byId('settings').hidden);
  else if (name === 'attach') pickFiles();
  else openPicker(name);
});

// ---- chat list: one line per chat. A chat is a root session with all its branches. ----
let chats: ChatRow[] = [];
function renderChats(): void {
  const box = byId('chats');
  box.replaceChildren();
  let group = '';
  for (const c of chats) {
    if (c.group !== group) add(box, 'div', 'chatgroup').textContent = group = c.group;
    const row = add(box, 'button', 'chatrow' + (c.current ? ' current' : '') + (busy() ? ' busy' : ''));
    add(row, 'span', 'chattitle').textContent = c.title;
    if (c.branches) {
      const n = add(row, 'span', 'chatcount');
      icon(n, ICONS.branch, 11);
      add(n, 'span').textContent = String(c.branches);
      n.title = c.branches === 1 ? '1 branch (see the graph)' : `${c.branches} branches (see the graph)`;
    }
    row.title = `${c.full}\n${c.updated ? new Date(c.updated).toLocaleString() : ''}` + (c.current ? '' : busy() ? '\nDisabled while Claude is working' : '');
    row.addEventListener('click', () => {
      if (c.current) return;
      if (busy()) return showNote('Cannot switch chats while Claude is working.', 6000);
      document.body.classList.remove('sideopen');
      api.openSession(c.open);
    });
  }
  byId('chattitle').textContent = chats.find((c) => c.current)?.title ?? '';
  const nc = byId('newchat');
  nc.setAttribute('aria-disabled', String(busy()));
  nc.title = busy() ? 'Disabled while Claude is working' : 'Start a new chat';
}
api.onChats((c) => {
  chats = c;
  renderChats();
});
byId('newchat').addEventListener('click', () => {
  if (busy()) return showNote('Cannot start a new chat while Claude is working.', 6000);
  document.body.classList.remove('sideopen');
  api.newChat();
});
const narrow = window.matchMedia('(max-width: 1000px)');
byId('sidetoggle').addEventListener('click', () => {
  document.body.classList.toggle(narrow.matches ? 'sideopen' : 'sideclosed');
  placeArtifact();
});

// ---- design. Already validated by the main process. Values go in as CSS variables and text nodes only. ----
function apply(d: any, theme: 'light' | 'dark'): void {
  const css = document.body.style;
  const r = d.colors[theme];
  const set = (name: string, value: string) => css.setProperty(name, value);
  set('--bg', r.background);
  set('--surface', r.surface);
  set('--raised', r.raised);
  set('--border', r.border);
  set('--text', r.text);
  set('--muted-text', r.mutedText);
  set('--user-bg', r.userBubble);
  set('--user-fg', r.userText);
  set('--code-bg', r.codeBackground);
  for (const [name, v] of Object.entries(d.colors.tones) as [string, { light: string; dark: string }][]) set(`--t-${name}`, v[theme]);
  set('--accent-fill', r.accentFill);
  set('--accent-on', r.accentOn);
  set('--font-reply', d.fonts.reply);
  set('--font-ui', d.fonts.ui);
  set('--font-code', d.fonts.code);
  set('--body-size', `${d.type.body}px`);
  set('--msg-size', `${d.type.message}px`);
  set('--ui-size', `${d.type.ui}px`);
  set('--small-size', `${d.type.small}px`);
  set('--code-size', `${d.type.code}px`);
  const sp = d.space;
  const spaces: Record<string, number> = {
    exchange: sp.exchange, 'before-h1': sp.beforeH1, 'before-h2': sp.beforeH2, 'before-h3': sp.beforeH3, 'after-heading': sp.afterHeading,
    paragraph: sp.paragraph, list: sp.listItem, block: sp.block, 'block-pad': sp.blockPadding,
  };
  for (const [k, v] of Object.entries(spaces)) set(`--sp-${k}`, `${v}px`);
  for (const h of ['h1', 'h2', 'h3', 'h4', 'fx']) {
    set(`--${h}-size`, `${d.type[h].size}px`);
    set(`--${h}-weight`, `${d.type[h].weight}`);
  }
  set('--chat-width', `${d.layout.chatWidth}px`);
  set('--sidebar-width', `${d.layout.sidebarWidth}px`);
  document.body.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme; // native controls (dropdown lists, scrollbars) follow the app's theme
  document.body.classList.toggle('nosidebar', !d.layout.sidebar);
  look = { ...look, bg: hexToRgb(r.background), effects: d.effects.enabled };
  set('--fx-glow', String(d.effects.glow ?? 0.5));
  term.options.theme = { background: r.codeBackground, foreground: r.text, cursor: d.colors.tones.accent[theme], selectionBackground: r.border };
  term.options.fontSize = d.terminal.fontSize;
  term.options.fontFamily = d.fonts.code;

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

api.onDesign((d, error, info, theme, l) => {
  designNow = d;
  looks = l;
  if (!byId('acctmenu').hidden) drawAccountMenu(); // the flyout's rings
  apply(d, theme);
  if (!byId('settings').hidden && sheetKind === 'settings') drawSettings();
  renderChat(); // colors changed: redraw (old color tags are checked against the background)
  const bar = byId('error');
  bar.textContent = error ? `design.json error (showing last working design): ${error}` : '';
  bar.hidden = !error;
  if (info && !error) showNote(info, 15000);
  refit();
  drawSoon();
});

fit.fit();
api.start(term.cols, term.rows);
input.focus();
