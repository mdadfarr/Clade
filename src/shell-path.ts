// An app opened from the Dock or Spotlight gets macOS's short PATH (/usr/bin:/bin:/usr/sbin:/sbin), so
// `claude` in ~/.local/bin or Homebrew is not found. This reads PATH from the user's login shell, the
// one a terminal would have. No Electron here, so it ports as it is.
import { execFileSync } from 'child_process';

const MARK = '__CLADE_PATH__';

/** The PATH between the two marks in the shell's output (shell start-up files may print other text). */
export function parsePathOutput(out: string): string | null {
  const m = new RegExp(`${MARK}(.*?)${MARK}`, 's').exec(out);
  const p = m?.[1].trim();
  return p ? p : null;
}

/** Login-shell entries first, then the ones the app already had; each entry once, empty ones dropped. */
export function mergePaths(login: string | null, current: string | undefined): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of `${login ?? ''}:${current ?? ''}`.split(':')) {
    if (part && !seen.has(part)) {
      seen.add(part);
      out.push(part);
    }
  }
  return out.join(':');
}

/** PATH from the login shell, or null when the shell fails, prints no PATH, or takes over 4 s. */
export function loginShellPath(shell = process.env.SHELL || '/bin/zsh'): string | null {
  try {
    const out = execFileSync(shell, ['-ilc', `printf '%s%s%s' '${MARK}' "$PATH" '${MARK}'`], {
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 1024 * 1024,
    });
    return parsePathOutput(out);
  } catch {
    return null;
  }
}
