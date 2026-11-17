// Live preview of a reply while Claude Code is still writing it. Claude Code only writes a block to
// the session file once the block is complete, but its terminal shows the text as it grows. This
// reads that growing text off the terminal screen. It is a preview only: the session file stays the
// one record, and replaces the preview as soon as the block lands there.
// Pure function. Plain script: loaded by index.html (global) and by the tests through require().

interface ScreenReply {
  blocks: number; // text blocks Claude has started in this turn (tool calls not counted)
  text: string; // the newest text block, with the terminal's line wrapping undone
  user: string; // the first line of the user's message this turn answers (to tell turns apart)
}

const RULE = /^─{10,}/;
const BOX = /^[│┌├└┬┴┼─╭╰]/;

/**
 * lines: the terminal screen with scrollback, top to bottom. cols: its width.
 * null: the screen does not look like Claude Code's chat (a dialog, or nothing yet).
 */
function replyOnScreen(lines: string[], cols: number): ScreenReply | null {
  const rows = lines.map((l) => l.replace(/\s+$/, ''));
  // The input box is the last "❯" line with a rule right above it; the chat ends above that rule.
  let end = -1;
  for (let i = rows.length - 1; i > 0; i--) {
    if (!rows[i].startsWith('❯')) continue;
    const rule = [i - 1, i - 2].find((k) => k >= 0 && RULE.test(rows[k]));
    if (rule !== undefined) {
      end = rule;
      break;
    }
  }
  if (end < 0) return null;
  // This turn starts at the last message the user sent.
  let start = -1;
  for (let i = end - 1; i >= 0; i--) {
    if (rows[i].startsWith('❯ ')) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const blocks: { lines: string[]; tool: boolean }[] = [];
  let cur: { lines: string[]; tool: boolean } | null = null;
  for (const row of rows.slice(start + 1, end)) {
    if (row.startsWith('⏺ ')) {
      cur = { lines: [row.slice(2)], tool: /^⏺ [A-Z][A-Za-z0-9_.:-]*\(/.test(row) };
      blocks.push(cur);
    } else if (cur && (row === '' || row.startsWith('  '))) {
      if (row.startsWith('  ⎿')) cur.tool = true; // a tool call's result line
      cur.lines.push(row.slice(2));
    } else cur = null; // a status line (spinner, "Worked for 2s"): the block is over
  }
  const texts = blocks.filter((b) => !b.tool);
  const last = blocks[blocks.length - 1];
  const user = rows[start].slice(2);
  if (!last || last.tool) return { blocks: texts.length, text: '', user };
  return { blocks: texts.length, text: unwrapScreenText(last.lines, cols), user };
}

/** Undo the terminal's wrapping: a line that fills the width continues in the next one. The reply label is never shown. */
function unwrapScreenText(lines: string[], cols: number): string {
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(para.join(''));
    para = [];
  };
  const full = cols - 2 - 24; // Claude Code wraps at a word, so a wrapped line can end well before the edge
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('{label')) break; // the label tag, also half-written: hidden
    if (!line.trim()) {
      flush();
      out.push('');
      continue;
    }
    const prev = lines[i - 1] ?? '';
    const joins = para.length > 0 && prev.length >= full && !BOX.test(line.trim()) && !BOX.test(prev.trim()) && !/^(\s*[-*•]|\s*\d+[.)])\s/.test(line);
    if (joins) para.push(' ' + line.trim());
    else {
      flush();
      para.push(line);
    }
  }
  flush();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

if (typeof module !== 'undefined') module.exports = { replyOnScreen, unwrapScreenText };
