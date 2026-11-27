// design.json (version 3): schema, built-in default, strict validation, contrast checks, and the
// conversion of older files. Data only: nothing in the file is ever run.
import { arr, num, obj, Panel, panel } from './design-v1';
import {
  bool, contrastRatio, DEFAULT_DESIGN_V2, DesignV2, font, HeadingType, headingType, hex, MIN_CONTRAST, readable, readDesignV2, resolveTheme, Theme, Tone, TONES,
} from './design-v2';

import { ACCENT_NAMES, DEFAULT_LOOK, isAccentName, Look, lookColors, matchLook } from './themes';

export { contrastRatio, MIN_CONTRAST, resolveTheme, Theme, Tone, TONES };

export const ROLES = ['background', 'surface', 'raised', 'border', 'text', 'mutedText', 'userBubble', 'userText', 'codeBackground', 'accentFill', 'accentOn'] as const;
export type Role = (typeof ROLES)[number];
export type Roles = Record<Role, string>;
export const SIZES = ['body', 'message', 'ui', 'small', 'code'] as const;
export const HEADS = ['h1', 'h2', 'h3', 'h4', 'fx'] as const;
export const SPACES = ['exchange', 'beforeH1', 'beforeH2', 'beforeH3', 'afterHeading', 'paragraph', 'listItem', 'block', 'blockPadding'] as const;

export interface Design {
  version: 3;
  theme: Theme;
  fonts: { reply: string; ui: string; code: string };
  type: Record<(typeof SIZES)[number], number> & Record<(typeof HEADS)[number], HeadingType>;
  space: Record<(typeof SPACES)[number], number>;
  layout: { chatWidth: number; sidebarWidth: number; sidebar: boolean };
  colors: { light: Roles; dark: Roles; tones: Record<Tone, { light: string; dark: string }> };
  effects: { enabled: boolean; glow: number };
  terminal: { fontSize: number };
  panels: Panel[];
  background?: Background; // optional; none = the theme's own background
  look?: Look; // the accent last picked (optional; default: Claude #D97757). The colors themselves are in `colors`.
}

/** What is behind the app: a preset ('theme' = the theme's own color; 'claude' is from the glass trial,
 * when Claude's dark background was a separate choice: now the Dark theme itself, so it draws the same) or a
 * picture: a file name in the project's backgrounds/ folder. */
export type Background = { preset: 'theme' | 'claude' } | { picture: string };
/** A picture's file name: plain name, no folders, an image type the page can draw. */
export const PICTURE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}\.(png|jpe?g|webp|gif)$/i;

/** The big title's hover glow, 0 (none) to 1. Optional in the file. */
export const DEFAULT_GLOW = 0.5;
export const ICON_CONTRAST = 3;
const OLD_FX = { size: 64, weight: 800 }; // the title size while titles were halftone dots

const defaultColors = lookColors(DEFAULT_LOOK);

// The defaults below are the values of tokens.css (design/DESIGN.md). The page draws from the tokens; a
// value in design.json that still equals a default (this one or an older one) leaves the token in charge.
// Anything else in the file wins (designOverrides).
export const DEFAULT_DESIGN: Design = {
  version: 3,
  theme: 'system',
  fonts: { reply: 'Source Serif 4 Variable, Source Serif 4, Georgia, serif', ui: 'Geist Variable, Geist, -apple-system, sans-serif', code: 'Geist Mono Variable, Geist Mono, Menlo, monospace' },
  type: {
    body: 17, message: 15, ui: 14, small: 12.5, code: 13,
    // DESIGN.md: only weights 400, 500 and 600
    h1: { size: 40, weight: 600 }, h2: { size: 30, weight: 600 }, h3: { size: 23, weight: 600 }, h4: { size: 19, weight: 600 },
    fx: { size: 88, weight: 600 },
  },
  space: { exchange: 32, beforeH1: 56, beforeH2: 44, beforeH3: 32, afterHeading: 14, paragraph: 16, listItem: 10, block: 16, blockPadding: 16 },
  layout: { chatWidth: 720, sidebarWidth: 272, sidebar: true },
  colors: {
    // The base surfaces with the default accent (themes.ts). accentFill: the accent as a fill (send button,
    // toggles, selection); accentOn: text and icons on it; tones.accent: the accent as text.
    light: defaultColors.light,
    dark: defaultColors.dark,
    // Light shades a little darker than before: they must read on Ivory's code background too.
    tones: {
      ...DEFAULT_DESIGN_V2.colors.tones,
      muted: { light: '#69645b', dark: '#a39d92' },
      good: { light: '#1d7148', dark: '#6fcf97' },
      warn: { light: '#925600', dark: '#e9b44c' },
      green: { light: '#39711d', dark: '#9ccf6a' },
      orange: { light: '#a7460b', dark: '#f29a5c' },
      teal: { light: '#0f7073', dark: '#5fcfd0' },
      accent: defaultColors.accent,
    },
  },
  effects: { enabled: true, glow: DEFAULT_GLOW },
  terminal: { fontSize: 13 },
  panels: [],
  look: { ...DEFAULT_LOOK },
};

