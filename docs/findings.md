# Findings

## Milestone 0: when does the session file update? (2026-11-15, Claude Code 2.1.325)

Question: does `~/.claude/projects/<folder>/<session-id>.jsonl` update while
Claude writes, or only after the reply is complete?

Answer: only after. No token streaming into the file.

Test: polled the file size every 200 ms during a live interactive session.
- While a reply's text streamed (about 10 s): no growth at all.
- Entries were appended in a batch once a step finished: the assistant
  entries (thinking, text, tool_use; one JSON line per block) and the
  tool_result together, right after the tool returned.
- So a multi-tool turn appears step by step; a single reply appears whole.

Consequence: the chat view shows "Claude is working..." until the reply lands.

Other facts used by the app:
- `<folder>` is the real path with every non-alphanumeric character replaced by `-`.
- Lines with `isMeta` or `isSidechain` are not conversation messages.
- The final assistant entry of a turn has `message.stop_reason: "end_turn"`;
  entries before a tool call have `"tool_use"`.

## Branching tests (2026-11-15, Claude Code 2.1.325)

Run by hand: interactive `claude` in a pty, in a test folder, resuming a
session that held one question and one reply, then sending one short message.

1. `claude --resume <session-id> --fork-session` works.
   - It opens with the old conversation on screen.
   - It makes a new `<new-id>.jsonl` in `~/.claude/projects/<folder>/`, but
     only when the first message is sent. Before that, no file exists.
   - The old session file stays byte-identical.

2. The new file contains the old messages, with the same `uuid` and
   `parentUuid` values and the old timestamps.
   - All 18 uuid-carrying lines of the old file were in the new file; 7 more
     were new.
   - `sessionId` on the copied lines is rewritten to the new id.
   - No field marks the fork point or the parent session. The file alone does
     not say where it was forked from.

3. `--session-id <new-uuid>` works together with `--resume` and
   `--fork-session`. The fork was written to exactly `<new-uuid>.jsonl`.
   So the app can choose the id itself and never has to guess from "newest
   file".

Consequences for the app:
- Start every session with an id the app chose (`--session-id`), and read
  exactly that file. Drop the "newest .jsonl" guess.
- Between pressing Branch and the first message, the branch file does not
  exist. Show the parent's messages up to the fork point until it appears.
- The fork point and parent must be saved by the app (branches.json); the
  session files do not record them.
- Walking the parent chain to rebuild history is not needed once the branch
  file exists, because it already holds the old messages.

## Plain resume (2026-11-15, seen while testing the Branch build)

`claude --resume <id>` (without `--fork-session`) appends new messages to the
same `<id>.jsonl`. No new file is made. So switching back to a session and
continuing it keeps it in its own tree node.

## Branch from an earlier reply by cutting the session file (2026-11-15, Claude Code 2.1.325)

Setup: interactive `claude` in a pty, scratch folder, one session with 4
exchanges: "Remember APPLE" / "Read notes.txt, tell me its first word" (one
Read tool step) / "Remember BANANA" / "Remember CHERRY".

How a cut was made: start at the chosen entry, follow `parentUuid` back to the
root, write only those entries (in order) to `<new-uuid>.jsonl` in the same
project folder, `sessionId` rewritten to the new id. Then `claude --resume
<new-uuid>`.

1. Cut at the end of reply 2 (the `system`/`turn_duration` entry, the last one
   before the "BANANA" message). Works.
   - Opens with the history up to that point on screen (APPLE, the Read step,
     "Zebra"). No BANANA or CHERRY.
   - "what was my last message?" gave "Use the Read tool to read notes.txt,
     then tell me its first word." "List every word I asked you to remember"
     gave only APPLE. Claude sees only the shortened history.
   - New messages are appended to the same new file (26 copied entries plus
     the new ones).
2. Cut between a tool call and its result (ending at the `tool_use` entry).
   Claude Code repairs it on resume: it adds a `tool_result` saying "Tool call
   interrupted: the session ended before this call's result was recorded" and an
   assistant entry "No response requested.". The screen shows "Interrupted ·
   What should Claude do instead?". The next message works; Claude says it never
   saw the file. Not harmful, but the app should never cut there. Cutting at the
   last entry of a reply avoids it.
3. Original file byte-identical after all tests (same sha256 before and after).
4. Retry.
   - a. As specified: cut ending at the user message ("Remember BANANA"),
     resume, send that message again. It works, but on resume Claude Code adds
     "No response requested." after the dangling message, so Claude sees the
     message twice. Asked to quote every message, it listed BANANA twice.
   - b. Cut at the end of the previous reply (same cut as test 1), then send the
     message. Clean: Claude sees it once, replies "OK", and the quote list has no
     duplicate.
   - So Retry should cut at the end of the previous reply (4b), not at the user
     message. For the first reply of a session there is no previous reply; the
     branch is then a fresh session (`--session-id <new>`) that gets the message.

Notes for the build:
- Session files hold many entry types. `attachment` and `system` entries carry
  `uuid`/`parentUuid` and sit in the chain; the walk keeps them. Entries without
  a uuid (`file-history-snapshot`, `api-request*`, `mode`, `permission-mode`,
  `session-owner`, `last-prompt`, `ai-title`, `cost-state`) are dropped by the
  cut. Resume worked without them. Losing `file-history-snapshot` probably means
  file rewind does not reach back before the branch point; not tested.
