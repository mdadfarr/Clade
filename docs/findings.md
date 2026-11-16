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
