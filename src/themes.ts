// The looks the user can pick: the default accent (Clay, #D97757) and 9 more on one set of surfaces, each a stored set of hand-set colors. Picking
// copies the stored values into design.json; nothing is computed at pick time, so a bad color cannot be
// chosen. Every combination is checked for contrast by themes.test.ts. Pure functions.
import type { Design, Roles } from './design';

export const ACCENT_NAMES = ['default', 'cyan', 'mint', 'blue', 'violet', 'pink', 'coral', 'amber', 'green', 'red'] as const;
export type AccentName = (typeof ACCENT_NAMES)[number];

/** The surface and text roles (everything but the accent's fill and the text on it). */
export type Surface = Omit<Roles, 'accentFill' | 'accentOn'>;

export interface AccentSet {
  label: string;
  fill: string; // the accent as a filled shape (send button, switches, selection)
  light: string; // the accent as text on a light theme
  dark: string; // the accent as text on a dark theme
  on: string; // text and icons on the fill
  fillLight?: string; // the fill in Ivory, when it differs from the fill in Dark
  onLight?: string;
  send?: string; // the send button's fill, when it differs from the fill
}

// The one set of surfaces: Ivory (light: white and neutral gray) and Dark (the Claude app's dark mode),
// sampled from Claude chat (design/DESIGN.md). These are the copy design.json holds; the page draws from
// tokens.css, which has the same values (tokens.test.ts keeps the two equal). surface is the sidebar, raised
// the highlighted row.
export const BASE: { light: Surface; dark: Surface } = {
  light: { background: '#ffffff', surface: '#fafafa', raised: '#e0e0e0', border: '#dcdcdc', text: '#191919', mutedText: '#5e5e5e', userBubble: '#e9e9e9', userText: '#191919', codeBackground: '#fafafa' },
  dark: { background: '#191919', surface: '#1f1f1f', raised: '#404040', border: '#414141', text: '#f0f0f0', mutedText: '#c0c0c0', userBubble: '#141413', userText: '#f0f0f0', codeBackground: '#1f1f1f' },
};

// The first Ivory and Dark (DESIGN.md v2's Figma values and approximations). A file written with them counts
// as its accent, so the sampled colors reach it without the file being rewritten.
export const IVORY_V2: { light: Surface; dark: Surface } = {
  light: { background: '#f7f6f1', surface: '#efede6', raised: '#e4e1d6', border: '#e3e0d6', text: '#1f1e1c', mutedText: '#5f5e58', userBubble: '#ece9e0', userText: '#1f1e1c', codeBackground: '#efede6' },
  dark: { background: '#262624', surface: '#1f1e1d', raised: '#30302e', border: '#42413e', text: '#faf9f5', mutedText: '#c2c0b6', userBubble: '#141413', userText: '#faf9f5', codeBackground: '#1f1e1d' },
};

// The background presets in Settings: the two themes' own backgrounds (picking one sets the theme too).
// A picture of the user's own is the third choice (design.json "background").
export const BACKGROUNDS = [
  { id: 'ivory', label: 'Ivory', color: '#ffffff', theme: 'light' },
  { id: 'dark', label: 'Dark', color: '#191919', theme: 'dark' },
] as const;

// The liquid-glass surfaces (never shipped; a file written while testing them counts as its accent).
export const GLASS: { light: Surface; dark: Surface } = {
  light: { background: '#f0eee6', surface: '#f7f5ef', raised: '#e7e4da', border: '#dad6ca', text: '#1a1915', mutedText: '#5e5d59', userBubble: '#e7e4da', userText: '#5e5d59', codeBackground: '#e6e4dd' },
  dark: { background: '#05070d', surface: '#0d1018', raised: '#161a23', border: '#232834', text: '#f3f6fb', mutedText: '#a3abbc', userBubble: '#161a23', userText: '#a3abbc', codeBackground: '#0f1117' },
};

// The surfaces before the redesign (Paper). A file that still has them with a stored accent counts as that
// look, so the new surfaces reach it without the file being rewritten.
export const PAPER: { light: Surface; dark: Surface } = {
  light: { background: '#f8f6f1', surface: '#f1eee7', raised: '#e9e5dc', border: '#d9d4c8', text: '#23211d', mutedText: '#6b665d', userBubble: '#e7e3da', userText: '#23211d', codeBackground: '#f0eee6' },
  dark: { background: '#1d1c1a', surface: '#262522', raised: '#302e2b', border: '#3a3835', text: '#ece8e0', mutedText: '#a39d92', userBubble: '#302e2b', userText: '#ece8e0', codeBackground: '#151412' },
};