- The fork point is the last chained entry before the next real user message
  (often `system`/`turn_duration`), not the last assistant line.
- A cut file exists right away, so a branch has a file before the first message
  is sent (unlike `--fork-session`).
- The app now writes new session files (never touches existing ones).
- The fallback (fresh session plus a history .md file) is not needed.
- If the usage limit is hit, Claude Code saves "You've hit your 5-hour limit" as
  an assistant entry (`stop_reason: "stop_sequence"`). The chat view shows it as
  a Claude reply.
- Test files deleted afterwards. The trust prompt for the scratch folder was
  accepted, so `~/.claude.json` keeps a trust entry for that path.

### Fallback plan (not needed now; kept in case cutting stops working)

Use this if a later Claude Code version refuses or misreads a cut file.
- Branch or Retry starts a fresh session: `claude --session-id <new-id>`.
- The app writes `branch-<id>-history.md` in the project folder. It holds the
  visible messages up to the fork point (the user's messages and Claude's
  replies, without tool details), taken from the original session file.
- On the user's first message in that branch, the app types: "The conversation
  so far is in @branch-<id>-history.md. Continue from it. Here is my next
  message: <message>". For Retry, <message> is the message that triggered the
  reply, sent once, on the click.
- The chat view shows the original file's messages up to the fork point above
  the branch's own messages, so the branch looks like a continuation.
- Costs: Claude sees history as one file, not real turns. Tool results and
  thinking are lost. The .md file sits in the user's folder.

## Permission cards: PermissionRequest hook tests (2026-11-16, Claude Code 2.1.325)

Setup: interactive `claude --permission-mode default` in a pty, scratch folder,
model haiku (cheap; hooks do not depend on the model). Hooks in the folder's
`.claude/settings.local.json`: a command hook for `PermissionRequest` (matcher
`*`, timeout 600) that saved its stdin JSON and then answered per a mode file;
also `PreToolUse` (matcher `AskUserQuestion`) and `Notification`, to see what
else fires. Note: when started from inside another Claude Code, the child
inherits `CLAUDE_CODE_*` env vars and turns transcript saving off; the test
driver removed them. The app's pty should do the same if it is ever launched
from Claude Code.

