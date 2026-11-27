import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import * as pty from 'node-pty';
import { DEFAULT_DESIGN, Design, designOverrides, PICTURE_NAME, readDesign, resolveTheme, Theme } from './design';
import { CLAUDE_MD, MD_END, MD_OLD_MARKER, MD_START } from './claude-md';
import { buildChats } from './chats';
import { artifactName, mergeAllow } from './artifacts';
import { registerArtifactScheme, startArtifacts } from './artifact-host';
import { ACCENT_NAMES, ACCENTS, applyLook, BACKGROUNDS, BASE, DEFAULT_LOOK, isAccentName, matchLook } from './themes';
import { applySettings, DEFAULT_SETTINGS, Effort, clearBoxKeys, effortInText, MAX_MODE_PRESSES, modelInBanner, Mode, modeInText, MODES, parseSettings, Settings, startFlags, stopScreen, validModel, zoomStep } from './settings';
import { addSkill, listSkills, mergeSkillSwitch } from './skills';
import { Account, NO_NETWORK_PROFILE, parseAuthStatus, UNKNOWN } from './account';
import { execFile } from 'child_process';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pastedName } = require('./composer') as { pastedName(mime: string, when: Date, n: number): string | null };
import { Chat, ChatItem, cutSession, parseSession, settle } from './session';
import { parseNames, setName } from './names';
import { buildGraph, layoutGraph } from './graph';
import { Branch, firstWords, parseBranches, UUID } from './branches';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { Action, answerBody, answeredCalls, CardView, HOOK_MARK, HookInput, makeCard, mergeHook, parseHookInput } from './cards';
import { pickStartFolder, readSavedFolder, saveFolder } from './folder-store';
import { loginShellPath, mergePaths } from './shell-path';

// Opened from the Dock or Spotlight, the app gets macOS's short PATH and would not find `claude`.
if (app.isPackaged) process.env.PATH = mergePaths(loginShellPath(), process.env.PATH);

const WHEEL_LOG = process.env.CLADE_WHEEL_LOG === '1';
registerArtifactScheme();
app.setName('Clade'); // own name and icon; nothing of Claude's is used
const ICON = path.join(__dirname, '..', 'assets', 'icon.png');

let win: BrowserWindow | null = null;
let artifacts: ReturnType<typeof startArtifacts> | null = null;

let folder = '';
let designFile = '';
let current: Design = DEFAULT_DESIGN; // last working design
let error: string | null = null;

let designNote: string | null = null; // e.g. the file is in the old format

function send(): void {
  nativeTheme.themeSource = current.theme; // menus and native controls follow the same theme
  const theme = resolveTheme(current.theme, nativeTheme.shouldUseDarkColors);
  win?.webContents.send('design', current, error, designNote, theme, looks(theme));
  sendPicture();
}

// ---- background picture: a file in the project's backgrounds/ folder, named in design.json. The page
// gets its bytes (and makes a blob: URL of them), so it never loads a file path itself. Sent again only
// when the file or its name changes. ----
const PICTURE_MAX = 25 * 1024 * 1024;
const PICTURE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
let pictureSent = '';
function sendPicture(): void {
  const name = current.background && 'picture' in current.background ? current.background.picture : '';
  const file = name ? path.join(folder, 'backgrounds', name) : '';
  let key = '';
  try {
    const st = file ? fs.statSync(file) : null;
    key = st && st.isFile() && st.size <= PICTURE_MAX ? `${file}:${st.size}:${st.mtimeMs}` : name ? 'missing' : '';
  } catch {
    key = name ? 'missing' : '';
  }
  if (key === pictureSent) return;
  pictureSent = key;
  if (!key || key === 'missing') {
    win?.webContents.send('bg-picture', null, '');
    if (key === 'missing') win?.webContents.send('note', '', `Background picture not found or over 25 MB: backgrounds/${name}`);
    return;
  }
  const mime = PICTURE_TYPES[name.slice(name.lastIndexOf('.') + 1).toLowerCase()];
  win?.webContents.send('bg-picture', new Uint8Array(fs.readFileSync(file)), mime);
}
/** Settings > Background > Picture: the user picks an image; a copy goes into backgrounds/ in the project. */
async function pickPicture(): Promise<void> {
  if (!win) return;
  const r = await dialog.showOpenDialog(win, { title: 'Choose a background picture', properties: ['openFile'], filters: [{ name: 'Pictures', extensions: Object.keys(PICTURE_TYPES) }] });
  if (r.canceled || !r.filePaths[0]) return;
  const src = r.filePaths[0];
  const ext = path.extname(src).slice(1).toLowerCase();
  if (!PICTURE_TYPES[ext]) return;
  if (fs.statSync(src).size > PICTURE_MAX) return void win.webContents.send('note', '', 'That picture is over 25 MB.');
  let base = path.basename(src, path.extname(src)).replace(/[^A-Za-z0-9 ._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 60) || 'background';
  const name = `${base}.${ext}`;
  if (!PICTURE_NAME.test(name)) return;
  fs.mkdirSync(path.join(folder, 'backgrounds'), { recursive: true });
  fs.copyFileSync(src, path.join(folder, 'backgrounds', name));
  pictureSent = ''; // same name, new file: send it again
  writeDesign({ ...structuredClone(current), background: { picture: name } });
}

/** What the Settings rows draw: the stored accents (names, labels, fill colors) and which one the design
 * matches now. Only stored names ever come back from the page. */
function looks(theme: 'light' | 'dark') {
  const now = matchLook(current);
  return {
    now,
    accent: now === 'custom' ? (current.look?.accent ?? DEFAULT_LOOK.accent) : now.accent, // which accent tokens to use
    accents: ACCENT_NAMES.map((id) => ({ id, label: ACCENTS[id].label, fill: ACCENTS[id].fill, fillLight: ACCENTS[id].fillLight ?? ACCENTS[id].fill })),
    backgrounds: BACKGROUNDS.map((b) => ({ id: b.id, label: b.label, color: b.color })),
    overrides: designOverrides(current, theme), // what design.json sets over tokens.css
  };
}

// ---- account row. `claude auth status` reads local state; it runs with all network denied by the
// macOS sandbox, and if that cannot start the row just says "Signed in with Claude Code". ----
const SOURCE_URL = 'https://github.com/mdadfarr/Clade';
const APP_VERSION: string = (() => {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version ?? '');
  } catch {
    return '';
  }
})();
let account: Account = UNKNOWN;
let accountAt = 0;
let accountRunning = false;
function refreshAccount(atStart: boolean): void {
  if (accountRunning || (!atStart && Date.now() - accountAt < 60_000)) return void win?.webContents.send('account', account);
  accountRunning = true;
  accountAt = Date.now();
  const env = { ...process.env } as Record<string, string>;
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_PID']) delete env[k];
  try {
    execFile('/usr/bin/sandbox-exec', ['-p', NO_NETWORK_PROFILE, 'claude', 'auth', 'status'], { timeout: 10_000, maxBuffer: 64 * 1024, env, cwd: os.homedir() }, (err, stdout) => {
      accountRunning = false;
      const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? ((err as unknown as { code: number }).code) : null) : 0;
      account = parseAuthStatus(String(stdout ?? ''), code);
      win?.webContents.send('account', account); // only state, email and plan
    });
  } catch {
    accountRunning = false;
    account = UNKNOWN;
    win?.webContents.send('account', account);
  }
}

function load(): void {
  try {
    const r = readDesign(fs.readFileSync(designFile, 'utf8'));
    current = r.design;
    designNote = r.note;
    error = null;
  } catch (e) {
    error = (e as Error).message.replace(/\s+/g, ' ');
  }
  send();
}

