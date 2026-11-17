// design.json version 2. Still read, then converted to version 3 by design.ts (version 1 files pass
// through here too). Data only.
import { arr, DEFAULT_DESIGN_V1, FONT, num, obj, Panel, panel, parseDesignV1 } from './design-v1';

export const TONES = ['accent', 'muted', 'good', 'warn', 'bad', 'blue', 'green', 'orange', 'purple', 'pink', 'teal'] as const;
export type Tone = (typeof TONES)[number];
export const ROLES = ['background', 'surface', 'raised', 'border', 'text', 'mutedText', 'userBubble', 'userText', 'codeBackground'] as const;
export type Role = (typeof ROLES)[number];
export type Roles = Record<Role, string>;
export type Theme = 'system' | 'light' | 'dark';
export interface HeadingType {
  size: number;
  weight: number;
}

export interface DesignV2 {
  version: 2;
  theme: Theme;
  fonts: { reply: string; ui: string; code: string };
  type: { body: number; ui: number; code: number; h1: HeadingType; h2: HeadingType; h3: HeadingType };
  layout: { chatWidth: number; sidebarWidth: number; sidebar: boolean };
  colors: { light: Roles; dark: Roles; tones: Record<Tone, { light: string; dark: string }> };
  effects: { enabled: boolean; gradientTo: Tone };
  terminal: { fontSize: number };
  panels: Panel[];
}

export const DEFAULT_DESIGN_V2: DesignV2 = {
  version: 2,
  theme: 'system',
  fonts: {
    reply: 'Charter, Iowan Old Style, Georgia, serif',
    ui: '-apple-system, Helvetica Neue, Arial, sans-serif',
    code: 'SF Mono, Menlo, monospace',
  },
  type: { body: 17, ui: 13, code: 14, h1: { size: 30, weight: 700 }, h2: { size: 23, weight: 700 }, h3: { size: 19, weight: 600 } },
  layout: { chatWidth: 720, sidebarWidth: 240, sidebar: true },
  colors: {
    light: {
      background: '#f8f6f1', surface: '#f0ede6', raised: '#e7e3da', border: '#d9d4c8', text: '#23211d',
      mutedText: '#6b665d', userBubble: '#e7e3da', userText: '#23211d', codeBackground: '#efece4',
    },
    dark: {
      background: '#1d1c1a', surface: '#262522', raised: '#302e2b', border: '#3a3835', text: '#ece8e0',
      mutedText: '#a39d92', userBubble: '#302e2b', userText: '#ece8e0', codeBackground: '#151412',
    },
    tones: {
      accent: { light: '#4a43c4', dark: '#aaa4ff' },
      muted: { light: '#6b665d', dark: '#a39d92' },
      good: { light: '#1f7a4d', dark: '#6fcf97' },
      warn: { light: '#9a5b00', dark: '#e9b44c' },
      bad: { light: '#b3302a', dark: '#ff8f85' },
      blue: { light: '#1f63b5', dark: '#7db4f5' },
      green: { light: '#3d7a1f', dark: '#9ccf6a' },
      orange: { light: '#b04a0c', dark: '#f29a5c' },
      purple: { light: '#8a3aa8', dark: '#d39bf0' },
      pink: { light: '#b02d73', dark: '#f58cbd' },
      teal: { light: '#0f7275', dark: '#5fcfd0' },
    },
  },
  effects: { enabled: true, gradientTo: 'pink' },
  terminal: { fontSize: 13 },
  panels: [],
};

export const MIN_CONTRAST = 4.5;
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function luminance(hex: string): number {
  const h = hex.length === 4 ? hex.replace(/[0-9a-f]/gi, '$&$&') : hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio of two hex colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function hex(v: unknown, where: string): string {
  if (typeof v !== 'string' || !HEX.test(v)) throw new Error(`${where} must be a hex color like "#1f63b5"`);
  return v;
}
export function font(v: unknown, where: string): string {
  if (typeof v !== 'string' || !FONT.test(v)) throw new Error(`${where} must be font names like "Georgia, serif"`);
  return v;
}
export function bool(v: unknown, where: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`${where} must be true or false`);
  return v;
}
export function readable(fg: string, bg: string, fgWhere: string, bgWhere: string): void {
  const c = contrastRatio(fg, bg);
  if (c < MIN_CONTRAST) throw new Error(`${fgWhere} has contrast ${c.toFixed(1)} on ${bgWhere} (needs ${MIN_CONTRAST})`);
}
export function headingType(v: unknown, where: string): HeadingType {
  const o = obj(v, ['size', 'weight'], where);
  return { size: num(o.size, 6, 72, `${where}.size`), weight: num(o.weight, 100, 900, `${where}.weight`) };
}
export function roles(v: unknown, where: string): Roles {
  const o = obj(v, [...ROLES], where);
  const out = {} as Roles;
  for (const k of ROLES) out[k] = hex(o[k], `${where}.${k}`);
  return out;
}

