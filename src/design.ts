// design.json (version 3): schema, built-in default, strict validation, contrast checks, and the
// conversion of older files. Data only: nothing in the file is ever run.
import { arr, num, obj, Panel, panel } from './design-v1';
import {
  bool, contrastRatio, DEFAULT_DESIGN_V2, DesignV2, font, HeadingType, headingType, hex, MIN_CONTRAST, readable, readDesignV2, resolveTheme, Theme, Tone, TONES,
} from './design-v2';

import { DEFAULT_LOOK, isAccentName, Look, lookColors } from './themes';

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
  look?: Look; // the accent last picked (optional; default cyan). The colors themselves are in `colors`.
}

/** The big title's hover glow, 0 (none) to 1. Optional in the file. */
export const DEFAULT_GLOW = 0.5;
const OLD_FX = { size: 64, weight: 800 }; // the title size while titles were halftone dots

const defaultColors = lookColors(DEFAULT_LOOK);

export const DEFAULT_DESIGN: Design = {
  version: 3,
  theme: 'system',
  fonts: { ...DEFAULT_DESIGN_V2.fonts },
  type: {
    body: 19, message: 17, ui: 14, small: 12.5, code: 15,
    h1: { size: 40, weight: 700 }, h2: { size: 30, weight: 700 }, h3: { size: 23, weight: 600 }, h4: { size: 19, weight: 700 },
    fx: { size: 88, weight: 800 },
  },
  space: { exchange: 40, beforeH1: 56, beforeH2: 44, beforeH3: 32, afterHeading: 14, paragraph: 18, listItem: 10, block: 28, blockPadding: 16 },
  layout: { chatWidth: 760, sidebarWidth: 240, sidebar: true },
  colors: {
    // The base surfaces with the Cyan accent (themes.ts). accentFill: the accent as a fill (send button,
    // toggles, selection); accentOn: text and icons on it; tones.accent: the accent as text.
    light: defaultColors.light,
    dark: defaultColors.dark,
    tones: { ...DEFAULT_DESIGN_V2.colors.tones, accent: defaultColors.accent },
  },
  effects: { enabled: true, glow: DEFAULT_GLOW },
  terminal: { fontSize: 13 },
  panels: [],
  look: { ...DEFAULT_LOOK },
};

function parseV3(raw: unknown): Design {
  const d = obj(raw, ['version', 'theme', 'fonts', 'type', 'space', 'layout', 'colors', 'effects', 'terminal', 'panels', 'look'], 'design', ['look']);
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
    readable(r.accentOn, r.accentFill, `colors.${name}.accentOn`, `colors.${name}.accentFill`);
    for (const k of TONES) readable(tones[k][name], r.background, `colors.tones.${k}.${name}`, `colors.${name}.background`);
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
    if (!isAccentName(lk.accent)) throw new Error('look.accent must be one of: cyan mint blue violet pink coral amber green red');
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
  d.layout.sidebarWidth = o.layout.sidebarWidth;
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