function writeDesign(d: Design): void {
  current = d;
  error = designNote = null;
  send();
  try {
    fs.writeFileSync(designFile, JSON.stringify(d, null, 2) + '\n');
  } catch {
    // the window already shows it; the file stays as it was
  }
}
const reset = () => writeDesign(DEFAULT_DESIGN);
// ---- app settings (zoom, what chats start with): a file in the app's data folder, outside every project ----
let settings: Settings = DEFAULT_SETTINGS;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const sendSettings = () => win?.webContents.send('settings', { ...settings });
function loadSettings(): void {
  try {
    settings = parseSettings(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    settings = DEFAULT_SETTINGS; // no file yet
  }
}
function applyZoom(): void {
  win?.webContents.setZoomFactor(settings.zoom);
  artifacts?.setZoom(settings.zoom);
}
/** Change settings (user action, or the default model read off the banner), save them, and apply. */
function saveSettings(patch: unknown): void {
  settings = applySettings(settings, patch);
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true, mode: 0o700 });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  } catch {
    // still applies for this run
  }
  applyZoom();
  sendSettings();
}
const zoomBy = (dir: number) => saveSettings({ zoom: zoomStep(settings.zoom, dir) });


/** View > Theme (user click only): saves the choice in design.json, in the new format. */
const setTheme = (theme: Theme) => writeDesign({ ...current, theme });

// ---- sessions and branches. Existing session files are only read, never written. A branch is a new
// file (cut from its parent at the fork point), created once and then left to claude. ----
const sessionDir = () => path.join(os.homedir(), '.claude', 'projects', fs.realpathSync(folder).replace(/[^a-zA-Z0-9]/g, '-'));
const sessionFile = (id: string) => path.join(sessionDir(), `${id}.jsonl`);
const branchesFile = () => path.join(folder, 'branches.json');
const namesFile = () => path.join(folder, 'chat-names.json'); // names given in the app (Claude Code's files are never written)
function readNames(): Record<string, string> {
  try {
    return parseNames(fs.existsSync(namesFile()) ? fs.readFileSync(namesFile(), 'utf8') : null);
  } catch {
    return {};
  }
}
const statKey = (f: string) => {
  try {
    const st = fs.statSync(f);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return '';
  }
};

// Parsed session files, cached by mtime and size.
const parsed = new Map<string, { key: string; chat: Chat }>();
// Turns known to be over that the file does not end (see settle): session id -> uuid of its last
// message then. While the file still ends at that message, the chat is not working.
const settled = new Map<string, string>();
function readSession(id: string): Chat | null {
  if (!id) return null;
  const key = statKey(sessionFile(id));
  if (!key) return null;
  const hit = parsed.get(id);
  const chat = hit?.key === key ? hit.chat : parseSession(fs.readFileSync(sessionFile(id), 'utf8'));
  if (hit?.key !== key) parsed.set(id, { key, chat });
  return chat.working && chat.lastUuid && settled.get(id) === chat.lastUuid ? settle(chat) : chat;
}

let branches: Branch[] = [];
let branchesError: string | null = null;
function loadBranches(): void {
  try {
    branches = fs.existsSync(branchesFile()) ? parseBranches(fs.readFileSync(branchesFile(), 'utf8')) : [];
    branchesError = null;
  } catch (e) {
    branches = []; // broken: every session file shows as its own root
    branchesError = (e as Error).message.replace(/\s+/g, ' ');
  }
}
function saveBranches(): void {
  if (branchesError && fs.existsSync(branchesFile())) fs.copyFileSync(branchesFile(), branchesFile() + '.broken');
  fs.writeFileSync(branchesFile(), JSON.stringify({ sessions: branches }, null, 2) + '\n');
  branchesError = null;
}

// ---- panes. The page shows a workspace of panes (see layout.ts); each pane is one chat with its own
// claude in its own hidden terminal, so every pane can work at the same time. A Runner is the main
// process side of one pane. Its claude always runs the chat the pane shows: opening another chat in a
// pane (only while it is idle) stops that claude, and the chat is only shown until the user sends. ----
interface Runner {
  pane: string;
  term: pty.IPty | null;
  sessionId: string; // the session its claude runs ('' when none runs)
  viewId: string; // the session the pane shows
  chat: Chat | null; // the running session's own file, or null if it has no file yet
  chatKey: string;
  // A Retry (or a send in a chat that was only shown) waiting to type its one message.
  pending: { id: string; stage: 'waiting' | 'sent'; count: number } | null;
  modeNow: Mode | 'other' | null; // read back from Claude Code's status line
  effortNow: Effort | null; // read back from Claude Code's corner
  carryMode: Mode | ''; // the mode to keep when the chat is restarted for a new model or effort
  cycling: boolean;
  size: { cols: number; rows: number };
  cardsKey: string;
  branchOf: string; // the session this pane was branched from in the workspace ('' if none)
}
const runners = new Map<string, Runner>();
let focusPane = '';
let treeKey = '';
const toPane = (r: Runner, channel: string, ...args: unknown[]) => win?.webContents.send(channel, r.pane, ...args);
const focused = () => runners.get(focusPane) ?? [...runners.values()][0];
/** Its claude is working (or a message is about to be typed into it). */
const busyR = (r: Runner) => !!r.chat?.working || !!r.pending;
const idle = (r: Runner) => !!r.term && !r.chat?.working && !r.pending;
const live = (r: Runner) => !!r.term && r.viewId === r.sessionId;
const runnerOf = (session: string) => [...runners.values()].find((r) => r.term && r.sessionId === session);
/** The pane that shows a session, if any: one session is only ever open in one pane. */
const shownIn = (session: string) => [...runners.values()].find((r) => r.viewId === session || r.sessionId === session);
const sendModes = (r: Runner) => toPane(r, 'pane-modes', r.modeNow, r.effortNow);
const noteTo = (r: Runner | undefined, text: string) => win?.webContents.send('note', r?.pane ?? '', text);
const paneArg = (pane: unknown) => (typeof pane === 'string' ? runners.get(pane) : undefined);

function pollRunner(r: Runner): void {
  // 0. The running session (cached by size and time): is it working?
  r.chat = readSession(r.sessionId);
  const isLive = live(r);
  const runningBusy = busyR(r);
  // 1. Chat of the session on screen.
  const branch = branches.find((b) => b.id === r.viewId);
  const ownKey = statKey(sessionFile(r.viewId));
  const key = `${r.viewId}|${r.sessionId}|${ownKey}|${ownKey ? '' : branch ? statKey(sessionFile(branch.parent)) : ''}|${r.pending?.stage ?? ''}|${runningBusy}`;
  if (key !== r.chatKey) {
    r.chatKey = key;
    const pend = r.pending;
    if (pend && (pend.id !== r.sessionId || (pend.stage === 'sent' && (r.chat?.replies.length ?? 0) > pend.count))) {
      r.pending = null;
      r.chatKey = ''; // send once more without the pending flag
    }
    const viewChat = isLive ? r.chat : readSession(r.viewId);
    let shown = viewChat;
    let empty = !!(viewChat && branch && viewChat.lastAny === branch.forkUuid);
    if (!shown && branch?.forkUuid) {
      // a branch made with --fork-session before cut files: show the parent up to the fork point
      const parentText = fs.existsSync(sessionFile(branch.parent)) ? fs.readFileSync(sessionFile(branch.parent), 'utf8') : '';
      shown = { ...parseSession(parentText, branch.forkUuid), working: false };
      empty = true;
    }
    // A reply that wrote a file into artifacts/ gets a card for it (once per reply and artifact).
    const items: ChatItem[] = [];
    const carded = new Set<string>();
    for (const { paths, ...item } of shown?.items ?? []) {
      items.push(item);
      for (const p of paths ?? []) {
        const name = artifactName(p, folder);
        if (!name || carded.has(`${item.reply}:${name}`)) continue;
        carded.add(`${item.reply}:${name}`);
        items.push({ role: 'artifact', text: name, reply: item.reply });
      }
    }
    if (empty && !r.pending) items.push({ role: 'tool', text: 'Empty branch: messages up to the fork point. Send a message to start it.' });
    const replies = (viewChat?.replies ?? []).map((x) => ({ id: x.id, copy: x.copy, branch: !!x.forkUuid, retry: x.first || !!x.retryCut }));
    const canBranch = !!viewChat?.replies.at(-1)?.forkUuid;
    const working = isLive && ((shown?.working ?? false) || !!r.pending);
    toPane(r, 'chat', { session: r.viewId, model: viewChat?.model ?? '', items, replies, working, canBranch, live: isLive, elsewhere: false });
  }
  checkCards(r);
}