1. The hook fires, for Write and for Bash, before the terminal prompt is
   answered. Input JSON (Write example):
   - `session_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `prompt_id`,
     `permission_mode` ("default"), `effort` ({"level":"medium"}),
     `hook_event_name` ("PermissionRequest"), `tool_name` ("Write"),
     `tool_input` ({"file_path": <absolute path>, "content": "hi"}).
   - Bash: `tool_input` = {"command", "description"}.
   - `permission_suggestions`: what "Yes, and don't ask again" would add, e.g.
     [{"type":"setMode","mode":"acceptEdits","destination":"session"}] for a Write.
   - No `tool_use_id` (PreToolUse has one; PermissionRequest does not).
2. Answers:
   - `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`
     runs the tool. The screen shows "Allowed by PermissionRequest hook".
   - `"behavior":"deny","message":"..."` blocks it. The screen shows "Denied by
     PermissionRequest hook"; Claude receives the message word for word and
     carries on with the turn.
   - Exit 0 with no output: the normal terminal prompt stays and works. This is
     the fallback.
   - The terminal prompt is drawn at the same time the hook starts, not after
     it. Whichever answers first wins.
   - Answering in the terminal while the hook still waits: the tool runs at
     once. The hook process is NOT killed; it ran to its end 40 s later and its
     "allow" was ignored. So the app cannot learn from the hook that the
     terminal answered. It must watch the session file: when a `tool_result`
     appears for the matching `tool_use` (same tool name and input), close the
     card.
3. AskUserQuestion: yes. It goes through PermissionRequest (and PreToolUse).
   `tool_input.questions` = [{question, header, options:[{label,
   description}], multiSelect}]. The hook can answer it:
   `"decision":{"behavior":"allow","updatedInput":{"questions":<same>,
   "answers":{"<question text>":"<option label>"}}}`. Claude then said "You
   picked Blue". The terminal list also offers "Type something" and "Chat about
   this"; a card can offer the options only, the rest stay in the terminal.
   A `Notification` hook also fired 6 s later ("Claude needs your permission",
   `notification_type: "permission_prompt"`), without the question details.
4. How long the hook can wait (short version; the 10-minute run was stopped).
   - Docs (code.claude.com/docs/en/hooks, "Hook handler fields" > "Common
     fields"): the field is `timeout`, in seconds, on each hook handler
     (event > matcher group > `hooks` array). Default 600 for `command`, `http`
     and `mcp_tool` hooks (30 for `prompt`, 60 for `agent`; lower defaults
     only for UserPromptSubmit, PreModelSwitch/PostModelSwitch and
     MessageDisplay). No general maximum is stated (only SessionEnd is capped,
     at 60 s). The docs do not say what a PermissionRequest timeout does.
   - `"timeout": 600` was used in every test. Claude Code started with it and
     showed no settings or hook error.
   - Hook waiting 90 s, then answering allow: the call ran ("Allowed by
     PermissionRequest hook") and Claude finished the turn.
   - `"timeout": 5` with a hook that sleeps 30 s: neither allow nor deny. The
     normal terminal prompt simply stays ("Do you want to proceed? 1 Yes ...
     4 No"), still open 20 s later, the command not run. The hook never wrote
     its "slept" line, so it was most likely killed at 5 s (not fully proven:
     the test closed Claude Code before the 30 s were up).
   - So a timeout behaves like "no answer": the terminal prompt is the
     fallback. Since 600 s is also the default, the app should set it
     explicitly but not expect more; a card left longer than that is answered
     only in the terminal (the app should then send nothing and keep the card
     in sync by watching the session file).
5. "Allow and don't ask again": yes. `decision.updatedPermissions`:
   `[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"echo PERM5:*"}],
   "behavior":"allow","destination":"localSettings"}]`.
   - It wrote `"permissions":{"allow":["Bash(echo PERM5:*)"]}` into
     `.claude/settings.local.json`, and Claude Code re-wrote the whole file
     (re-indented). A new session then ran `echo PERM5 three` with no
     PermissionRequest at all.
   - A command with a redirect (`echo PERM5 two > two.txt`) still asked: the
     prefix rule does not cover writes.
   - `destination` can also be `session` (this session only). The
     `permission_suggestions` from the input are ready-made entries for this.

Consequences for the build:
- Use PermissionRequest for both permission cards and question cards.
- No output = terminal fallback, always safe.
- Close a card when the session file shows the tool's result (the terminal
  answered it, or Esc). Do not rely on the hook being killed.
- Since Claude Code rewrites settings.local.json, the app should merge its hook
  entry into the existing JSON, not keep its own copy of the file.
- Test files deleted afterwards. The scratch folders got trust entries in
  `~/.claude.json`.

## Permission cards: build check (2026-11-16, Claude Code 2.1.325)

Real app on a scratch folder, driven over the DevTools protocol, model haiku,
folder set to `defaultMode: "default"` (the user's default is auto mode, which
asks almost nothing, so cards only show in folders where Claude Code asks).

- Hook script alone: no endpoint file, exit in 0.4 s; dead port, 0.2 s; app
  that never accepts, 2.2 s; all with no output. Normal answer passed through.
- Trust prompt of a new folder (no hook for it): terminal opened by itself with
  "Claude is asking something in the terminal". Its default is "No, exit".
- Write: card with path and content, Allow once: file written.
- Bash `echo cardtest > out.txt`: Deny with a reason: not run, Claude quoted
  the reason word for word.
- AskUserQuestion Red/Blue: clicked Blue, Claude said "You picked Blue."
- `touch term1.txt`, answered with Enter in the terminal: the card closed when
  the tool_result reached the session file.
- Two parallel Bash calls: Claude Code asks one at a time, so the cards came
  one after the other, in order. The second card's timer already showed 9:48,
  counted from its own request.
- `python3 -c 'print(6*7)'`: Claude Code suggested `addRules` to localSettings;
  the button read "Always allow Bash(python3 -c 'print(6*7)')" and saved exactly
  that rule. For `mkdir`/`touch` the terminal offers "always allow access to
  <folder>" instead, which is not a rule: no button.
- Expiry (lifetime patched to 40 s in the compiled files for this run only):
  bar warning, then urgent under 30 s, then "Expired, answer in the terminal",
  terminal opened, hook gave no decision, the terminal prompt stayed and
  worked; the expired card closed when the result arrived.
- Not tested: switching sessions while a card waits. The app already blocks
  switching while Claude is working, and a permission wait counts as working.

## Grey time bar, reply labels, reply graph: build check (2026-11-16)

Real app, scratch folder, haiku, driven over the DevTools protocol.

- Question card: title "Claude asks", no raw tool name. 3px grey bar inside
  the card; the fill grows from the right edge (after 5 s: 8 px of 710 px);
  "9:45 left" in small grey text at the bottom right of the card.
- Labels: haiku ended every reply with `{label=...}` from the CLAUDE.md rule
  ("Fruit choice pear", "Pear fact", "Moon fact", "Apple browning fact"). None
  showed in the chat.
- Graph (Cmd+G or the Graph button): 3 replies in a column; "Branch from here"
  on the first reply made a branch, its message hung under reply 1 in a second
  column; the current reply had the lighter fill.
- Zoom past 3x over "Moon fact" switched to its session; a click on "Apple
  browning fact" switched back. Drag panned the view.
- Real CDP mouse events hung while the test window was covered (Chromium
  throttles hidden windows), so hover, pinch, drag and click were sent as DOM
  pointer and wheel events to the same handlers. A real trackpad pinch was not
  tried.

## Left-filling time bar, pinch to open the graph: build check (2026-11-16)

Linux cloud container, so NOT the real app on a Mac and NOT a real trackpad.
The renderer (index.html) ran in Chromium with a stub `api`; input was sent
below the page, through the DevTools protocol (`Input.dispatchMouseEvent`
mouseWheel with the ctrl modifier, and `Input.synthesizePinchGesture`).

- Card: no time text; 3px bar; a card half way through its 590 s had a fill of
  355 px of 710 px starting at the track's left edge. With two cards the foot
  showed "1 more waiting" and no times.
- `synthesizePinchGesture` (source "mouse" = touchpad, scale 0.5) reached the
  page as about 40 wheel events: `ctrlKey=true`, `deltaMode=0`, `deltaY`
  positive and small (0.6 to 1.3 each, about 69 in total = -100 * ln 0.5).
  So fingers together = deltaY > 0, as the code assumes.
- Plain scroll (no ctrl), a tiny pinch (deltaY sum 9) and a pinch in on the
  chat did not open the graph. A pinch out (sum >= 15) opened it at zoom 7.5
  (the current reply fills the view); pinching out further went down to 1x.
- Pinch in over another session's node past 3x asked for that session; the
  rest of the same pinch did not reopen the graph; a new pinch out did.
- Page zoom (`visualViewport.scale`) stayed 1 throughout.
- Still to do on a Mac: `CLADE_WHEEL_LOG=1 npm start -- <folder>`, pinch on
  the chat, and compare the printed `wheel deltaY=... ctrlKey=...` lines with
  the above. `setVisualZoomLevelLimits(1, 1)` in the main process was not run
  here (Electron was not started).

## Pinch switches views, it does not zoom (2026-11-16)

Changed after review: a pinch only switches between the chat and the graph.
Same setup as above (Chromium, stub `api`, CDP input; not a Mac trackpad).

- Chat: plain scroll, a tiny pinch out and a pinch in did nothing. A pinch out
  opened the graph framed on the current reply (zoom 7.5); the rest of that
  pinch and a second pinch out changed nothing (no zoom).
- Graph: Cmd+scroll zoomed (7.5 -> 3.05). A tiny pinch in did nothing. A pinch
  in over another session's reply opened that session; a pinch in over empty
  space went back to the chat you were on.
- `Input.synthesizePinchGesture` (touchpad, scale 0.5 then 2) opened the graph
  and then closed it. Page zoom stayed 1. Cmd+G and the Graph button work.

## Smooth pinch between chat and graph (2026-11-16)

Changed after review: a pinch is one continuous zoom. Out of the chat, the
chat shrinks back into its reply's box while the graph fades in; the box starts
at 5x (twice the graph's closest zoom, 2.5x), never window-filling. Below 2.5x
the pinch just zooms the graph. Pinching in on a reply: the graph zooms up to
2.5x around the fingers, then the box slides to the middle, the graph fades and
the chat comes forward. Fingers stopped half way: it settles (220 ms) to the
nearer end; the graph end of a move out of the chat is zoom 1.

Real app (Electron on the Mac, scratch folder, haiku), but the window was
covered, so input was DOM wheel events with ctrlKey, and requestAnimationFrame
was swapped for a timer in the page (a hidden window pauses it). A real
trackpad and real frame rate were not tried.

- Pinch out on the chat, 40 events of deltaY 2: graph opacity 0, 0.12, 0.35,
  0.62, 0.86, 0.99, 1 while zoom went 7.2 -> 2.65 (before the 5x cap); then
  plain zoom to 1.5. With the cap: opacity 0.61 at 3.35x, chat at scale 0.85.
- Small pinch out (sum 15), let go: back to the chat, no graph.
- Let go at opacity 0.61: settled to the graph at zoom 1.
- Pinch in on another session's reply: plain zoom 1 -> 2.32, then the fade
  (0.96, 0.72, 0.39, 0.10), then that session's chat at that reply; the old
  chat stayed hidden until the new one was on screen.
- Pinch in to opacity 0.80, let go: back to the graph at 2.5x.
- Pinch in over empty space stops at 2.5x and opens nothing.

## Polish build: checks (2026-11-16, Claude Code 2.1.325, Electron 39)

**Allow rule for artifacts/ (real Claude Code, `--permission-mode default`, haiku).**
`.claude/settings.local.json` held `"allow": ["Write(/artifacts/**)", "Edit(/artifacts/**)"]`.
- Write to `artifacts/a.html` and `artifacts/e.html`: written, no question.
- Write to `<project>/outside.html`: Claude Code asked. Not written.
- Write to `artifacts/../c.html`: Claude Code asked. Not written.
- Write to `artifacts/sub/d.html`: written, no question (the rule covers
  subfolders; the app itself only shows files directly in `artifacts/`).
- Not tested: Edit on an existing artifact (only Write was exercised).

**Artifact sandbox (real app, a test page that tries to get out).**
The page loaded Chart.js 4.6.1, D3 7.9.2 and KaTeX from `lib/` and drew a chart.
Its own report, read back from the view: fetch to https, to 127.0.0.1 and to
`file:`: blocked. `<img>` from https: blocked. WebSocket: blocked.
`window.open`: denied. `require`, `process`, `api`: not there.
`clade-artifact://current/../design.json`: blocked. A script inside an `.svg`
artifact did not run. `location.href = https://...` after 1.5 s: the view
stayed on the artifact. Opening `../design.json` or an unknown name through
the app's own channel did nothing.

