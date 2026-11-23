// Plain script (no imports). Terminal and FitAddon come from <script> tags, api from preload; the
// reply renderer and its helpers (byId, add, svg, icon, renderMarkdown...) from md.ts; the layout tree
// from layout.ts. This file draws one pane (createPane: a chat, its message box, cards and its own hidden
// terminal) and the shell around the panes (chat list, graph, settings, account menu, artifacts).
// workspace.ts lays the panes out and starts the page.
declare const Terminal: any;
declare const FitAddon: any;
declare const api: {
  appStart(): Promise<string | null>;
  paneOpen(pane: string, o: { session?: string; branchOf?: string; cols: number; rows: number }): void;
  paneClose(pane: string): void;
  paneFocus(pane: string): void;
  makeBranch(pane: string): Promise<{ session: string; parent: string } | { error: string }>;
  saveWorkspace(ws: LWorkspace): void;
  onPaneTitles(cb: (t: Record<string, PaneTitle>) => void): void;
  onPaneModes(cb: (pane: string, mode: string | null, effort: string | null) => void): void;
  onFocusPane(cb: (pane: string) => void): void;
  write(pane: string, data: string): void;
  resize(pane: string, cols: number, rows: number): void;
  send(pane: string, text: string): void;
  onData(cb: (pane: string, data: string) => void): void;
  onDesign(cb: (design: any, error: string | null, info: string | null, theme: 'light' | 'dark', looks: Looks) => void): void;
  onChats(cb: (chats: ChatRow[]) => void): void;
  newChat(pane: string): void;
  pathOf(file: File): string;
  pickFiles(): Promise<Chip[]>;
  statFiles(paths: string[]): Promise<Chip[]>;
  savePaste(bytes: Uint8Array, mime: string): Promise<Chip | null>;
  stop(pane: string): void;
  stopScreen(pane: string, lines: string[]): void;
  renameChat(id: string, name: string): void;
  edit(pane: string, replyId: string, text: string): void;
  setOptions(pane: string, patch: object): void;
  nextMode(pane: string): void;
  zoom(dir: number): void;
  onSettings(cb: (s: AppSettings) => void): void;
  onShortcut(cb: (name: string) => void): void;
  skillsList(): Promise<SkillInfo[]>;
  skillSwitch(name: string, on: boolean): Promise<{ skills: SkillInfo[]; error: string }>;
  skillAdd(): Promise<{ skills: SkillInfo[]; error: string }>;
  designSet(patch: object): void;
  onAccount(cb: (a: AccountView) => void): void;
  accountRefresh(): void;
  showUsage(pane: string): void;
  usageOpen(pane: string): Promise<boolean>;
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
  onChat(cb: (pane: string, chat: ChatView) => void): void;
  onToggleTerm(cb: () => void): void;
  branch(pane: string, replyId?: string, from?: string): void;
  retry(pane: string, replyId: string): void;
  copy(text: string): void;
  onNote(cb: (pane: string, text: string) => void): void;
  onPrefill(cb: (pane: string, text: string, why?: string) => void): void;
  openSession(pane: string, id: string): void;
  onGraph(cb: (pane: string, graph: GraphData) => void): void;
  onToggleGraph(cb: () => void): void;
  onTermReset(cb: (pane: string) => void): void;
  onCards(cb: (pane: string, cards: Card[]) => void): void;
  wheelLog: boolean;
  logWheel(line: string): void;
  onShowTerm(cb: (pane: string, why: string) => void): void;
  onCheckQuestion(cb: (pane: string) => void): void;
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
  items: { role: string; text: string; reply?: number; uuid?: string }[];
  replies?: { id: string; copy: string; branch: boolean; retry: boolean }[];
  working: boolean;
  canBranch?: boolean;
  live?: boolean; // this chat runs in the pane's terminal (false: a chat that is only shown)
  elsewhere?: boolean;
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
  seenDefault: string; // Claude Code's own default model, from its banner ('' = not seen yet)
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
  current: boolean; // shown in the focused pane
  named: boolean; // a name the user gave it here
  name: string; // the title before it was cut to fit
  running?: boolean; // its claude is working now
  panes?: string[]; // panes that show one of its sessions
}
interface PaneTitle {
  title: string;
  branchOf: string; // title of the chat this pane was branched from ('' if none)
  chat: string; // root session of its chat (the chat list's id)
  named: string; // the name given to this session in the app
}
/** One pane: a chat with its own claude, as the shell and workspace.ts see it. */
interface PaneView {
  id: string;
  el: HTMLElement;
  chat: ChatView;
  graph: GraphData;
  title: PaneTitle;
  busy(): boolean;
  onChat(c: ChatView): void;
  onData(d: string): void;
  termReset(): void;
  setCards(c: Card[]): void;
  showTerm(on: boolean): void;
  termShown(): boolean;
  checkQuestion(): void;
  prefill(text: string, why?: string): void;
  note(text: string, ms: number): void;
  setGraph(g: GraphData): void;
  setModes(mode: string | null, effort: string | null): void;
  setTitle(t: PaneTitle): void;
  render(): void;
  refit(): void;
  focusInput(): void;
  openPicker(kind: string): void;
  pickFiles(): void;
  addFiles(more: Chip[]): void;
  screenLines(): string[];
  showReply(reply: string): void;
  quote(shown: HTMLElement, text: string): void;
  theme(d: any, theme: 'light' | 'dark'): void;
  termSize(): { cols: number; rows: number };
  /** Before the pane's element is moved: returns what puts its scroll position back afterwards. */
  holdScroll(): () => void;
  destroy(): void;
}

// ---- shell state shared by all panes ----
const panes = new Map<string, PaneView>();
let focusId = '';
/** True while a divider between panes is dragged (workspace.ts): the terminals keep their size until the
 *  drag ends, so claude gets one resize, not one per frame. */
let holdFit = false;
/** The focused pane (the one the menus, the graph, Cmd+J and the chat list act on). */
const fp = (): PaneView | undefined => panes.get(focusId) ?? panes.values().next().value;
let look: MdOptions = { bg: [255, 255, 255], effects: true, copy: (t) => api.copy(t), saveDrawing: (svg, name) => api.saveDrawing(svg, name) };
let opts: AppSettings = { zoom: 1, model: '', effort: '', mode: '', toolsOpen: false, showAccount: true, seenDefault: '' };
let designNow: any = null;
let themeNow: 'light' | 'dark' = 'light';
const openTools = new Set<string>(); // tool lines the user unfolded, as "session:item index"
const scrollPos = new Map<string, number>(); // scroll position per session while the app runs (-1: at the bottom)
const busy = () => !!fp()?.busy(); // the focused pane's claude is working
/** A note in the focused pane's message area. */
const showNote = (text: string, ms: number) => fp()?.note(text, ms);