/** Chat list (one line per root session with all its branches), pane titles and each pane's reply graph,
 *  from every session file in the project's session folder plus branches.json. */
function pollTree(): void {
  if (!win) return;
  const files = fs.existsSync(sessionDir()) ? fs.readdirSync(sessionDir()).filter((n) => UUID.test(n.replace(/\.jsonl$/, '')) && n.endsWith('.jsonl')) : [];
  const all = [...runners.values()];
  const tKey = [focusPane, ...all.map((r) => `${r.pane}:${r.viewId}:${r.sessionId}:${busyR(r)}:${r.branchOf}`), statKey(branchesFile()), statKey(namesFile()), ...files.map((n) => n + statKey(path.join(sessionDir(), n)))].join('|');
  if (tKey === treeKey) return;
  treeKey = tKey;
  loadBranches();
  const ids = new Set(files.map((n) => n.slice(0, -6)));
  for (const r of all) {
    if (r.sessionId) ids.add(r.sessionId);
    ids.add(r.viewId);
  }
  const mtime = (id: string) => {
    try {
      return fs.statSync(sessionFile(id)).mtimeMs;
    } catch {
      return 0;
    }
  };
  const names = readNames();
  const chats = buildChats([...ids].map((id) => ({ id, chat: readSession(id), mtime: mtime(id) })), branches, focused()?.viewId ?? '', Date.now(), names);
  // running: a chat whose claude is working now; panes: the panes that show one of its sessions
  win.webContents.send('chats', chats.map(({ sessions, ...row }) => ({
    ...row,
    running: all.some((r) => busyR(r) && sessions.includes(r.sessionId)),
    panes: all.filter((r) => sessions.includes(r.viewId)).map((r) => r.pane),
  })));
  const rowOf = (id: string) => chats.find((c) => c.sessions.includes(id));
  const titleOf = (id: string) => names[id] || rowOf(id)?.title || '';
  const titles: Record<string, { title: string; branchOf: string; chat: string; named: string }> = {};
  for (const r of all) {
    titles[r.pane] = { title: titleOf(r.viewId) || 'New chat', branchOf: r.branchOf ? titleOf(r.branchOf) || 'another chat' : '', chat: rowOf(r.viewId)?.id ?? r.viewId, named: names[r.viewId] ?? '' };
    const mine = rowOf(r.viewId)?.sessions ?? [r.viewId];
    const graph = buildGraph(mine.map((id) => ({ id, chat: readSession(id) })), branches, r.viewId);
    const nodes = layoutGraph(graph.nodes).map((p) => ({ ...p.node, x: p.x, y: p.y }));
    toPane(r, 'graph', { nodes, current: graph.current, session: r.viewId, error: branchesError });
  }
  win.webContents.send('pane-titles', titles);
}

function pollAll(): void {
  if (!win || !folder) return;
  for (const r of runners.values()) {
    try {
      pollRunner(r);
    } catch (e) {
      console.error('session poll:', e);
    }
  }
  try {
    pollTree();
  } catch (e) {
    console.error('tree poll:', e);
  }
}

// ---- permission cards. Claude Code's PermissionRequest hook (dist/hook.js) posts each question to a
// server on 127.0.0.1 only (random port, token made at each launch). The app answers only when the
// user clicks; otherwise it sends no decision and Claude Code's own terminal prompt stays. Each card
// shows in the pane whose claude asked. ----
const CARD_MS = 590_000; // a card expires this long after its request arrived
const HOOK_TIMEOUT_S = 600; // Claude Code's limit for the hook (its default too)
let token = '';
let endpointFile = '';
let cardsError: string | null = null; // why cards are off, if they are
const ran = new Set<string>(); // sessions the app started in this launch
interface Pending {
  card: CardView;
  input: HookInput;
  res: http.ServerResponse | null; // the hook's open request; null once answered
  before: Set<string>; // matching tool calls that already had a result when the request arrived
  timer: NodeJS.Timeout;
}
let cards: Pending[] = []; // in arrival order
let lastCardEvent = 0;

const sendCards = (r: Runner) => toPane(r, 'cards', cards.filter((p) => r.sessionId && p.card.session === r.sessionId).map((p) => p.card));
const sendCardsFor = (session: string) => {
  const r = runnerOf(session);
  if (r) sendCards(r);
};
const showTerminal = (r: Runner | undefined, why: string) => win?.webContents.send('show-term', r?.pane ?? '', why);

function reply(p: Pending, body: string): void {
  const r = p.res;
  p.res = null;
  if (r && !r.writableEnded) r.end(body);
}

function closeCard(p: Pending, body = ''): void {
  clearTimeout(p.timer);
  reply(p, body);
  cards = cards.filter((x) => x !== p);
  lastCardEvent = Date.now();
  sendCardsFor(p.card.session);
}

function expire(p: Pending): void {
  reply(p, ''); // no decision: the terminal prompt stays
  p.card.expired = true;
  lastCardEvent = Date.now();
  sendCardsFor(p.card.session);
  const r = runnerOf(p.card.session);
  if (r) showTerminal(r, 'A card expired. Answer Claude in the terminal.');
}

/** The session file plus its subagent files (subagent tool calls are written there). */
function sessionTexts(id: string): string {
  const parts: string[] = [];
  try {
    parts.push(fs.readFileSync(sessionFile(id), 'utf8'));
  } catch {
    // no file yet
  }
  const sub = path.join(sessionDir(), id, 'subagents');
  try {
    for (const n of fs.readdirSync(sub)) if (n.endsWith('.jsonl')) parts.push(fs.readFileSync(path.join(sub, n), 'utf8'));
  } catch {
    // no subagents
  }
  return parts.join('\n');
}

/** Close cards whose tool call got its result (answered in the terminal), and expired cards whose turn ended. */
function checkCards(r: Runner): void {
  const mine = cards.filter((p) => r.sessionId && p.card.session === r.sessionId);
  if (!mine.length) return;
  const sub = path.join(sessionDir(), r.sessionId, 'subagents');
  let names: string[] = [];
  try {
    names = fs.readdirSync(sub);
  } catch {
    // no subagents
  }
  const key = [r.sessionId, statKey(sessionFile(r.sessionId)), ...names.map((n) => n + statKey(path.join(sub, n)))].join('|');
  if (key === r.cardsKey) return;
  r.cardsKey = key;
  const text = sessionTexts(r.sessionId);
  for (const p of mine) {
    const done = answeredCalls(text, p.input.tool_name, p.input.tool_input).some((id) => !p.before.has(id));
    if (done || (p.card.expired && r.chat && !r.chat.working)) closeCard(p);
  }
}

function onHookRequest(text: string, res: http.ServerResponse): void {
  let input: HookInput;
  try {
    input = parseHookInput(text);
  } catch (e) {
    res.end('');
    showTerminal(focused(), `Claude Code sent a question the app cannot read (${(e as Error).message}). Answer it in the terminal.`);
    return;
  }
  // Only sessions this app runs, and only while a pane runs them. Anything else keeps its own prompt.
  const r = runnerOf(input.session_id);
  if (!ran.has(input.session_id) || !r) return void res.end('');
  const now = Date.now();
  let card: CardView;
  try {
    card = makeCard(input, randomUUID(), now, CARD_MS);
  } catch (e) {
    res.end('');
    showTerminal(r, `Claude asked something the app cannot show (${(e as Error).message}). Answer it in the terminal.`);
    return;
  }
  const before = new Set(answeredCalls(sessionTexts(input.session_id), input.tool_name, input.tool_input));
  const p: Pending = { card, input, res, before, timer: setTimeout(() => expire(p), CARD_MS) };
  res.on('close', () => {
    // the hook went away without our answer (Claude Code stopped it): the card has nothing to answer
    if (p.res === res && !res.writableEnded) {
      p.res = null;
      if (!p.card.expired) closeCard(p);
    }
  });
  cards.push(p);
  r.cardsKey = '';
  lastCardEvent = now;
  sendCards(r);
}