export function parseV2(raw: unknown): DesignV2 {
  const d = obj(raw, ['version', 'theme', 'fonts', 'type', 'layout', 'colors', 'effects', 'terminal', 'panels'], 'design');
  if (d.version !== 2) throw new Error('version must be 2');
  if (d.theme !== 'system' && d.theme !== 'light' && d.theme !== 'dark') throw new Error('theme must be "system", "light" or "dark"');
  const f = obj(d.fonts, ['reply', 'ui', 'code'], 'fonts');
  const t = obj(d.type, ['body', 'ui', 'code', 'h1', 'h2', 'h3'], 'type');
  const l = obj(d.layout, ['chatWidth', 'sidebarWidth', 'sidebar'], 'layout');
  const c = obj(d.colors, ['light', 'dark', 'tones'], 'colors');
  const light = roles(c.light, 'colors.light');
  const dark = roles(c.dark, 'colors.dark');
  const tn = obj(c.tones, [...TONES], 'colors.tones');
  const tones = {} as DesignV2['colors']['tones'];
  for (const k of TONES) {
    const o = obj(tn[k], ['light', 'dark'], `colors.tones.${k}`);
    tones[k] = { light: hex(o.light, `colors.tones.${k}.light`), dark: hex(o.dark, `colors.tones.${k}.dark`) };
  }
  for (const [name, r] of [['light', light], ['dark', dark]] as const) {
    readable(r.text, r.background, `colors.${name}.text`, `colors.${name}.background`);
    readable(r.mutedText, r.background, `colors.${name}.mutedText`, `colors.${name}.background`);
    readable(r.userText, r.userBubble, `colors.${name}.userText`, `colors.${name}.userBubble`);
    for (const k of TONES) readable(tones[k][name], r.background, `colors.tones.${k}.${name}`, `colors.${name}.background`);
  }
  const e = obj(d.effects, ['enabled', 'gradientTo'], 'effects');
  if (!TONES.includes(e.gradientTo as Tone)) throw new Error(`effects.gradientTo must be one of: ${TONES.join(', ')}`);
  const term = obj(d.terminal, ['fontSize'], 'terminal');
  return {
    version: 2,
    theme: d.theme,
    fonts: { reply: font(f.reply, 'fonts.reply'), ui: font(f.ui, 'fonts.ui'), code: font(f.code, 'fonts.code') },
    type: {
      body: num(t.body, 6, 40, 'type.body'),
      ui: num(t.ui, 6, 40, 'type.ui'),
      code: num(t.code, 6, 40, 'type.code'),
      h1: headingType(t.h1, 'type.h1'),
      h2: headingType(t.h2, 'type.h2'),
      h3: headingType(t.h3, 'type.h3'),
    },
    layout: {
      chatWidth: num(l.chatWidth, 300, 3000, 'layout.chatWidth'),
      sidebarWidth: num(l.sidebarWidth, 160, 480, 'layout.sidebarWidth'),
      sidebar: bool(l.sidebar, 'layout.sidebar'),
    },
    colors: { light, dark, tones },
    effects: { enabled: bool(e.enabled, 'effects.enabled'), gradientTo: e.gradientTo as Tone },
    terminal: { fontSize: num(term.fontSize, 6, 40, 'terminal.fontSize') },
    panels: arr(d.panels, 'panels').map((p, i) => panel(p, `panels[${i}]`)),
  };
}

export const OLD_FORMAT_NOTE =
  'design.json is in the old format; colors now come from the theme. Design > Reset Design writes the new format.';

/** The first format, converted: sizes, width, a changed font and panels are kept; its colors are not. */
export function fromV1(text: string): DesignV2 {
  const o = parseDesignV1(text);
  const d = structuredClone(DEFAULT_DESIGN_V2);
  const was = DEFAULT_DESIGN_V1;
  if (o.body.size !== was.body.size) d.type.body = o.body.size;
  if (o.chat.fontSize !== was.chat.fontSize) d.type.ui = o.chat.fontSize;
  for (const h of ['h1', 'h2', 'h3'] as const) {
    if (o.headings[h].size !== was.headings[h].size) d.type[h].size = o.headings[h].size;
    if (o.headings[h].weight !== was.headings[h].weight) d.type[h].weight = o.headings[h].weight;
  }
  if (o.chat.width !== was.chat.width) d.layout.chatWidth = o.chat.width;
  if (o.chat.font !== was.chat.font) d.fonts.reply = d.fonts.ui = o.chat.font;
  if (o.terminal.fontSize !== was.terminal.fontSize) d.terminal.fontSize = o.terminal.fontSize;
  d.panels = o.panels;
  return d;
}

/** Parse and validate design.json text. Throws an Error with a one-line message. */
export function readDesignV2(text: string): { design: DesignV2; note: string | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`bad JSON: ${(e as Error).message}`);
  }
  const old = typeof raw === 'object' && raw !== null && !Array.isArray(raw) && !('version' in raw);
  return old ? { design: fromV1(text), note: OLD_FORMAT_NOTE } : { design: parseV2(raw), note: null };
}

export const parseDesignV2 = (text: string): DesignV2 => readDesignV2(text).design;

/** What the page needs: the design plus which theme is on. */
export function resolveTheme(theme: Theme, systemDark: boolean): 'light' | 'dark' {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}
