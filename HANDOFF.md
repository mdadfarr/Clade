# Handoff

State on 2026-11-19, branch as checked out, `npm test`: 183 pass, 0 fail
(with the uncommitted changes below in the tree).

## Goal

Clade is a desktop chat window for Claude Code (Electron, node-pty, xterm).
It runs the real `claude` in a hidden terminal, draws the conversation from
the session file, and makes Claude Code's own features (permissions, modes,
models, branching, skills) usable with the mouse. It must stay a thin, honest
layer over Claude Code:

- No API, no login, no tokens of its own. The app never goes online itself.
- It sends nothing except what the user clicks or types. It never clicks for
  the user and never auto-allows anything.
- Sessions, branching, retry and permissions keep working as they do now.
- design.json is data; Claude's text goes into the page as text nodes.
- Model tests: Haiku by default, Sonnet only where a plan says so, always
  `--model` and `--effort low`, short prompts. Never Opus or Fable. The
  user's global Claude Code setup is never changed.

The plans in `docs/` (`polish-plan.md` to `polish-plan-4.md`) are the spec;
each later plan overrides the earlier ones where they differ.
`docs/findings.md` records every check that was run, with numbers.

## What is done

- **Base**: chat view (serif replies, user bubble, folded tool steps, code
  coloring, KaTeX, tables, callouts, live preview while writing), message
  box with attachments and pickers (mode, thinking, model, skills), chat
  list, Copy / Retry / Branch, reply graph (Cmd+G, pinch out, smooth pinch
  between chat and graph), Cmd+J terminal.
- **Permission cards**: PermissionRequest hook (`hook.ts`) to a local HTTP
  server on 127.0.0.1 with a per-launch token; Allow once, Deny with reason,
  Always allow only with Claude Code's own suggestion; question cards;
  590 s expiry with a grey time bar; cards close when the session file shows
  the tool's result.
- **Reply format** (CLAUDE.md section the app writes, `claude-md.ts`):
  order is replies, color, blocks, artifacts, label, design.json. Color
  rule (1 to 3 short colored phrases per section), map nesting rule, reply
  label `{label=...}` on every reply.
- **Blocks the app draws**: `map` (foldable tree, measured indent step of
  2/3/4 spaces or tab, `├─`/`└─` lines, parents semibold, fold counts),
  `mem`, `timeline`, `compare`, `flow`, and inline `svg` drawings through a
  strict own parser (`draw.ts`; allowlist, app color names, Copy and Save).
- **Artifacts**: one self-contained file in `artifacts/`, sandboxed side
  panel with no network, bundled Chart.js / D3 / KaTeX, versions kept; the
  panel opens by itself when a file is written or changed after start.
- **Look**: one surface set (Paper), light / dark / system, 9 accents
  (Cyan, Mint, Blue, Violet, Pink, Coral, Amber, Green, Red) as stored
  values checked for contrast 4.5 everywhere they are drawn. No free color
  picker. Title effect: big plain heading (88 px) with a soft accent glow on
  hover (`effects.glow`).
- **Sidebar bottom**: account row from `claude auth status` run under
  `sandbox-exec (deny network*)` (only email and plan reach the page;
  Settings switch "Show account name"), menu with Settings, accents, usage
  bars (types `/usage` into the hidden terminal on menu open, reads the
  screen, presses Esc), Get help (`help.md` drawn like a reply), one fixed
  GitHub link, version.
- **Bugs fixed**: table cells break mid-word; jump arrow over text; orange
  macOS focus ring (now the app's own, keyboard only); dark dropdowns with
  dark text (`color-scheme`); red selection with the Red accent (selection
  is now a yellow highlight).
- **Latest commits**: opening a chat only shows it, sending a message starts
  Claude Code on it (`d2eeedc`); "prompt disappearing" fix in session parsing
  (`47032db`).

## Round 2026-11-19 (second session)

- **Stop bug**: Claude Code 2.1.328, stopped before the first word, writes no `[Request interrupted]`
  line and puts the message back in its own box (the message is left off the chain). The page sends
  the screen after Stop (`stop-screen`); once `esc to interrupt` is gone, main marks that last message
  as settled (`settled` map, `settle()` in session.ts), clears Claude Code's box (Ctrl+U, Backspace per
  row: `clearBoxKeys`) and puts the text back in the app's box. A freshly started claude also counts
  as idle. The parser shows "Interrupted" between a message with no answer and the next one.
- **Model default**: banner read when started without `--model` (`modelInBanner`), stored as
  `seenDefault` in app settings; picker shows "Default (Opus 5.5)". Thinking shows "Default (x)" only
  when no level is picked.
- **Rename**: `chat-names.json` in the project (`names.ts`); also reads Claude Code's own
  `custom-title` (`/rename`). Pencil on row hover, or double-click the top title.
- **Edit a message**: pencil under a user bubble, edit in place, Send = Retry with new text
  (`edit` IPC, shared `resend` in main). Pending count now taken from the new branch file.
- **Sidebar width**: drag `#sidegrip` (160-480), arrows, double-click = 240; saved to design.json.
- All checked in the real app over CDP with Haiku, scratch `--user-data-dir`. Note: in Plan mode
  Claude Code answered with Sonnet even with `--model haiku`.