async function startCardServer(): Promise<void> {
  token = randomBytes(32).toString('hex');
  const expected = Buffer.from(`Bearer ${token}`);
  const server = http.createServer((req, res) => {
    const fail = (code: number) => {
      res.writeHead(code);
      res.end();
    };
    const got = Buffer.from(String(req.headers.authorization ?? ''));
    const port = (server.address() as { port: number }).port;
    if (req.method !== 'POST' || req.url !== '/permission') return fail(404);
    if (req.headers.host !== `127.0.0.1:${port}` || req.headers.origin !== undefined) return fail(403); // not from a browser
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return fail(403);
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 1_000_000) {
        fail(413);
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.flushHeaders(); // tells the hook the app has its question (it gives up after 2 s without this)
      onHookRequest(Buffer.concat(chunks).toString('utf8'), res);
    });
  });
  server.requestTimeout = 10_000; // receiving the request; the answer may take up to CARD_MS
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as { port: number }).port;

  // Port and token for the hook, in the app's data folder, readable by the owner only.
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = createHash('sha256').update(fs.realpathSync(folder)).digest('hex').slice(0, 16);
  endpointFile = path.join(dir, `hook-${key}.json`);
  const tmp = `${endpointFile}.${process.pid}.tmp`;
  fs.rmSync(tmp, { force: true });
  fs.writeFileSync(tmp, JSON.stringify({ port, token }), { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, endpointFile);
}

/** Always allow file writes inside artifacts/ (two fixed rules, nothing broader). Everything else in the file is kept. */
function installArtifactRule(): void {
  const file = path.join(folder, '.claude', 'settings.local.json');
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const next = mergeAllow(before);
  if (next === null) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next, { flag: before === null ? 'wx' : 'w' });
}

/** Add our hook entry to .claude/settings.local.json. Everything else in the file is kept. */
function installHook(): void {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const command = `${HOOK_MARK} ELECTRON_RUN_AS_NODE=1 ${q(process.execPath)} ${q(path.join(__dirname, 'hook.js'))} ${q(endpointFile)}`;
  const file = path.join(folder, '.claude', 'settings.local.json');
  const read = () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
  const before = read();
  let next: string | null;
  try {
    next = mergeHook(before, command, HOOK_TIMEOUT_S);
  } catch (e) {
    throw new Error(`.claude/settings.local.json was left as it is: ${(e as Error).message}`);
  }
  if (next === null) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (read() !== before) throw new Error('.claude/settings.local.json changed while the app was adding its hook; restart the app');
  fs.writeFileSync(file, next, { flag: before === null ? 'wx' : 'w' });
}

/** Stop a pane's claude (the pane then only shows its chat). Its questions die with it. */
function stopRunner(r: Runner): void {
  const old = r.term;
  r.term = null;
  old?.kill();
  for (const c of cards.filter((c) => r.sessionId && c.card.session === r.sessionId)) closeCard(c);
  if (usageRunner === r) usageReading = false;
  r.sessionId = '';
  r.chat = null;
  r.pending = null;
  r.modeNow = r.effortNow = null;
}

// Start claude for a session in a pane. Only called from the user's own actions (new pane, Branch,
// Retry, a send in a chat that was only shown, a new model).
function runClaude(r: Runner, id: string, args: string[]): void {
  // What the user picked in the message box (model, thinking, mode) goes to claude as its own flags.
  args = [...args, ...startFlags({ model: settings.model, effort: settings.effort, mode: r.carryMode || settings.mode })];
  r.carryMode = '';
  stopRunner(r);
  sendModes(r);
  r.sessionId = r.viewId = id;
  ran.add(id);
  r.chatKey = treeKey = r.cardsKey = '';
  toPane(r, 'term-reset');
  sendCards(r);
  // Drop markers a parent Claude Code would pass on (they turn transcript saving off).
  const env = { ...process.env } as Record<string, string>;
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_PID']) delete env[k];
  let p: pty.IPty;
  try {
    p = pty.spawn('claude', args, { name: 'xterm-256color', cols: r.size.cols, rows: r.size.rows, cwd: folder, env });
  } catch (e) {
    toPane(r, 'pty-data', `Could not start "claude": ${(e as Error).message}\r\n`);
    return;
  }
  r.term = p;
  // A claude just started is never working, whatever the end of its file says.
  const atStart = readSession(id);
  if (atStart?.working && atStart.lastUuid) settled.set(id, atStart.lastUuid);
  // A question in the terminal with no card for it (the hook could not reach the app, a trust
  // prompt, ...): show the terminal.
  let tail = '';
  let ask: NodeJS.Timeout | undefined;
  // Started without --model: the banner names Claude Code's own default, which the model picker shows.
  let banner = validModel(settings.model) ? null : '';
  p.onData((d) => {
    if (r.term !== p) return;
    toPane(r, 'pty-data', d);
    const text = plain(d);
    if (banner !== null) {
      banner = (banner + text).slice(-4000);
      const seen = modelInBanner(banner);
      if (seen) {
        banner = null;
        if (seen !== settings.seenDefault) saveSettings({ seenDefault: seen });
      }
    }
    const mode = modeInText(text);
    const effort = effortInText(text);
    if ((mode && mode !== r.modeNow) || (effort && effort !== r.effortNow)) {
      r.modeNow = mode ?? r.modeNow;
      r.effortNow = effort ?? r.effortNow;
      sendModes(r);
    }
    tail = (tail + text).slice(-400);
    if (!/Esc to cancel|Enter to confirm/.test(tail)) return;
    tail = '';
    clearTimeout(ask);
    const check = () => {
      if (r.term !== p || cards.some((c) => c.card.session === id)) return; // gone, or a card covers it
      if (usageRunner === r && (usageReading || Date.now() - usageAt < 3000)) return; // the /usage screen the app opened for the bars
      // Right after a card was answered, wait out the moment its own dialog closes, then look again
      // instead of giving up: a second question that follows at once would otherwise show nowhere.
      const wait = lastCardEvent + 5000 - Date.now();
      if (wait > 0) return void (ask = setTimeout(check, wait + 200));
      // The page holds the screen: it shows the terminal only if a question is still on it and no card is open.
      toPane(r, 'check-question', id);
    };
    ask = setTimeout(check, 2500);
  });
  p.onExit(() => {
    clearTimeout(ask);
    for (const c of cards.filter((c) => c.card.session === id)) closeCard(c); // its questions died with it
    if (r.term === p) toPane(r, 'pty-data', '\r\n[claude exited]\r\n');
  });
}

function openSession(r: Runner, id: string): void {
  const branch = branches.find((b) => b.id === id);
  if (fs.existsSync(sessionFile(id))) runClaude(r, id, ['--resume', id]);
  else if (branch?.forkUuid) runClaude(r, id, ['--session-id', id, '--resume', branch.parent, '--fork-session']); // made before cut files
  else runClaude(r, id, ['--session-id', id]); // new session, or a Retry of a first reply
}

/** New branch of `parent` ending at forkUuid (null: a fresh session), saved in branches.json. With a
 *  pane, claude starts on it there; without, the branch is only made (a new pane shows it). */
function newBranch(r: Runner | null, parent: string, forkUuid: string | null, words: string): string | null {
  const id = randomUUID();
  if (forkUuid) {
    try {
      const cut = cutSession(fs.readFileSync(sessionFile(parent), 'utf8'), forkUuid, id);
      fs.writeFileSync(sessionFile(id), cut, { flag: 'wx', mode: 0o600 }); // a new file; never overwrites
    } catch (e) {
      noteTo(r ?? undefined, `Could not make the branch: ${(e as Error).message}`);
      return null;
    }
  }
  loadBranches();
  branches.push({ id, parent, forkUuid: forkUuid ?? '', forkWords: words, created: new Date().toISOString() });
  saveBranches();
  if (r) runClaude(r, id, forkUuid ? ['--resume', id] : ['--session-id', id]);
  return id;
}