// Older defaults: before the redesign (Paper) and during the glass trial. A file written then still has
// them; they count as "not set".
const OLD_DEFAULTS = [
  {
    fonts: { ...DEFAULT_DESIGN_V2.fonts } as Record<string, string>,
    type: { body: 19, message: 17, ui: 14, small: 12.5, code: 15 } as Record<string, number>,
    space: { exchange: 40, paragraph: 18, block: 28 } as Record<string, number>,
    layout: { chatWidth: 760, sidebarWidth: 240 } as Record<string, number>,
  },
  {
    fonts: { reply: 'Geist Variable, Geist, -apple-system, sans-serif' } as Record<string, string>,
    type: { body: 15 } as Record<string, number>,
    space: { exchange: 36 } as Record<string, number>,
    layout: {} as Record<string, number>,
  },
];

const OLD_HEAD_WEIGHTS: Record<(typeof HEADS)[number], number> = { h1: 700, h2: 700, h3: 600, h4: 700, fx: 800 };

const SPACE_VARS: Record<(typeof SPACES)[number], string> = {
  exchange: 'exchange', beforeH1: 'before-h1', beforeH2: 'before-h2', beforeH3: 'before-h3', afterHeading: 'after-heading',
  paragraph: 'paragraph', listItem: 'list', block: 'block', blockPadding: 'block-pad',
};
const SIZE_VARS: Record<(typeof SIZES)[number], string> = { body: 'body-size', message: 'msg-size', ui: 'ui-size', small: 'small-size', code: 'code-size' };
const ROLE_VARS: Record<Role, string> = {
  background: 'bg', surface: 'surface', raised: 'raised', border: 'border', text: 'text-1', mutedText: 'text-2',
  userBubble: 'user-bubble', userText: 'user-fg', codeBackground: 'code-bg', accentFill: 'accent', accentOn: 'on-accent',
};

/** The CSS variables design.json sets over tokens.css for this theme: every value that differs from the
 * shipped default (current or pre-redesign). Colors only when they are not a stored look (edited by hand);
 * the color tones (Claude's {good}, {bad}... and the red) always come from the file. */
export function designOverrides(d: Design, theme: 'light' | 'dark'): Record<string, string> {
  const out: Record<string, string> = {};
  const D = DEFAULT_DESIGN;
  const isDefault = (v: unknown, ...defaults: unknown[]) => defaults.some((x) => x !== undefined && JSON.stringify(x) === JSON.stringify(v));
  const old = <K extends keyof (typeof OLD_DEFAULTS)[number]>(group: K, key: string) => OLD_DEFAULTS.map((o) => o[group][key]);
  for (const k of ['reply', 'ui', 'code'] as const) if (!isDefault(d.fonts[k], D.fonts[k], ...old('fonts', k))) out[`--font-${k}`] = d.fonts[k];
  for (const k of SIZES) if (!isDefault(d.type[k], D.type[k], ...old('type', k))) out[`--${SIZE_VARS[k]}`] = `${d.type[k]}px`;
  for (const k of HEADS) {
    if (d.type[k].size !== D.type[k].size) out[`--${k}-size`] = `${d.type[k].size}px`;
    if (!isDefault(d.type[k].weight, D.type[k].weight, OLD_HEAD_WEIGHTS[k])) out[`--${k}-weight`] = `${d.type[k].weight}`;
  }
  for (const k of SPACES) if (!isDefault(d.space[k], D.space[k], ...old('space', k))) out[`--sp-${SPACE_VARS[k]}`] = `${d.space[k]}px`;
  if (!isDefault(d.layout.chatWidth, D.layout.chatWidth, ...old('layout', 'chatWidth'))) out['--chat-width'] = `${d.layout.chatWidth}px`;
  if (!isDefault(d.layout.sidebarWidth, D.layout.sidebarWidth, ...old('layout', 'sidebarWidth'))) out['--sidebar-width'] = `${d.layout.sidebarWidth}px`;
  if (d.effects.glow !== DEFAULT_GLOW) out['--fx-glow'] = String(d.effects.glow);
  for (const k of TONES) if (k !== 'accent') out[`--t-${k}`] = d.colors.tones[k][theme];
  if (matchLook(d) === 'custom') {
    const r = d.colors[theme];
    for (const k of ROLES) out[`--${ROLE_VARS[k]}`] = r[k];
    // the DESIGN.md tokens that stand for a role: the sidebar is the surface, its row fills are raised
    out['--sidebar-bg'] = r.surface;
    out['--row-active'] = out['--row-new'] = r.raised;
    out['--send'] = r.accentFill;
    out['--accent-text'] = d.colors.tones.accent[theme];
  }
  return out;
}

