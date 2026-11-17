// The account row: `claude auth status` output, read down to what the page may show. Only the email and
// the plan word ever leave the main process; ids, paths and dates are dropped here. Pure functions.

export interface Account {
  state: 'in' | 'out' | 'unknown'; // signed in, signed out, or the output could not be read
  email: string; // '' unless signed in with a readable email
  plan: string; // '' when absent; one short word like "pro" or "max"
}

export const UNKNOWN: Account = { state: 'unknown', email: '', plan: '' };

const EMAIL = /^[^\s@<>"'`]{1,64}@[^\s@<>"'`]{1,190}\.[A-Za-z]{2,24}$/;
const PLAN = /^[A-Za-z0-9 _-]{1,20}$/;

/** Read `claude auth status` (stdout and exit code). Anything unexpected gives the safe answer. */
export function parseAuthStatus(stdout: string, code: number | null): Account {
  if (code !== 0) return UNKNOWN;
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return UNKNOWN;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return UNKNOWN;
  const o = raw as Record<string, unknown>;
  if (o.loggedIn === false) return { state: 'out', email: '', plan: '' };
  if (o.loggedIn !== true) return UNKNOWN;
  const email = typeof o.email === 'string' && EMAIL.test(o.email.trim()) ? o.email.trim() : '';
  const plan = typeof o.planTier === 'string' && PLAN.test(o.planTier.trim()) ? o.planTier.trim().toLowerCase() : '';
  if (!email) return { state: 'unknown', email: '', plan }; // signed in, but no email to show
  return { state: 'in', email, plan };
}

/** The row's one line of text. showName false hides the email. */
export function accountLine(a: Account, showName: boolean): string {
  if (a.state === 'out') return 'Not signed in';
  if (a.state === 'in' && showName) return a.email;
  return 'Signed in with Claude Code';
}

/** The sandbox profile `auth status` runs under: everything as usual, but no network at all. */
export const NO_NETWORK_PROFILE = '(version 1)(allow default)(deny network*)';