**Versions.** Editing the open file made version 2, the panel reloaded by
itself and showed "2 / 2"; stepping back loaded `clade-artifact://v1/...` with
the "older version" note.

**Look.** Checked with page captures over the DevTools protocol, dark and
light, at about 1470 x 810, 1333 x 839 and 900 x 608, on hand-written demo
session files (no Claude replies were generated for this): dither, gradient
and mono headings, tags, a map (5 of 6 nodes linked), table, callouts, code
coloring, folded tool line, version switcher "1 / 2", chat list, permission
card (injected into the page for the picture), reply graph, artifact panel,
narrow layout with the sidebar as an overlay.
- OS screenshots were not possible: the shell has no screen recording
  permission (`screencapture`: "could not create image from display") and
  may not send Apple events. A page capture does not include the artifact's
  separate view, so that view was captured on its own and compared with the
  panel's rectangle (661 x 765 both).
- Not checked on screen: a real trackpad pinch with the new layout, a real
  permission card after the restyle, Retry and Branch clicks after the
  restyle (their code paths were not changed), the outline rail (needs a
  window about 1400 px wide with the sidebar open).

Test files deleted afterwards.

## Polish 2: tests before the build (2026-11-16/17, Claude Code 2.1.326)

Real interactive `claude` in a pty, scratch folder, haiku, short messages.

