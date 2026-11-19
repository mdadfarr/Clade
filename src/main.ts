import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import * as pty from 'node-pty';
import { DEFAULT_DESIGN, Design, readDesign, resolveTheme, Theme } from './design';
import { CLAUDE_MD, MD_END, MD_OLD_MARKER, MD_START } from './claude-md';
import { buildChats } from './chats';
import { artifactName, mergeAllow } from './artifacts';
import { registerArtifactScheme, startArtifacts } from './artifact-host';
import { ACCENT_NAMES, ACCENTS, applyLook, DEFAULT_LOOK, isAccentName, matchLook } from './themes';
import { applySettings, DEFAULT_SETTINGS, Effort, effortInText, MAX_MODE_PRESSES, Mode, modeInText, MODES, parseSettings, Settings, startFlags, zoomStep } from './settings';
import { addSkill, listSkills, mergeSkillSwitch } from './skills';
import { Account, NO_NETWORK_PROFILE, parseAuthStatus, UNKNOWN } from './account';
import { execFile } from 'child_process';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pastedName } = require('./composer') as { pastedName(mime: string, when: Date, n: number): string | null };
import { Chat, ChatItem, cutSession, parseSession } from './session';
import { buildGraph, layoutGraph } from './graph';
import { Branch, firstWords, parseBranches, UUID } from './branches';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { Action, answerBody, answeredCalls, CardView, HOOK_MARK, HookInput, makeCard, mergeHook, parseHookInput } from './cards';

const WHEEL_LOG = process.env.CLADE_WHEEL_LOG === '1';
registerArtifactScheme();
app.setName('Clade'); // own name and icon; nothing of Claude's is used
const ICON = path.join(__dirname, '..', 'assets', 'icon.png');

let win: BrowserWindow | null = null;
let artifacts: ReturnType<typeof startArtifacts> | null = null;
let term: pty.IPty | null = null;
let folder = '';
let designFile = '';
let current: Design = DEFAULT_DESIGN; // last working design
let error: string | null = null;

let designNote: string | null = null; // e.g. the file is in the old format

function send(): void {
  nativeTheme.themeSource = current.theme; // menus and native controls follow the same theme
  win?.webContents.send('design', current, error, designNote, resolveTheme(current.theme, nativeTheme.shouldUseDarkColors), looks());
}

/** What the Settings rows draw: the stored accents (names, labels, fill colors) and which one the design
 * matches now. Only stored names ever come back from the page. */