export const ACCENTS: Record<AccentName, AccentSet> = {
  default: { label: 'Clay', fill: '#D97757', light: '#9D4D2C', dark: '#D97757', on: '#FFFFFF', send: '#C6623F' },
  cyan: { label: 'Cyan', fill: '#00E2E6', light: '#007071', dark: '#00E2E6', on: '#1d1c1a' },
  mint: { label: 'Mint', fill: '#5EDFA4', light: '#19714A', dark: '#5EDFA4', on: '#1d1c1a' },
  blue: { label: 'Blue', fill: '#6CB2FF', light: '#1F63B5', dark: '#7DB8FF', on: '#1d1c1a' },
  violet: { label: 'Violet', fill: '#A99BFF', light: '#5B4BC4', dark: '#B3A7FF', on: '#1d1c1a' },
  pink: { label: 'Pink', fill: '#FFB7C5', light: '#AF375E', dark: '#FFB7C5', on: '#1d1c1a' },
  coral: { label: 'Coral', fill: '#FF9478', light: '#AF3F1E', dark: '#FF9478', on: '#1d1c1a' },
  amber: { label: 'Amber', fill: '#F4B740', light: '#8E5900', dark: '#F4B740', on: '#1d1c1a' },
  green: { label: 'Green', fill: '#069902', light: '#057502', dark: '#06A802', on: '#1d1c1a' },
  red: { label: 'Red', fill: '#C20000', light: '#C20000', dark: '#FF4D4D', on: '#FFFFFF' },
};

// The accents' text shades on light before the redesign (Ivory's code background needed darker ones).
const PAPER_ACCENT_TEXT: Partial<Record<AccentName, string>> = {
  cyan: '#00787A', mint: '#1B7A50', pink: '#B83A63', coral: '#B3401F', amber: '#8F5A00', green: '#057B02',
};

export interface Look {
  accent: AccentName;
}
export const DEFAULT_LOOK: Look = { accent: 'default' };

export const isAccentName = (v: unknown): v is AccentName => (ACCENT_NAMES as readonly unknown[]).includes(v);

/** The colors of one look, as design.json holds them (other tones are not part of a look). */
export function lookColors(look: Look, t = BASE): { light: Roles; dark: Roles; accent: { light: string; dark: string } } {
  const a = ACCENTS[look.accent];
  return {
    light: { ...t.light, accentFill: a.fillLight ?? a.fill, accentOn: a.onLight ?? a.on },
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
  light: { ...PAPER.light, surface: '#f0ede6', raised: '#e7e3da', codeBackground: '#efece4', accentFill: '#00E2E6', accentOn: '#1d1c1a' },
  dark: { ...PAPER.dark, accentFill: '#00E2E6', accentOn: '#1d1c1a' },
  accent: { light: '#00787A', dark: '#00E2E6' },
};

// The glass trial's default accent: Sky in the dark theme, a lighter Clay in Ivory.
const GLASS_DEFAULT = {
  light: { ...GLASS.light, accentFill: '#C96442', accentOn: '#FFFFFF' },
  dark: { ...GLASS.dark, accentFill: '#7DD3FC', accentOn: '#06101F' },
  accent: { light: '#9D4D2C', dark: '#7DD3FC' },
};

const matches = (d: Design, c: ReturnType<typeof lookColors>) =>
  sameRoles(d.colors.light, c.light) && sameRoles(d.colors.dark, c.dark) && same(d.colors.tones.accent.light, c.accent.light) && same(d.colors.tones.accent.dark, c.accent.dark);

/** What the design's colors are: the recorded look when its colors still match the stored set exactly,
 * else 'custom' (someone edited `colors` by hand). */
export function matchLook(d: Design): Look | 'custom' {
  const look = d.look ?? DEFAULT_LOOK;
  if (matches(d, lookColors(look))) return look;
  if (matches(d, lookColors(look, IVORY_V2))) return look; // written with the first Ivory and Dark
  if (look.accent !== 'default') {
    // written before the redesign: Paper surfaces and the accent's old text shade
    const paper = lookColors(look, PAPER);
    const old = PAPER_ACCENT_TEXT[look.accent];
    if (matches(d, old ? { ...paper, accent: { ...paper.accent, light: old } } : paper)) return look;
    if (matches(d, lookColors(look, GLASS))) return look; // written while the glass surfaces were tried
  } else if (matches(d, GLASS_DEFAULT)) return look;
  if (!d.look && matches(d, OLD_DEFAULT)) return { accent: 'cyan' };
  return 'custom';
}
