// App settings (zoom, and what new chats start with): one small JSON file in the app's data folder,
// outside every project, so Claude Code cannot see or change it. Also the flags these settings turn
// into for `claude`, and the steps between permission modes. Pure functions.

export const MODES = ['manual', 'acceptEdits', 'plan', 'auto'] as const; // bypassPermissions and dontAsk are left out on purpose
export type Mode = (typeof MODES)[number];
export const MODE_LABELS: Record<Mode, string> = { manual: 'Ask', acceptEdits: 'Accept edits', plan: 'Plan', auto: 'Auto' };
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const; // Claude Code's own levels; there is no "off"
export type Effort = (typeof EFFORTS)[number];
export const MODEL_ALIASES = ['fable', 'opus', 'sonnet', 'haiku'] as const;

export interface Settings {
  zoom: number; // 0.5 to 2, steps of 0.1
  model: string; // '' = Claude Code's own default
  effort: Effort | ''; // '' = Claude Code's own default
  mode: Mode | ''; // '' = Claude Code's own default
  toolsOpen: boolean; // tool steps shown unfolded
  showAccount: boolean; // the account row shows the email (off: "Signed in with Claude Code")
}
export const DEFAULT_SETTINGS: Settings = { zoom: 1, model: '', effort: '', mode: '', toolsOpen: false, showAccount: true };

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const clampZoom = (z: number) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 10) / 10;
/** One step in (+1), out (-1), or back to 100% (0). */
export const zoomStep = (z: number, dir: number) => (dir === 0 ? 1 : clampZoom(z + (dir > 0 ? 0.1 : -0.1)));

/** A model name that is safe to pass on: an alias or a full name. Never something that reads as a flag or a second word. */
export const validModel = (m: unknown): m is string => typeof m === 'string' && /^[A-Za-z0-9][A-Za-z0-9._\-\[\]]{0,79}$/.test(m);

/** Read the settings file. Anything missing, unknown or wrong falls back to its default; never throws. */
export function parseSettings(text: string | null): Settings {
  let raw: any = {};
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    raw = {};
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) raw = {};
  return applySettings(DEFAULT_SETTINGS, raw);
}

/** `patch` laid over `base`, taking only keys and values that are valid. */
export function applySettings(base: Settings, patch: unknown): Settings {
  const p = (typeof patch === 'object' && patch !== null ? patch : {}) as Record<string, unknown>;
  const out = { ...base };
  if (typeof p.zoom === 'number' && Number.isFinite(p.zoom)) out.zoom = clampZoom(p.zoom);
  if (p.model === '' || validModel(p.model)) out.model = p.model;
  if (p.effort === '' || EFFORTS.includes(p.effort as Effort)) out.effort = p.effort as Effort | '';
  if (p.mode === '' || MODES.includes(p.mode as Mode)) out.mode = p.mode as Mode | '';
  if (typeof p.toolsOpen === 'boolean') out.toolsOpen = p.toolsOpen;
  if (typeof p.showAccount === 'boolean') out.showAccount = p.showAccount;
  return out;
}

/** Flags added when the app starts `claude`. Nothing is added for a setting left on "default". */
export function startFlags(s: Pick<Settings, 'model' | 'effort' | 'mode'>): string[] {
  const flags: string[] = [];
  if (validModel(s.model)) flags.push('--model', s.model);
  if (EFFORTS.includes(s.effort as Effort)) flags.push('--effort', s.effort);
  if (MODES.includes(s.mode as Mode)) flags.push('--permission-mode', s.mode);
  return flags;
}

// What Claude Code's status line says for each mode (the app reads the mode back from the terminal).
const MODE_TEXT: [RegExp, Mode | 'other'][] = [
  [/manual mode on/, 'manual'],
  [/accept edits on/, 'acceptEdits'],
  [/plan mode on/, 'plan'],
  [/auto mode on/, 'auto'],
  [/bypass permissions on|don'?t ask on/i, 'other'],
];

/** The mode named last in a piece of terminal text. null: none named. 'other': a mode this app does not offer. */
export function modeInText(text: string): Mode | 'other' | null {
  let best: { at: number; mode: Mode | 'other' } | null = null;
  for (const [re, mode] of MODE_TEXT) {
    const g = new RegExp(re.source, 'g' + re.flags.replace('g', ''));
    let m: RegExpExecArray | null;
    while ((m = g.exec(text))) if (!best || m.index > best.at) best = { at: m.index, mode };
  }
  return best ? best.mode : null;
}

/** The effort level shown in Claude Code's corner ("● high · /effort"), if any. */
export function effortInText(text: string): Effort | null {
  const all = [...text.matchAll(/(low|medium|high|xhigh|max) · \/effort/g)];
  return all.length ? (all[all.length - 1][1] as Effort) : null;
}

/** Shift+Tab cycles the modes in a fixed order. At most this many presses are ever needed (and tried). */
export const MAX_MODE_PRESSES = MODES.length + 2;