const CHEVRON = ['m6 3.5 4.5 4.5L6 12.5'];
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const ICONS: Record<string, string[]> = {
  copy: ['M5.5 5.5h7v8h-7z', 'M3.5 10.5v-8h7'],
  retry: ['M13 8a5 5 0 1 1-1.6-3.7', 'M13 2v3h-3'],
  edit: ['M10.5 3 13 5.5 6 12.5H3.5V10z', 'm9 4.5 2.5 2.5'],
  branch: [circle(4.5, 3, 1.5), circle(4.5, 13, 1.5), circle(11.5, 5, 1.5), 'M4.5 4.5v7', 'M11.5 6.5c0 3-7 2.5-7 5'],
  prev: ['M10 3 5 8l5 5'],
  next: ['m6 3 5 5-5 5'],
};
const SEND_ICON = ['M8 13V3', 'M3.5 7.5 8 3l4.5 4.5'];
const STOP_ICON = ['M4.5 4.5h7v7h-7z'];
const X_ICON = ['m4.5 4.5 7 7M11.5 4.5l-7 7'];
const CHECK_ICON = ['m3.5 8.5 3 3 6-7'];
const DOWN_ICON = ['m4 6 4 4 4-4'];
const PEN_ICON = ['M10.5 3 13 5.5 6 12.5H3.5V10z', 'm9 4.5 2.5 2.5'];
const MODE_NAMES: [string, string, string][] = [
  ['manual', 'Ask', 'Asks before edits and commands'],
  ['acceptEdits', 'Accept edits', 'Edits files without asking; still asks for commands'],
  ['plan', 'Plan', 'Reads and plans; changes nothing'],
  ['auto', 'Auto', 'Decides by itself when to ask'],
];
const EFFORT_NAMES: [string, string][] = [['', 'Default'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']];
const MODEL_NAMES: [string, string][] = [['', 'Default'], ['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']];
const PREVIEW_LINES = 40;
const head = (s: string) => s.split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 30);

/** A small icon button; `off` is why it is disabled ('' = enabled). `isBusy`: the pane's claude works. */
function iconButton(row: HTMLElement, name: string, tip: string, off: string, onClick: (b: HTMLElement) => void, isBusy: () => boolean = busy): void {
  const b = add(row, 'button', 'act');
  b.setAttribute('aria-label', name);
  b.setAttribute('aria-disabled', String(!!off)); // not "disabled", so the tooltip still shows on hover
  b.title = off || tip;
  icon(b, ICONS[name]);
  b.addEventListener('click', () => {
    if (b.getAttribute('aria-disabled') !== 'true' && !isBusy()) onClick(b);
  });
}

/** Replies that stand beside this one in the graph: a Retry and the reply it replaced, or branches from the same point. */
function siblingsOf(g: GraphData, replyId: string): { all: GNode[]; at: number } | null {
  const n = g.nodes.find((x) => x.reply === replyId);
  if (!n) return null;
  const root = n.beside ?? n.id;
  const all = g.nodes
    .filter((m) => (n.parent !== null ? m.parent === n.parent : m.parent === null && (m.id === root || m.beside === root)))
    .sort((a, b) => a.created.localeCompare(b.created));
  return all.length > 1 ? { all, at: all.indexOf(n) } : null;
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

// =====================================================================================================
// One pane. Everything a chat needs lives in here, so panes never share state: each has its own chat,
// message box, cards, live preview and hidden terminal, and works while another pane is focused.
// =====================================================================================================
function createPane(id: string): PaneView {
  const tpl = byId('panetpl') as HTMLTemplateElement;
  const el = (tpl.content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
  el.dataset.pane = id;
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => el.querySelector(sel) as T;
  const messages = q('.messages');
  const itemsEl = q('.items');
  const input = q<HTMLTextAreaElement>('.input');
  const sendBtn = q<HTMLButtonElement>('.send');
  const composer = q('.composer');
  const composerwrap = q('.composerwrap');
  const popover = q('.popover');
  const cardBox = q('.cards');
  const noteEl = q('.note');
  const jump = q('.jump');
  const rail = q('.rail');
  const workingEl = q('.working');
  const termEl = q('.term');

  let chat: ChatView = { session: '', model: '', items: [], working: false };
  let graph: GraphData = { nodes: [], current: null, session: '', error: null };
  let title: PaneTitle = { title: 'New chat', branchOf: '', chat: '', named: '' };
  let modeNow: string | null = null; // read back from Claude Code's status line
  let effortNow: string | null = null;
  let sent = false; // the user just pressed Enter and the session file has not caught up yet
  let stick = true; // keep the newest message in view unless the user scrolled up
  const isBusy = () => sent || chat.working;

  // ---- its terminal: hidden by default (off-screen at a real size); Cmd+J shows the focused pane's ----
  const term = new Terminal({ fontFamily: 'Menlo, monospace' });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(termEl);
  term.onData((d: string) => api.write(id, d));
  let lastSize = '';
  function refit(): void {
    if (!termEl.isConnected || termEl.clientWidth < 20 || termEl.clientHeight < 20) return; // parked or not laid out
    try {
      fit.fit();
    } catch {
      return;
    }
    const key = `${term.cols}x${term.rows}`;
    if (key !== lastSize) {
      lastSize = key;
      api.resize(id, term.cols, term.rows);
    }
  }
  function showTerm(on: boolean): void {
    el.classList.toggle('showterm', on);
    refit();
    if (on) term.focus();
    else input.focus();
  }
  function screenLines(): string[] {
    const b = term.buffer.active;
    const out: string[] = [];
    for (let i = Math.max(0, b.length - 200); i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? '');
    return out;
  }

  // ---- chat view ----
  const toBottom = () => {
    if (stick) messages.scrollTop = messages.scrollHeight;
  };
  let scrollFrame = 0;
  messages.addEventListener('scroll', () => {
    const below = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
    stick = below < 40;
    jump.hidden = below < messages.clientHeight; // more than one screen up
    if (!scrollFrame) scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      updateRail();
    });
  });
  // The jump arrow sits beside the message box when the chat area has room for it there, else on the box's edge.
  function placeJump(): void {
    const margin = (composerwrap.clientWidth - composer.offsetWidth) / 2; // free space right of the box
    const tight = margin < 34 + 16 + 8; // button, its gap to the pane edge, and air beside the box
    jump.classList.toggle('tight', tight);
    jump.style.setProperty('--jump-right', `${Math.max(8, margin + 14)}px`);
  }
  new ResizeObserver(placeJump).observe(composerwrap);
  jump.addEventListener('click', () => {
    stick = true;
    messages.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' });
  });
  new ResizeObserver(toBottom).observe(messages); // pane or terminal strip resized
  new ResizeObserver(toBottom).observe(itemsEl); // content grew (new message, fonts loaded)
  let fitFrame = 0;
  new ResizeObserver(() => {
    if (!fitFrame) fitFrame = requestAnimationFrame(() => {
      fitFrame = 0;
      if (!holdFit) refit();
      updateRail();
    });
  }).observe(el);

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
    const keep = stick;
    itemsEl.replaceChildren();
    // Claude's side of each exchange goes in one .reply box, with the action row under its last item.
    const groups = new Map<number, HTMLElement>();
    const lastOf = new Map<number, number>();
    chat.items.forEach((item, i) => item.reply !== undefined && lastOf.set(item.reply, i));
    chat.items.forEach((item, i) => {
      let parent = itemsEl;
      if (item.reply !== undefined) {
        if (!groups.has(item.reply)) {
          const g = add(itemsEl, 'div', 'reply');
          g.dataset.reply = chat.replies?.[item.reply]?.id ?? '';
          groups.set(item.reply, g);
        }
        parent = groups.get(item.reply)!;
      }
      const names = item.role === 'tool' ? toolNames(item.text) : null;
      if (names) toolLine(parent, names, `${chat.session}:${i}`);
      else if (item.role === 'artifact') artifactCard(parent, item.text);
      else if (item.role === 'user') userMessage(item.text, chat.replies?.find((r) => r.id === item.uuid));
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
    if (pending) userMessage(pending.text, undefined);
    workingEl.hidden = !isBusy();
    workingEl.lastElementChild!.textContent = 'Claude is working. If nothing happens, press Cmd+J to see the terminal.';
    renderControls();
    const before = !!livePreview;
    readPreview();
    if (before && !livePreview) Array.from(itemsEl.querySelectorAll('.claude')).at(-1)?.classList.add('landed'); // the real text took the preview's place
    stick = keep;
    toBottom();
    scrollToReply();
    renderHead();
    railFor = null;
    updateRail();
  }

  // ---- live preview: the reply as it grows on Claude Code's (hidden) terminal. Plain text only, and
  // only until the finished block arrives in the session file, which stays the one record. ----
  let livePreview = '';
  let previewTimer = 0;
  let lastSent = ''; // the message just typed, until the session file has it
  // The message just sent, drawn as a bubble at once; Claude Code writes it to the session file only when
  // it starts on it. Dropped when the file has it, or when it comes back to the box (not sent / stopped).
  let pending: { text: string; session: string; users: number } | null = null;
  const userCount = (c: ChatView) => c.items.filter((i) => i.role === 'user').length;
  function pendingInFile(c: ChatView): boolean {
    if (!pending) return true;
    return c.session === pending.session ? userCount(c) > pending.users : userCount(c) > 0;
  }
  function readPreview(): void {
    previewTimer = 0;
    let next = '';
    if (isBusy() && chat.live !== false) { // the terminal holds the running chat only
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
    let pv = itemsEl.querySelector<HTMLElement>(':scope > .preview');
    if (!livePreview) return void pv?.remove();
    if (!pv) pv = add(itemsEl, 'div', 'claude preview');
    else if (itemsEl.lastElementChild !== pv) itemsEl.appendChild(pv);
    pv.replaceChildren();
    // A drawing's SVG source is not shown while it is written: a quiet box of its size holds its place.
    for (const part of drawPreviewParts(livePreview)) {
      if (part.kind === 'draw') drawingPlaceholder(pv, part.width, part.height);
      else for (const para of part.text.split('\n\n')) if (para.trim()) add(pv, 'p').textContent = para;
    }
    toBottom();
  }

  // ---- a message of the user's: the bubble, and Edit under it on hover. Edit opens the text in place;
  // "Send" makes a new branch without this message and what came after, and sends the new text there
  // (like Retry with other words). Nothing is sent until the user clicks Send or presses Enter. ----
  let editing: { id: string; text: string } | null = null;
  function userMessage(text: string, r: { id: string; retry: boolean } | undefined): void {
    const wrap = add(itemsEl, 'div', 'userwrap');
    if (r && editing?.id === r.id) {
      const box = add(wrap, 'div', 'user editing');
      const area = add(box, 'textarea', 'editbox') as HTMLTextAreaElement;
      area.value = editing.text;
      area.setAttribute('aria-label', 'Edit your message');
      const grow = () => {
        area.style.height = 'auto';
        area.style.height = `${area.scrollHeight}px`;
      };
      const row = add(box, 'div', 'editrow');
      add(row, 'span', 'edithint').textContent = 'Sends in a new branch; this version stays in the graph.';
      const cancel = add(row, 'button', 'editbtn') as HTMLButtonElement;
      cancel.textContent = 'Cancel';
      const send = add(row, 'button', 'editbtn primary') as HTMLButtonElement;
      send.textContent = 'Send';
      const check = () => (send.disabled = !area.value.trim() || area.value.trim() === text.trim());
      const go = () => {
        if (send.disabled || isBusy() || !editing) return;
        api.edit(id, editing.id, area.value.trim());
        editing = null;
        renderChat();
      };
      const stop = () => {
        editing = null;
        renderChat();
      };
      area.addEventListener('input', () => {
        if (editing) editing.text = area.value;
        grow();
        check();
      });
      area.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') stop();
        else if (sendsOnKey(e.key, e.shiftKey, e.isComposing, area.value)) {
          e.preventDefault();
          go();
        }
        e.stopPropagation();
      });
      cancel.addEventListener('click', stop);
      send.addEventListener('click', go);
      check();
      requestAnimationFrame(() => {
        grow();
        area.focus();
      });
      return;
    }
    const bubble = add(wrap, 'div', 'user');
    // Leading "> " lines (a quote from Reply): drawn as a quote, the way the reply looked; the rest as text.
    const lines = text.split('\n');
    let n = 0;
    while (n < lines.length && /^>( |$)/.test(lines[n])) n++;
    if (n) {
      renderMarkdown(add(bubble, 'div', 'userquote claude'), lines.slice(0, n).map((l) => l.replace(/^> ?/, '')).join('\n'), look);
      bubble.appendChild(document.createTextNode(lines.slice(n).join('\n').replace(/^\n+/, '')));
    } else bubble.textContent = text;
    if (!r) return;
    const row = add(wrap, 'div', 'actions useracts');
    const off = isBusy() ? 'Disabled while Claude is working' : r.retry ? '' : 'Editing is not possible here';
    iconButton(row, 'edit', 'Edit this message and send it again (in a new branch)', off, () => {
      editing = { id: r.id, text };
      renderChat();
    }, isBusy);
  }

  // ---- Copy / Retry / Branch under a reply. Clicks only ask the main process, which re-checks everything. ----
  function actions(parent: HTMLElement, k: number): void {
    const r = chat.replies?.[k];
    if (!r?.copy) return; // no text of Claude's own (e.g. only a usage-limit notice): no buttons
    const row = add(parent, 'div', 'actions' + (k === chat.replies!.length - 1 ? ' newest' : ''));
    const why = isBusy() ? 'Disabled while Claude is working' : '';
    iconButton(row, 'copy', 'Copy', why, (b) => {
      api.copy(r.copy);
      b.title = 'Copied';
      b.classList.add('done');
    }, isBusy);
    iconButton(row, 'retry', 'Retry: new branch without this reply, then send your message again', why || (r.retry ? '' : 'Retry is not possible here'), () => api.retry(id, r.id), isBusy);
    iconButton(row, 'branch', 'Branch: new branch that ends at this reply, in this pane', why || (r.branch ? '' : 'Branch is not possible here'), () => api.branch(id, r.id), isBusy);
    const sib = siblingsOf(graph, r.id);
    if (!sib) return;
    // Other versions of this reply (a Retry, or branches from the same point): step through them.
    const sw = add(row, 'span', 'switcher');
    const go = (to: number) => () => openNodeIn(view, sib.all[to]);
    iconButton(sw, 'prev', 'Previous version of this reply', why || (sib.at > 0 ? '' : 'This is the first version'), go(sib.at - 1), isBusy);
    add(sw, 'span').textContent = `${sib.at + 1} / ${sib.all.length}`;
    iconButton(sw, 'next', 'Next version of this reply', why || (sib.at < sib.all.length - 1 ? '' : 'This is the last version'), go(sib.at + 1), isBusy);
  }

  // ---- outline rail: the headings of the reply in view, when the pane is wide and the reply long ----
  let railFor: HTMLElement | null = null;
  function updateRail(): void {
    const box = messages.getBoundingClientRect();
    const mid = box.top + box.height / 3;
    const room = window.innerWidth >= 1100 && box.width >= itemsEl.clientWidth + 2 * 190; // space beside the column
    const group = !room ? undefined : Array.from(itemsEl.querySelectorAll<HTMLElement>(':scope > .reply')).find((g) => {
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

  // ---- a reply to scroll to once its chat is on screen (from the graph) ----
  let wantReply = '';
  let scrollUntil = 0;
  function scrollToReply(): void {
    if (!wantReply) return;
    if (Date.now() > scrollUntil) return void (wantReply = '');
    const group = Array.from(itemsEl.querySelectorAll<HTMLElement>(':scope > .reply')).find((g) => g.dataset.reply === wantReply);
    if (!group) return;
    wantReply = '';
    const target = (group.previousElementSibling as HTMLElement | null) ?? group; // the user message above the reply
    target.scrollIntoView({ block: 'start' });
    stick = false;
    group.classList.add('flash');
    setTimeout(() => group.classList.remove('flash'), 1200);
  }

  // ---- permission and question cards. One at a time, oldest first. A click only asks the main
  // process, which checks it against the card; the app never answers by itself. ----
  let cards: Card[] = [];
  let shownCard = ''; // "id|expired" of the card on screen
  let clicked = ''; // id of the card just answered (its buttons are off until it goes)
  let ticker: number | undefined;

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
    const multi = c.questions.some((x) => x.multiSelect);
    let sendAnswers: HTMLButtonElement | null = null;
    for (const qq of c.questions) {
      const qe = add(box, 'div', 'question');
      if (qq.header) add(qe, 'div', 'q-header').textContent = qq.header;
      add(qe, 'div', 'q-text').textContent = qq.question;
      if (qq.multiSelect) add(qe, 'div', 'card-note').textContent = 'Several answers allowed: the app cannot send these. Answer in the terminal.';
      const os = add(qe, 'div', 'q-options');
      for (const o of qq.options) {
        const b = add(os, 'button', 'q-option') as HTMLButtonElement;
        add(b, 'span').textContent = o.label;
        if (o.description) add(b, 'span', 'q-desc').textContent = o.description;
        b.disabled = multi;
        b.addEventListener('click', () => {
          chosen[qq.question] = o.label;
          for (const x of Array.from(os.children)) x.classList.toggle('chosen', x === b);
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
    const first = cards[0];
    if (!first) return;
    const t = timeLeft(first.expires, Date.now());
    if (t.level === 'expired' && !first.expired) {
      first.expired = true; // the main process sends the same at the same moment
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
    const first = cards[0];
    const key = first ? `${first.id}|${first.expired}` : '';
    if (key !== shownCard) {
      shownCard = key;
      cardBox.replaceChildren();
      if (first) buildCard(first);
    }
    renderHead();
    if (!first) {
      clearInterval(ticker); // closed early or answered: the timer stops
      ticker = undefined;
      return;
    }
    ticker ??= window.setInterval(tick, 250);
    tick();
    toBottom();
  }

  let noteTimer: number | undefined;
  function note(text: string, ms: number): void {
    noteEl.textContent = text;
    noteEl.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => (noteEl.hidden = true), ms);
  }

  // ---- composer: the text box, attachment chips and one row of controls. Enter sends, Shift+Enter
  // makes a new line. Only the user's own key or click sends, stops or changes anything. ----
  let chips: Chip[] = [];
  /** The round button: Send while there is something to send, Stop while Claude works and the box is empty. */
  // Quotes (Reply on a selection): shown above the text box as they look in the chat; sent as "> " lines.
  let quotes: { shown: HTMLElement; text: string }[] = [];
  function renderQuotes(): void {
    const box = q('.quotebox');
    box.replaceChildren();
    box.hidden = !quotes.length;
    for (const qt of quotes) {
      const row = add(box, 'div', 'quote');
      add(row, 'div', 'quotebody claude').appendChild(qt.shown.cloneNode(true));
      const x = add(row, 'button', 'quotex');
      x.setAttribute('aria-label', 'Remove this quote');
      x.title = 'Remove this quote';
      icon(x, X_ICON, 12, 1.6);
      x.addEventListener('click', () => {
        quotes = quotes.filter((k) => k !== qt);
        renderQuotes();
      });
    }
    updateSend();
  }
  function updateSend(): void {
    const has = !!input.value.trim() || chips.length > 0 || quotes.length > 0;
    const stop = isBusy() && !has;
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
    if (!input.value.trim() && !chips.length && !quotes.length) return;
    if (isBusy()) return note('Claude is still working in this pane. Send this when it has finished, or press Stop.', 6000);
    // attachments go as paths only; Claude Code reads the files. Quotes go first, as "> " lines.
    lastSent = (quotes.map((k) => quoteText(k.text)).join('') + buildMessage(input.value, chips)).trim();
    quotes = [];
    renderQuotes();
    api.send(id, lastSent);
    pending = { text: lastSent, session: chat.session, users: userCount(chat) };
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
      if (!isBusy()) api.nextMode(id);
    } else if (e.key === 'Escape') {
      if (!popover.hidden) closePopover();
      else if (isBusy()) stopClaude();
    } else if (sendsOnKey(e.key, e.shiftKey, e.isComposing, input.value || (chips.length ? 'x' : ''))) {
      e.preventDefault();
      sendInput();
    }
  });
  sendBtn.addEventListener('click', () => (isBusy() && !input.value.trim() && !chips.length ? stopClaude() : sendInput()));
  /** Stop: Esc in the pane's terminal. Claude Code does not always write that the turn ended, so the pane
   *  then shows the main process the bottom of its screen, a few times, until the chat is no longer busy. */
  function stopClaude(): void {
    api.stop(id);
    let tries = 0;
    const lookAgain = () => {
      if (!isBusy()) return;
      api.stopScreen(id, screenLines().slice(-term.rows));
      if (++tries < 5) setTimeout(lookAgain, 800);
    };
    setTimeout(lookAgain, 900);
  }

  // ---- attachments: chips above the text box. The app only learns each file's path and size. ----
  function renderChips(): void {
    const box = q('.chips');
    box.replaceChildren();
    for (const c of chips) {
      const warn = chipWarning(c);
      const chipEl = add(box, 'span', 'chip' + (warn ? ' warn' : ''));
      chipEl.title = `${c.path}${warn ? `\n${warn}` : ''}`;
      add(chipEl, 'span', 'chipname').textContent = c.name;
      add(chipEl, 'span', 'chipsize').textContent = c.dir ? 'folder' : sizeText(c.size);
      const x = add(chipEl, 'button', 'chipx');
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
    if (chips.length - before < more.filter((m) => !chips.slice(0, before).some((c) => c.path === m.path)).length) note(`At most ${MAX_CHIPS} files per message.`, 6000);
    renderChips();
    input.focus();
  }
  const pickFiles = () => void api.pickFiles().then(addFiles);
  q('.attach').addEventListener('click', pickFiles);
  // A pasted image is saved into the project's attachments/ folder first, so it has a path to send.
  input.addEventListener('paste', (e) => {
    const images = Array.from(e.clipboardData?.items ?? []).filter((i) => i.kind === 'file' && i.type in PASTE_TYPES);
    if (!images.length) return; // text pastes as usual
    e.preventDefault();
    for (const item of images) {
      const file = item.getAsFile();
      if (!file) continue;
      void file.arrayBuffer().then((buf) => api.savePaste(new Uint8Array(buf), item.type)).then((c) => (c ? addFiles([c]) : note('The pasted image could not be saved.', 6000)));
    }
  });

  // ---- pickers: mode, thinking, model, skills. Small lists that open above their button. ----
  let popFor = '';
  function closePopover(): void {
    popover.hidden = true;
    popFor = '';
    for (const b of Array.from(el.querySelectorAll('.ctl.open'))) b.classList.remove('open');
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
    api.setOptions(id, patch);
    input.focus();
  };
  function openPicker(kind: string): void {
    if (popFor === kind) return closePopover();
    const btn = q(kind === 'effort' ? '.effortbtn' : kind === 'model' ? '.modelbtn' : kind === 'skills' ? '.skillsbtn' : '.modebtn');
    if (btn.getAttribute('aria-disabled') === 'true') return note(btn.title, 5000);
    closePopover();
    popFor = kind;
    btn.classList.add('open');
    popover.replaceChildren();
    if (kind === 'mode') {
      add(popover, 'div', 'poptitle').textContent = 'Mode (Shift+Tab for the next one)';
      for (const [mid, label, desc] of MODE_NAMES) popItem(label, desc, (modeNow ?? opts.mode) === mid, pick({ mode: mid }));
      if (modeNow === 'other') add(popover, 'div', 'popnote').textContent = 'Claude Code is in a mode this app does not offer. Change it in the terminal (Cmd+J).';
    } else if (kind === 'effort') {
      add(popover, 'div', 'poptitle').textContent = 'Thinking (Claude Code effort)';
      // Default: what Claude Code's corner shows while no level is picked here.
      const ownEffort = !opts.effort && effortNow ? EFFORT_NAMES.find(([eid]) => eid === effortNow)?.[1] : '';
      for (const [eid, label] of EFFORT_NAMES) popItem(eid === '' && ownEffort ? `Default (${ownEffort})` : label, eid === '' ? "Claude Code's own setting" : '', opts.effort === eid, pick({ effort: eid }));
      add(popover, 'div', 'popnote').textContent = 'Higher levels think longer and use more of your limit. Changing it restarts Claude Code on this chat; other panes take it when they next start.';
    } else if (kind === 'model') {
      add(popover, 'div', 'poptitle').textContent = 'Model';
      const own = opts.seenDefault;
      for (const [mid, label] of MODEL_NAMES)
        popItem(mid === '' && own ? `Default (${own})` : label, mid === '' ? (own ? "Claude Code's own setting, as it named it the last time it started without a model" : "Claude Code's own setting. Its name shows here once Claude Code has started with it.") : '', opts.model === mid, pick({ model: mid }));
      const other = add(popover, 'input', 'popinput') as HTMLInputElement;
      other.placeholder = 'Other: a full model name, then Enter';
      if (opts.model && !MODEL_NAMES.some(([mid]) => mid === opts.model)) other.value = opts.model;
      other.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (!/^[A-Za-z0-9][A-Za-z0-9._\-\[\]]{0,79}$/.test(other.value.trim())) return note('A model name has only letters, digits, dots, dashes and brackets.', 6000);
        pick({ model: other.value.trim() })();
      });
      add(popover, 'div', 'popnote').textContent = (chat.model ? `The last reply was written by ${chat.model}. ` : '') + 'Changing the model restarts Claude Code on this chat; other panes take it when they next start.';
    } else {
      add(popover, 'div', 'poptitle').textContent = 'Skills';
      add(popover, 'div', 'popnote').textContent = 'Loading…';
      void api.skillsList().then((list) => popFor === 'skills' && drawSkills(list, ''));
    }
    const r = btn.getBoundingClientRect();
    const wrap = composerwrap.getBoundingClientRect();
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
    const why = isBusy() ? 'Disabled while Claude is working' : '';
    const label = (sel: string, text: string, tip: string, warn = false) => {
      const b = q(sel);
      b.replaceChildren();
      add(b, 'span').textContent = text;
      icon(b, DOWN_ICON, 11, 1.6);
      b.title = why || tip;
      b.setAttribute('aria-disabled', String(!!why));
      b.classList.toggle('warn', warn);
    };
    const mode = modeNow ?? opts.mode;
    const modeName = MODE_NAMES.find(([mid]) => mid === mode)?.[1] ?? (mode === 'other' ? 'Other mode' : 'Mode');
    label('.modebtn', modeName, 'Permission mode (Cmd+Shift+P; Shift+Tab for the next one)', mode === 'plan');
    const effort = effortNow ?? opts.effort;
    label('.effortbtn', `Thinking: ${effort || 'default'}`, 'Thinking level: Claude Code effort (Cmd+Shift+E)');
    const model = opts.model || chat.model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
    label('.modelbtn', model || 'Model', 'Model (Cmd+Shift+M)');
    updateSend();
  }
  q('.modebtn').addEventListener('click', () => openPicker('mode'));
  q('.effortbtn').addEventListener('click', () => openPicker('effort'));
  q('.modelbtn').addEventListener('click', () => openPicker('model'));
  q('.skillsbtn').addEventListener('click', () => openPicker('skills'));
  document.addEventListener('pointerdown', (e) => {
    if (!popover.hidden && e.target instanceof Node && !popover.contains(e.target) && !(e.target as Element).closest?.('.ctl')) closePopover();
  });

  // ---- title bar: name, "branch of" label, working dots. The buttons are wired by workspace.ts. ----
  function renderHead(): void {
    const t = q('.panetitle');
    if (!t.querySelector('input')) t.textContent = title.title;
    t.title = title.title;
    const br = q('.panebranch');
    br.textContent = title.branchOf ? `branch of ${title.branchOf}` : '';
    br.title = title.branchOf ? `Branched from "${title.branchOf}". The two chats are separate from here on.` : '';
    let dots = el.querySelector('.panehead .chatdots');
    const working = isBusy() || cards.length > 0;
    if (working && !dots) {
      dots = document.createElement('span');
      dots.className = 'chatdots';
      for (let i = 0; i < 3; i++) dots.appendChild(document.createElement('i'));
      br.after(dots);
    } else if (!working) dots?.remove();
    if (dots) dots.setAttribute('aria-label', cards.length ? 'Claude is asking something here' : 'Claude is working here');
  }

  const view: PaneView = {
    id,
    el,
    get chat() {
      return chat;
    },
    get graph() {
      return graph;
    },
    get title() {
      return title;
    },
    busy: isBusy,
    onChat(c) {
      const switched = c.session !== chat.session;
      if (switched && chat.session) scrollPos.set(chat.session, stick ? -1 : messages.scrollTop);
      if (switched) editing = null;
      // Another chat opened in this pane (not the new one the message started): the bubble is not its.
      if (pending && (pendingInFile(c) || (switched && pending.session))) pending = null;
      chat = c;
      sent = false;
      if (switched) {
        const at = scrollPos.get(c.session) ?? -1;
        stick = at < 0 || !!wantReply;
        renderChat();
        if (!stick) messages.scrollTop = at;
        onPaneSession(view);
      } else renderChat();
      if (id === focusId) revealCenter();
    },
    onData(d) {
      term.write(d);
      if (isBusy() && !previewTimer) previewTimer = window.setTimeout(readPreview, 120); // the reply may have grown on the terminal
    },
    termReset: () => term.reset(),
    setCards(c) {
      cards = c;
      renderCards();
    },
    showTerm,
    termShown: () => el.classList.contains('showterm'),
    // Claude Code shows a question in the terminal and no card came for it: if it is still on the screen
    // (bottom rows) and no card is open, show the terminal so the question is not missed.
    checkQuestion() {
      if (cards.length) return;
      const b = term.buffer.active;
      const rows: string[] = [];
      for (let i = Math.max(0, b.length - term.rows); i < b.length; i++) rows.push(b.getLine(i)?.translateToString(true) ?? '');
      if (!/Esc to cancel|Enter to confirm|Enter to select/.test(rows.join('\n'))) return;
      showTerm(true);
      note('Claude is asking something in the terminal. Answer it there.', 10000);
    },
    prefill(t, why) {
      pending = null; // the message is back in the box, so it is not shown as sent
      renderChat();
      if (why === 'stopped') {
        // Stopped before Claude wrote anything: the message comes back here, as Claude Code does in its own box.
        if (!input.value.trim()) input.value = t;
        growInput();
        input.focus();
        return note('Stopped. Your message is back in the box: change it or press Enter to send it again.', 8000);
      }
      input.value = t; // never sent by the app: the user presses Enter
      growInput();
      input.focus();
      note('Claude was not ready, so nothing was sent. Your message is in the box below. Press Enter to send it.', 20000);
    },
    note,
    setGraph(g) {
      graph = g;
      renderChat(); // the version switchers under replies come from the graph
    },
    setModes(m, e) {
      modeNow = m;
      effortNow = e;
      renderControls();
    },
    setTitle(t) {
      title = t;
      renderHead();
    },
    render: renderChat,
    refit,
    focusInput: () => input.focus(),
    openPicker,
    pickFiles,
    addFiles,
    screenLines,
    showReply(reply) {
      wantReply = reply;
      scrollUntil = Date.now() + 15000;
      scrollToReply();
    },
    quote(shown, text) {
      quotes.push({ shown, text });
      renderQuotes();
      input.focus();
    },
    theme(d, th) {
      const r = d.colors[th];
      term.options.theme = { background: r.codeBackground, foreground: r.text, cursor: d.colors.tones.accent[th], selectionBackground: r.border };
      term.options.fontSize = d.terminal.fontSize;
      term.options.fontFamily = d.fonts.code;
    },
    termSize() {
      refit();
      return { cols: term.cols, rows: term.rows };
    },
    holdScroll() {
      const top = messages.scrollTop;
      const keep = stick;
      return () => {
        stick = keep;
        if (keep) messages.scrollTop = messages.scrollHeight;
        else messages.scrollTop = top;
      };
    },
    destroy() {
      clearInterval(ticker);
      clearTimeout(noteTimer);
      term.dispose();
      el.remove();
    },
  };
  if (designNow) view.theme(designNow, themeNow);
  renderChat();
  return view;
}

// ---- messages from the main process, to their pane ('' : the focused pane) ----
const paneFor = (pane: string) => (pane ? panes.get(pane) : fp());
api.onChat((p, c) => paneFor(p)?.onChat(c));
api.onData((p, d) => panes.get(p)?.onData(d));
api.onTermReset((p) => panes.get(p)?.termReset());
api.onCards((p, c) => panes.get(p)?.setCards(c));
api.onCheckQuestion((p) => panes.get(p)?.checkQuestion());
api.onShowTerm((p, why) => {
  const v = paneFor(p);
  if (!v) return;
  v.showTerm(true);
  v.note(why, 10000);
});
api.onNote((p, t) => paneFor(p)?.note(t, 10000));
api.onPrefill((p, t, why) => panes.get(p)?.prefill(t, why));
api.onPaneModes((p, m, e) => panes.get(p)?.setModes(m, e));
api.onPaneTitles((t) => {
  for (const [p, v] of panes) if (t[p]) v.setTitle(t[p]);
  rebuildGraph(); // the chat names above the trees
});
api.onGraph((p, g) => {
  const v = panes.get(p);
  if (!v) return;
  v.setGraph(g);
  rebuildGraph(); // every pane's chat is in the graph view
  if (p === focusId) renderToolbar();
});
api.onToggleTerm(() => {
  const v = fp();
  if (v) v.showTerm(!v.termShown());
});
// Files dropped on the window go to the pane under the pointer.
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
const paneAt = (t: EventTarget | null) => {
  const pe = t instanceof Element ? (t.closest('.pane') as HTMLElement | null) : null;
  return (pe && panes.get(pe.dataset.pane ?? '')) || fp();
};
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  for (const c of Array.from(document.querySelectorAll('.composer.dropping'))) c.classList.remove('dropping');
  paneAt(e.target)?.el.querySelector('.composer')?.classList.add('dropping');
});
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) for (const c of Array.from(document.querySelectorAll('.composer.dropping'))) c.classList.remove('dropping');
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  for (const c of Array.from(document.querySelectorAll('.composer.dropping'))) c.classList.remove('dropping');
  const v = paneAt(e.target);
  const paths = Array.from(e.dataTransfer?.files ?? []).map((f) => api.pathOf(f)).filter(Boolean);
  if (v && paths.length) void api.statFiles(paths).then((c) => v.addFiles(c));
});

