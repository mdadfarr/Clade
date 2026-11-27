# Moving Clade off Electron: options and costs

Research only. No code was changed.
Written 2026-11-22. Electron in use: 39.8.10.
"Not verified" means: no source confirmed it, and no test was run.

## Terms

- **Electron**: Chromium (the browser engine of Chrome) plus Node.js in one app. Clade's current base.
- **Main process**: the Node side. Runs `dist/main.js`. Has files, processes, network.
- **Renderer**: the web page side. Runs `index.html` and its scripts. No Node access.
- **Preload**: a small script that runs before the page and gives it a safe `window.api`.
- **IPC** (inter-process communication): messages between main and renderer.
- **PTY** (pseudo-terminal): a fake terminal. `claude` thinks it runs in a real terminal.
- **node-pty**: the Node library that makes PTYs. It is a native addon.
- **Native addon**: compiled C/C++ code that Node loads. Must match the runtime it runs in.
- **WebView**: a browser engine shown inside an app window.
- **WKWebView**: Apple's WebView. Uses WebKit, the Safari engine. Ships with macOS.
- **System WebView**: the WebView the OS already has. The app does not ship its own engine.
- **CEF** (Chromium Embedded Framework): Chromium packed for use inside other apps.
- **Sidecar**: a separate program the app ships and starts as a child process.
- **Custom scheme**: an own URL type, like `clade-artifact://`, served by the app.
- **Partition / session**: a separate store for cookies, cache and storage.
- **Notarization**: Apple's scan of a signed app. Without it, macOS warns on first open.
- **Rewrite size**: S = days, M = 1–3 weeks, L = 1–2 months, XL = most of the app.

---

## Step 1. What Clade uses from Electron

### 1.1 Process layout

```
Electron app
├── main process (Node)          src/main.ts, src/artifact-host.ts
│   ├── one PTY per pane          node-pty → `claude`
│   ├── http hook server          127.0.0.1, random port
│   └── file watchers             fs.watch on the folder and artifacts/
├── preload                       src/preload.ts → window.api
├── renderer (main window)        index.html + dist/*.js
└── artifact view                 WebContentsView, own session, clade-artifact: scheme
```

### 1.2 Feature list

Each line: feature — what it does for the user — where.