- **T1, streaming.** The session file still gets a block only when it is
  complete. The terminal shows the reply as it grows, a line or paragraph at
  a time (not letter by letter). A reply starts with `⏺ `, continues on lines
  indented two spaces, and ends at a status line (`✻ Worked for 2s`) or the
  rule above the input box. Tool calls also start with `⏺ ` (`⏺ Read(...)`)
  and have a `⎿` result line. The text is already formatted and wrapped at the
  terminal width: tables are drawn with box characters and bold marks are gone.
  - On a short terminal (the app's hidden one had 11 rows) Claude Code wipes
    the screen and its scrollback while a long reply grows, so nothing could be
    read. With a tall hidden terminal (about 170 rows) the same reply read fine.
- **T2, attachments.** A typed `@/full/path` attaches the file (Claude Code
  shows "Read notes.txt"). A path with spaces works as `@"/my docs/sea life.txt"`.
  It also works when the message is pasted as several lines.
- **T3, mode.** Shift+Tab cycles manual, accept edits, plan, auto, manual.
  The status line names the mode each time ("plan mode on"). The session file
  only has a `permission-mode` line from the start, so the app reads the status
  line.
- **T4/T5, `/effort` and `/model`.** Both work when typed, with no dialog. But
  both say "saved as your default for new sessions": they change the user's
  global Claude Code defaults. (The test changed the default model to haiku;
  it was put back to fable.) So the app does not type them. Instead it restarts
  `claude --resume <id> --model <m> --effort <e> --permission-mode <mode>` on
  the same chat. Checked: the header then shows the new model and effort, the
  mode carries over, and `~/.claude/settings.json` is unchanged.
- **T6, skills.** Claude Code has a per-skill switch: the `skillOverrides`
  setting (`"off"`, `"name-only"`, `"user-invocable-only"`, `"on"`), keyed by
  skill name. With `{"skillOverrides": {"zzdemo": "off"}}` in the project's
  `.claude/settings.local.json`, `/zzdemo` answered "Skill "zzdemo" is disabled
  via skillOverrides"; without it the skill ran. So the app never moves skill
  folders.

## Polish 2: build checks (2026-11-17)

Real app on a scratch folder, driven over the DevTools protocol; page captures
only (the shell still has no screen recording permission).

- Look: cyan accent (fill `#00E2E6`, text on light `#00787A`), no gradients
  (a test fails if `app.css` gains one), new sizes and spacing. Seen dark at
  about 1280 x 860 and on a large display, and light at 1000 x 700 with zoom
  150% (the narrow layout, sidebar as a toggle).
- Zoom: Cmd-menu handlers stepped 100% to 110% and to 150%; the badge showed;
  the level was in `settings.json` in the app data folder and came back after a
  restart.
- Mode picker: Plan, then Ask. Each time the label changed only after Claude
  Code's status line named the mode.
- Model and thinking: picking haiku and low restarted Claude Code on the chat;
  its corner then read "low" and the next reply's model was `claude-haiku-5-5`.
- Skills: the list showed 41 skills from the home folder and plugins.
- Streaming: on a real reply the preview grew (239, then 593 characters) and
  was replaced by the finished reply (1278 characters). Haiku is fast, so only
  two steps were caught.
- Diagrams: a hand-written demo reply with `mem` (8 pointers incl. a field, an
  array cell, null and a missing target), `timeline`, `compare`, `flow` (a
  loop and a skip) and one broken `mem` block (shown as code).
- Found and fixed on the way: the tall hidden terminal made the page
  scrollable and shifted the window's content up; it is now `position: fixed`.
- Not checked on screen: attaching by drag and drop and by paste (the code
  paths are unit-tested only as far as the message text and file names), the
  paperclip dialog, the artifact view's position at a zoom other than 100%,
  "Add from a folder" in the app (the copy is unit-tested), switching a skill
  from the list (the merge is unit-tested, and the setting itself was tested
  in T6), Shift+Tab and Esc typed on a real keyboard, a permission card while
  a preview is showing.

Test files deleted afterwards. The app's own `settings.json` was put back to
defaults.

## Polish 3, milestone 1: bugs (2026-11-17)

Real app on the Mac, a hand-written session (no model: the account's 5-hour
limit was reached, so model runs wait).

- T4, the orange ring: Chromium's `-webkit-focus-ring-color` here is
  `rgb(229, 151, 0)` (the macOS system accent), the app accent is `#00E2E6`.
  So the orange ring was the system focus ring left on the last clicked
  control. Fix: the system ring is off for buttons, links, inputs and
  `[tabindex]`; the app's ring (2 px accent) shows for keyboard focus only.
  Checked with forced pseudo states on a map pill, the attach button and the
  Graph button: mouse focus `none 0px`, keyboard focus `solid 2px
  rgb(0, 226, 230)`.
- Tables: cells computed `overflow-wrap: normal`, `word-break: normal`,
  `min-width: 7ch`; inline code in cells `nowrap`. A 4-column table with long
  identifiers wrapped only between words and fit the 760 px column.
- Jump arrow: wide window, at x 1192-1224 with the reading column ending at
  1116, just above the message box. Column forced to 5000 px (no margin):
  `tight`, on the box's top edge at its right end (box top 661, arrow
  644-676), over the border, not over text.