// ---- artifact panel ----
const artPanel = byId('artifact');
const artBody = byId('artifactbody');
/** Tell the main process where the artifact's view goes, or to hide it while something covers the panel. */
function placeArtifact(): void {
  const covered = graphOpen || !byId('settings').hidden || !artShown || artShown.type === 'md' || artPanel.hidden || (narrow.matches && document.body.classList.contains('sideopen')) || document.body.classList.contains('panedrag');
  const r = artBody.getBoundingClientRect();
  api.artifactBounds(covered || r.width < 1 || r.height < 1 ? null : { x: r.left, y: r.top, width: r.width, height: r.height });
}
new ResizeObserver(placeArtifact).observe(artBody);
window.addEventListener('resize', placeArtifact);
const renderAll = () => {
  for (const v of panes.values()) v.render();
};
api.onArtifacts((list) => {
  arts = list;
  renderAll(); // the cards show version counts
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

// ---- reply graph (Cmd+G) of the focused pane. One node per reply. Clicks only ask the main process to
// switch or branch; it re-checks everything. Only the nodes in view are drawn. ----
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
function setGraph(g: GraphData): void {
  graph = g;
  byNode = new Map(g.nodes.map((n) => [n.id, n]));
  drawSoon();
}

// The graph view shows every chat open in the workspace: one tree per chat, side by side in the panes'
// layout order, with the chat's name above it. Two panes on the same chat (or on branches of it) share
// one tree. Each pane's own place in its tree is marked; the focused pane's is the current node.
let trees: { title: string; x: number }[] = [];
let paneSpots = new Set<string>(); // the newest reply shown in each pane
function rebuildGraph(): void {
  const f = fp();
  const nodes: GNode[] = [];
  const have = new Set<string>();
  trees = [];
  paneSpots = new Set();
  let col = 0;
  const order = Lay.paneIds(ws.root).map((pid) => panes.get(pid)).filter((v): v is PaneView => !!v);
  for (const v of order) {
    if (v.graph.current) paneSpots.add(v.graph.current);
    if (!v.graph.nodes.length || v.graph.nodes.some((n) => have.has(n.id))) continue; // same chat as a tree already drawn
    const w = Math.max(...v.graph.nodes.map((n) => n.x)) + 1;
    for (const n of v.graph.nodes) {
      have.add(n.id);
      nodes.push({ ...n, x: n.x + col });
    }
    trees.push({ title: v.title.title, x: col });
    col += w + 1; // an empty column between two chats
  }
  setGraph({ nodes, current: f?.graph.current ?? null, session: f?.chat.session ?? '', error: f?.graph.error ?? null });
}
/** The pane a node opens in: the one showing its session, else the focused pane if the node is in its
 *  chat, else a pane on that chat. */
function paneForNode(n: GNode): PaneView | undefined {
  const f = fp();
  const all = [...panes.values()];
  const inChat = (v: PaneView) => v.graph.nodes.some((x) => x.id === n.id);
  return all.find((v) => v.chat.session === n.session) ?? (f && inChat(f) ? f : all.find(inChat)) ?? f;
}

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
  if (trees.length > 1 && view.s > 0.2)
    for (const t of trees) svg(root, 'text', { x: t.x * COLW, y: -16, class: 'gtree' }).textContent = t.title.length > 40 ? t.title.slice(0, 39) + '…' : t.title;
  for (const n of graph.nodes) {
    const p = at(n);
    const qn = n.parent ? byNode.get(n.parent) : undefined;
    if (qn) {
      const a = at(qn);
      if (seen(Math.min(a.x, p.x), a.y, Math.max(a.x, p.x) + NW, p.y + NH)) {
        const ax = a.x + NW / 2;
        const ay = a.y + NH;
        const px = p.x + NW / 2;
        const my = (ay + p.y) / 2;
        svg(lines, 'path', { d: `M${ax} ${ay} C${ax} ${my} ${px} ${my} ${px} ${p.y}`, class: 'gline' });
      }
    }
    if (!seen(p.x, p.y, p.x + NW, p.y + NH)) continue;
    const g = svg(boxes, 'g', { class: 'gnode' + (n.id === graph.current ? ' current' : paneSpots.has(n.id) ? ' here' : ''), 'data-node': n.id });
    svg(g, 'rect', { x: p.x, y: p.y, width: NW, height: NH, rx: 7 });
    if (view.s > 0.35) svg(g, 'text', { x: p.x + 10, y: p.y + 17 }).textContent = shortLabel(n.label || '…');
  }
}

/** Center the view on a node (the current reply when the graph opens), at zoom 1. */
function centerOn(nid: string | null): void {
  const n = (nid && byNode.get(nid)) || graph.nodes[graph.nodes.length - 1];
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

let revealTimer: number | undefined;
/** The chat moved into is on screen: show the workspace again (it was kept out of sight meanwhile). */
function revealCenter(): void {
  if (centerEl.style.opacity === '0' && !trip) {
    clearTimeout(revealTimer);
    centerEl.style.opacity = '';
  }
}
/** Click (or zoom into) a node: show its session in that pane and scroll to the reply. */
function openNodeIn(v: PaneView | undefined, n: GNode): void {
  openGraph(false);
  if (!v) return;
  if (n.session === v.chat.session) return v.showReply(n.reply);
  if (v.busy()) return v.note('Claude is working in this pane. Open the other version when it has finished.', 6000);
  const other = [...panes.values()].find((x) => x !== v && x.chat.session === n.session);
  if (other) {
    focusPaneView(other);
    return other.showReply(n.reply);
  }
  v.showReply(n.reply);
  if (v.id === focusId) {
    // Keep the old chat out of sight until the new one is on screen (onChat shows it again).
    centerEl.style.opacity = '0';
    clearTimeout(revealTimer);
    revealTimer = window.setTimeout(() => (centerEl.style.opacity = ''), 1500);
  }
  api.openSession(v.id, n.session);
}
function openNode(n: GNode): void {
  const v = paneForNode(n);
  if (v && v.id !== focusId) focusPaneView(v); // a reply of another pane's chat opens in that pane
  openNodeIn(v, n);
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
  const target = paneForNode(n);
  const why = target?.busy() ? 'Disabled while Claude is working' : n.canBranch ? '' : 'Branch is not possible here';
  b.disabled = !!why;
  b.title = why || 'New branch that ends at this reply, in the pane of its chat';
  b.addEventListener('click', () => {
    const v = paneForNode(n);
    if (!v || v.busy() || !n.canBranch) return;
    if (v.id !== focusId) focusPaneView(v);
    api.branch(v.id, n.reply, n.session);
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
  const target = paneForNode(hit);
  const switches = !!target && hit.session !== target.chat.session;
  if (switches && target!.busy()) return showNote('Cannot switch sessions while Claude is working in that pane.', 4000);
  const other = switches || (!!target && target.id !== focusId); // the chat behind is not the one moved into
  const p = at(hit);
  trip = { node: hit, fx: view.tx + (p.x + NW / 2) * view.s, fy: view.ty + (p.y + NH / 2) * view.s, fromChat: false, other };
}

// Every wheel event of the window. A trackpad pinch (ctrlKey) never zooms the page: it is the
// continuous zoom between the focused pane's chat and its graph above.
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
api.onToggleGraph(() => openGraph(!graphOpen));
byId('graphbtn').addEventListener('click', () => openGraph(!graphOpen));
byId('graphclose').addEventListener('click', () => openGraph(false));

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
  if (!byId('settings').hidden && sheetKind === 'settings') drawSettings();
  renderAll(); // tool steps folded or open; control labels
});

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
  const seg = (r: HTMLElement, items: [string, string][], current: string, click: (sid: string) => void) => {
    const s = add(r, 'div', 'seg');
    for (const [sid, label] of items) {
      const b = add(s, 'button', sid === current ? 'on' : '');
      b.textContent = label;
      b.addEventListener('click', () => click(sid));
    }
  };
  const select = (r: HTMLElement, items: [string, string][], current: string, change: (sid: string) => void) => {
    const s = add(r, 'select') as HTMLSelectElement;
    for (const [sid, label] of items) {
      const o = add(s, 'option') as HTMLOptionElement;
      o.value = sid;
      o.textContent = label;
    }
    s.value = current;
    s.addEventListener('change', () => change(s.value));
  };
  const toggle = (r: HTMLElement, on: boolean, click: (on: boolean) => void) => {
    const b = add(r, 'button', 'switch' + (on ? ' on' : ''));
    b.addEventListener('click', () => click(!on));
  };
  const pid = fp()?.id ?? '';
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
  select(row('Model', 'For new chats and the focused pane.' + busyHint), MODEL_NAMES.some(([mid]) => mid === opts.model) ? MODEL_NAMES : [...MODEL_NAMES, [opts.model, opts.model]], opts.model, (model) => api.setOptions(pid, { model }));
  select(row('Thinking', "Claude Code's effort level."), EFFORT_NAMES, opts.effort, (effort) => api.setOptions(pid, { effort }));
  select(row('Mode', 'What new chats start in.'), [['', 'Default'], ...MODE_NAMES.map(([mid, label]) => [mid, label] as [string, string])], opts.mode, (mode) => api.setOptions('', { mode }));
  toggle(row('Show tool steps unfolded', ''), opts.toolsOpen, (toolsOpen) => api.setOptions('', { toolsOpen }));
  toggle(row('Show account name', 'The email in the chat list'), opts.showAccount !== false, (showAccount) => api.setOptions('', { showAccount }));
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
  for (const t of ['Your own themes', 'Tabs inside a pane']) add(later, 'li').textContent = t;
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
  const top = add(m, 'div', 'acchead');
  add(top, 'span', 'accname').textContent = accountText();
  if (account.plan && account.state === 'in') add(top, 'span', 'accplan').textContent = account.plan;
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
  for (const [tid, label] of [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]) {
    const b = add(fs, 'button', tid === (designNow?.theme ?? 'system') ? 'on' : '');
    b.textContent = label;
    b.addEventListener('click', () => api.designSet({ theme: tid }));
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
// ---- usage bars, read from Claude Code's /usage screen in an idle pane's hidden terminal (on opening the menu) ----
let usage: { state: 'idle' | 'reading' | 'ok' | 'unavailable'; limits: UsageLimit[]; at: number; why: string } = { state: 'idle', limits: [], at: 0, why: '' };
async function readUsage(): Promise<void> {
  if (usage.state === 'reading') return;
  // the focused pane if it is idle, else any idle pane with a claude running
  const v = [fp(), ...panes.values()].find((x) => x && !x.busy() && x.chat.live);
  if (!v) {
    usage = { ...usage, state: usage.limits.length ? 'ok' : 'unavailable', why: 'Claude is working; usage is read when it has finished.' };
    return;
  }
  usage = { ...usage, state: 'reading', why: '' };
  if (!(await api.usageOpen(v.id))) {
    usage = { ...usage, state: usage.limits.length ? 'ok' : 'unavailable', why: 'Claude Code is busy.' };
    return redrawMenu();
  }
  // Wait until the screen shows the same limits twice in a row (it draws in steps), at most 8 s.
  let last = '';
  let found: UsageLimit[] | null = null;
  for (let t = 0; t < 32; t++) {
    await new Promise((r) => setTimeout(r, 250));
    const now = parseUsage(v.screenLines());
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
  const top = add(box, 'div', 'usagehead');
  add(top, 'span').textContent = 'Usage';
  if (usage.state === 'reading') add(top, 'span', 'acchint').textContent = 'reading…';
  else if (usage.at) add(top, 'span', 'acchint').textContent = new Date(usage.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (usage.state === 'reading' && !usage.limits.length) {
    for (let i = 0; i < 2; i++) add(add(box, 'div', 'usagerow pending'), 'div', 'usagebar');
    return;
  }
  for (const u of usage.limits) {
    const row = add(box, 'div', 'usagerow');
    const ut = add(row, 'div', 'usagetop');
    add(ut, 'span', 'usagetitle').textContent = u.title.replace(/^Current /, '').replace(/^week/, 'Week').replace(/^session/, 'Session');
    add(ut, 'span', 'usagepct').textContent = `${Math.round(u.percent)}% used`;
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
        const v = fp();
        if (v) api.showUsage(v.id);
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

// ---- chat list: one line per chat. A chat is a root session with all its branches. ----
let chats: ChatRow[] = [];
let renaming = ''; // id of the chat whose name is being edited (the list waits to redraw)
/** Edit a name in place of `el`. Enter or leaving the box saves, Esc cancels, empty goes back to its own
 *  title. `rid` is the session the name is for (a chat's root, or a pane's own session). */
function renameIn(el: HTMLElement, rid: string, name: string, inPlace = false): void {
  renaming = rid;
  const box = document.createElement('div');
  box.className = 'chatrow editing';
  const field = add(box, 'input', 'renamebox') as HTMLInputElement;
  field.value = name;
  field.maxLength = 60;
  field.setAttribute('aria-label', 'Chat name');
  field.title = 'Enter saves, Esc cancels. Empty: back to its own title.';
  if (inPlace) el.replaceChildren(field);
  else el.replaceWith(box);
  field.focus();
  field.select();
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    renaming = '';
    const n = field.value.trim();
    if (save && n !== name) api.renameChat(rid, n);
    if (inPlace) el.textContent = save && n ? n : name;
    renderChats();
  };
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
  field.addEventListener('pointerdown', (e) => e.stopPropagation()); // not a pane drag
  field.addEventListener('blur', () => finish(true));
}
function renderChats(): void {
  if (renaming || dragChat) return; // a drag keeps its row (redrawn when the drag ends)
  const box = byId('chats');
  box.replaceChildren();
  let group = '';
  for (const c of chats) {
    if (c.group !== group) add(box, 'div', 'chatgroup').textContent = group = c.group;
    const row = add(box, 'button', 'chatrow' + (c.current ? ' current' : '') + (c.running ? ' running' : ''));
    add(row, 'span', 'chattitle').textContent = c.title;
    if (c.branches) {
      const n = add(row, 'span', 'chatcount');
      icon(n, ICONS.branch, 11);
      add(n, 'span').textContent = String(c.branches);
      n.title = c.branches === 1 ? '1 branch (see the graph)' : `${c.branches} branches (see the graph)`;
    }
    if (c.running) {
      const d = add(row, 'span', 'chatdots');
      d.setAttribute('aria-label', 'Claude is working here');
      for (let i = 0; i < 3; i++) add(d, 'i');
    }
    // Opening a chat only shows it; Claude starts there when you send a message.
    const where = c.panes?.length ? `\nOpen in ${c.panes.length === 1 ? 'a pane' : `${c.panes.length} panes`}` : '';
    row.title = `${c.full}\n${c.updated ? new Date(c.updated).toLocaleString() : ''}` + (c.running ? '\nClaude is working here' : '') + where;
    const pen = add(row, 'span', 'chatpen');
    pen.setAttribute('role', 'button');
    pen.setAttribute('aria-label', 'Rename');
    pen.title = 'Rename';
    icon(pen, PEN_ICON, 12, 1.5);
    pen.addEventListener('click', (e) => {
      e.stopPropagation();
      renameIn(row, c.id, c.name);
    });
    row.addEventListener('click', () => {
      if (c.current) return;
      document.body.classList.remove('sideopen');
      openChat(c.open, c.panes ?? []);
    });
    // Drag the row onto the workspace to open the chat in a new pane there (workspace.ts).
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      if (renaming || !e.dataTransfer) return e.preventDefault();
      e.dataTransfer.setData('application/x-clade-chat', c.open);
      e.dataTransfer.effectAllowed = 'move';
      startChatDrag(c.open);
    });
    row.addEventListener('dragend', endChatDrag);
  }
}
api.onChats((c) => {
  chats = c;
  renderChats();
});
byId('newchat').addEventListener('click', () => {
  document.body.classList.remove('sideopen');
  newChatHere();
});
const narrow = window.matchMedia('(max-width: 1000px)');
// The narrow window's chat list is a drawer over the chats. Crossing the line (leaving full screen, zoom)
// closes it, so it does not come back on top of the chats by itself.
narrow.addEventListener('change', () => {
  document.body.classList.remove('sideopen');
  placeArtifact();
});
// ---- chat list width: drag its right edge (160 to 480 px), arrow keys on the edge, double-click for 240.
// Saved in design.json (layout.sidebarWidth) when the drag ends. ----
const grip = byId('sidegrip');
const sideW = () => parseFloat(getComputedStyle(byId('sidebar')).width); // without the border
function setSideWidth(w: number, save: boolean): void {
  const v = Math.round(Math.min(480, Math.max(160, w)));
  document.body.style.setProperty('--sidebar-width', `${v}px`); // where apply() puts it too
  placeArtifact();
  if (save) api.designSet({ sidebarWidth: v });
}
grip.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  const x0 = e.clientX;
  const w0 = sideW();
  grip.setPointerCapture(e.pointerId);
  grip.classList.add('drag');
  document.body.classList.add('sizing');
  const move = (m: PointerEvent) => setSideWidth(w0 + m.clientX - x0, false);
  const up = (u: PointerEvent) => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.removeEventListener('pointercancel', up);
    grip.classList.remove('drag');
    document.body.classList.remove('sizing');
    setSideWidth(w0 + u.clientX - x0, true);
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', up);
});
grip.addEventListener('dblclick', () => setSideWidth(240, true));
grip.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  setSideWidth(sideW() + (e.key === 'ArrowLeft' ? -16 : 16), true);
});
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
  for (const v of panes.values()) v.theme(d, theme);

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
  themeNow = theme;
  looks = l;
  if (!byId('acctmenu').hidden) drawAccountMenu(); // the flyout's rings
  apply(d, theme);
  if (!byId('settings').hidden && sheetKind === 'settings') drawSettings();
  renderAll(); // colors changed: redraw (old color tags are checked against the background)
  const bar = byId('error');
  bar.textContent = error ? `design.json error (showing last working design): ${error}` : '';
  bar.hidden = !error;
  if (info && !error) showNote(info, 15000);
  for (const v of panes.values()) v.refit();
  drawSoon();
});