```
Window and app
├── BrowserWindow — the app window, size, min size, title, background color before paint
│   └── src/main.ts:829
├── app.setName / app.dock.setIcon — "Clade" name and own Dock icon
│   └── src/main.ts:28, :757
├── app.getPath('userData') — where settings.json and the hook endpoint file live
│   └── src/main.ts:113, :501
├── app.whenReady / window-all-closed / will-quit — start-up, quit, clean-up of hook file
│   └── src/main.ts:738, :1261-1270
├── app.isPackaged — reads the folder argument right in dev and packaged builds
│   └── src/main.ts:715
├── process.execPath + ELECTRON_RUN_AS_NODE — the hook runs with Electron's own binary as Node
│   └── src/main.ts:524 (no separate Node needed on the user's machine)
└── win.loadFile — loads index.html from disk
    └── src/main.ts:1258

Menu and shortcuts
├── Menu.setApplicationMenu — the full macOS menu bar, all Cmd shortcuts (Cmd+T, Cmd+D, Cmd+J,
│   Cmd+G, Cmd+U, Cmd+Shift+R ...), roles about/hide/quit/editMenu (copy, paste, undo)
│   └── src/main.ts:761-826
└── reset shortcut lives in the menu, out of design.json's reach (a safety rule)
    └── src/main.ts:760, :816

IPC
├── contextBridge.exposeInMainWorld('api') — the whole page↔main API, ~70 calls
│   └── src/preload.ts:5-77
├── ipcMain.on / ipcMain.handle — ~45 handlers
│   └── src/main.ts:849-1257
├── webContents.send — main → page pushes: chat, pty-data, cards, design, settings, notes ...
│   └── src/main.ts:43, :222, :306 and more
└── dead: preload exposes makeBranch, saveWorkspace; main has no handler for them
    └── src/preload.ts:9-10

Native dialogs
├── dialog.showOpenDialog — choose the project folder at start
│   └── src/main.ts:717
├── dialog.showOpenDialog — Attach files (Cmd+U)
│   └── src/main.ts:1036
├── dialog.showOpenDialog — Add a skill folder
│   └── src/main.ts:1141
└── dialog.showSaveDialog — Save drawing as SVG
    └── src/main.ts:1219

shell
├── shell.openPath — open the project folder in Finder
│   └── src/main.ts:1174
├── shell.openExternal(SOURCE_URL) — the one fixed web link
│   └── src/main.ts:1228 (a test checks this: src/mainrules.test.ts:9)
└── shell.showItemInFolder — reveal an artifact in Finder
    └── src/artifact-host.ts:249

clipboard
└── clipboard.writeText — Copy buttons on replies and drawings
    └── src/main.ts:982 (paste of images uses the web clipboardData event: src/renderer.ts:895)

nativeTheme
├── themeSource — menus and native controls follow the app theme
│   └── src/main.ts:42
├── shouldUseDarkColors — "Follow system" theme; first paint color
│   └── src/main.ts:43, :836
└── on('updated') — live switch when macOS goes light/dark
    └── src/main.ts:1257

webUtils.getPathForFile
└── the real path of a file dropped on the message box (Claude Code reads the path)
    └── src/preload.ts:43, used at src/renderer.ts:1224

Zoom
├── webContents.setZoomFactor — Cmd+Plus / Cmd+Minus page zoom, kept in settings
│   └── src/main.ts:123; artifact view: src/artifact-host.ts:175, :255
└── setVisualZoomLevelLimits(1, 1) — a pinch never zooms the page itself
    └── src/main.ts:845-847

Trackpad pinch (src/pinch.ts, src/renderer.ts:1678-1697)
├── relies on Chromium on macOS: pinch → wheel event with ctrlKey = true, deltaY = -100·ln(scale)
├── PINCH_RATE = 0.02 is tuned to Chromium's deltaY size
├── preventDefault on that wheel stops page zoom
└── used for the continuous zoom between a chat and the reply graph

Artifact view (src/artifact-host.ts)
├── protocol.registerSchemesAsPrivileged — clade-artifact: as a standard, secure scheme
│   └── :25
├── session.fromPartition('artifact') — in-memory store shared with nothing
│   └── :128
├── ses.webRequest.onBeforeRequest — block every URL that is not clade-artifact:, data:, blob:
│   └── :130-138
├── ses.enableNetworkEmulation({ offline: true }) — second network lock
│   └── :139
├── setPermissionRequestHandler / CheckHandler → false — no camera, mic, location ...
│   └── :140-141
├── will-download blocked — :142
├── ses.protocol.handle — serves artifact files and the KaTeX/chart libs with a strict CSP header
│   └── :146-160
├── WebContentsView (sandbox, contextIsolation, no node, no devtools) — a native view over the page
│   └── :167-177
├── setWindowOpenHandler deny, will-navigate / will-frame-navigate / will-attach-webview blocked
│   └── :171-174
└── setBounds from the page's panel rectangle (artifact-bounds IPC) — the view follows the layout
    └── :183, :240; src/main.ts:863

Chromium-only web features used by the page
├── ::-webkit-scrollbar (thin themed scrollbars) — app.css:18-20
│   └── WebKit has it too. Firefox does not.
├── -webkit-line-clamp (two-line skill descriptions) — app.css:357
│   └── WebKit has it too.
├── -webkit-font-smoothing — app.css:4 (macOS only, WebKit has it)
├── color-mix() — app.css:16, :140, :164, :255, :437 (Safari 16.2+; not verified per macOS version)
├── innerText for quote text — src/renderer.ts:2316 (all engines)
├── ResizeObserver, matchMedia, HTML5 drag-drop — standard
└── no other Chromium-only API found in src/ (searched navigator.*, gesture*, showDirectoryPicker,
    execCommand, Workers, localStorage)

Processes and Node
├── node-pty spawn of `claude` per pane — src/main.ts:569-571
│   └── native addon; prebuilds for darwin-arm64 / darwin-x64 in node_modules/node-pty/prebuilds
├── execFile('/usr/bin/sandbox-exec' ... 'claude auth status') — account state, no network
│   └── src/main.ts:75
├── http.createServer on 127.0.0.1:0 — permission cards; token in a 0600 file
│   └── src/main.ts:465-510
├── src/hook.ts — the hook script Claude Code runs; talks to that server
└── fs.watch — folder and artifacts/ change detection — src/main.ts:1251, src/artifact-host.ts:120
```

