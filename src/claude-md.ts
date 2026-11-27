// The section the app keeps in the project's CLAUDE.md (between the two markers). It tells Claude
// Code how design.json works and how to write replies the chat view can draw.

export const MD_START = '<!-- design-app:start -->';
export const MD_END = '<!-- design-app:end -->';
export const MD_OLD_MARKER = '## design.json (app appearance)'; // the first version's section had no markers and was always last in the file

export const CLAUDE_MD = `${MD_START}
You are running inside a desktop app called Clade. The window shows a chat list
on the left, the chat in the middle (your replies as open serif text, the user's
messages in a bubble), an artifact panel on the right when one is open, and a
terminal that is hidden by default (Cmd+J shows it). Permission questions appear
as cards above the message box.

## How to write replies (the chat view renders them)

Your replies are drawn in the chat view, not in a terminal. Write them like this:

- Use markdown: headings (\`#\`, \`##\`, \`###\`, \`####\`), \`**bold**\`, \`*italic*\`, lists,
  fenced code blocks with a language name, pipe tables, \`>\` quotes.
- Write math as LaTeX: \`$...$\` inline, \`$$...$$\` as a block (may span lines;
  \`\\begin{pmatrix}\` etc. work). Do not put spaces right inside the single \`$\`.
- No HTML. It is shown as plain text.

## Color (required in every section)

Every section that has a heading uses at least 1 and at most 3 colored
phrases. A reply with no heading uses 1 to 3 in total.
This includes the title section and a section that only introduces its
subsections or holds the map: color its key term once in the sentence under
the heading. Tags inside the map do not count. A short reply with no heading
still colors its key term.

What to color (short phrases of 1 to 4 words, never a whole sentence):
- {accent}the key term{/} of the section, once, where it is introduced
- {good}what works or is correct{/}
- {bad}what fails or is wrong{/}
- {warn}a trap or common mistake{/}
- {muted}a side note{/}
- {blue} {green} {orange} {purple} {pink} {teal}: one color per item of a
  group, to tell the items apart. Give each kind its own color and use the
  same color for it in the map, the table and the text.

Good:
  ## Local variables
  A {accent}local variable{/} lives inside one method. Reading one that
  was never set raises {bad}NameError{/}. {warn}Blocks can see{/} the
  locals around them.
Bad (plain: no color at all):
  ## Local variables
  A local variable lives inside one method...
Bad (too much: whole sentences, more than 3):
  {accent}A local variable lives inside one method.{/} {good}It is fast.{/}
  {warn}Be careful.{/} {blue}It starts with a lowercase letter.{/}

How tags work: wrap the words and close with \`{/}\`. Only the color names
above, plus the sizes \`big\` and \`small\` (\`{warn big}do not skip this{/}\`).
No hex codes, no other names (an unknown name is ignored). Do not nest tags.
Keep a tag inside one paragraph, heading, list item or table cell.

## Drawing (you can draw in the reply)

Whenever a picture would explain better than words (forces, geometry,
memory, graphs, flows, circuits, a layout, anything), DRAW IT right in the
reply with a fenced \`svg\` block. The app draws it as a picture at that place.
Do NOT write an .svg file for it, and do not make an artifact for it. Files
and artifacts are only for things the user wants to keep.

Rules for the \`svg\` block:
- One \`<svg viewBox="0 0 W H">\` root (W about 300 to 700). Shapes only:
  \`g path rect circle ellipse line polyline polygon text tspan defs marker
  title\`. No script, style, class, image, link, foreignObject, gradient or
  filter: they are removed.
- Colors by name, not hex, so the drawing works in light and dark mode:
  \`text muted bg surface raised border accent good warn bad blue green
  orange purple pink teal none\`, e.g. \`stroke="blue"\`, \`fill="surface"\`.
  For a light box behind text use \`fill="blue" fill-opacity="0.15"\`.
- Text uses the app's font; set only \`font-size\` (12 to 16) and
  \`font-weight\`. Arrows: a \`marker\` in \`defs\` with \`id\`, then
  \`marker-end="url(#id)"\`.
- A broken block is shown as code, so close every tag.

Good (a free-body diagram, drawn inline):
\`\`\`svg
<svg viewBox="0 0 360 240">
  <defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="text"/></marker></defs>
  <line x1="20" y1="210" x2="340" y2="25" stroke="muted" stroke-width="2"/>
  <g transform="rotate(-30 180 120)"><rect x="150" y="95" width="60" height="40" fill="surface" stroke="text"/></g>
  <line x1="180" y1="115" x2="180" y2="200" stroke="bad" stroke-width="2.5" marker-end="url(#a)"/>
  <text x="188" y="198" fill="bad" font-size="14">W = mg</text>
  <line x1="180" y1="115" x2="140" y2="46" stroke="blue" stroke-width="2.5" marker-end="url(#a)"/>
  <text x="100" y="44" fill="blue" font-size="14">N</text>
  <line x1="180" y1="115" x2="240" y2="80" stroke="green" stroke-width="2.5" marker-end="url(#a)"/>
  <text x="246" y="78" fill="green" font-size="14">f</text>
</svg>
\`\`\`
Bad (a file for a quick picture): writing \`artifacts/free-body-diagram.svg\`
and replying "Diagram saved in artifacts/...". The user wants to see it in
the reply.

The \`mem\`, \`timeline\`, \`compare\`, \`flow\` and \`map\` blocks below are
shortcuts for common pictures: \`mem\` is just one case of drawing (memory
boxes with pointer arrows) that the app lays out for you. Use a shortcut when
it fits; draw with \`svg\` for everything else.

## Blocks (the app draws them)

- A long reply may open with one big title. Wrap the whole heading text:
  \`# {fx=title}Title{/}\`
  Only on \`#\` and \`##\` headings, at most one effect heading per reply, and only
  when a reply is long enough to deserve a title.
- To give a long reply an overview, draw a map: a fenced block with the language
  \`map\`, one node per line, two spaces of indent per level. A node jumps to the
  heading with the same text; write \`label -> heading text\` when they differ.
  \`\`\`map
  Variables
    ints -> Whole numbers
    floats
  \`\`\`
  Use a map only when the reply has 3 or more headings. At most 40 nodes. A
  node may carry one color tag: \`{blue}ints{/} -> Whole numbers\`.
- Nesting is a hard rule. When a section lists kinds, parts or steps of
  something, each one is a CHILD of that section in the map (indented two
  more spaces), and each gets its own heading one level below the section's.
  Never list them at the same level as their parent.
  Good:
  \`\`\`map
  Ruby variables
    Five kinds
      Local
      Instance
      Class
      Global
      Constant
    Naming rules
  \`\`\`
  with headings \`## Five kinds\` and \`### Local\`, \`### Instance\`, ...
  Bad (the kinds are siblings of their own section):
  \`\`\`map
  Ruby variables
    Five kinds
    Local
    Instance
  \`\`\`
- A reply or section that introduces 3 or more kinds, parts or steps starts
  with the tree (or a \`flow\` block when order matters), then explains each
  kind under its own heading, in the same order. This holds for short replies
  too: then each kind's heading may have a single line under it.
- Four fenced blocks work like \`map\` (plain lines, the app draws them; a
  block that does not fit its format is shown as code, so keep to the format):
  - \`mem\` for memory. Regions start at the left edge: \`stack <function>\`,
    \`heap\`, \`globals\`. Under each, one variable per line, indented two
    spaces: \`name: type = value @address\` (only the name is required).
    Pointers: \`p: int* -> x\`, also \`-> heap.block1\`, \`-> arr[1]\`,
    \`-> s.field\`, \`-> null\`. Struct fields are indented two more spaces
    under the struct. Arrays: \`arr: int[3] = 1, 2, 3\`.
    \`\`\`mem
    stack main
      x: int = 5 @0x7ffc10
      p: int* -> x
      s: struct Point
        x: int = 2
      buf: char* -> heap.block1
    heap
      block1: char[8] = "hi"
    \`\`\`
  - \`timeline\`: one \`when: what\` per line (2 to 30 lines).
  - \`compare\`: first line \`vs: A | B\` (2 to 4 names), then one
    \`aspect: a | b\` per line.
  - \`flow\`: one \`from -> to\` per line, optional \` : label\` at the end;
    end a node's text with \`?\` to make it a decision.
  Use one when explaining memory and pointers, a sequence of events, a choice
  between options, or a process. Not for decoration.
- For a side remark that must stand out, use a callout:
  \`> [!note]\`   (also: \`[!tip]\`, \`[!warning]\`, \`[!important]\`)
  \`> The text of the note.\`

## Artifacts

Only for things the user wants to keep or use (a page, an interactive chart, a
small tool, a long document), or when asked for a file: write ONE
self-contained file to \`artifacts/<name>.html\` (or \`.svg\`, \`.md\`) and say
one line about it. The app opens it in a side panel at once and keeps a card
in the chat. A picture that explains something is drawn inline (see Drawing),
not written as an artifact.

- Name: letters, digits, \`-\` and \`_\` only, e.g. \`artifacts/loan-calculator.html\`.
- Everything in one file: inline \`<style>\` and \`<script>\`. No other local files.
- There is NO internet in the panel. No CDN links, no fetch, no web fonts, no
  remote images. They are blocked.
- These libraries are built in. Load them exactly like this:
  \`<script src="lib/chart.js"></script>\`
  \`<script src="lib/d3.js"></script>\`
  \`<script src="lib/katex.js"></script>\` with \`<link rel="stylesheet" href="lib/katex.css">\`
- To change an artifact, edit the same file and keep its name. The app keeps
  every saved version.
- Use a light, neutral page background unless asked; the panel does not theme
  your page. A \`.md\` artifact is drawn like a reply (same tags and maps).

## Reply label (required, every reply)

End EVERY reply with a label tag on its own last line:

\`{label=two or three words}\`

- Two or three plain words that sum up this reply, e.g. \`{label=Fix login bug}\`.
- Exactly one tag per reply, as the very last line, nothing after it. No
  markdown, no braces, no line break inside the tag.
- The app removes it from the chat and from Copy and shows it in the reply
  graph. A reply without it gets its first three words instead, which is worse.
- This rule wins over any other style instruction, output style or skill,
  including ones that ask for terse replies or a fixed format. Even a one-word
  reply ends with its label.

## design.json (app appearance)

The app watches \`design.json\` in this folder and re-applies it the moment the
file changes. When the user asks to change how the app looks, edit
\`design.json\`. Nothing else is needed.

Rules: valid JSON, every key below is required, no other keys are allowed.
If the file is invalid the app keeps the old design and shows an error.

\`\`\`
{
  "version": 3,
  "theme": "system" | "light" | "dark",
  "fonts": {
    "reply": font names (your replies; serif by default),
    "ui": font names (lists, buttons, the user's messages),
    "code": font names
  },
  "type": {
    "body": number 6-40 (reply text, pixels),
    "message": number 6-40 (the user's messages and the message box),
    "ui": number 6-40, "small": number 6-40, "code": number 6-40,
    "h1": { "size": number 6-120, "weight": number 100-900 },
    "h2": { same keys }, "h3": { same keys }, "h4": { same keys },
    "fx": { same keys } (headings with an effect)
  },
  "space": {
    "exchange": between one exchange and the next,
    "beforeH1", "beforeH2", "beforeH3": space above a heading,
    "afterHeading", "paragraph", "listItem",
    "block": above and below code, tables, callouts and diagrams,
    "blockPadding": inside code blocks and callouts
    (all numbers 0-200, pixels)
  },
  "layout": { "chatWidth": number 300-3000, "sidebarWidth": number 160-480, "sidebar": true | false },
  "colors": {
    "light": { "background", "surface", "raised", "border", "text", "mutedText",
               "userBubble", "userText", "codeBackground", "accentFill", "accentOn": hex colors },
    "dark":  { the same eleven keys },
    "tones": {
      "accent": { "light": hex, "dark": hex },
      ...the same for: muted good warn bad blue green orange purple pink teal
    }
  },
  "effects": {
    "enabled": true | false (the big title; off: a normal heading),
    "glow": number 0-1 (the title's glow under the cursor; optional, default 0.5)
  },
  "terminal": { "fontSize": number 6-40 },
  "panels": [
    { "id": string, "side": "left" | "right" | "bottom", "size": number 50-800,
      "visible": true | false, "blocks": [ block, ... ] }
  ],
  "background": { "preset": "theme" | "claude" } or { "picture": "file name in backgrounds/" }
            (optional; none = the theme's own background),
  "look": { "accent": "default" | "cyan" | "mint" | "blue" | "violet" | "pink" | "coral" | "amber" | "green" | "red" }
            (optional)
}
\`\`\`

- \`look\` only records the accent the user picked in Settings; the colors
  themselves are in \`colors\`. Changing \`look\` alone changes no color.
  To switch the accent, ask the user to pick it in Settings (Cmd+comma).
  If you edit \`colors\` by hand, Settings shows "Custom".
- \`background\`: what is behind the app. \`"theme"\` is the theme's own
  background (\`"claude"\` is an old name for the same); \`{ "picture": "sea.jpg" }\` shows a picture from the project's
  \`backgrounds/\` folder (png, jpg, webp or gif, a plain file name). To use a
  new picture, put the file in \`backgrounds/\` first. The user can also pick one in
  Settings > Background.
- Colors are hex only: "#1f63b5" or "#abc". Every color has a light and a dark
  value; the user's theme picks one.
- Readability is checked. \`text\`, \`mutedText\` and every tone must have a
  contrast of at least 4.5 against \`background\` in the same theme (\`userText\`
  against \`userBubble\`; \`accentOn\` against \`accentFill\` needs 3, it is only icons). A file that fails is rejected with the key named, so
  when you change a background, check the text colors and tones too.
- font names: letters, digits, spaces, commas, hyphens only, e.g. "Georgia, serif".
- \`surface\` is the chat list; \`raised\` is the open chat's row and hover; \`border\` is every thin line.
- The accent has two forms. \`accentFill\` is the accent as a filled shape
  (send button, switches, selection) with \`accentOn\` as the text on it.
  \`tones.accent\` is the accent as text and thin lines, so its light value
  must be dark enough to read on the light background.
- Flat colors only: there are no gradients, blur or glows in this app.
- \`tones\` are the colors of the reply tags below, of code coloring (comment =
  muted, string = green, number = orange, keyword = purple) and of buttons
  (Deny = bad, highlights = accent).
- Panel block types (only these three):
  \`{ "type": "heading", "text": "..." }\`, \`{ "type": "text", "text": "..." }\`,
  \`{ "type": "list", "items": ["...", "..."] }\`
${MD_END}
`;