function parseV3(raw: unknown): Design {
  const d = obj(raw, ['version', 'theme', 'fonts', 'type', 'space', 'layout', 'colors', 'effects', 'terminal', 'panels', 'look', 'background'], 'design', ['look', 'background']);
  if (d.version !== 3) throw new Error('version must be 3');
  if (d.theme !== 'system' && d.theme !== 'light' && d.theme !== 'dark') throw new Error('theme must be "system", "light" or "dark"');
  const f = obj(d.fonts, ['reply', 'ui', 'code'], 'fonts');
  const t = obj(d.type, [...SIZES, ...HEADS], 'type');
  const s = obj(d.space, [...SPACES], 'space');
  const l = obj(d.layout, ['chatWidth', 'sidebarWidth', 'sidebar'], 'layout');
  const c = obj(d.colors, ['light', 'dark', 'tones'], 'colors');
  const themeRoles = (v: unknown, where: string) => {
    const o = obj(v, [...ROLES], where);
    const out = {} as Roles;
    for (const k of ROLES) out[k] = hex(o[k], `${where}.${k}`);
    return out;
  };
  const light = themeRoles(c.light, 'colors.light');
  const dark = themeRoles(c.dark, 'colors.dark');
  const tn = obj(c.tones, [...TONES], 'colors.tones');
  const tones = {} as Design['colors']['tones'];
  for (const k of TONES) {
    const o = obj(tn[k], ['light', 'dark'], `colors.tones.${k}`);
    tones[k] = { light: hex(o.light, `colors.tones.${k}.light`), dark: hex(o.dark, `colors.tones.${k}.dark`) };
  }
  for (const [name, r] of [['light', light], ['dark', dark]] as const) {
    readable(r.text, r.background, `colors.${name}.text`, `colors.${name}.background`);
    readable(r.mutedText, r.background, `colors.${name}.mutedText`, `colors.${name}.background`);
    readable(r.userText, r.userBubble, `colors.${name}.userText`, `colors.${name}.userBubble`);
    // Only icons sit on the accent fill (send arrow, switch knob): 3:1, the WCAG rule for non-text.
    const onFill = contrastRatio(r.accentOn, r.accentFill);
    if (onFill < ICON_CONTRAST) throw new Error(`colors.${name}.accentOn has contrast ${onFill.toFixed(1)} on colors.${name}.accentFill (needs ${ICON_CONTRAST})`);
    for (const k of TONES) readable(tones[k][name], r.background, `colors.tones.${k}.${name}`, `colors.${name}.background`);
  }
  let background: Background | undefined;
  if (d.background !== undefined) {
    const b = obj(d.background, ['preset', 'picture'], 'background', ['preset', 'picture']);
    if ((b.preset === undefined) === (b.picture === undefined)) throw new Error('background must have either "preset" or "picture"');
    if (b.preset !== undefined) {
      if (b.preset !== 'theme' && b.preset !== 'claude') throw new Error('background.preset must be "theme" or "claude"');
      background = { preset: b.preset };
    } else {
      if (typeof b.picture !== 'string' || !PICTURE_NAME.test(b.picture) || b.picture.includes('..'))
        throw new Error('background.picture must be a file name in backgrounds/, like "sea.jpg" (png, jpg, webp or gif)');
      background = { picture: b.picture };
    }
  }
  // `dither` is from files written while titles were halftone dots: accepted (any value) and ignored.
  const e = obj(d.effects, ['enabled', 'glow', 'dither'], 'effects', ['glow', 'dither']);
  const glow = e.glow === undefined ? DEFAULT_GLOW : num(e.glow, 0, 1, 'effects.glow');
  const term = obj(d.terminal, ['fontSize'], 'terminal');
  const type = {} as Design['type'];
  for (const k of SIZES) type[k] = num(t[k], 6, 40, `type.${k}`);
  for (const k of HEADS) {
    const h = obj(t[k], ['size', 'weight'], `type.${k}`);
    type[k] = { size: num(h.size, 6, 120, `type.${k}.size`), weight: num(h.weight, 100, 900, `type.${k}.weight`) };
  }
  // A file from the halftone days with the old default title size gets the new, bigger default.
  if (e.dither !== undefined && type.fx.size === OLD_FX.size && type.fx.weight === OLD_FX.weight) type.fx = { ...DEFAULT_DESIGN.type.fx };
  const space = {} as Design['space'];
  for (const k of SPACES) space[k] = num(s[k], 0, 200, `space.${k}`);
  let look: Look | undefined;
  if (d.look !== undefined) {
    // `theme` is from files written while there were four themes to pick: accepted and ignored.
    const lk = obj(d.look, ['theme', 'accent'], 'look', ['theme']);
    if (!isAccentName(lk.accent)) throw new Error(`look.accent must be one of: ${ACCENT_NAMES.join(' ')}`);
    look = { accent: lk.accent };
  }
  return {
    version: 3,
    theme: d.theme,
    fonts: { reply: font(f.reply, 'fonts.reply'), ui: font(f.ui, 'fonts.ui'), code: font(f.code, 'fonts.code') },
    type,
    space,
    layout: {
      chatWidth: num(l.chatWidth, 300, 3000, 'layout.chatWidth'),
      sidebarWidth: num(l.sidebarWidth, 160, 480, 'layout.sidebarWidth'),
      sidebar: bool(l.sidebar, 'layout.sidebar'),
    },
    colors: { light, dark, tones },
    effects: { enabled: bool(e.enabled, 'effects.enabled'), glow },
    terminal: { fontSize: num(term.fontSize, 6, 40, 'terminal.fontSize') },
    panels: arr(d.panels, 'panels').map((p, i) => panel(p, `panels[${i}]`)),
    ...(look ? { look } : {}),
    ...(background ? { background } : {}),
  };
}