### 1.3 Which files run where

```
Node side only (imported by main.ts)
├── main.ts, artifact-host.ts, hook.ts (child process)
├── account, artifacts, branches, cards, chats, claude-md, design, design-v1/v2,
│   graph, names, session, settings, skills, themes
└── none of these import 'electron' except main.ts and artifact-host.ts

Renderer only (script tags in index.html:138-153, plain scripts, no imports)
├── timeleft, pinch, markup, stream, usage, highlight, draw, md, diagrams, layout,
│   renderer, workspace
└── preload.ts (Electron-specific bridge)

Both
└── composer.ts — script tag in index.html:144 and require() in main.ts:18
```

Key point: only **three files touch Electron**: `main.ts`, `artifact-host.ts`, `preload.ts`.
The renderer talks only to `window.api`. Swap what is behind `window.api` and the page stays.

### 1.4 Tests

- 25 test files, **197 tests** today (not 183; `npm test` on 2026-11-22: 197 pass).
- No test imports `electron`. They run in plain Node (`node --test`).
- 3 tests read `src/main.ts` as text and match Electron call shapes:
  `shell.openExternal(...)`, `ipcMain.on('open-source', ...)`, `send('account', ...)`
  (`src/mainrules.test.ts:9-28`).
- `css.test.ts`, `design-v3.test.ts`, `themes.test.ts` read `app.css`, `index.html`, source files as text.

---

## Step 2. The options

### Option 1. Local server + browser tab

```
What it is
└── main.ts becomes a plain Node server. The UI opens at http://127.0.0.1:<port> in the user's browser.
What we rewrite
├── preload.ts → a small client: WebSocket for pushes, fetch/WebSocket for calls (M)
├── main.ts → drop Electron imports; ipcMain → WebSocket handlers (M)
├── dialogs, Finder, clipboard → browser or `osascript`/`open` (S–M)
└── artifact view → an <iframe sandbox> on a second origin (other port) (M)
What we keep
└── all renderer code, all Node modules, node-pty, the hook server, all tests but the 3 text tests
Size and memory
├── app: our JS only (a few MB) + node_modules. No engine shipped.
└── memory: one browser tab in the user's browser. not verified with numbers.
Build and ship
├── `npm install && node dist/server.js`, or `npx` a package
└── no .app needed. Optional: a tiny launcher .app.
Maturity
└── plain Node `http` + WebSocket. Very mature.
```

Needs Node on the user's machine (the hook today uses Electron as Node; it would use system Node).

### Option 2. Tauri 2 + Node sidecar

```
What it is
├── Tauri: a Rust app shell that shows the UI in the system WebView (WKWebView on macOS)
└── our TypeScript main side runs as a sidecar Node binary
What we rewrite
├── a small Rust shell: window, menu, dialogs, bridge between WebView and sidecar (M)
├── preload.ts → Tauri `invoke`/events, or the page talks straight to the sidecar on a local socket (M)
├── main.ts → remove Electron; becomes the sidecar's server (M)
└── artifact view → second webview (unstable API) or sandboxed iframe (M–L)
What we keep
└── renderer, Node modules, node-pty (inside the sidecar), tests except the 3 text tests
Size and memory
├── Tauri alone: 8.6 MiB demo vs 244 MiB Electron (Hopp); 57 MB vs 323 MB (Better Stack)
└── plus the sidecar: a Node single binary is tens of MB (not verified for our app)
Build and ship
├── sidecar built with @yao-pkg/pkg, `bun build --compile` or Node SEA, listed in `externalBin`
├── binary name must end in the target triple (e.g. -aarch64-apple-darwin)
├── native addons: pkg can't bundle .node loaded by dynamic path; Node SEA must write the
│   .node to a temp file before load. node-pty also ships `spawn-helper`. Needs care. not verified.
└── signing/notarization: built into the Tauri bundler (env vars)
Maturity
├── Tauri 2: stable since 2024, wide use
└── multi-webview (child webviews in one window) still behind the `unstable` flag (tauri 2.11 source)
```