/** Type text into a pane's claude and press Enter. Only for the user's own Enter or Retry click. */
function typeText(r: Runner, text: string): void {
  const t = r.term;
  if (!t) return;
  t.write(text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text); // several lines go in as one paste
  setTimeout(() => r.term === t && t.write('\r'), 150); // separate write, so claude does not treat Enter as pasted text
}

// The /usage screen the app opened to read the bars (see 'usage-open'), and the pane it was typed in.
// Only then is Esc pressed.
let usageReading = false;
let usageAt = 0;
let usageRunner: Runner | null = null;
function closeUsage(): void {
  if (!usageReading) return;
  usageReading = false;
  usageAt = Date.now();
  usageRunner?.term?.write('\x1b');
}

const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, ' ').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');

/** Retry: once the new claude is idle, type its one message. If claude shows a question or never
 *  settles, nothing is sent; the message goes into the pane's chat box for the user to send. */
function typeWhenReady(r: Runner, p: pty.IPty, text: string): void {
  let seen = '';
  let quiet: NodeJS.Timeout | undefined;
  const started = Date.now();
  const finish = (ready: boolean) => {
    data.dispose();
    exit.dispose();
    clearTimeout(quiet);
    clearTimeout(limit);
    if (r.term !== p || !r.pending || r.pending.stage !== 'waiting') return;
    r.chatKey = '';
    if (ready && !/Enter to confirm|Esc to cancel/.test(plain(seen))) {
      typeText(r, text);
      const sent = r.pending;
      sent.stage = 'sent';
      setTimeout(() => {
        if (r.pending !== sent) return;
        r.pending = null; // the message never showed up in the file
        r.chatKey = '';
      }, 60000);
    } else {
      r.pending = null;
      toPane(r, 'prefill', text);
    }
  };
  const data = p.onData((d) => {
    seen = (seen + d).slice(-8000);
    clearTimeout(quiet);
    quiet = setTimeout(() => finish(true), Math.max(1500, 3000 - (Date.now() - started)));
  });
  const exit = p.onExit(() => finish(false));
  const limit = setTimeout(() => finish(false), 30000);
}

// The chats folder: a command-line folder, else the last one picked (folder-store.ts), else the dialog.
const savedFolderFile = () => path.join(app.getPath('userData'), 'folder.json');
async function askFolder(title: string): Promise<string | null> {
  const opts: Electron.OpenDialogOptions = { title, properties: ['openDirectory', 'createDirectory'] };
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return r.canceled ? null : r.filePaths[0];
}
async function chooseFolder(): Promise<string | null> {
  // Optional folder argument: `npm start -- /some/folder`. In dev the first plain argument is the app path.
  const arg = process.argv.slice(1).filter((a) => !a.startsWith('-'))[app.isPackaged ? 0 : 1];
  const start = pickStartFolder({ arg, saved: readSavedFolder(savedFolderFile()) });
  const chosen = start ?? (await askFolder('Choose a folder to run claude in'));
  if (chosen) saveFolder(savedFolderFile(), chosen);
  return chosen;
}
/** Clade › Change Folder…: save the new folder and restart the app on it (everything is built on the folder). */
async function changeFolder(): Promise<void> {
  const next = await askFolder('Choose a new folder to run claude in');
  if (!next || path.resolve(next) === path.resolve(folder)) return;
  saveFolder(savedFolderFile(), next);
  // Drop a folder given on the command line, so the restart opens the saved one.
  const keep = process.argv.slice(1).filter((a) => a.startsWith('-'));
  app.relaunch({ args: app.isPackaged ? keep : [process.argv[1], ...keep] });
  app.quit();
}

function prepareFolder(): void {
  if (!fs.existsSync(designFile)) fs.writeFileSync(designFile, JSON.stringify(DEFAULT_DESIGN, null, 2) + '\n');
  const md = path.join(folder, 'CLAUDE.md');
  const old = fs.existsSync(md) ? fs.readFileSync(md, 'utf8') : '';
  // Replace our own section if present (so new keys reach Claude), keep everything else.
  const start = old.includes(MD_START) ? old.indexOf(MD_START) : old.indexOf(MD_OLD_MARKER);
  const end = old.includes(MD_END) ? old.indexOf(MD_END) + MD_END.length : old.length;
  const before = (start < 0 ? old : old.slice(0, start)).trimEnd();
  const after = start < 0 ? '' : old.slice(end).trim();
  const next = (before ? before + '\n\n' : '') + CLAUDE_MD + (after ? '\n' + after + '\n' : '');
  if (next !== old) fs.writeFileSync(md, next);
}