export const OLD_FORMAT_NOTE = 'design.json is in an older format and was converted for this run. Design > Reset Design writes the new format.';

/** A version 2 design, converted: what you changed is kept; what still had the old default takes the new default. */
export function fromV2(o: DesignV2): Design {
  const d = structuredClone(DEFAULT_DESIGN);
  const was = DEFAULT_DESIGN_V2;
  const keep = <T>(old: T, oldDefault: T, set: (v: T) => void) => JSON.stringify(old) !== JSON.stringify(oldDefault) && set(old);
  d.theme = o.theme;
  keep(o.fonts, was.fonts, (v) => (d.fonts = v));
  for (const k of ['body', 'ui', 'code'] as const) keep(o.type[k], was.type[k], (v) => (d.type[k] = v));
  for (const k of ['h1', 'h2', 'h3'] as const) keep(o.type[k], was.type[k], (v) => (d.type[k] = v));
  keep(o.layout.chatWidth, was.layout.chatWidth, (v) => (d.layout.chatWidth = v));
  keep(o.layout.sidebarWidth, was.layout.sidebarWidth, (v) => (d.layout.sidebarWidth = v));
  d.layout.sidebar = o.layout.sidebar;
  for (const th of ['light', 'dark'] as const) keep(o.colors[th], was.colors[th], (v) => (d.colors[th] = { ...d.colors[th], ...v }));
  for (const k of TONES) keep(o.colors.tones[k], was.colors.tones[k], (v) => (d.colors.tones[k] = v));
  d.effects.enabled = o.effects.enabled;
  d.terminal = o.terminal;
  d.panels = o.panels;
  return parseV3(d); // e.g. a background you changed must still be readable with the new colors
}

/** Parse and validate design.json text. Throws an Error with a one-line message. */
export function readDesign(text: string): { design: Design; note: string | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`bad JSON: ${(e as Error).message}`);
  }
  const version = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as { version?: unknown }).version : undefined;
  if (version === 3) return { design: parseV3(raw), note: null };
  if (version !== undefined && version !== 2) throw new Error('version must be 3');
  return { design: fromV2(readDesignV2(text).design), note: OLD_FORMAT_NOTE };
}

export const parseDesign = (text: string): Design => readDesign(text).design;