### Option 3. Tauri 2, backend in Rust

```
What it is
└── same shell as Option 2, but main.ts logic is rewritten in Rust; PTY via portable-pty (from WezTerm)
What we rewrite
├── main.ts (1270 lines) + all Node-side modules: session parsing, chats, cards, design
│   validation, settings, skills, account, graph, hook server (XL)
└── the hook script (hook.ts) → a small Rust binary or keep a shell/Node script
What we keep
└── renderer and CSS only
Size and memory
└── smallest: Tauri shell only. Numbers as Option 2 without the sidecar.
Build and ship
└── `cargo tauri build`; signing/notarization in the bundler
Maturity
├── portable-pty: used by WezTerm; mature
└── tauri-plugin-pty: last release Dec 2023, marked "Developing" — not a safe base
```

### Option 4. Native Swift app + WKWebView

```
What it is
└── a small Swift/AppKit app. Window, menu, dialogs in Swift. UI is our page in a WKWebView.
Two forms
├── 4a: Swift shell + our Node code as a child process (like Option 2, but no Rust)
└── 4b: all backend in Swift; PTY with SwiftTerm's LocalProcess or forkpty
What we rewrite
├── 4a: Swift shell (window, menu, dialogs, WKScriptMessageHandler bridge) (M); main.ts as in Option 2
└── 4b: everything on the Node side, in Swift (XL)
What we keep
└── renderer and CSS; 4a also keeps all Node modules and node-pty
Artifact view
├── second WKWebView, WKWebsiteDataStore.nonPersistent() (in memory, never on disk)
├── WKURLSchemeHandler serves clade-artifact:
└── network block: WKContentRuleList or navigation delegate. Whether rules cover all
    sub-requests is not verified.
Size and memory
└── a Swift shell is a few MB (not verified); 4a adds the Node binary
Build and ship
├── Xcode or `swift build`; codesign + `notarytool` by hand or a script
└── no auto-update built in (Sparkle is the usual add-on; not researched here)
Maturity
└── WKWebView and AppKit: very mature. SwiftTerm: v1.15.0 builds clean on Swift 6.
```

### Option 5. Electrobun

```
What it is
├── TypeScript desktop framework. Bun runs the main side. Native parts in Zig.
└── macOS: WKWebView by default; CEF (Chromium) optional per window (`bundleCEF`)
What we rewrite
├── main.ts: Electron calls → Electrobun APIs (BrowserWindow, menus, dialogs, RPC) (M)
├── preload.ts → Electrobun typed RPC (M)
├── node-pty → may load under Bun (Node-API), or Bun.Terminal (Bun 1.3.5+), or bun-pty. not verified
└── artifact view → BrowserView or <electrobun-webview> with `partition` + `sandbox` (M)
What we keep
└── renderer, most Node modules (Bun runs Node APIs; full compat not verified), tests (run with node)
Size and memory
├── Better Stack test: 418 MB bundle (likely with CEF); not verified for WKWebView-only builds
└── Electrobun claims small bundles with the system webview; not verified
Build and ship
└── its own CLI builds and updates (bsdiff patches); codesign/notarize supported (not verified)
Maturity
├── v1 released; v1.18 current (CEF 147, Bun 1.3.11)
└── young; docs differ between mirrors; APIs "evolve quickly" (community guide)
```

### Option 6. Others that fit (macOS, TypeScript, PTY, web UI)

```
Deno desktop (`deno desktop`)
├── shipped in Deno 2.9.0, 2026-06-25, marked experimental
├── OS WebView default, CEF optional; one binary; ~40 MB (Deno docs) / ~68.5 MB (independent test)
├── no Rust toolchain needed
└── PTY: node-pty under Deno not verified. Too new to bet on.

Electron, slimmed (stay)
└── keep Electron; only fix what hurts (size via asar/pruning). Listed as the baseline.

Not a fit
├── Wails (Go backend) — backend rewrite in Go; drops TypeScript on the Node side
└── Neutralino — no PTY story found; not researched further
```

---

## Step 3. Features lost per option

Legend: **same** · **diff** (works differently, how) · **lost**.

