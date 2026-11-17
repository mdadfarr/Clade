// Usage as bars: Claude Code's own /usage screen, read off the hidden terminal. Claude Code fetches the
// numbers itself; the app only reads what the screen shows. Pure function. Plain script: loaded by
// index.html (global) and by the tests through require().

interface UsageLimit {
  title: string; // as printed: "Current session", "Current week (all models)", "Current week (Fable)"
  percent: number; // 0-100, "% used"
  resets: string; // "10:30pm (America/Toronto)", or '' if the screen shows none
}

/**
 * lines: the terminal screen, top to bottom. Each limit on the /usage screen is a title line, a bar line
 * ending "N% used", and a "Resets ..." line. null: no limit on screen (not the /usage screen, or not
 * drawn yet).
 */
function parseUsage(lines: string[]): UsageLimit[] | null {
  const rows = lines.map((l) => l.trim());
  const out: UsageLimit[] = [];
  for (let i = 1; i < rows.length; i++) {
    const m = /(\d{1,3}(?:\.\d+)?)%\s+used$/.exec(rows[i]);
    if (!m) continue;
    let t = i - 1;
    while (t > 0 && !rows[t]) t--;
    const title = rows[t];
    // a title is plain words: no bar, no percent, no table column
    if (!title || /[█▌▏▎▍▋▊▉%│]/.test(title) || title.length > 60 || !/^[A-Z]/.test(title)) continue;
    const r = /^Resets\s+(.{1,80})$/.exec(rows[i + 1] ?? '');
    const percent = Math.min(100, Math.max(0, Number(m[1])));
    if (!out.some((u) => u.title === title)) out.push({ title, percent, resets: r ? r[1] : '' });
  }
  return out.length ? out : null;
}

/** The bar's color: the accent, warn above 80%, bad above 95%. */
const usageLevel = (percent: number): 'ok' | 'warn' | 'bad' => (percent > 95 ? 'bad' : percent > 80 ? 'warn' : 'ok');

if (typeof module !== 'undefined') module.exports = { parseUsage, usageLevel };