function looks() {
  return {
    now: matchLook(current),
    accents: ACCENT_NAMES.map((id) => ({ id, label: ACCENTS[id].label, fill: ACCENTS[id].fill })),
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
let modeNow: Mode | 'other' | null = null; // read back from Claude Code's status line
let effortNow: Effort | null = null; // read back from Claude Code's corner
let carryMode: Mode | '' = ''; // the mode to keep when the current chat is restarted for a new model or effort
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const sendSettings = () => win?.webContents.send('settings', { ...settings, modeNow, effortNow });
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
/** Change settings (user action only), save them, and apply. */
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
function readSession(id: string): Chat | null {
  const key = statKey(sessionFile(id));
  if (!key) return null;
  const hit = parsed.get(id);
  if (hit?.key === key) return hit.chat;
  const chat = parseSession(fs.readFileSync(sessionFile(id), 'utf8'));
  parsed.set(id, { key, chat });
  return chat;
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

let sessionId = ''; // the session running in the terminal
let viewId = ''; // the session shown in the chat. Opening an old chat only shows it; claude starts for it
// when the user sends a message there, so a chat that is working keeps running meanwhile.
let currentChat: Chat | null = null; // the running session's own file, or null if it has no file yet
let chatKey = '';
let treeKey = '';
// A Retry waiting to type its one message into the new branch. Only set by a Retry click.
let pending: { id: string; stage: 'waiting' | 'sent'; count: number } | null = null;


function pollSession(): void {
  if (!sessionId || !win) return;
  try {
    // 0. The running session (cached by size and time): is it working?
    currentChat = readSession(sessionId);
    const live = viewId === sessionId;
    const runningBusy = !!currentChat?.working || !!pending;
    // 1. Chat of the session on screen.
    const branch = branches.find((b) => b.id === viewId);
    const ownKey = statKey(sessionFile(viewId));
    const key = `${viewId}|${sessionId}|${ownKey}|${ownKey ? '' : branch ? statKey(sessionFile(branch.parent)) : ''}|${pending?.stage ?? ''}|${runningBusy}`;
    if (key !== chatKey) {
      chatKey = key;
      if (pending && (pending.id !== sessionId || (pending.stage === 'sent' && (currentChat?.replies.length ?? 0) > pending.count))) {
        pending = null;
        chatKey = ''; // send once more without the pending flag
      }
      const viewChat = live ? currentChat : readSession(viewId);
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
      if (empty && !pending) items.push({ role: 'tool', text: 'Empty branch: messages up to the fork point. Send a message to start it.' });
      const replies = (viewChat?.replies ?? []).map((r) => ({ id: r.id, copy: r.copy, branch: !!r.forkUuid, retry: r.first || !!r.retryCut }));
      const canBranch = !!viewChat?.replies.at(-1)?.forkUuid;
      // live: this chat runs in the terminal. elsewhere: another chat is working (this one is only shown).
      const working = live && ((shown?.working ?? false) || !!pending);
      win.webContents.send('chat', { session: viewId, model: viewChat?.model ?? '', items, replies, working, canBranch, live, elsewhere: !live && runningBusy });
    }

    checkCards();

    // 2. Chat list (one line per root session with all its branches) and the reply graph of the
    //    current chat, from every session file in the project's session folder plus branches.json.
    const files = fs.existsSync(sessionDir()) ? fs.readdirSync(sessionDir()).filter((n) => UUID.test(n.replace(/\.jsonl$/, '')) && n.endsWith('.jsonl')) : [];
    const tKey = [viewId, sessionId, String(runningBusy), statKey(branchesFile()), ...files.map((n) => n + statKey(path.join(sessionDir(), n)))].join('|');
    if (tKey === treeKey) return;
    treeKey = tKey;
    loadBranches();
    const ids = new Set(files.map((n) => n.slice(0, -6)));
    ids.add(sessionId);
    ids.add(viewId);
    const mtime = (id: string) => {
      try {
        return fs.statSync(sessionFile(id)).mtimeMs;
      } catch {
        return 0;
      }
    };
    const chats = buildChats([...ids].map((id) => ({ id, chat: readSession(id), mtime: mtime(id) })), branches, viewId, Date.now());
    // running: the chat whose claude is working now (the list marks it, so it can be found again)
    win.webContents.send('chats', chats.map(({ sessions, ...row }) => ({ ...row, running: runningBusy && sessions.includes(sessionId) })));
    const mine = chats.find((c) => c.current)?.sessions ?? [viewId];
    const graph = buildGraph(mine.map((id) => ({ id, chat: readSession(id) })), branches, viewId);
    const nodes = layoutGraph(graph.nodes).map((p) => ({ ...p.node, x: p.x, y: p.y }));
    win.webContents.send('graph', { nodes, current: graph.current, session: viewId, error: branchesError });
  } catch (e) {
    console.error('session poll:', e);
  }
}

// ---- permission cards. Claude Code's PermissionRequest hook (dist/hook.js) posts each question to a
// server on 127.0.0.1 only (random port, token made at each launch). The app answers only when the
// user clicks; otherwise it sends no decision and Claude Code's own terminal prompt stays. ----
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
let cardsKey = '';
let lastCardEvent = 0;

const sendCards = () => win?.webContents.send('cards', cards.filter((p) => p.card.session === sessionId).map((p) => p.card));
const showTerminal = (why: string) => win?.webContents.send('show-term', why);

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
  sendCards();
}

function expire(p: Pending): void {
  reply(p, ''); // no decision: the terminal prompt stays
  p.card.expired = true;
  lastCardEvent = Date.now();
  sendCards();
  if (p.card.session === sessionId) showTerminal('A card expired. Answer Claude in the terminal.');
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
function checkCards(): void {
  const mine = cards.filter((p) => p.card.session === sessionId);
  if (!mine.length) return;
  const sub = path.join(sessionDir(), sessionId, 'subagents');
  let names: string[] = [];
  try {
    names = fs.readdirSync(sub);
  } catch {
    // no subagents
  }
  const key = [sessionId, statKey(sessionFile(sessionId)), ...names.map((n) => n + statKey(path.join(sub, n)))].join('|');
  if (key === cardsKey) return;
  cardsKey = key;
  const text = sessionTexts(sessionId);
  for (const p of mine) {
    const done = answeredCalls(text, p.input.tool_name, p.input.tool_input).some((id) => !p.before.has(id));
    if (done || (p.card.expired && currentChat && !currentChat.working)) closeCard(p);
  }
}

function onHookRequest(text: string, res: http.ServerResponse): void {
  let input: HookInput;
  try {
    input = parseHookInput(text);
  } catch (e) {
    res.end('');
    showTerminal(`Claude Code sent a question the app cannot read (${(e as Error).message}). Answer it in the terminal.`);
    return;
  }
  // Only sessions this app runs, and only the one running now. Anything else keeps its own prompt.
  if (!ran.has(input.session_id) || input.session_id !== sessionId || !term) return void res.end('');
  const now = Date.now();
  let card: CardView;
  try {
    card = makeCard(input, randomUUID(), now, CARD_MS);
  } catch (e) {
    res.end('');
    showTerminal(`Claude asked something the app cannot show (${(e as Error).message}). Answer it in the terminal.`);
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
  cardsKey = '';
  lastCardEvent = now;
  sendCards();
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

// Start claude for a session. Only called from the user's own actions (app start, Branch, Retry, node click).
let size = { cols: 80, rows: 10 };
function runClaude(id: string, args: string[]): void {
  // What the user picked in the message box (model, thinking, mode) goes to claude as its own flags.
  args = [...args, ...startFlags({ model: settings.model, effort: settings.effort, mode: carryMode || settings.mode })];
  carryMode = '';
  modeNow = effortNow = null;
  sendSettings();
  const old = term;
  term = null;
  old?.kill();
  sessionId = viewId = id;
  ran.add(id);
  chatKey = treeKey = cardsKey = '';
  win?.webContents.send('term-reset');
  sendCards();
  // Drop markers a parent Claude Code would pass on (they turn transcript saving off).
  const env = { ...process.env } as Record<string, string>;
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_PID']) delete env[k];
  let p: pty.IPty;
  try {
    p = pty.spawn('claude', args, { name: 'xterm-256color', cols: size.cols, rows: size.rows, cwd: folder, env });
  } catch (e) {
    win?.webContents.send('pty-data', `Could not start "claude": ${(e as Error).message}\r\n`);
    return;
  }
  term = p;
  // A question in the terminal with no card for it (the hook could not reach the app, a trust
  // prompt, ...): show the terminal.
  let tail = '';
  let ask: NodeJS.Timeout | undefined;
  p.onData((d) => {
    if (term !== p) return;
    win?.webContents.send('pty-data', d);
    const text = plain(d);
    const mode = modeInText(text);
    const effort = effortInText(text);
    if ((mode && mode !== modeNow) || (effort && effort !== effortNow)) {
      modeNow = mode ?? modeNow;
      effortNow = effort ?? effortNow;
      sendSettings();
    }
    tail = (tail + text).slice(-400);
    if (!/Esc to cancel|Enter to confirm/.test(tail)) return;
    tail = '';
    clearTimeout(ask);
    const check = () => {
      if (term !== p || cards.some((c) => c.card.session === id)) return; // gone, or a card covers it
      if (usageReading || Date.now() - usageAt < 3000) return; // the /usage screen the app opened for the bars
      // Right after a card was answered, wait out the moment its own dialog closes, then look again
      // instead of giving up: a second question that follows at once would otherwise show nowhere.
      const wait = lastCardEvent + 5000 - Date.now();
      if (wait > 0) return void (ask = setTimeout(check, wait + 200));
      // The page holds the screen: it shows the terminal only if a question is still on it and no card is open.
      win?.webContents.send('check-question', id);
    };
    ask = setTimeout(check, 2500);
  });
  p.onExit(() => {
    clearTimeout(ask);
    for (const c of cards.filter((c) => c.card.session === id)) closeCard(c); // its questions died with it
    if (term === p) win?.webContents.send('pty-data', '\r\n[claude exited]\r\n');
  });
}

function openSession(id: string): void {
  const branch = branches.find((b) => b.id === id);
  if (fs.existsSync(sessionFile(id))) runClaude(id, ['--resume', id]);
  else if (branch?.forkUuid) runClaude(id, ['--session-id', id, '--resume', branch.parent, '--fork-session']); // made before cut files
  else runClaude(id, ['--session-id', id]); // new session, or a Retry of a first reply
}

/** New branch of `parent` ending at forkUuid (null: a fresh session). Saved in branches.json, then opened. */
function newBranch(parent: string, forkUuid: string | null, words: string): string | null {
  const id = randomUUID();
  if (forkUuid) {
    try {
      const cut = cutSession(fs.readFileSync(sessionFile(parent), 'utf8'), forkUuid, id);
      fs.writeFileSync(sessionFile(id), cut, { flag: 'wx', mode: 0o600 }); // a new file; never overwrites
    } catch (e) {
      win?.webContents.send('note', `Could not make the branch: ${(e as Error).message}`);
      return null;
    }
  }
  loadBranches();
  branches.push({ id, parent, forkUuid: forkUuid ?? '', forkWords: words, created: new Date().toISOString() });
  saveBranches();
  runClaude(id, forkUuid ? ['--resume', id] : ['--session-id', id]);
  return id;
}

/** Type text into claude and press Enter. Only for the user's own Enter or Retry click. */
function typeText(text: string): void {
  const t = term;
  if (!t) return;
  t.write(text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text); // several lines go in as one paste
  setTimeout(() => term === t && t.write('\r'), 150); // separate write, so claude does not treat Enter as pasted text
}

// The /usage screen the app opened to read the bars (see 'usage-open'). Only then is Esc pressed.
let usageReading = false;
let usageAt = 0;
function closeUsage(): void {
  if (!usageReading) return;
  usageReading = false;
  usageAt = Date.now();
  term?.write('\x1b');
}

const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, ' ').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');

/** Retry: once the new claude is idle, type its one message. If claude shows a question or never
 *  settles, nothing is sent; the message goes into the chat box for the user to send. */
function typeWhenReady(p: pty.IPty, text: string): void {
  let seen = '';
  let quiet: NodeJS.Timeout | undefined;
  const started = Date.now();
  const finish = (ready: boolean) => {
    data.dispose();
    exit.dispose();
    clearTimeout(quiet);
    clearTimeout(limit);
    if (term !== p || !pending || pending.stage !== 'waiting') return;
    chatKey = '';
    if (ready && !/Enter to confirm|Esc to cancel/.test(plain(seen))) {
      typeText(text);
      const sent = pending;
      sent.stage = 'sent';
      setTimeout(() => {
        if (pending !== sent) return;
        pending = null; // the message never showed up in the file
        chatKey = '';
      }, 60000);
    } else {
      pending = null;
      win?.webContents.send('prefill', text);
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

async function chooseFolder(): Promise<string | null> {
  // Optional folder argument: `npm start -- /some/folder`. In dev the first plain argument is the app path.
  const arg = process.argv.slice(1).filter((a) => !a.startsWith('-'))[app.isPackaged ? 0 : 1];
  if (arg && fs.existsSync(arg) && fs.statSync(arg).isDirectory()) return path.resolve(arg);
  const r = await dialog.showOpenDialog({
    title: 'Choose a folder to run claude in',
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
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
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Clade',
        submenu: [
          { role: 'about' },
          { label: 'Settings…', accelerator: 'Cmd+,', click: () => win?.webContents.send('shortcut', 'settings') },
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
          { label: 'Attach Files…', accelerator: 'Cmd+U', click: () => win?.webContents.send('shortcut', 'attach') },
          { label: 'Mode…', accelerator: 'Cmd+Shift+P', click: () => win?.webContents.send('shortcut', 'mode') },
          { label: 'Thinking…', accelerator: 'Cmd+Shift+E', click: () => win?.webContents.send('shortcut', 'effort') },
          { label: 'Model…', accelerator: 'Cmd+Shift+M', click: () => win?.webContents.send('shortcut', 'model') },
          { label: 'Skills…', accelerator: 'Cmd+Shift+K', click: () => win?.webContents.send('shortcut', 'skills') },
        ],
      },
      {
        label: 'Design',
        submenu: [
          { label: 'Theme: Follow System', click: () => setTheme('system') },
          { label: 'Theme: Light', click: () => setTheme('light') },
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
    backgroundColor: current.colors[resolveTheme(current.theme, nativeTheme.shouldUseDarkColors)].background,
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
    term?.kill();
  });

  // Renderer is ready: apply design, then start claude at the terminal's size.
  ipcMain.on('start', (_e, cols: number, rows: number) => {
    load();
    sendSettings();
    size = { cols, rows };
    chatKey = treeKey = cardsKey = '';
    sendCards();
    if (cardsError) {
      win?.webContents.send('note', `Permission cards are off: ${cardsError}`);
      showTerminal(`Permission cards are off: ${cardsError}`);
    }
    if (ruleError) win?.webContents.send('note', ruleError);
    win?.webContents.send('artifacts', artifacts?.list() ?? []);
    if (term) return;
    loadBranches();
    const id = randomUUID(); // the app picks the id, so it knows exactly which file to read
    runClaude(id, ['--session-id', id]);
  });

  // Branch (user click only): new branch ending at that reply (no id: the newest reply). From the
  // graph, the reply may belong to another session (given as `from`); the same branch logic applies.
  ipcMain.on('branch', (_e, replyId?: unknown, from?: unknown) => {
    if (readSession(sessionId)?.working || pending) return; // a branch restarts claude: not while it works
    const parent = typeof from === 'string' && UUID.test(from) ? from : viewId;
    const chat = readSession(parent);
    if (!chat) return;
    const r = typeof replyId === 'string' ? chat.replies.find((x) => x.id === replyId) : chat.replies.at(-1);
    if (r?.forkUuid) newBranch(parent, r.forkUuid, firstWords(r.text) || '(fork)');
  });

  // Retry (user click only): new branch ending right before that reply, then send its user message once.
  ipcMain.on('retry', (_e, replyId: unknown) => {
    const chat = readSession(viewId);
    if (!chat || readSession(sessionId)?.working || pending || typeof replyId !== 'string') return;
    const r = chat.replies.find((x) => x.id === replyId);
    if (!r?.text || (!r.first && !r.retryCut)) return;
    const id = newBranch(viewId, r.first ? null : r.retryCut, 'retry: ' + firstWords(r.userText));
    if (!id || !term) return;
    pending = { id, stage: 'waiting', count: chat.replies.indexOf(r) };
    typeWhenReady(term, r.userText);
  });

  // A card click (user click only). Checked against the card; anything that does not fit sends nothing.
  ipcMain.on('card-answer', (_e, id: unknown, a: unknown) => {
    const p = cards.find((x) => x.card.id === id);
    if (!p || p.card.session !== sessionId || p.card.expired || !p.res || typeof a !== 'object' || a === null) return;
    let body: string;
    try {
      body = answerBody(p.input, p.card, a as Action);
    } catch (e) {
      win?.webContents.send('note', `Nothing sent: ${(e as Error).message}`);
      return;
    }
    closeCard(p, body);
    if ((a as Action).action === 'terminal') showTerminal('Answer Claude in the terminal.');
  });

  // Copy (user click only): the reply text, already stripped of style tags.
  ipcMain.on('copy', (_e, text: unknown) => typeof text === 'string' && clipboard.writeText(text));

  // New chat (user click only): a fresh session, started exactly like the one at app start.
  ipcMain.on('new-chat', () => {
    if (currentChat?.working || pending) return;
    if (!currentChat && !branches.some((b) => b.id === sessionId)) {
      viewId = sessionId; // the running one is an empty new chat already: just show it
      chatKey = treeKey = '';
      return;
    }
    const id = randomUUID();
    runClaude(id, ['--session-id', id]);
  });

  // Chat list or graph click (user click only): switch to that session.
  ipcMain.on('open-session', (_e, id: string) => {
    // Only shows the chat. Nothing is started until the user sends a message in it (chat-send).
    if (typeof id !== 'string' || !UUID.test(id) || id === viewId) return;
    loadBranches();
    viewId = id;
    chatKey = treeKey = '';
  });
  // ---- message box controls. Every handler runs on a user click or key; each re-checks its input. ----
  const idle = () => !!term && !currentChat?.working && !pending;
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
  // Stop: Esc in the terminal, exactly what the key does there.
  ipcMain.on('stop', () => term?.write('\x1b'));

  // Mode: Claude Code's own Shift+Tab cycle, pressed until the status line names the chosen mode.
  let cycling = false;
  async function cycleTo(target: Mode): Promise<void> {
    if (cycling || !idle()) return;
    cycling = true;
    try {
      for (let i = 0; i < MAX_MODE_PRESSES && modeNow !== target; i++) {
        const before = modeNow;
        const t = term;
        t?.write('\x1b[Z');
        for (let w = 0; w < 25 && modeNow === before && term === t; w++) await new Promise((r) => setTimeout(r, 60));
        if (modeNow === before || term !== t) break; // no answer from the status line: stop pressing
      }
      if (modeNow !== target) win?.webContents.send('note', 'Could not confirm the mode. Check the terminal (Cmd+J).');
    } finally {
      cycling = false;
    }
  }
  // Pickers and settings: model, thinking (effort), mode, zoom, tool steps. A new model or effort
  // restarts claude on the same session with its own flags (nothing is typed, no default is changed).
  ipcMain.on('set-options', (_e, patch: unknown) => {
    const before = settings;
    const next = applySettings(settings, patch);
    // A new model or effort restarts the running chat; while another chat is only shown, it applies at the next start.
    const restart = (next.model !== before.model || next.effort !== before.effort) && viewId === sessionId;
    if (restart && !idle() && ran.size) return void win?.webContents.send('note', 'Wait until Claude has finished, then change the model or thinking level.');
    saveSettings(patch);
    if (restart && term) {
      carryMode = modeNow && modeNow !== 'other' ? modeNow : '';
      loadBranches();
      if (fs.existsSync(sessionFile(sessionId)) || branches.some((b) => b.id === sessionId)) openSession(sessionId);
      else {
        const id = randomUUID(); // an empty new chat: start it again with the new flags
        runClaude(id, ['--session-id', id]);
      }
    } else if (next.mode && next.mode !== before.mode) void cycleTo(next.mode);
  });
  ipcMain.on('next-mode', () => idle() && term?.write('\x1b[Z')); // Shift+Tab in the message box
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
    // A look: only stored names are accepted, and only stored colors are written (themes.ts).
    const lk = (typeof o.look === 'object' && o.look !== null ? o.look : null) as Record<string, unknown> | null;
    if (lk) {
      const base = matchLook(current);
      const now = base === 'custom' ? (current.look ?? DEFAULT_LOOK) : base;
      const accent = isAccentName(lk.accent) ? lk.accent : now.accent;
      next = applyLook(next, { accent });
    }
    if (o.resetLook === true) {
      next = applyLook(next, DEFAULT_LOOK);
      next.theme = 'system';
    }
    writeDesign(next);
  });
  ipcMain.on('reset-design', reset);
  ipcMain.on('open-folder', () => void shell.openPath(folder));

  ipcMain.on('pty-write', (_e, d: string) => term?.write(d)); // only what the user types
  // Chat text box: type the user's text into the terminal, then press Enter. Only on the user's Enter.
  ipcMain.on('chat-send', (_e, text: unknown) => {
    if (typeof text !== 'string') return;
    if (viewId === sessionId) return typeText(text);
    // A chat that was only shown: start claude on it now, then type the message once it is ready.
    if (!idle()) {
      win?.webContents.send('note', 'Claude is still working in another chat. Send this when it has finished.');
      return void win?.webContents.send('prefill', text);
    }
    loadBranches();
    const count = readSession(viewId)?.replies.length ?? 0;
    openSession(viewId);
    if (!term) return;
    pending = { id: viewId, stage: 'waiting', count };
    typeWhenReady(term, text);
  });

  // ---- sidebar menu: account (read only), usage, help, the one fixed link ----
  ipcMain.on('account-refresh', () => refreshAccount(false));
  // Usage bars (on opening the menu only, never on a timer): type Claude Code's own /usage into the
  // hidden terminal; the page reads the numbers off its screen (usage.ts) and then asks for Esc, which
  // closes that screen again. The terminal is not shown. Nothing else is typed or pressed, so no
  // setting can change; the app reads no file for it and does not go online (Claude Code does).
  ipcMain.handle('usage-open', () => {
    if (!idle() || usageReading) return false;
    usageReading = true;
    usageAt = Date.now();
    typeText('/usage');
    setTimeout(() => usageReading && closeUsage(), 12_000); // the page never answered: close it anyway
    return true;
  });
  ipcMain.on('usage-close', () => closeUsage());
  ipcMain.on('show-usage', () => {
    if (!idle()) return void win?.webContents.send('note', 'Wait until Claude has finished, then show usage.');
    win?.webContents.send('show-term', "Usage, as Claude Code shows it. Esc closes it; Cmd+J hides the terminal.");
    typeText('/usage'); // Claude Code's own command: it fetches and draws the numbers; the app reads nothing
  });
  // Save a drawing (the Save button under it; user click only): a save dialog, then the file the user named.
  ipcMain.on('save-drawing', async (_e, svg: unknown, name: unknown) => {
    if (!win || typeof svg !== 'string' || !svg.startsWith('<svg ') || svg.length > 200_000) return;
    const base = (typeof name === 'string' ? name : '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'drawing';
    const r = await dialog.showSaveDialog(win, { title: 'Save drawing', defaultPath: path.join(folder, `${base}.svg`), filters: [{ name: 'SVG picture', extensions: ['svg'] }] });
    if (r.canceled || !r.filePath) return;
    try {
      fs.writeFileSync(r.filePath, svg);
      win.webContents.send('note', `Saved ${path.basename(r.filePath)}.`);
    } catch (e) {
      win.webContents.send('note', `Not saved: ${(e as Error).message}`);
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
  setInterval(pollSession, 300);
  ipcMain.on('pty-resize', (_e, cols: number, rows: number) => {
    size = { cols, rows };
    try {
      term?.resize(cols, rows);
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
