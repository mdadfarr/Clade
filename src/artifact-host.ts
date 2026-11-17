// Artifacts, the running part: watches <project>/artifacts/, keeps versions, serves files over the
// clade-artifact: scheme, and shows one artifact in a sandboxed view of its own (separate session,
// no Node, no preload, every network request cancelled). The view cannot reach the app or Claude.
import { BrowserWindow, protocol, session, shell, WebContentsView } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  ARTIFACT_NAME, ArtifactType, CONTENT_TYPES, CSP, MAX_BYTES, nextVersion, resolveUrl, SCHEME, svgPage, typeOf, urlFor, versionNumbers, versionPath, versionsToPrune,
} from './artifacts';

export interface ArtifactInfo {
  name: string;
  type: ArtifactType;
  versions: number; // how many are saved
  deleted: boolean; // the file is gone; its versions remain
}
export interface ArtifactShown extends ArtifactInfo {
  version: number; // the one on screen
  latest: boolean;
  text?: string; // .md only: drawn by the app's own reply renderer
}

/** Must run before the app is ready. */
export function registerArtifactScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);
}

export function startArtifacts(win: BrowserWindow, folder: string, log: boolean) {
  const dir = path.join(folder, 'artifacts');
  const libs = path.join(__dirname, '..', 'node_modules');
  const send = (channel: string, ...args: unknown[]) => !win.isDestroyed() && win.webContents.send(channel, ...args);
  fs.mkdirSync(dir, { recursive: true });

  // ---- files and versions ----
  const seen = new Map<string, string>(); // name -> "mtime:size" of the file last snapshotted
  let list: ArtifactInfo[] = [];
  let open: { name: string; version: number | null } | null = null; // null version: follow the newest
  let primed = false; // the first scan only learns what is there; later writes open the panel

  const numbers = (name: string): number[] => {
    try {
      return versionNumbers(fs.readdirSync(path.join(dir, '.versions', name)), name);
    } catch {
      return [];
    }
  };
  const readVersion = (name: string, n: number) => fs.readFileSync(path.join(dir, versionPath(name, n)));

  /** Save the file as a new version unless it is byte-identical to the last one. */
  function snapshot(name: string): void {
    const data = fs.readFileSync(path.join(dir, name));
    const nums = numbers(name);
    if (nums.length && readVersion(name, nums[nums.length - 1]).equals(data)) return;
    const file = path.join(dir, versionPath(name, nextVersion(nums)));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data, { flag: 'wx' });
    for (const n of versionsToPrune([...nums, nextVersion(nums)])) fs.rmSync(path.join(dir, versionPath(name, n)), { force: true });
  }

  function scan(): void {
    const next: ArtifactInfo[] = [];
    const changed: string[] = [];
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((n) => ARTIFACT_NAME.test(n));
    } catch {
      // folder removed: only saved versions show
    }
    for (const name of names) {
      try {
        const st = fs.lstatSync(path.join(dir, name));
        if (!st.isFile() || st.size > MAX_BYTES) continue; // links, folders and huge files are ignored
        const key = `${st.mtimeMs}:${st.size}`;
        if (seen.get(name) !== key) {
          snapshot(name);
          seen.set(name, key);
          changed.push(name);
        }
        next.push({ name, type: typeOf(name), versions: numbers(name).length, deleted: false });
      } catch {
        // changed while reading: the next watch event picks it up
      }
    }
    let saved: string[] = [];
    try {
      saved = fs.readdirSync(path.join(dir, '.versions')).filter((n) => ARTIFACT_NAME.test(n));
    } catch {
      // none yet
    }
    for (const name of saved) {
      if (next.some((a) => a.name === name) || !numbers(name).length) continue;
      seen.delete(name);
      next.push({ name, type: typeOf(name), versions: numbers(name).length, deleted: true });
    }
    next.sort((a, b) => a.name.localeCompare(b.name));
    if (JSON.stringify(next) !== JSON.stringify(list)) {
      list = next;
      send('artifacts', list);
    }
    const wasPrimed = primed;
    primed = true;
    const fresh = changed.filter((n) => next.some((a) => a.name === n && !a.deleted));
    if (wasPrimed && fresh.length && !(open && open.version !== null && fresh.includes(open.name))) {
      // Written or changed while the app runs (Claude saved it): show it at once, newest version.
      // An older version the user is looking at stays on screen; its count still updates below.
      show(fresh[fresh.length - 1], null);
      return;
    }
    if (open && open.version === null && changed.includes(open.name)) show(open.name, null); // the open one was saved again
    else if (open && !list.some((a) => a.name === open!.name)) close();
    else if (open && changed.includes(open.name)) show(open.name, open.version); // the version count changed
  }

  let timer: NodeJS.Timeout | undefined;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(scan, 150);
  };
  try {
    fs.watch(dir, soon);
  } catch {
    // no watching: the list still updates when a card is opened
  }
  const poll = setInterval(scan, 3000); // also catches a folder that was deleted and made again
  win.on('closed', () => clearInterval(poll));

  // ---- the sandbox ----
  const ses = session.fromPartition('artifact'); // in memory only; shared by nothing else
  const blocked: string[] = [];
  ses.webRequest.onBeforeRequest((d, cb) => {
    const ok = d.url.startsWith(`${SCHEME}://`) || d.url.startsWith('data:') || d.url.startsWith('blob:') || d.url === 'about:blank';
    if (!ok) {
      blocked.push(d.url.slice(0, 200));
      if (blocked.length > 100) blocked.shift();
      if (log) console.log(`artifact blocked: ${d.url.slice(0, 200)}`);
    }
    cb({ cancel: !ok });
  });
  ses.enableNetworkEmulation({ offline: true }); // a second lock on top of the request filter
  ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (e) => e.preventDefault());

  const respond = (body: Buffer | string, type: string) =>
    new Response(body as BodyInit, { headers: { 'content-type': type, 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' } });
  ses.protocol.handle(SCHEME, (req) => {
    const t = resolveUrl(req.url);
    try {
      if (req.method !== 'GET' || !t) throw new Error('not found');
      if (t.kind === 'lib') return respond(fs.readFileSync(path.join(libs, t.file)), t.type);
      if (t.kind === 'view') return respond(svgPage(t.name), CONTENT_TYPES.html);
      const file = t.version ? path.join(dir, versionPath(t.name, t.version)) : path.join(dir, t.name);
      const st = fs.lstatSync(file);
      if (!st.isFile() || st.size > MAX_BYTES) throw new Error('not found');
      return respond(fs.readFileSync(file), CONTENT_TYPES[typeOf(t.name)]);
    } catch {
      if (log) console.log(`artifact 404: ${req.url.slice(0, 200)}`);
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain', 'content-security-policy': CSP } });
    }
  });

  let view: WebContentsView | null = null;
  let bounds: Electron.Rectangle | null = null; // in page pixels (before the window's zoom)
  let zoom = 1;
  function ensureView(): WebContentsView {
    if (view) return view;
    const v = new WebContentsView({
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false, spellcheck: false },
    });
    v.setBackgroundColor('#ffffff');
    v.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    v.webContents.on('will-navigate', (e) => e.preventDefault()); // links inside an artifact go nowhere
    v.webContents.on('will-frame-navigate', (e) => e.preventDefault());
    v.webContents.on('will-attach-webview', (e) => e.preventDefault());
    v.webContents.on('did-finish-load', () => v.webContents.setZoomFactor(zoom)); // the page zoom applies to artifacts too
    v.setVisible(false);
    win.contentView.addChildView(v);
    return (view = v);
  }
  function place(): void {
    if (!view) return;
    const show = !!bounds && !!open && typeOf(open.name) !== 'md';
    if (show) view.setBounds({ x: Math.round(bounds!.x * zoom), y: Math.round(bounds!.y * zoom), width: Math.round(bounds!.width * zoom), height: Math.round(bounds!.height * zoom) });
    view.setVisible(show);
  }

  /** Show an artifact (user click, or the open one was saved again). version null = the newest. */
  function show(name: string, version: number | null): void {
    if (typeof name !== 'string' || !ARTIFACT_NAME.test(name)) return;
    scan();
    const info = list.find((a) => a.name === name);
    const nums = numbers(name);
    if (!info || !nums.length) return;
    const want = typeof version === 'number' && nums.includes(version) && version !== nums[nums.length - 1] ? version : null;
    const n = want ?? nums[nums.length - 1];
    open = { name, version: want };
    const fromVersion = want !== null || info.deleted; // a deleted file is shown from its last version
    const shown: ArtifactShown = { ...info, version: nums.indexOf(n) + 1, latest: want === null };
    if (info.type === 'md') {
      try {
        shown.text = (fromVersion ? readVersion(name, n) : fs.readFileSync(path.join(dir, name))).toString('utf8');
      } catch {
        shown.text = '';
      }
    } else {
      void ensureView()
        .webContents.loadURL(urlFor(name, fromVersion ? n : null))
        .catch(() => {});
    }
    send('artifact-shown', shown);
    place();
  }

  function close(): void {
    open = null;
    const v = view;
    view = null;
    if (v) {
      win.contentView.removeChildView(v);
      v.webContents.close();
    }
    send('artifact-shown', null);
  }

  return {
    list: () => list,
    scan,
    show,
    /** Step to the version before or after the one shown. */
    step(delta: number): void {
      if (!open) return;
      const nums = numbers(open.name);
      const at = open.version === null ? nums.length - 1 : nums.indexOf(open.version);
      const to = nums[at + (delta < 0 ? -1 : 1)];
      if (to !== undefined) show(open.name, to);
    },
    reload: () => open && show(open.name, open.version),
    close,
    /** Where the page's panel is (window coordinates), or null to hide the view (panel covered or closed). */
    setBounds(b: unknown): void {
      const r = b as Electron.Rectangle | null;
      const ok = !!r && [r.x, r.y, r.width, r.height].every((n) => Number.isFinite(n) && n >= 0 && n < 20000) && r.width > 0 && r.height > 0;
      bounds = ok ? { x: r!.x, y: r!.y, width: r!.width, height: r!.height } : null;
      place();
    },
    reveal(): void {
      if (!open) return;
      const file = path.join(dir, open.name);
      shell.showItemInFolder(fs.existsSync(file) ? file : dir);
    },
    blocked: () => [...blocked],
    /** The window's zoom factor: the view is placed in zoomed pixels and its page zooms the same. */
    setZoom(z: number): void {
      zoom = z;
      view?.webContents.setZoomFactor(z);
      place();
    },
  };
}