### 3.1 Feature table

| Feature | 1 Server+tab | 2 Tauri+Node | 3 Tauri+Rust | 4 Swift+WKWebView | 5 Electrobun |
|---|---|---|---|---|---|
| App window, Dock icon, name | diff: a browser tab; no own Dock icon unless a launcher app | same | same | same | same |
| Native menu + Cmd shortcuts | diff: page keydown only; Cmd+T/W/D/[ ] taken by the browser | same (Rust menu) | same | same | same |
| Edit menu (copy, paste, undo) | same (browser has it) | same (predefined items) | same | same | same |
| IPC `window.api` | diff: WebSocket | diff: invoke/events or socket | diff: invoke/events | diff: WKScriptMessageHandler | diff: typed RPC |
| Folder dialog at start | diff: folder given on command line or typed; or `osascript` picker | same | same | same | same |
| Attach / skill / save dialogs | diff: `osascript` picker from server, or browser file input (no paths) | same | same | same | same |
| Dropped file path (`getPathForFile`) | **lost**: browsers never give paths. Upload copies instead | diff: native drop event gives paths; HTML5 drop and native drop conflict (known on Windows; macOS not verified) | same as 2 | diff: NSView drag handler gives paths | not verified |
| Paste image | same | same | same | same | same |
| Clipboard copy | same (`navigator.clipboard`, needs secure context: localhost counts) | same | same | same | same |
| Open folder / reveal in Finder / open URL | diff: server runs `open` | same (plugins) | same | same | same |
| Follow system light/dark | diff: CSS `prefers-color-scheme`; live switch works in the page | same | same | same | same |
| Native controls follow theme (`themeSource`) | lost (browser chrome follows the OS) | same (window theme API) | same | same | not verified |
| Cmd+Plus page zoom (setZoomFactor) | diff: browser zoom; not saved per app | diff: webview zoom API | diff | diff: `pageZoom` | not verified |
| Trackpad pinch → graph zoom | same in Chrome; Safari/Firefox give ctrlKey wheel too (W3C post 2024); deltaY size may differ → retune PINCH_RATE | diff: WKWebView: ctrlKey wheel reported for Safari; untested in WKWebView. not verified | as 2 | as 2; can also catch NSMagnificationGestureRecognizer natively and send scale | WKWebView: as 2. CEF: same as now |
| Block page pinch zoom | diff: preventDefault on ctrl-wheel; works in Chrome | diff: WKWebView `allowsMagnification` is off by default (not verified in Tauri) | as 2 | same (property) | not verified |
| Artifact view: own scheme | diff: second local port as origin | diff: custom scheme yes; second webview needs `unstable` | as 2 | same (WKURLSchemeHandler) | diff: `views://` style scheme; own scheme not verified |
| Artifact view: in-memory store | diff: iframe on other origin; storage per origin in the user's browser profile (persists) | not verified | not verified | same (`nonPersistent()`) | same (partition without `persist:`) |
| Artifact view: network block | diff: CSP header + iframe sandbox only; no request filter, no offline switch | diff: CSP; request filter not verified | as 2 | diff: content rules + CSP; coverage not verified | not verified |
| Artifact view: permissions off, no downloads, no navigation | diff: iframe `sandbox` (no `allow-*`) blocks most; downloads blocked by sandbox | not verified | not verified | same (delegates) | partly: `sandbox` disables RPC |
| Artifact view as native view over page | diff: plain iframe (simpler; no setBounds) | diff: child webview (unstable) or iframe | as 2 | same (second WKWebView) | same (`<electrobun-webview>`) |
| `-webkit-scrollbar`, line-clamp | Firefox: lost (falls back to default bars / no clamp) | same (WebKit) | same | same | same |
| `color-mix()` | same in current browsers | same on macOS with Safari 16.2+ engine | same | same | same |
| node-pty per pane | same | same (inside sidecar; packaging risk) | diff: portable-pty | 4a same; 4b SwiftTerm/forkpty | not verified under Bun |
| Hook server (127.0.0.1) | same | same (sidecar) | diff: Rust | 4a same | same (Bun http) |
| Hook script runtime (ELECTRON_RUN_AS_NODE) | diff: system `node` | diff: sidecar binary in a hook mode | diff: Rust binary | 4a: Node binary | diff: `bun` |
| `sandbox-exec` auth check | same | same | same | same | same |
| fs.watch | same | same | diff: notify crate | 4a same | same (Bun) |
| Window background before first paint | lost (white/black tab) | same (window color) | same | same | not verified |