app.whenReady().then(async () => {
  const chosen = await chooseFolder();
  if (!chosen) return app.quit();
  folder = chosen;
  designFile = path.join(folder, 'design.json');
  prepareFolder();
  try {
    await startCardServer();
    installHook();
  } catch (e) {
    cardsError = (e as Error).message.replace(/\s+/g, ' ');
  }
  let ruleError = '';
  try {
    installArtifactRule();
  } catch (e) {
    ruleError = `Artifacts will ask before each write (.claude/settings.local.json was left as it is: ${(e as Error).message.replace(/\s+/g, ' ')})`;
  }

  if (fs.existsSync(ICON)) app.dock?.setIcon(ICON);

  // Fixed menu. The reset shortcut lives here, outside design.json's reach.
  const shortcut = (name: string) => () => win?.webContents.send('shortcut', name);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Clade',
        submenu: [
          { role: 'about' },
          { label: 'Settings…', accelerator: 'Cmd+,', click: shortcut('settings') },
          { label: 'Change Folder…', accelerator: 'Cmd+O', click: () => void changeFolder() },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => zoomBy(1) },
          { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', visible: false, acceleratorWorksWhenHidden: true, click: () => zoomBy(1) },
          { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoomBy(-1) },
          { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => zoomBy(0) },
        ],
      },
      {
        label: 'Chat',
        submenu: [
          { label: 'Attach Files…', accelerator: 'Cmd+U', click: shortcut('attach') },
          { label: 'Mode…', accelerator: 'Cmd+Shift+P', click: shortcut('mode') },
          { label: 'Thinking…', accelerator: 'Cmd+Shift+E', click: shortcut('effort') },
          { label: 'Model…', accelerator: 'Cmd+Shift+M', click: shortcut('model') },
          { label: 'Skills…', accelerator: 'Cmd+Shift+K', click: shortcut('skills') },
        ],
      },
      {
        label: 'Pane',
        submenu: [
          { label: 'New Chat Pane', accelerator: 'Cmd+T', click: shortcut('pane-new') },
          { label: 'Branch This Pane', accelerator: 'Cmd+Shift+B', click: shortcut('pane-branch') },
          { type: 'separator' },
          { label: 'Split Right (New Chat)', accelerator: 'Cmd+D', click: shortcut('pane-split-right') },
          { label: 'Split Down (New Chat)', accelerator: 'Cmd+Shift+D', click: shortcut('pane-split-down') },
          { type: 'separator' },
          { label: 'Next Pane', accelerator: 'Cmd+]', click: shortcut('pane-next') },
          { label: 'Previous Pane', accelerator: 'Cmd+[', click: shortcut('pane-prev') },
          { label: 'Maximize / Restore Pane', accelerator: 'Cmd+Shift+Enter', click: shortcut('pane-max') },
          { type: 'separator' },
          { label: 'Close Pane', accelerator: 'Cmd+W', click: shortcut('pane-close') },
        ],
      },
      {
        label: 'Design',
        submenu: [
          { label: 'Theme: Follow System', click: () => setTheme('system') },
          { label: 'Theme: Ivory (Light)', click: () => setTheme('light') },
          { label: 'Theme: Dark', click: () => setTheme('dark') },
          { type: 'separator' },
          { label: 'Reset Design', accelerator: 'Cmd+Shift+R', click: reset },
        ],
      },
      { label: 'Terminal', submenu: [{ label: 'Show / Hide Terminal', accelerator: 'Cmd+J', click: () => win?.webContents.send('toggle-term') }] },
      { label: 'Graph', submenu: [{ label: 'Show / Hide Reply Graph', accelerator: 'Cmd+G', click: () => win?.webContents.send('toggle-graph') }] },
    ]),
  );

  // CLADE_WINDOW=900x640 sets the start size (used to check layouts).
  const start = /^(\d{3,4})x(\d{3,4})$/.exec(process.env.CLADE_WINDOW ?? '');
  win = new BrowserWindow({
    width: start ? +start[1] : 1240,
    height: start ? +start[2] : 800,
    title: `Clade — ${path.basename(folder)}`,
    icon: ICON,
    minWidth: 560,
    minHeight: 420,
    backgroundColor: (matchLook(current) === 'custom' ? current.colors : BASE)[resolveTheme(current.theme, nativeTheme.shouldUseDarkColors)].background,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: WHEEL_LOG ? ['--wheel-log'] : [],
    },
  });
  // A trackpad pinch must never zoom the page itself: the renderer uses it for the reply graph.
  const noPageZoom = () => void win?.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  noPageZoom();
  win.webContents.on('did-finish-load', noPageZoom);
  win.webContents.on('did-start-loading', () => (pictureSent = '')); // a reloaded page has no picture yet
  // CLADE_WHEEL_LOG=1: print every wheel event the page gets (to check a real trackpad pinch).
  ipcMain.on('wheel-log', (_e, line: unknown) => WHEEL_LOG && typeof line === 'string' && console.log(line.slice(0, 300)));
  artifacts = startArtifacts(win, folder, process.env.CLADE_ARTIFACT_LOG === '1');
  loadSettings();
  applyZoom();
  win.webContents.on('did-finish-load', applyZoom);
  win.webContents.on('did-finish-load', () => refreshAccount(true));
  artifacts.scan();
  // Artifact panel: opens by itself when Claude writes or changes an artifact, and on a card click.
  // The page runs in its own sandboxed view; see artifact-host.ts.
  ipcMain.on('artifact-open', (_e, name: unknown, version: unknown) => typeof name === 'string' && artifacts?.show(name, typeof version === 'number' ? version : null));
  ipcMain.on('artifact-step', (_e, delta: unknown) => artifacts?.step(delta === -1 ? -1 : 1));
  ipcMain.on('artifact-reload', () => artifacts?.reload());
  ipcMain.on('artifact-close', () => artifacts?.close());
  ipcMain.on('artifact-reveal', () => artifacts?.reveal());
  ipcMain.on('artifact-bounds', (_e, b: unknown) => artifacts?.setBounds(b));
  win.on('closed', () => {
    win = null;
    for (const r of runners.values()) r.term?.kill();
  });

  // Renderer is ready: apply design and settings. The page then opens its panes (pane-open).
  ipcMain.handle('app-start', () => {
    load();
    sendSettings();
    treeKey = '';
    for (const r of runners.values()) stopRunner(r); // the page was reloaded: its panes start again
    runners.clear();
    if (cardsError) {
      win?.webContents.send('note', '', `Permission cards are off: ${cardsError}`);
      showTerminal(undefined, `Permission cards are off: ${cardsError}`);
    }
    if (ruleError) win?.webContents.send('note', '', ruleError);
    win?.webContents.send('artifacts', artifacts?.list() ?? []);
    loadBranches();
    return null;
  });

  // ---- panes: opened and closed by the page (user actions, or the saved workspace at start) ----
  const PANE_ID = /^p[a-z0-9]{1,24}$/;
  // A pane with a chat in it only shows it (claude starts when the user sends there); a pane without one
  // starts claude on a new chat at once, exactly like the one at app start.
  ipcMain.on('pane-open', (_e, pane: unknown, o: unknown) => {
    if (typeof pane !== 'string' || !PANE_ID.test(pane) || runners.has(pane)) return;
    const opt = (typeof o === 'object' && o !== null ? o : {}) as Record<string, unknown>;
    const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : d);
    const r: Runner = {
      pane, term: null, sessionId: '', viewId: '', chat: null, chatKey: '', pending: null, modeNow: null, effortNow: null, carryMode: '', cycling: false,
      size: { cols: n(opt.cols, 20, 1000, 80), rows: n(opt.rows, 5, 1000, 10) }, cardsKey: '',
      branchOf: typeof opt.branchOf === 'string' && UUID.test(opt.branchOf) ? opt.branchOf : '',
    };
    runners.set(pane, r);
    if (!focusPane) focusPane = pane;
    treeKey = '';
    const session = typeof opt.session === 'string' && UUID.test(opt.session) ? opt.session : '';
    const other = session ? shownIn(session) : undefined;
    if (session && !other) {
      r.viewId = session;
      sendCards(r);
      sendModes(r);
      return;
    }
    if (other) win?.webContents.send('focus-pane', other.pane); // already open there: a new chat here instead
    const id = randomUUID(); // the app picks the id, so it knows exactly which file to read
    runClaude(r, id, ['--session-id', id]);
  });
  // Close a pane: its claude stops (a reply still being written stops with it); the chat stays in the list.
  ipcMain.on('pane-close', (_e, pane: unknown) => {
    const r = paneArg(pane);
    if (!r) return;
    stopRunner(r);
    runners.delete(r.pane);
    if (focusPane === r.pane) focusPane = '';
    treeKey = '';
  });
  ipcMain.on('pane-focus', (_e, pane: unknown) => {
    if (typeof pane !== 'string' || !runners.has(pane) || focusPane === pane) return;
    focusPane = pane;
    treeKey = '';
  });

  // Branch (user click only): new branch ending at that reply (no id: the newest reply), in the same pane.
  // From the graph, the reply may belong to another session (given as `from`); the same branch logic applies.
  ipcMain.on('branch', (_e, pane: unknown, replyId?: unknown, from?: unknown) => {
    const r = paneArg(pane);
    if (!r || busyR(r)) return; // a branch restarts this pane's claude: not while it works
    const parent = typeof from === 'string' && UUID.test(from) ? from : r.viewId;
    const other = shownIn(parent);
    if (other && other !== r && busyR(other)) return; // its file is still being written
    const chat = readSession(parent);
    if (!chat) return;
    const x = typeof replyId === 'string' ? chat.replies.find((y) => y.id === replyId) : chat.replies.at(-1);
    if (x?.forkUuid) newBranch(r, parent, x.forkUuid, firstWords(x.text) || '(fork)');
  });

  // Retry (user click only): new branch ending right before that reply, then send its user message once.
  // Edit: the same, with the user's new text. Both only on the user's click, in that pane.
  const resend = (r: Runner | undefined, replyId: unknown, text: string | null) => {
    if (!r) return;
    const chat = readSession(r.viewId);
    if (!chat || busyR(r) || typeof replyId !== 'string') return;
    const x = chat.replies.find((y) => y.id === replyId);
    if (!x || (!x.first && !x.retryCut) || (text === null && !x.text)) return;
    const words = text === null ? 'retry: ' + firstWords(x.userText) : 'edit: ' + firstWords(text);
    const id = newBranch(r, r.viewId, x.first ? null : x.retryCut, words);
    if (!id || !r.term) return;
    // Done once the new branch has one more reply than its cut file (not counted from the old chat:
    // a message stopped before its reply is not on the chain, so the counts can differ).
    r.pending = { id, stage: 'waiting', count: readSession(id)?.replies.length ?? 0 };
    typeWhenReady(r, r.term, text ?? x.userText);
  };
  ipcMain.on('retry', (_e, pane: unknown, replyId: unknown) => resend(paneArg(pane), replyId, null));
  ipcMain.on('edit', (_e, pane: unknown, replyId: unknown, text: unknown) => {
    if (typeof text !== 'string' || !text.trim() || text.length > 100_000) return;
    resend(paneArg(pane), replyId, text.trim());
  });

  // A card click (user click only). Checked against the card; anything that does not fit sends nothing.
  ipcMain.on('card-answer', (_e, id: unknown, a: unknown) => {
    const p = cards.find((x) => x.card.id === id);
    const r = p ? runnerOf(p.card.session) : undefined;
    if (!p || !r || p.card.expired || !p.res || typeof a !== 'object' || a === null) return;
    let body: string;
    try {
      body = answerBody(p.input, p.card, a as Action);
    } catch (e) {
      noteTo(r, `Nothing sent: ${(e as Error).message}`);
      return;
    }
    closeCard(p, body);
    if ((a as Action).action === 'terminal') showTerminal(r, 'Answer Claude in the terminal.');
  });

  // Copy (user click only): the reply text, already stripped of style tags.
  ipcMain.on('copy', (_e, text: unknown) => typeof text === 'string' && clipboard.writeText(text));

  // New chat in a pane (user click only): a fresh session, started exactly like a new pane.
  ipcMain.on('new-chat', (_e, pane: unknown) => {
    const r = paneArg(pane);
    if (!r || busyR(r)) return;
    if (live(r) && !r.chat && !branches.some((b) => b.id === r.sessionId)) return; // already an empty new chat
    r.branchOf = '';
    const id = randomUUID();
    runClaude(r, id, ['--session-id', id]);
  });

  // Rename a chat (by its session id; the root's name is the chat list's): saved in chat-names.json; an
  // empty name clears it.
  ipcMain.on('rename-chat', (_e, id: unknown, name: unknown) => {
    if (typeof id !== 'string' || !UUID.test(id)) return;
    try {
      const before = fs.existsSync(namesFile()) ? fs.readFileSync(namesFile(), 'utf8') : null;
      fs.writeFileSync(namesFile(), setName(before, id, name));
    } catch (e) {
      noteTo(focused(), `Could not rename the chat: ${(e as Error).message}`);
    }
    treeKey = '';
    pollAll();
  });
  // Chat list or graph click (user click only): show that session in the pane. Only shows the chat;
  // nothing is started until the user sends a message in it (chat-send). A chat already open in another
  // pane is focused there instead.
  ipcMain.on('open-session', (_e, pane: unknown, id: unknown) => {
    const r = paneArg(pane);
    if (!r || typeof id !== 'string' || !UUID.test(id) || id === r.viewId) return;
    const other = shownIn(id);
    if (other && other !== r) return void win?.webContents.send('focus-pane', other.pane);
    if (busyR(r)) return; // the page opens it in a new pane instead
    loadBranches();
    stopRunner(r);
    sendModes(r);
    sendCards(r);
    r.viewId = id;
    r.branchOf = '';
    r.chatKey = treeKey = '';
  });
  // ---- message box controls. Every handler runs on a user click or key; each re-checks its input. ----
  const statOf = (p: string) => {
    try {
      const st = fs.statSync(p);
      return { path: p, name: path.basename(p), size: st.isDirectory() ? 0 : st.size, dir: st.isDirectory() };
    } catch {
      return null;
    }
  };
  // Attach: only paths and sizes come back; the app never reads the files.
  ipcMain.handle('pick-files', async () => {
    if (!win) return [];
    const r = await dialog.showOpenDialog(win, { title: 'Attach files', properties: ['openFile', 'openDirectory', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths.map(statOf).filter(Boolean);
  });
  ipcMain.handle('stat-files', (_e, paths: unknown) =>
    Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string' && path.isAbsolute(p)).slice(0, 50).map(statOf).filter(Boolean) : [],
  );
  // A pasted image has no path: save it in <project>/attachments/ so Claude Code can read it.
  ipcMain.handle('save-paste', (_e, bytes: unknown, mime: unknown) => {
    if (!(bytes instanceof Uint8Array) || typeof mime !== 'string' || bytes.length === 0 || bytes.length > 30_000_000) return null;
    const dir = path.join(folder, 'attachments');
    for (let n = 1; n < 100; n++) {
      const name = pastedName(mime, new Date(), n);
      if (!name) return null;
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), bytes, { flag: 'wx' });
        return statOf(path.join(dir, name));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return null;
      }
    }
    return null;
  });
  // Stop: Esc in the pane's terminal, exactly what the key does there.
  ipcMain.on('stop', (_e, pane: unknown) => paneArg(pane)?.term?.write('\x1b'));
  // After a Stop the page sends the bottom of the pane's terminal screen. Once Claude Code no longer offers
  // "esc to interrupt", its turn is over even if the file does not say so. A message it put back in its
  // own box is cleared there and goes back into the pane's message box, so the next send is not added to it.
  ipcMain.on('stop-screen', (_e, pane: unknown, lines: unknown) => {
    const r = paneArg(pane);
    if (!r?.term || !Array.isArray(lines)) return;
    const screen = stopScreen(lines.filter((l): l is string => typeof l === 'string').slice(-60));
    const chat = readSession(r.sessionId);
    if (screen.busy || !chat?.working || !chat.lastUuid || r.pending) return;
    settled.set(r.sessionId, chat.lastUuid);
    r.chatKey = treeKey = '';
    const last = chat.replies.at(-1);
    if (screen.boxLines && last && !last.text) {
      r.term.write(clearBoxKeys(screen.boxLines));
      toPane(r, 'prefill', last.userText, 'stopped');
    }
    pollAll();
  });

  // Mode: Claude Code's own Shift+Tab cycle, pressed until the status line names the chosen mode.
  async function cycleTo(r: Runner, target: Mode): Promise<void> {
    if (r.cycling || !idle(r)) return;
    r.cycling = true;
    try {
      for (let i = 0; i < MAX_MODE_PRESSES && r.modeNow !== target; i++) {
        const before = r.modeNow;
        const t = r.term;
        t?.write('\x1b[Z');
        for (let w = 0; w < 25 && r.modeNow === before && r.term === t; w++) await new Promise((res) => setTimeout(res, 60));
        if (r.modeNow === before || r.term !== t) break; // no answer from the status line: stop pressing
      }
      if (r.modeNow !== target) noteTo(r, 'Could not confirm the mode. Check the terminal (Cmd+J).');
    } finally {
      r.cycling = false;
    }
  }
  // Pickers and settings: model, thinking (effort), mode, zoom, tool steps. A new model or effort
  // restarts claude on the pane's chat with its own flags (nothing is typed, no default is changed);
  // other panes take it at their next start.
  ipcMain.on('set-options', (_e, pane: unknown, patch: unknown) => {
    const r = paneArg(pane);
    const before = settings;
    const next = applySettings(settings, patch);
    const restart = !!r && (next.model !== before.model || next.effort !== before.effort) && live(r);
    if (restart && r && !idle(r)) return void noteTo(r, 'Wait until Claude has finished, then change the model or thinking level.');
    saveSettings(patch);
    if (restart && r) {
      r.carryMode = r.modeNow && r.modeNow !== 'other' ? r.modeNow : '';
      loadBranches();
      if (fs.existsSync(sessionFile(r.sessionId)) || branches.some((b) => b.id === r.sessionId)) openSession(r, r.sessionId);
      else {
        const id = randomUUID(); // an empty new chat: start it again with the new flags
        runClaude(r, id, ['--session-id', id]);
      }
    } else if (r && next.mode && next.mode !== before.mode) void cycleTo(r, next.mode);
  });
  ipcMain.on('next-mode', (_e, pane: unknown) => {
    const r = paneArg(pane);
    if (r && idle(r)) r.term?.write('\x1b[Z'); // Shift+Tab in the message box
  });
  ipcMain.on('zoom', (_e, dir: unknown) => zoomBy(dir === 1 ? 1 : dir === -1 ? -1 : 0));

  // Skills: listed from SKILL.md files; switched with Claude Code's own skillOverrides setting.
  const skills = () => listSkills(folder, os.homedir());
  const localSettings = () => path.join(folder, '.claude', 'settings.local.json');
  ipcMain.handle('skills-list', () => skills());
  ipcMain.handle('skill-switch', (_e, name: unknown, on: unknown) => {
    const s = skills().find((x) => x.name === name);
    if (!s || !s.canSwitch || typeof on !== 'boolean') return { skills: skills(), error: 'That skill cannot be switched here.' };
    try {
      const before = fs.existsSync(localSettings()) ? fs.readFileSync(localSettings(), 'utf8') : null;
      fs.mkdirSync(path.dirname(localSettings()), { recursive: true });
      fs.writeFileSync(localSettings(), mergeSkillSwitch(before, s.name, on));
      return { skills: skills(), error: '' };
    } catch (e) {
      return { skills: skills(), error: `.claude/settings.local.json was left as it is: ${(e as Error).message}` };
    }
  });
  ipcMain.handle('skill-add', async () => {
    if (!win) return { skills: skills(), error: '' };
    const r = await dialog.showOpenDialog(win, { title: 'Add a skill: choose its folder (it holds a SKILL.md)', properties: ['openDirectory'] });
    if (r.canceled) return { skills: skills(), error: '' };
    try {
      addSkill(folder, r.filePaths[0]);
      return { skills: skills(), error: '' };
    } catch (e) {
      return { skills: skills(), error: `Not added: ${(e as Error).message}` };
    }
  });

  // Settings sheet: the parts that live in design.json, and two buttons.
  ipcMain.on('design-set', (_e, p: unknown) => {
    const o = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>;
    let next = structuredClone(current);
    if (o.theme === 'system' || o.theme === 'light' || o.theme === 'dark') next.theme = o.theme;
    if (typeof o.effects === 'boolean') next.effects.enabled = o.effects;
    if (typeof o.sidebar === 'boolean') next.layout.sidebar = o.sidebar;
    if (typeof o.sidebarWidth === 'number' && Number.isFinite(o.sidebarWidth)) next.layout.sidebarWidth = Math.round(Math.min(480, Math.max(160, o.sidebarWidth)));
    // A look: only stored names are accepted, and only stored colors are written (themes.ts).
    const lk = (typeof o.look === 'object' && o.look !== null ? o.look : null) as Record<string, unknown> | null;
    if (lk) {
      const base = matchLook(current);
      const now = base === 'custom' ? (current.look ?? DEFAULT_LOOK) : base;
      const accent = isAccentName(lk.accent) ? lk.accent : now.accent;
      next = applyLook(next, { accent });
    }
    // Background: a preset (Ivory or Dark, which sets the theme too), or a picture the user picks.
    const bg = typeof o.background === 'string' ? BACKGROUNDS.find((b) => b.id === o.background) : undefined;
    if (bg) {
      next.theme = bg.theme;
      delete next.background;
    }
    if (o.background === 'none') delete next.background; // remove the picture, keep the theme
    if (o.pickBackground === true) return void pickPicture();
    if (o.resetLook === true) {
      next = applyLook(next, DEFAULT_LOOK);
      next.theme = 'system';
      delete next.background;
    }
    writeDesign(next);
  });
  ipcMain.on('reset-design', reset);
  ipcMain.on('open-folder', () => void shell.openPath(folder));
  ipcMain.on('change-folder', () => void changeFolder());

  ipcMain.on('pty-write', (_e, pane: unknown, d: unknown) => typeof d === 'string' && paneArg(pane)?.term?.write(d)); // only what the user types
  // A pane's text box: type the user's text into its terminal, then press Enter. Only on the user's Enter.
  ipcMain.on('chat-send', (_e, pane: unknown, text: unknown) => {
    const r = paneArg(pane);
    if (!r || typeof text !== 'string') return;
    if (live(r)) return typeText(r, text);
    // A chat that was only shown: start claude on it now, then type the message once it is ready.
    if (r.pending) return void toPane(r, 'prefill', text);
    loadBranches();
    const count = readSession(r.viewId)?.replies.length ?? 0;
    openSession(r, r.viewId);
    if (!r.term) return;
    r.pending = { id: r.viewId, stage: 'waiting', count };
    typeWhenReady(r, r.term, text);
  });

  // ---- sidebar menu: account (read only), usage, help, the one fixed link ----
  ipcMain.on('account-refresh', () => refreshAccount(false));
  // Usage bars (on opening the menu only, never on a timer): type Claude Code's own /usage into the
  // hidden terminal of an idle pane; the page reads the numbers off its screen (usage.ts) and then asks
  // for Esc, which closes that screen again. The terminal is not shown. Nothing else is typed or pressed,
  // so no setting can change; the app reads no file for it and does not go online (Claude Code does).
  ipcMain.handle('usage-open', (_e, pane: unknown) => {
    const r = paneArg(pane);
    if (!r || !idle(r) || usageReading) return false;
    usageReading = true;
    usageAt = Date.now();
    usageRunner = r;
    typeText(r, '/usage');
    setTimeout(() => usageReading && closeUsage(), 12_000); // the page never answered: close it anyway
    return true;
  });
  ipcMain.on('usage-close', () => closeUsage());
  ipcMain.on('show-usage', (_e, pane: unknown) => {
    const r = paneArg(pane);
    if (!r || !idle(r)) return void noteTo(r, 'Wait until Claude has finished, then show usage.');
    showTerminal(r, 'Usage, as Claude Code shows it. Esc closes it; Cmd+J hides the terminal.');
    typeText(r, '/usage'); // Claude Code's own command: it fetches and draws the numbers; the app reads nothing
  });
  // Save a drawing (the Save button under it; user click only): a save dialog, then the file the user named.
  ipcMain.on('save-drawing', async (_e, svg: unknown, name: unknown) => {
    if (!win || typeof svg !== 'string' || !svg.startsWith('<svg ') || svg.length > 200_000) return;
    const base = (typeof name === 'string' ? name : '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'drawing';
    const r = await dialog.showSaveDialog(win, { title: 'Save drawing', defaultPath: path.join(folder, `${base}.svg`), filters: [{ name: 'SVG picture', extensions: ['svg'] }] });
    if (r.canceled || !r.filePath) return;
    try {
      fs.writeFileSync(r.filePath, svg);
      win.webContents.send('note', '', `Saved ${path.basename(r.filePath)}.`);
    } catch (e) {
      win.webContents.send('note', '', `Not saved: ${(e as Error).message}`);
    }
  });
  ipcMain.on('open-source', () => void shell.openExternal(SOURCE_URL)); // fixed: no URL comes from the page
  ipcMain.handle('help-text', () => {
    try {
      return fs.readFileSync(path.join(__dirname, '..', 'help.md'), 'utf8');
    } catch {
      return '# Help\n\nThe help file is missing from this copy of the app.';
    }
  });
  ipcMain.handle('app-version', () => APP_VERSION);
  setInterval(pollAll, 300);
  ipcMain.on('pty-resize', (_e, pane: unknown, cols: unknown, rows: unknown) => {
    const r = paneArg(pane);
    if (!r || typeof cols !== 'number' || typeof rows !== 'number' || !(cols >= 2 && rows >= 1 && cols <= 1000 && rows <= 1000)) return;
    r.size = { cols: Math.round(cols), rows: Math.round(rows) };
    try {
      r.term?.resize(r.size.cols, r.size.rows);
    } catch {
      // claude already exited
    }
  });

  // Watch the folder (not the file) so atomic replace-on-save is also seen.
  let timer: NodeJS.Timeout | undefined;
  fs.watch(folder, (_event, name) => {
    if (name !== 'design.json') return;
    clearTimeout(timer);
    timer = setTimeout(load, 50);
  });

  nativeTheme.on('updated', send); // macOS switched between light and dark
  win.loadFile(path.join(__dirname, '..', 'index.html'));
});

app.on('window-all-closed', () => app.quit());
process.on('SIGTERM', () => app.quit()); // so will-quit below still runs
app.on('will-quit', () => {
  for (const p of cards) reply(p, ''); // the terminal prompts take over
  try {
    if (endpointFile && JSON.parse(fs.readFileSync(endpointFile, 'utf8')).token === token) fs.rmSync(endpointFile);
  } catch {
    // already gone
  }
});
