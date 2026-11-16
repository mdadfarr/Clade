import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as pty from 'node-pty';
import { DEFAULT_DESIGN, Design, parseDesign } from './design';
import { Chat, cutSession, parseSession } from './session';
import { Branch, firstWords, parseBranches, UUID } from './branches';
import { randomUUID } from 'crypto';

const MD_START = '<!-- design-app:start -->';
const MD_END = '<!-- design-app:end -->';
const MD_OLD_MARKER = '## design.json (app appearance)'; // section written by the first version, always last in the file
const CLAUDE_MD = `${MD_START}
## design.json (app appearance)

You are running inside a desktop app. The app watches \`design.json\` in this
folder and re-applies it the moment the file changes. When the user asks to
change how the app looks, edit \`design.json\`. Nothing else is needed.

The window shows a chat view (the user's messages on the right, yours on the
left), optional panels, and a small terminal strip at the bottom.

Rules: valid JSON, every key below is required, no other keys are allowed.
If the file is invalid the app keeps the old design and shows an error.

\`\`\`
{
  "terminal": {
    "background": color,
    "textColor": color,
    "fontSize": number 6-40
  },
  "window": { "background": color },
  "panels": [
    {
      "id": string,
      "side": "left" | "right" | "bottom",
      "size": number 50-800 (pixels: width for left/right, height for bottom),
      "visible": true | false,
      "blocks": [ block, ... ]
    }
  ],
  "chat": {
    "font": font names, e.g. "Georgia, serif" (letters, digits, spaces, commas, hyphens only),
    "fontSize": number 6-40 (text box and small grey lines),
    "width": number 300-3000 (max width of the message column, pixels)
  },
  "userBox": { "background": color, "textColor": color },
  "claudeBox": { "background": color, "textColor": color },
  "headings": {
    "h1": { "size": number 6-72 (pixels), "weight": number 100-900, "color": color },
    "h2": { same keys },
    "h3": { same keys }
  },
  "body": { "size": number 6-40 (message text, pixels) },
  "bold": { "color": color },
  "code": { "background": color }
}
\`\`\`

color = hex ("#103010"), a color name ("darkgreen"), or "rgb(...)"/"rgba(...)".
"inherit" means: same as the surrounding text.

Block types (only these three):
- \`{ "type": "heading", "text": "..." }\`
- \`{ "type": "text", "text": "..." }\`
- \`{ "type": "list", "items": ["...", "..."] }\`

Example panel: a left to-do list
\`\`\`
{ "id": "todo", "side": "left", "size": 220, "visible": true, "blocks": [
  { "type": "heading", "text": "To do" },
  { "type": "list", "items": ["First thing", "Second thing"] }
] }
\`\`\`

## How to write replies (the chat view renders them)

Your replies are drawn in the chat view, not in a terminal. Write them like this:

- Use markdown headings (\`#\`, \`##\`, \`###\`), \`**bold**\`, lists and fenced code blocks.
- Write math as LaTeX: \`$...$\` inline, \`$$...$$\` as a block (may span lines;
  \`\\begin{pmatrix}\` etc. work). Do not put spaces right inside the single \`$\`.
- For emphasis you may color or resize text with this tag, choosing the
  colors and sizes yourself:
  \`{c=#e8a33d s=1.4}important text{/}\`
  - \`c\` = hex color (\`#rgb\` or \`#rrggbb\`), \`s\` = size multiplier 0.8 to 2.5.
    Either one alone is fine: \`{c=#ff8800}warm{/}\`, \`{s=1.8}big{/}\`.
  - Keep a tag inside one paragraph, heading or list item. Do not nest tags.
  - Pick colors that are readable on the claudeBox background; a color with
    too little contrast is ignored.
- No HTML. It is shown as plain text.
${MD_END}
`;

let win: BrowserWindow | null = null;
let term: pty.IPty | null = null;
let folder = '';
let designFile = '';
let current: Design = DEFAULT_DESIGN; // last working design
let error: string | null = null;

function send(): void {
  win?.webContents.send('design', current, error);
}

function load(): void {
  try {
    current = parseDesign(fs.readFileSync(designFile, 'utf8'));
    error = null;
  } catch (e) {
    error = (e as Error).message.replace(/\s+/g, ' ');
  }
  send();
}