### 3.2 Pinch zoom, in short

- Today: Chromium on macOS sends `wheel` with `ctrlKey` for pinch. `pinch.ts` uses `deltaY`.
- WebKit: bug 230545 asked for the same mapping on macOS. A 2024 W3C post says Safari now does it.
- So WKWebView likely works. **Not verified in WKWebView.** The `deltaY` scale may differ from Chromium.
- Fallback in WebKit: `gesturechange` gives `e.scale`. A small adapter in `renderer.ts` can map it.
- Swift (Option 4) can also read the native magnify gesture and post the scale. Always works.

### 3.3 Artifact view, in short

- Today it is a strong sandbox: own process, own memory store, request filter, offline, no permissions.
- Option 4 and 5 keep most of it with real native pieces.
- Option 1 drops to a browser iframe. Still sandboxed, but no request filter. CSP only.
- Option 2/3 need the `unstable` multi-webview API, or drop to an iframe.

### 3.4 Tests

```
Pure logic tests (21 files, 166 tests): run as they are in all options with Node.
├── Option 3 and 4b: the code they test moves to Rust/Swift. Tests then test dead code.
│   They must be rewritten in Rust/Swift, or the logic stays in TS and is not used.
└── Option 5: they still run under `node --test` (Bun also runs node:test; not verified).
Text tests on main.ts (mainrules.test.ts, 3 tests)
└── break in every option. They match Electron call shapes. Rewrite the regexes.
Files that read app.css / index.html / src as text (css, design-v3, themes: 28 tests)
└── run in all options while app.css, index.html and the renderer files stay.
```

### 3.5 What the user needs for "redesign the app with one prompt"

The Clade idea: the user's own `claude` edits the app's source, then it rebuilds.

| Option | Needs on the user's machine | Rebuild after an edit |
|---|---|---|
| Today (Electron) | Node + npm | `tsc`, restart |
| 1 Server + tab | Node + npm | `tsc`, reload tab (server restart only for Node-side edits) |
| 2 Tauri + Node | Node + npm; **Rust toolchain** for any shell edit; sidecar rebuild for main edits | UI edits: reload. Shell edits: `cargo` build (minutes) |
| 3 Tauri + Rust | **Rust toolchain**; Claude must write Rust for any backend change | `cargo` build for most changes |
| 4 Swift | **Xcode or Command Line Tools + Swift**; 4a also Node | Swift edits: `swift build` |
| 5 Electrobun | **Bun** (+ Zig not needed by users; not verified) | Bun build, restart |

UI-only redesigns (CSS, renderer) need no compiler beyond `tsc` in all options.

---

## Step 4. Features gained

Work: S = days, M = 1–3 weeks, L = more.

```
Option 1. Server + browser tab
├── use Clade from a phone, iPad, or another machine (M: auth token, bind address, TLS)
│   └── danger: anyone who reaches the port runs `claude` in your folder. Needs a token, LAN-only.
├── run headless on a server or over SSH, open in any browser (S)
├── many windows/tabs on one backend (S–M)
├── no app to install or sign; nothing to notarize (S)
├── fastest edit loop for the Clade idea (S)
└── lost "app feel": no own Dock icon, menus, window color
Option 2. Tauri + Node
├── much smaller app (Tauri shell; Node sidecar adds tens of MB)
├── lower memory (system WebView; one engine shared with Safari)
├── tray / menu bar app, global shortcuts, notifications: official plugins (S each)
├── auto-update: official updater, Ed25519-signed, plus notarization (M)
├── signing and notarization in the bundler; tauri-action for CI (S–M)
└── later: Windows/Linux builds come cheap (not a goal)
Option 3. Tauri + Rust
├── all of Option 2
├── smallest and fastest start
└── one language less at runtime; no Node needed at all
Option 4. Swift + WKWebView
├── full AppKit: menu bar extra, global hotkeys, notifications, Services, Quick Look, Spotlight (S–M each)
├── native pinch gesture, native drag with paths, native text input
├── smallest shell; Apple-native signing and notarization (notarytool) (S)
└── auto-update via Sparkle (M; not researched)
Option 5. Electrobun
├── stays TypeScript; closest API shape to Electron
├── per-window choice: WKWebView (small) or CEF (Chromium, same as today)
│   └── CEF gives an exit if WKWebView breaks pinch or the artifact view
├── built-in updater with small binary diffs (not verified)
└── Bun start-up speed (not verified for this app)
```