// ---- reply with a selection: select text in a chat, a small Reply button shows beside it; a click
// puts the text into that pane's message box as a quote (each line starting with "> "), with the cursor
// after it. Nothing is sent: the user writes the question and presses Enter. ----
const replyBtn = document.createElement('button');
replyBtn.id = 'replysel';
replyBtn.hidden = true;
replyBtn.title = 'Quote this in your next message';
icon(replyBtn, ['M6.5 4 3 7.5 6.5 11', 'M3.5 7.5H9a4 4 0 0 1 4 4V13'], 13, 1.6);
add(replyBtn, 'span').textContent = 'Reply';
document.body.appendChild(replyBtn);
let replyText = '';
let replyPane: PaneView | null = null;
function placeReply(): void {
  const sel = getSelection();
  const text = sel && !sel.isCollapsed ? sel.toString().trim() : '';
  const range = text && sel!.rangeCount ? sel!.getRangeAt(0) : null;
  const node = range?.commonAncestorContainer;
  const el = node ? (node instanceof Element ? node : node.parentElement) : null;
  const items = el?.closest('.items');
  const pe = items?.closest('.pane') as HTMLElement | null | undefined;
  replyPane = (pe && panes.get(pe.dataset.pane ?? '')) || null;
  if (!range || !items || !replyPane) {
    replyBtn.hidden = true;
    replyText = '';
    return;
  }
  const rects = range.getClientRects();
  const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
  const box = (items.closest('.messages') as HTMLElement).getBoundingClientRect();
  if (last.bottom < box.top || last.top > box.bottom) {
    replyBtn.hidden = true; // the end of the selection is scrolled out of view
    return;
  }
  replyText = text;
  replyBtn.hidden = false;
  const w = replyBtn.offsetWidth || 80;
  replyBtn.style.left = `${Math.max(box.left + 4, Math.min(last.right - w / 2, box.right - w - 4))}px`;
  replyBtn.style.top = `${Math.min(last.bottom + 6, box.bottom - 34)}px`;
}
document.addEventListener('selectionchange', () => requestAnimationFrame(placeReply));
document.addEventListener('scroll', () => !replyBtn.hidden && placeReply(), true);
replyBtn.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection while clicking
replyBtn.addEventListener('click', () => {
  const sel = getSelection();
  if (!replyText || !replyPane || !sel?.rangeCount) return;
  const v = replyPane;
  const range = sel.getRangeAt(0).cloneRange();
  // A selection that starts or ends inside a formula takes the whole formula (half a KaTeX tree is noise).
  const mathOf = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest('.katex-display, .katex');
  const m1 = mathOf(range.startContainer);
  const m2 = mathOf(range.endContainer);
  if (m1) range.setStartBefore(m1);
  if (m2) range.setEndAfter(m2);
  const shown = document.createElement('div');
  shown.appendChild(range.cloneContents()); // the app's own drawn nodes: colors, math, code as on screen
  shown.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  shown.querySelectorAll('button, .actions, .preview').forEach((n) => n.remove());
  sel.removeAllRanges();
  replyBtn.hidden = true;
  v.quote(shown, quoteSource(shown) || replyText);
});
/** The text that is sent for a quote: formulas as their TeX between $ signs (KaTeX keeps the source in
 *  its MathML annotation), everything else as the text on screen, with its line breaks. */
function quoteSource(shown: HTMLElement): string {
  const c = shown.cloneNode(true) as HTMLElement;
  c.querySelectorAll('.katex-display, .katex').forEach((k) => {
    if (!c.contains(k)) return; // inside a display formula already replaced
    const tex = k.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    if (!tex) return;
    const block = k.classList.contains('katex-display');
    k.replaceWith(document.createTextNode(block ? `\n$$${tex}$$\n` : `$${tex}$`));
  });
  // innerText needs layout: measure off screen, in the chat column's styles. Not visibility:hidden —
  // innerText skips hidden text, which left it empty and fell back to selection.toString() (KaTeX's
  // MathML, one symbol per line).
  const host = document.createElement('div');
  host.className = 'claude';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:600px;pointer-events:none';
  host.appendChild(c);
  document.body.appendChild(host);
  const text = c.innerText;
  host.remove();
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