function reset(): void {
  current = DEFAULT_DESIGN;
  error = null;
  send();
  try {
    fs.writeFileSync(designFile, JSON.stringify(DEFAULT_DESIGN, null, 2) + '\n');
  } catch {
    // window is already reset; file stays as it was
  }
}

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

let sessionId = ''; // the session shown in the chat and running in the terminal
let currentChat: Chat | null = null; // that session's own file, or null if it has no file yet
let chatKey = '';
let treeKey = '';
// A Retry waiting to type its one message into the new branch. Only set by a Retry click.
let pending: { id: string; stage: 'waiting' | 'sent'; count: number } | null = null;

const textOf = (chat: Chat, uuid: string) => chat.items.find((i) => i.uuid === uuid)?.text;
const isRetry = (b: Branch) => b.forkWords.startsWith('retry: ');

function pollSession(): void {
  if (!sessionId || !win) return;
  try {
    // 1. Chat of the current session.
    const branch = branches.find((b) => b.id === sessionId);
    const ownKey = statKey(sessionFile(sessionId));
    const key = `${sessionId}|${ownKey}|${ownKey ? '' : branch ? statKey(sessionFile(branch.parent)) : ''}|${pending?.stage ?? ''}`;
    if (key !== chatKey) {
      chatKey = key;
      currentChat = readSession(sessionId);
      if (pending && (pending.id !== sessionId || (pending.stage === 'sent' && (currentChat?.replies.length ?? 0) > pending.count))) {
        pending = null;
        chatKey = ''; // send once more without the pending flag
      }
      let shown = currentChat;
      let empty = !!(currentChat && branch && currentChat.lastAny === branch.forkUuid);
      if (!shown && branch?.forkUuid) {
        // a branch made with --fork-session before cut files: show the parent up to the fork point
        const parentText = fs.existsSync(sessionFile(branch.parent)) ? fs.readFileSync(sessionFile(branch.parent), 'utf8') : '';
        shown = { ...parseSession(parentText, branch.forkUuid), working: false };
        empty = true;
      }
      const items = [...(shown?.items ?? [])];
      if (empty && !pending) items.push({ role: 'tool', text: 'Empty branch: messages up to the fork point. Send a message to start it.' });
      const replies = (currentChat?.replies ?? []).map((r) => ({ id: r.id, copy: r.copy, branch: !!r.forkUuid, retry: r.first || !!r.retryCut }));
      const canBranch = !!currentChat?.replies.at(-1)?.forkUuid;
      win.webContents.send('chat', { items, replies, working: (shown?.working ?? false) || !!pending, canBranch });
    }

    // 2. Tree: branches.json plus every session file in the project's session folder.
    const files = fs.existsSync(sessionDir()) ? fs.readdirSync(sessionDir()).filter((n) => UUID.test(n.replace(/\.jsonl$/, '')) && n.endsWith('.jsonl')) : [];
    const tKey = [sessionId, statKey(branchesFile()), ...files.map((n) => n + statKey(path.join(sessionDir(), n)))].join('|');
    if (tKey === treeKey) return;
    treeKey = tKey;
    loadBranches();
    const ids = new Set(files.map((n) => n.slice(0, -6)));
    const nodes: { id: string; parent: string | null; label: string; full: string; created: string; empty: boolean }[] = [];
    for (const b of branches) {
      const parent = readSession(b.parent);
      const own = ids.has(b.id) ? readSession(b.id) : null;
      const empty = !own || own.lastAny === b.forkUuid; // a cut file with nothing sent yet is still empty
      const reply = parent?.replies.find((r) => r.forkUuid === b.forkUuid);
      nodes.push({
        id: b.id,
        parent: b.parent,
        label: empty ? 'empty branch' : b.forkWords,
        full: isRetry(b) ? b.forkWords : (parent && (reply?.text || textOf(parent, b.forkUuid))) || b.forkWords,
        created: b.created,
        empty,
      });
    }
    for (const id of ids) {
      if (branches.some((b) => b.id === id)) continue;
      const chat = readSession(id);
      const first = chat?.first ?? '';
      nodes.push({ id, parent: null, label: first ? firstWords(first) : '(no messages)', full: first || '(no messages)', created: chat?.created ?? '', empty: false });
    }
    if (!nodes.some((n) => n.id === sessionId)) {
      nodes.push({ id: sessionId, parent: null, label: 'new session', full: 'New session, no messages yet', created: new Date().toISOString(), empty: true });
    }
    for (const n of nodes) if (n.parent && !nodes.some((m) => m.id === n.parent)) n.parent = null;
    win.webContents.send('tree', { nodes, current: sessionId, error: branchesError });
  } catch (e) {
    console.error('session poll:', e);
  }
}