---

## Step 5. Compare and recommend

### 5.1 Table

| Option | Rewrite size | Features lost | Features gained | App size | Fit with Clade idea |
|---|---|---|---|---|---|
| 1 Server + tab | M | Dropped-file paths, native menu/shortcuts, Dock app feel, artifact request filter | Phone/remote use, headless, no signing, fastest edit loop | few MB + node_modules, no engine | Best: only Node |
| 2 Tauri + Node | M–L | Some artifact sandbox parts (unstable API), packaging risk with node-pty | Small, tray, updater, notarization | ~10 MB shell + Node binary (not verified) | Medium: Rust for shell edits |
| 3 Tauri + Rust | XL | Same as 2; TS backend and its tests | Smallest, all Tauri plugins | smallest | Poor: Claude must write Rust, user needs cargo |
| 4a Swift + Node | M–L | Little; artifact sandbox mostly kept | Full AppKit, native pinch | few MB shell + Node (not verified) | Medium: Xcode tools for shell edits |
| 4b Swift only | XL | TS backend and its tests | As 4a, no Node | smallest | Poor: Swift for every backend change |
| 5 Electrobun | M | Unknowns: node-pty under Bun, own scheme | TS kept, WKWebView or CEF, updater | WKWebView build small (not verified); CEF large | Good: TS + Bun |
| Stay on Electron | 0 | none | none | ~255 MB Electron.app today | Good: Node only |

### 5.2 Ranked recommendation

1. **Option 1, local server + browser tab, as the first step.**
   - Smallest change. Keeps all TS and almost all tests.
   - Forces a clean `window.api` transport (WebSocket). Every later option reuses it.
   - Best fit with the Clade idea: only Node on the user's machine.
   - Cost: dropped-file paths and native menus go. Remote use needs real auth.
2. **Option 5, Electrobun with WKWebView, as the app wrapper on top of that transport.**
   - Stays TypeScript. CEF is a fallback per window if WebKit fails.
   - Risk: young project, fast-moving API, node-pty under Bun unverified.
3. **Option 4a, Swift shell + Node child, if Electrobun fails the spikes.**
   - Most native and most stable base. Needs Xcode tools for shell edits.
4. Option 2 (Tauri + Node). Works, but adds Rust and the unstable multi-webview API for little extra.
5. Options 3 and 4b. Full backend rewrite. Breaks the Clade idea. Not advised.

Staying on Electron is still a valid answer if size is the only pain.

### 5.3 The two biggest risks and how to test them

**Risk 1: trackpad pinch in WKWebView.**
The graph zoom is a core gesture. WebKit may not send `ctrlKey` wheel events, or sizes may differ.

```
Throwaway test (half a day)
├── new folder; one HTML page that logs every `wheel` (ctrlKey, deltaY, deltaMode)
│   and every `gesturestart/gesturechange` (scale)
├── load it in: (a) Safari, (b) a 30-line Swift app with WKWebView, (c) an Electrobun hello app
├── pinch slowly in and out; compare logs to Clade's `CLADE_WHEEL_LOG=1` output in Electron
└── pass: ctrlKey wheels arrive, preventDefault stops page zoom, deltaY within ~2× of Chromium
```

**Risk 2: node-pty + `claude` under the new runtime and packaging.**
Every pane is a PTY. If it fails, nothing works.

```
Throwaway test (one day)
├── script: spawn `claude --version`, then an interactive `claude` in a PTY; resize; write Esc; read output
├── run it: (a) plain Node, (b) `bun run`, (c) Bun.Terminal instead of node-pty,
│   (d) as a compiled single binary (`bun build --compile` and Node SEA), started from a signed .app
├── check: spawn-helper found, resize works, Unicode and colors arrive, child dies on quit
└── pass: all four in (d) on a clean user account with Gatekeeper on
```