- Stylesheet tests (`src/css.test.ts`) keep the three rules.

## Polish 3, milestone 3: themes and accents (2026-11-17)

- `src/themes.ts`: 4 themes, 9 accents, stored values; `applyLook` copies
  them into design.json, `matchLook` gives the look or "custom".
- Contrast check (`themes.test.ts`): every theme x accent x light/dark;
  body and muted text on background, surface, raised and code background;
  accent text and the ten tones on background, surface and code background;
  user text on its bubble; text on the accent fill. Zero failures. Before the
  ground changes, today's Paper failed it too (green tone 4.10 on `raised`,
  4.44 on the code background).
- Real app: picking Sand then Red wrote `look` {sand, red}, dark accent fill
  `#C20000`, text on it `#FFFFFF`, accent text `#C20000` / `#FF4D4D`, and kept
  the body size (19). A hand edit of one surface color: "Custom", no ring.
  "Reset to default": Paper, Cyan, System, the hand edit gone. Slate with
  Green in light mode drew as expected.
- Old files: no `look` key is valid; the previous default colors still count
  as Paper and Cyan.

## Polish 3, T1 to T3 and milestone 4: sidebar bottom (2026-11-17)

- T2: `/usage` exists in Claude Code 2.1.326 ("Show session cost, plan
  usage, and activity stats") and opens a Usage tab (session, week, per
  model bars). Before and after it: `~/.claude/settings.json` and the
  project's `.claude/settings.local.json` byte-identical; `~/.claude.json`
  changed only in `pluginUsage.caveman@caveman.usageCount` / `lastUsedAt`
  (a counter, not a setting). So the menu item is kept.
- `auth status` under `sandbox-exec (deny network*)`: works, same keys as
  in the plan, `loggedIn` true, `planTier` "pro".
- T1 and T3 (baseline, 6 runs, Haiku and Sonnet, `--effort low`): see the
  table in "Colors in replies" below. Haiku wrote no map for the ruby
  prompt (no headings at all), so a flat map was not reproduced; all three
  section 2 fixes are built and the 3-run check decides.
- The terse plugin: its text ("CAVEMAN MODE ACTIVE ...") enters every
  session as a SessionStart hook result of the `caveman@caveman` plugin, so
  `skillOverrides` cannot reach it. Control run, plugin off for those runs
  only (`--settings '{"enabledPlugins":{"caveman@caveman":false}}'`, no file
  changed): Haiku still wrote 0 colored phrases in all 3 replies (pointers:
  7 headings, none colored). So the plugin shortens replies but is not why
  they have no color; the CLAUDE.md color rule is.
- Sidebar row in the real app: email and initial with "Show account name"
  on; off: "Signed in with Claude Code" and a plain icon, in the row and
  the menu header. Menu: email + "Pro", Settings, Theme flyout (same rows as
  Settings), Show usage in the terminal (typed `/usage`, terminal opened,
  note shown), Get help, Source on GitHub, v0.0.1.
- Help page: help.md drawn by the reply renderer; map (8 pills), table,
  mem, timeline, compare, flow and callout all drew; tests check every
  block parses, every map node has a heading, every tag is known, no hard
  wraps.
- Source tests on main.ts: one `shell.openExternal(SOURCE_URL)`, the
  handler takes nothing from the page; the only `execFile` is the sandboxed
  `auth status`; only the parsed account is sent.

## Polish 3, milestone 2: section tree (2026-11-17)

- Parser: the indent step is measured (2, 3 or 4 spaces; a tab is one
  level); every indent must be a whole number of steps, else the block shows
  as code. 2, 3, 4-space and tab blocks give the same tree (test). Two old
  tests changed meaning: 3 spaces and 4 spaces after a root are now valid
  steps, so those tests now use a 1-space step and a real skipped level.
- Drawing (real app, a hand-written 4-space map): connectors in the muted
  text color, `├─` stubs and a rounded `└─` for the last child, parents
  semibold (600), a fold triangle before each parent. Folding "Five kinds"
  left 3 rows and showed "5"; unfolding brought all 8 back; a click on a
  label still jumped to its heading and flashed it.