## What is left

1. **Uncommitted work in the tree** (not written in the session that wrote
   this file; review before committing):
   - Reply with a selection: select text in a reply, a small Reply button
     appears beside it and puts the text into the message box as a `> `
     quote (`markup.ts` `quoteText`, `renderer.ts`, `app.css`, `preload.ts`,
     `main.ts`, test in `markup.test.ts`).
   - `cutSession` (`session.ts`): when one message has several tool calls,
     answers that hang beside the chain are now kept, so a Branch or Retry
     after parallel tool calls no longer fails or drops answers. Test in
     `session-paste.test.ts`.
2. **Color rule below its target.** Plan 3's mark is 5 of 6 replies passing;
   measured 3 of 6 (was 1 of 6 before the rewrite). Misses are single
   uncolored sections. Open choice for the user: accept, try another wording,
   or switch the caveman plugin off for Clade projects only
   (`enabledPlugins` in that project's `.claude/settings.local.json`; not
   done without a yes). A control run showed the plugin is not the main
   cause.
3. **Tree check below its target.** 1 of 3 Haiku runs had a map with two
   levels below the root. When a map is written its nesting is right; Haiku
   often writes no map for a short answer.
4. **Not seen on real hardware**: a real trackpad pinch and the glow's
   easing on screen (test windows were covered, which pauses animation).
5. **Small**: the `mem` box shows thin scrollbars; "Your own themes" is on
   the Settings "later" list; Red, Green and Pink accents look like the
   {bad}, {good}/{green} and {pink} tones (left as is, see decisions).

## Key files

| File | What |
|---|---|
| `src/main.ts` | main process: claude in a pty, sessions, branches, cards server, design.json, account, usage, IPC |
| `src/renderer.ts`, `index.html`, `app.css` | the page: chat, composer, cards, graph, Settings, sidebar menu, help |
| `src/md.ts`, `diagrams.ts`, `draw.ts` | reply drawing, block diagrams, strict SVG drawing parser |
| `src/markup.ts`, `highlight.ts` | tag, map, mem, timeline, compare, flow, table parsers; code coloring (pure) |
| `src/session.ts`, `branches.ts`, `chats.ts`, `graph.ts` | session parsing and cutting, branch file, chat list, reply graph (pure) |
| `src/cards.ts`, `hook.ts`, `timeleft.ts` | permission cards, the hook script, time bar |
| `src/design.ts` (+ `design-v1.ts`, `design-v2.ts`) | design.json schema, validation, contrast, old formats |
| `src/themes.ts` | the stored surface set and 9 accents |
| `src/account.ts`, `usage.ts` | `auth status` and `/usage` screen readers (pure) |
| `src/claude-md.ts` | the CLAUDE.md section |
| `src/colorcount.ts` | counting colors and sections in replies, for the color-rule tests |
| `src/artifacts.ts`, `artifact-host.ts` | artifact rules and the sandboxed panel |
| `src/settings.ts`, `composer.ts`, `skills.ts`, `stream.ts`, `pinch.ts` | app settings and claude flags, attachments, skills, live preview, pinch |
| `src/*.test.ts` | one test file per pure module, plus source-rule tests (`css.test.ts`, `mainrules.test.ts`, `help.test.ts`) |
| `help.md` | in-app help page |
| `docs/polish-plan*.md`, `docs/findings.md` | the spec, and every check with its numbers |

## Decisions made

- **Thin layer**: everything goes through Claude Code itself (typed slash
  commands, its hook, its settings keys). The app reads no login files.
- **Network**: the app listens on 127.0.0.1 only; `auth status` runs with
  network denied; the only web link is one hard-coded URL with no input from
  the page (checked by a test on `main.ts`).
- **Hand-set colors**: accents and surfaces are stored, not computed at pick
  time; a test walks every combination. Colored text is checked on
  background, surface and code background; only body and muted text on
  `raised` (hover rows, code headers, icons). Green dark `#06A802`, Red dark
  `#FF4D4D`.
- **Accent clashes left alone**: no underline, icon or chip for Red vs
  {bad}, Green vs {good}, Pink vs {pink}; the user will change colors later
  if needed.
- **Themes dropped** (plan 4): only Paper. `look.theme` in old files is
  accepted and ignored.
- **Halftone dropped** (plan 4): replaced by the plain big title with a
  hover glow. Old `effects.dither` keys are accepted and ignored; `fx=mono`
  draws the same title.
- **Drawings inline, artifacts only for things to keep**: `svg` blocks in
  the reply, never an .svg file for an explanation.
- **Usage**: read off Claude Code's own `/usage` screen on menu open only,
  never on a timer; no stored numbers.
- **Map format**: indent step measured per block; a tab is one level; mixed
  steps show the block as code.
- **Testing method**: real app driven over the DevTools protocol (port
  9223); hand-written session files for UI checks without a model; Chromium
  switches `--disable-backgrounding-occluded-windows
  --disable-renderer-backgrounding` when the test window is covered; CDP media
  emulation must stay on the same connection; screenshots for the repo are
  taken with "Show account name" off.
- **Commits**: small, one per milestone, only when asked; nothing global is
  ever changed for a test.