---

## Sources

- Tauri, Node.js as a sidecar: https://v2.tauri.app/learn/sidecar-nodejs/
- Tauri webview JS reference (child webviews are unstable): https://v2.tauri.app/reference/javascript/api/namespacewebview
- Tauri 2.11 webview source (unstable gate): https://docs.rs/crate/tauri/2.11.0/source/src/webview/plugin.rs
- Tauri custom protocol handler changes: https://v2.tauri.app/release/tauri/v2.0.0-rc.17
- Tauri drag-drop vs HTML5 (Windows, Jan 2026): https://wyhinton.github.io/2026/01/14/Tauri-DragAndDrop-Issues
- Tauri issue 9528 (wheel event missing): https://www.github.com/tauri-apps/tauri/issues/9528
- Tauri discussion 3843 (disable pinch magnify): https://github.com/tauri-apps/tauri/discussions/3843
- Tauri signing/notarization guide: https://dev.to/tomtomdu73/ship-your-tauri-v2-app-like-a-pro-code-signing-for-macos-and-windows-part-12-3o9n
- Tauri updater notes: https://stuffbucket.github.io/skills/catalog/tauri-updater/
- tauri-plugin-pty: https://lib.rs/crates/tauri-plugin-pty
- portable-pty: https://docs.rs/portable-pty
- Tauri vs Electron sizes (Hopp): https://dev.to/gethopp/tauri-vs-electron-performance-bundle-size-and-the-real-trade-offs-1el4
- Tauri vs Electron vs Deno vs Electrobun (Better Stack): https://betterstack.com/community/guides/scaling-nodejs/tauri-vs-electron-vs-deno-vs-electrobun/
- Electrobun repo: https://github.com/blackboardsh/electrobun
- Electrobun v1 post: https://blackboard.sh/blog/electrobun-v1/
- Electrobun compatibility (WKWebView/CEF): https://framework.blackboard.sh/electrobun/guides/compatability/
- Electrobun v1.18.0 changelog: https://framework.blackboard.sh/electrobun/guides/changelog/v1-18-0/
- Electrobun bundling CEF: https://blackboard.sh/electrobun/docs/apis/bundling-cef
- Electrobun BrowserView (partition, sandbox): https://framework.blackboard.sh/electrobun/apis/browser-view/
- Electrobun webview tag: https://framework.blackboard.sh/electrobun/apis/browser/electrobun-webview-tag/
- Bun 1.3.5 (Bun.Terminal PTY): https://bun.com/blog/bun-v1.3.5
- Bun Node-API: https://bun.com/docs/runtime/node-api
- bun-pty: https://github.com/flatina/bun-pty
- Node.js single executable applications: https://nodejs.org/api/single-executable-applications.md
- Deno desktop: https://docs.deno.com/runtime/desktop/
- Deno desktop news (2.9, June 2026): https://www.devclass.com/development/2026/06/25/deno-project-is-going-to-add-cross-platform-desktop-apps-in-next-major-update/5261530
- WebKit bug 230545 (pinch → ctrl wheel): https://bugs.webkit.org/show_bug.cgi?id=230545
- WebKit bug 145214: https://bugs.webkit.org/show_bug.cgi?id=145214
- W3C list, pinch gives ctrlKey wheel in Safari too (Oct 2024): https://lists.w3.org/Archives/Public/public-webapps-github/2024Oct/0088.html
- Pinch gestures in the DOM: https://dev.to/danburzo/pinch-me-i-m-zooming-gestures-in-the-dom-a0e
- Apple WKWebsiteDataStore: https://developer.apple.com/documentation/webkit/wkwebsitedatastore
- Apple WKURLSchemeHandler: https://developer.apple.com/documentation/webkit/wkurlschemehandler
- Apple WKContentRuleListStore: https://developer.apple.com/documentation/webkit/wkcontentruleliststore
- SwiftTerm: https://github.com/migueldeicaza/SwiftTerm
- SwiftTerm LocalProcess: https://migueldeicaza.github.io/SwiftTerm/Classes/LocalProcess.html