- Haiku check, "what are the variables in ruby", 3 runs each:
  - With the plan's wording ("A section that introduces several kinds
    starts with the tree"): 0 of 3. All three answered with a short bullet
    list, no headings, no map.
  - Wording widened to "A reply or section that introduces 3 or more kinds
    ... starts with the tree ... This holds for short replies too": 1 of 3
    by the plan's measure (2 levels below the root, every child heading one
    level below its parent's). Run 2: no map again. Run 3: the five kinds
    were correctly children of "Five kinds" (h3 under h2), but Haiku made
    "Five kinds" the root, so only 1 level below it.
  - So nesting itself is right whenever a map is written (2 of 2); Haiku
    often writes no map for a short answer.

## Polish 3, milestone 5: halftone headings (2026-11-17)

Real app on the Mac. The test window sat behind other windows, so the app
was started with Chromium's `--disable-backgrounding-occluded-windows
--disable-renderer-backgrounding` (test only: an occluded window otherwise
pauses animation frames, which is also what a user's covered window does).

- Replaces the Bayer checker. The heading stays real text (transparent once
  drawn); a canvas over it draws dots at the browser's own glyph positions.
  A cell counts as letter when a quarter of it is covered (at half, thin
  strokes lost too many dots).
- Cost, one 64 px heading of 381 dots, drift, focused and on screen,
  10-second samples: 30 frames per second, 0.23 ms average draw, renderer
  4.9% of one core (`top`, 11 samples). Light with the cursor over it:
  0.21 ms, 4.1%. Effects off: 0 frames, 0.0%. The estimate in the plan
  ("a few percent of one core") holds.
- Stands still: window not focused (the real window had lost focus): 0
  frames, 0.0%. Off screen: `visible` false, 0 frames in 3 s. Reduced
  motion (emulated `prefers-reduced-motion: reduce`): 0 frames in 3 s, the
  canvas identical after 3 s, and a pointer move over it changed nothing.
- Zoom 110%: canvas rebuilt at device pixel ratio 2.2 (1672 x 147 for
  760 x 67 CSS px), so one canvas pixel per screen pixel.
- `effects.dither` keys validated (variant, speed 0-3, dotSize 3-12,
  cursorRadius 0-300; optional, so old files stay valid).
- Demo: Settings, "Halftone style" row with "Compare styles": a sheet with
  Drift, Wave and Light, each forced on its own heading, and "Use this".
  This replaces the planned hand-written demo session, so no demo chat sits
  in the chat list.

## Polish 3, milestone 6: colors in replies (2026-11-17)

Same 3 prompts, Haiku and Sonnet, `--effort low`, `--model` given, a scratch project with the app's CLAUDE.md section; counted from the session files by `src/colorcount.ts`. The user's setup unchanged (the caveman plugin's text was in every session). Pass: every section has 1 to 3 colored phrases and none is longer than 4 words. Plan's mark: 5 of 6.

Before (old CLAUDE.md, color rule after the design.json schema): 1 of 6 pass.

| run | model | prompt | words | headings | colors | per section | uncolored | >4 words | label | map (depth) | blocks | pass | terse text in session |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku-1 | claude-haiku-5-5 | what are the variables in ruby | 136 | 0 | 0 | 0 | 0 | 0 | yes | no | - | no | yes |
| haiku-2 | claude-haiku-5-5 | explain pointers in C | 330 | 0 | 0 | 0 | 0 | 0 | yes | no | mem | no | yes |
| haiku-3 | claude-haiku-5-5 | why does my for loop skip the last item | 194 | 0 | 0 | 0 | 0 | 0 | yes | no | - | no | yes |
| sonnet-4 | claude-sonnet-5-5 | what are the variables in ruby | 176 | 0 | 1 | 1 | 0 | 0 | yes | no | table | yes | yes |
| sonnet-5 | claude-sonnet-5-5 | explain pointers in C | 360 | 8 | 2 | 0,0,0,0,0,0,1,1 | 6 | 1 | yes | no | callout mem table | no | yes |
| sonnet-6 | claude-sonnet-5-5 | why does my for loop skip the last item | 161 | 0 | 0 | 0 | 0 | 0 | yes | no | - | no | yes |

After, first rewrite (reordered; the plan's color rule): 1 of 6 pass, but colors went from 0-2 to 5-7 per reply with headings, maps appeared, no phrase over 4 words. Misses: the title or parent section that only holds an intro and the map.

| run | model | prompt | words | headings | colors | per section | uncolored | >4 words | label | map (depth) | blocks | pass | terse text in session |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku-1 | claude-haiku-5-5 | what are the variables in ruby | 247 | 7 | 7 | 0,2,1,2,1,1,0 | 2 | 0 | yes | yes (2) | - | no | yes |
| haiku-2 | claude-haiku-5-5 | explain pointers in C | 217 | 5 | 5 | 0,1,1,1,2 | 1 | 0 | yes | yes (1) | mem | no | yes |
| haiku-3 | claude-haiku-5-5 | why does my for loop skip the last item | 117 | 0 | 0 | 0 | 0 | 0 | yes | no | - | no | yes |
| sonnet-4 | claude-sonnet-5-5 | what are the variables in ruby | 130 | 6 | 5 | 1,1,1,1,0,1 | 1 | 0 | yes | yes (1) | - | no | yes |
| sonnet-5 | claude-sonnet-5-5 | explain pointers in C | 293 | 6 | 5 | 0,1,1,0,1,2 | 2 | 0 | yes | yes (1) | callout mem | no | yes |
| sonnet-6 | claude-sonnet-5-5 | why does my for loop skip the last item | 145 | 0 | 2 | 2 | 0 | 0 | yes | no | - | yes | yes |

After, second wording (adds: the title section and a section that only introduces its subsections or holds the map colors its key term once; tags inside the map do not count; a short reply without headings still colors its key term): **3 of 6 pass**. Below the plan's 5 of 6.

| run | model | prompt | words | headings | colors | per section | uncolored | >4 words | label | map (depth) | blocks | pass | terse text in session |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| haiku-1 | claude-haiku-5-5 | what are the variables in ruby | 123 | 6 | 5 | 1,2,0,1,1,0 | 2 | 1 | yes | yes (2) | - | no | yes |
| haiku-2 | claude-haiku-5-5 | explain pointers in C | 374 | 7 | 5 | 1,0,1,2,0,1,0 | 3 | 2 | yes | no | mem | no | yes |
| haiku-3 | claude-haiku-5-5 | why does my for loop skip the last item | 123 | 0 | 1 | 1 | 0 | 0 | yes | no | - | yes | yes |
| sonnet-4 | claude-sonnet-5-5 | what are the variables in ruby | 120 | 6 | 6 | 1,1,1,1,1,1 | 0 | 0 | yes | yes (1) | - | yes | yes |
| sonnet-5 | claude-sonnet-5-5 | explain pointers in C | 225 | 5 | 6 | 0,1,0,1,4 | 2 | 0 | yes | yes (1) | mem | no | yes |
| sonnet-6 | claude-sonnet-5-5 | why does my for loop skip the last item | 99 | 0 | 2 | 2 | 0 | 0 | yes | no | - | yes | yes |

- Remaining misses: single uncolored sections (Haiku 2 and 3 of 6-7, Sonnet pointers 2 of 5), one Sonnet section with 4 colors, and two Haiku phrases over 4 words.
- One batch of 6 hit the account's usage limit (replies were the 9-word limit notice) and was run again after the reset; only the rerun is counted.

## Polish 3, milestone 7: docs (2026-11-17)

- README: themes and accents, halftone styles, foldable map tree, sidebar
  menu, new source files; four screenshots in `docs/screenshots/` (Paper
  with Cyan and Sand with Red, light and dark), taken with "Show account
  name" off so no email is in the repository.
- Seen in the Sand with Red shots: the accent ("prefix") and {bad}
  ("NameError") read as the same red, as expected; left as is by decision.

## Polish 4 (2026-11-17)

Real app on the Mac (Electron, driven over the DevTools protocol), a scratch
project inside this folder (`.scratch/`, not committed), Haiku with `--model`
and `--effort` low set through the app's own pickers. Page captures only; the
artifact view captured from its own target and laid into the page shot.

- 1, artifacts: reproduced on the old build. Haiku wrote
  `artifacts/fbd-box-ramp.svg`, the chat showed only the card, the panel stayed
  closed: `show()` ran only on a card click. Now a file written or changed
  after start opens the panel on its newest version (a file written by hand
  while the app ran: the panel opened, "1 / 1"). Files there at start do not
  open.
- 2, drawings: free-body prompt: Haiku drew it in an `svg` block, shown inline
  at 360 x 240, light and dark; no file written, no card. Streaming: the
  preview held a box of the same width (the first build was 0.66 px taller
  from the dashed border; fixed with `box-sizing`). Pointer prompt: Haiku used
  the `mem` shortcut (inline, no file), not `svg`; allowed by the CLAUDE.md
  text ("use a shortcut when it fits").
- 3, title: 88 px at 760 px column, glow on hover (red accent: 14 px,
  accent at 35%). The transition stalled in the test because the window was
  covered (`visibilityState` hidden); with the transition off the hover value
  was right. Not seen easing on screen.
- 5, usage: menu open typed `/usage`, read "Current session 22%" and "Current
  week (all models) 70%" with reset times, pressed Esc; the terminal was not
  shown. This Pro account shows no per-model limit, so no third bar. Hashes of
  `~/.claude/settings.json`, the app's `settings.json`, the project's
  `design.json`, `.claude/settings.local.json` and `CLAUDE.md` were the same
  before and after.
- 6, dropdowns: `color-scheme` was never set; now `dark` in dark mode; every
  select and option computed `rgb(236,232,224)` on `rgb(38,37,34)`. The open
  native list itself cannot be captured.
- 7, red behind a paragraph: the screenshot was not in the message. With the
  Red accent, the selection rule (`accent-fill` at 40%) painted the whole
  selected sentence red, which matches the description; reproduced by
  selecting that paragraph with the old rule. Now a neutral tint of the text
  color.
- Seen on the way: the `mem` box showed a white scrollbar corner in dark mode;
  the corner is now transparent. The box still shows thin scrollbars (left as
  it is).
