// The looks the user can pick: 9 accents on one set of surfaces, each a stored set of hand-set colors. Picking
// copies the stored values into design.json; nothing is computed at pick time, so a bad color cannot be
// chosen. Every combination is checked for contrast by themes.test.ts. Pure functions.
import type { Design, Roles } from './design';

export const ACCENT_NAMES = ['cyan', 'mint', 'blue', 'violet', 'pink', 'coral', 'amber', 'green', 'red'] as const;
export type AccentName = (typeof ACCENT_NAMES)[number];

/** The surface and text roles (everything but the accent's fill and the text on it). */
export type Surface = Omit<Roles, 'accentFill' | 'accentOn'>;

export interface AccentSet {
  label: string;
  fill: string; // the accent as a filled shape (send button, switches, selection)
  light: string; // the accent as text on a light theme
  dark: string; // the accent as text on a dark theme
  on: string; // text and icons on the fill
}

// The one set of surfaces, light and dark (the former Paper theme). The four picked themes are gone;
// light, dark or system is the only choice, plus the accent.
export const BASE: { light: Surface; dark: Surface } = {
  light: { background: '#f8f6f1', surface: '#f1eee7', raised: '#e9e5dc', border: '#d9d4c8', text: '#23211d', mutedText: '#6b665d', userBubble: '#e7e3da', userText: '#23211d', codeBackground: '#f0eee6' },
  dark: { background: '#1d1c1a', surface: '#262522', raised: '#302e2b', border: '#3a3835', text: '#ece8e0', mutedText: '#a39d92', userBubble: '#302e2b', userText: '#ece8e0', codeBackground: '#151412' },
};

export const ACCENTS: Record<AccentName, AccentSet> = {
  cyan: { label: 'Cyan', fill: '#00E2E6', light: '#00787A', dark: '#00E2E6', on: '#1d1c1a' },
  mint: { label: 'Mint', fill: '#5EDFA4', light: '#1B7A50', dark: '#5EDFA4', on: '#1d1c1a' },
  blue: { label: 'Blue', fill: '#6CB2FF', light: '#1F63B5', dark: '#7DB8FF', on: '#1d1c1a' },
  violet: { label: 'Violet', fill: '#A99BFF', light: '#5B4BC4', dark: '#B3A7FF', on: '#1d1c1a' },
  pink: { label: 'Pink', fill: '#FFB7C5', light: '#B83A63', dark: '#FFB7C5', on: '#1d1c1a' },
  coral: { label: 'Coral', fill: '#FF9478', light: '#B3401F', dark: '#FF9478', on: '#1d1c1a' },
  amber: { label: 'Amber', fill: '#F4B740', light: '#8F5A00', dark: '#F4B740', on: '#1d1c1a' },
  green: { label: 'Green', fill: '#069902', light: '#057B02', dark: '#06A802', on: '#1d1c1a' },
  red: { label: 'Red', fill: '#C20000', light: '#C20000', dark: '#FF4D4D', on: '#FFFFFF' },
};

export interface Look {
  accent: AccentName;
}
export const DEFAULT_LOOK: Look = { accent: 'cyan' };

export const isAccentName = (v: unknown): v is AccentName => (ACCENT_NAMES as readonly unknown[]).includes(v);

/** The colors of one look, as design.json holds them (other tones are not part of a look). */
export function lookColors(look: Look): { light: Roles; dark: Roles; accent: { light: string; dark: string } } {
  const t = BASE;
  const a = ACCENTS[look.accent];
  return {
    light: { ...t.light, accentFill: a.fill, accentOn: a.on },
    dark: { ...t.dark, accentFill: a.fill, accentOn: a.on },
    accent: { light: a.light, dark: a.dark },
  };
}

/** A copy of the design with this look's stored colors and the accent's name. Nothing else changes. */
export function applyLook(d: Design, look: Look): Design {
  const c = lookColors(look);
  const next = structuredClone(d);
  next.colors.light = c.light;
  next.colors.dark = c.dark;
  next.colors.tones.accent = c.accent;
  next.look = { ...look };
  return next;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sameRoles = (a: Roles, b: Roles) => (Object.keys(b) as (keyof Roles)[]).every((k) => same(a[k], b[k]));

// The default colors before themes existed (older surface values, Cyan). A file written then has no
// `look` key; it still counts as Cyan.
const OLD_DEFAULT = {
  light: { ...BASE.light, surface: '#f0ede6', raised: '#e7e3da', codeBackground: '#efece4', accentFill: '#00E2E6', accentOn: '#1d1c1a' },
  dark: { ...BASE.dark, accentFill: '#00E2E6', accentOn: '#1d1c1a' },
  accent: { light: '#00787A', dark: '#00E2E6' },
};

const matches = (d: Design, c: ReturnType<typeof lookColors>) =>
  sameRoles(d.colors.light, c.light) && sameRoles(d.colors.dark, c.dark) && same(d.colors.tones.accent.light, c.accent.light) && same(d.colors.tones.accent.dark, c.accent.dark);

/** What the design's colors are: the recorded look when its colors still match the stored set exactly,
 * else 'custom' (someone edited `colors` by hand). */
export function matchLook(d: Design): Look | 'custom' {
  const look = d.look ?? DEFAULT_LOOK;
  if (matches(d, lookColors(look))) return look;
  if (!d.look && matches(d, OLD_DEFAULT)) return DEFAULT_LOOK;
  return 'custom';
}