// Start claude for a session. Only called from the user's own actions (app start, Branch, Retry, node click).
let size = { cols: 80, rows: 10 };
function runClaude(id: string, args: string[]): void {
  const old = term;
  term = null;
  old?.kill();
  sessionId = id;
  chatKey = treeKey = '';
  win?.webContents.send('term-reset');
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
  p.onData((d) => term === p && win?.webContents.send('pty-data', d));
  p.onExit(() => term === p && win?.webContents.send('pty-data', '\r\n[claude exited]\r\n'));
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

  // Fixed menu. The reset shortcut lives here, outside design.json's reach.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { label: 'Design', submenu: [{ label: 'Reset Design', accelerator: 'Cmd+Shift+R', click: reset }] },
      { label: 'Terminal', submenu: [{ label: 'Bigger / Smaller Terminal', accelerator: 'Cmd+J', click: () => win?.webContents.send('toggle-term') }] },
    ]),
  );

  win = new BrowserWindow({
    width: 1100,
    height: 720,
    title: `claude — ${folder}`,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.on('closed', () => {
    win = null;
    term?.kill();
  });

  // Renderer is ready: apply design, then start claude at the terminal's size.
  ipcMain.on('start', (_e, cols: number, rows: number) => {
    load();
    size = { cols, rows };
    chatKey = treeKey = '';
    if (term) return;
    loadBranches();
    const id = randomUUID(); // the app picks the id, so it knows exactly which file to read
    runClaude(id, ['--session-id', id]);
  });

  // Branch (user click only): new branch ending at that reply (no id: the newest reply).
  ipcMain.on('branch', (_e, replyId?: unknown) => {
    const chat = readSession(sessionId);
    if (!chat || chat.working || pending) return;
    const r = typeof replyId === 'string' ? chat.replies.find((x) => x.id === replyId) : chat.replies.at(-1);
    if (r?.forkUuid) newBranch(sessionId, r.forkUuid, firstWords(r.text) || '(fork)');
  });

  // Retry (user click only): new branch ending right before that reply, then send its user message once.
  ipcMain.on('retry', (_e, replyId: unknown) => {
    const chat = readSession(sessionId);
    if (!chat || chat.working || pending || typeof replyId !== 'string') return;
    const r = chat.replies.find((x) => x.id === replyId);
    if (!r?.text || (!r.first && !r.retryCut)) return;
    const id = newBranch(sessionId, r.first ? null : r.retryCut, 'retry: ' + firstWords(r.userText));
    if (!id || !term) return;
    pending = { id, stage: 'waiting', count: chat.replies.indexOf(r) };
    typeWhenReady(term, r.userText);
  });

  // Copy (user click only): the reply text, already stripped of style tags.
  ipcMain.on('copy', (_e, text: unknown) => typeof text === 'string' && clipboard.writeText(text));

  // Tree node click (user click only): switch to that session.
  ipcMain.on('open-session', (_e, id: string) => {
    if (typeof id !== 'string' || !UUID.test(id) || id === sessionId || currentChat?.working || pending) return;
    loadBranches();
    openSession(id);
  });
  ipcMain.on('pty-write', (_e, d: string) => term?.write(d)); // only what the user types
  // Chat text box: type the user's text into the terminal, then press Enter. Only on the user's Enter.
  ipcMain.on('chat-send', (_e, text: unknown) => typeof text === 'string' && typeText(text));
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

  win.loadFile(path.join(__dirname, '..', 'index.html'));
});

app.on('window-all-closed', () => app.quit());
