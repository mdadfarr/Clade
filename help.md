# Help

```map
Help
  Shortcuts
  Reply formatting
    Color and size tags
    Drawings
    Blocks
  Attaching files
  What the app writes
  The terminal
```

## Shortcuts

| Keys | What it does |
|---|---|
| `Enter` | Send the message |
| `Shift+Enter` | New line in the message |
| `Shift+Tab` | Next permission mode (in the message box) |
| `Esc` | Stop Claude while it works; closes sheets and menus |
| `Cmd+,` | Settings |
| `Cmd+U` | Attach files |
| `Cmd+J` | Show or hide the terminal |
| `Cmd+G` | Reply graph (also: pinch out on the chat) |
| `Cmd+Shift+P` | Mode |
| `Cmd+Shift+E` | Thinking level |
| `Cmd+Shift+M` | Model |
| `Cmd+Shift+K` | Skills |
| `Cmd+Plus` `Cmd+Minus` `Cmd+0` | Text size |
| `Cmd+Shift+R` | Reset the design to its default |

## Reply formatting

Claude's replies are drawn by this app. It follows the rules the app keeps in the project's `CLAUDE.md`.

### Color and size tags

A few words can carry a color: {accent}the key idea{/}, {good}what works{/}, {bad}what fails{/}, {warn}a trap{/}, {muted}a side note{/}. Group colors tell items apart: {blue}blue{/}, {green}green{/}, {orange}orange{/}, {purple}purple{/}, {pink}pink{/}, {teal}teal{/}. Sizes: {big}big{/} and {small}small{/}.

The colors follow light or dark mode and the accent you pick in Settings.

### Drawings

Claude can draw right in a reply: a fenced `svg` block is shown as a picture where it is written. It uses the app's colors, so it looks right in light and dark mode. Hover it for **Copy** (the SVG) and **Save** (asks where to save an .svg file).

```svg
<svg viewBox="0 0 300 120">
  <rect x="10" y="30" width="90" height="50" rx="8" fill="blue" fill-opacity="0.15" stroke="blue"/>
  <text x="55" y="60" text-anchor="middle" fill="text">idea</text>
  <line x1="100" y1="55" x2="190" y2="55" stroke="muted" stroke-width="2"/>
  <rect x="190" y="30" width="100" height="50" rx="8" fill="green" fill-opacity="0.15" stroke="green"/>
  <text x="240" y="60" text-anchor="middle" fill="text">picture</text>
</svg>
```

Only shapes and text are kept: no scripts, links, styles, images or fonts from outside. A drawing that cannot be read shows as code.

### Blocks

The blocks below are shortcuts for common drawings. A **map** gives a long reply an overview; each node jumps to its heading (the map at the top of this page is one).

A **mem** block draws memory:

```mem
stack main
  x: int = 5
  p: int* -> x
```

A **timeline**:

```timeline
Morning: open the project
Noon: ask Claude
Evening: read the reply graph
```

A **compare** table:

```compare
vs: Branch | Retry
starts from: a reply you pick | the message before a reply
keeps: everything up to that reply | everything before it
```

A **flow**:

```flow
Ask -> Claude works
Claude works -> Needs permission? : a tool call
Needs permission? -> Card above the box : yes
Needs permission? -> Reply : no
```

A **callout**:

> [!tip]
> Hover a reply to Copy, Retry or Branch.

## Your chats

Hover a message of yours and click the pencil to edit it. Send makes a new branch without that message and what came after, and sends the new text there; the old version stays, and the arrows under the reply step between them.

Hover a chat in the list and click the pencil to rename it, or use Rename in a pane's title bar menu. Leave the name empty to go back to its own title. A name given with Claude Code's own `/rename` shows too.

Drag the right edge of the chat list to make it wider or narrower. Double-click the edge to go back to the usual width.

Stop (or `Esc`) before Claude has written anything puts your message back in the box, as Claude Code does in its own box.

The model picker's Default names the model Claude Code chose the last time it started without one.

## Attaching files

Press `Cmd+U`, drop files on the window, or paste an image. Each file shows as a chip above the message box. Only the file's path goes into your message; Claude Code reads the file itself. A pasted image is first saved into the project's `attachments` folder, because it has no path of its own.

## What the app writes

In the project folder:

- `design.json`: how the app looks (Settings writes it; so can Claude).
- `CLAUDE.md`: the app keeps one marked section in it; the rest is yours.
- `branches.json`: which chat was branched from which reply.
- `chat-names.json`: names you gave chats in the app (Claude Code's own files are never changed).
- `artifacts/`: files Claude makes for you to keep; the side panel opens on one as soon as Claude writes it. Saved versions are in `artifacts/.versions`.
- `attachments/`: pasted images.
- `.claude/settings.local.json`: the permission-card hook, the artifact rule, and skill switches. Only those entries are added; nothing else in the file is changed.

In the app's own data folder (outside every project): `settings.json` (text size, model, thinking, mode and switches) and a small file that lets the permission hook reach this window.

The app itself never goes online. The account row reads `claude auth status` with all network access blocked. The usage bars in the sidebar menu come from Claude Code's own `/usage`: when you open the menu, the app types it into the hidden terminal, reads the numbers off the screen and closes it again. Claude Code fetches those numbers; the app reads no file for them.

## The terminal

Claude Code runs in a terminal that is hidden by default. `Cmd+J` shows or hides it. It opens by itself when Claude Code asks something the app cannot show as a card.
