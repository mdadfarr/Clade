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
