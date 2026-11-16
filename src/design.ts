// design.json schema, built-in default, and strict validation. Data only.

export type Block =
  | { type: 'heading' | 'text'; text: string }
  | { type: 'list'; items: string[] };

export interface Panel {
  id: string;
  side: 'left' | 'right' | 'bottom';
  size: number;
  visible: boolean;
  blocks: Block[];
}

export interface Design {
  terminal: { background: string; textColor: string; fontSize: number };
  window: { background: string };
  panels: Panel[];
  chat: { font: string; fontSize: number; width: number };
  userBox: Box;
  claudeBox: Box;
  headings: { h1: Heading; h2: Heading; h3: Heading };
  body: { size: number };
  bold: { color: string };
  code: { background: string };
}

export interface Heading {
  size: number;
  weight: number;
  color: string;
}

export interface Box {
  background: string;
  textColor: string;
}

export const DEFAULT_DESIGN: Design = {
  terminal: { background: '#1e1e1e', textColor: '#e0e0e0', fontSize: 14 },
  window: { background: '#2b2b2b' },
  panels: [],
  chat: { font: '-apple-system, Helvetica, Arial, sans-serif', fontSize: 14, width: 760 },
  userBox: { background: '#2f5d8a', textColor: '#ffffff' },
  claudeBox: { background: '#3a3a3a', textColor: '#e8e8e8' },
  headings: {
    h1: { size: 22, weight: 700, color: 'inherit' },
    h2: { size: 19, weight: 700, color: 'inherit' },
    h3: { size: 16, weight: 600, color: 'inherit' },
  },
  body: { size: 14 },
  bold: { color: 'inherit' },
  code: { background: 'rgba(0,0,0,0.3)' },
};

// Only plain colors: hex, a color name, or rgb()/rgba(). No url(), no other CSS.
const COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([\d\s.,%]+\))$/;
// Font family names only: letters, digits, spaces, commas, hyphens.
const FONT = /^[a-zA-Z0-9 ,-]{1,200}$/;

function obj(v: unknown, allowed: string[], where: string, optional: string[] = []): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${where} must be an object`);
  for (const k of Object.keys(v)) if (!allowed.includes(k)) throw new Error(`unknown key "${k}" in ${where}`);
  for (const k of allowed) if (!(k in v) && !optional.includes(k)) throw new Error(`missing key "${k}" in ${where}`);
  return v as Record<string, unknown>;
}

function str(v: unknown, where: string): string {
  if (typeof v !== 'string') throw new Error(`${where} must be a string`);
  return v;
}

function color(v: unknown, where: string): string {
  if (typeof v !== 'string' || !COLOR.test(v)) throw new Error(`${where} must be a color like "#103010", "green" or "rgb(0,80,0)"`);
  return v;
}

function num(v: unknown, min: number, max: number, where: string): number {
  if (typeof v !== 'number' || !(v >= min && v <= max)) throw new Error(`${where} must be a number from ${min} to ${max}`);
  return v;
}

function box(v: unknown, where: string): Box {
  const o = obj(v, ['background', 'textColor'], where);
  return { background: color(o.background, `${where}.background`), textColor: color(o.textColor, `${where}.textColor`) };
}

function chat(v: unknown): Design['chat'] {
  const o = obj(v, ['font', 'fontSize', 'width'], 'chat');
  if (typeof o.font !== 'string' || !FONT.test(o.font)) throw new Error('chat.font must be font names like "Georgia, serif"');
  return { font: o.font, fontSize: num(o.fontSize, 6, 40, 'chat.fontSize'), width: num(o.width, 300, 3000, 'chat.width') };
}

function heading(v: unknown, where: string): Heading {
  const o = obj(v, ['size', 'weight', 'color'], where);
  return { size: num(o.size, 6, 72, `${where}.size`), weight: num(o.weight, 100, 900, `${where}.weight`), color: color(o.color, `${where}.color`) };
}

function headings(v: unknown): Design['headings'] {
  const o = obj(v, ['h1', 'h2', 'h3'], 'headings');
  return { h1: heading(o.h1, 'headings.h1'), h2: heading(o.h2, 'headings.h2'), h3: heading(o.h3, 'headings.h3') };
}

function arr(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`${where} must be a list`);
  return v;
}

function block(v: unknown, where: string): Block {
  const type = (v as { type?: unknown } | null)?.type;
  if (type === 'heading' || type === 'text') {
    const o = obj(v, ['type', 'text'], where);
    return { type, text: str(o.text, `${where}.text`) };
  }
  if (type === 'list') {
    const o = obj(v, ['type', 'items'], where);
    return { type, items: arr(o.items, `${where}.items`).map((s, i) => str(s, `${where}.items[${i}]`)) };
  }
  throw new Error(`${where}.type must be "heading", "text" or "list"`);
}

function panel(v: unknown, where: string): Panel {
  const o = obj(v, ['id', 'side', 'size', 'visible', 'blocks'], where);
  if (o.side !== 'left' && o.side !== 'right' && o.side !== 'bottom') throw new Error(`${where}.side must be "left", "right" or "bottom"`);
  if (typeof o.visible !== 'boolean') throw new Error(`${where}.visible must be true or false`);
  return {
    id: str(o.id, `${where}.id`),
    side: o.side,
    size: num(o.size, 50, 800, `${where}.size`),
    visible: o.visible,
    blocks: arr(o.blocks, `${where}.blocks`).map((b, i) => block(b, `${where}.blocks[${i}]`)),
  };
}

/** Parse and validate design.json text. Throws an Error with a one-line message. */
export function parseDesign(text: string): Design {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`bad JSON: ${(e as Error).message}`);
  }
  // The chat sections may be left out (older files); then defaults apply.
  const optional = ['chat', 'userBox', 'claudeBox', 'headings', 'body', 'bold', 'code'];
  const d = obj(raw, ['terminal', 'window', 'panels', ...optional], 'design', optional);
  const t = obj(d.terminal, ['background', 'textColor', 'fontSize'], 'terminal');
  const w = obj(d.window, ['background'], 'window');
  return {
    terminal: {
      background: color(t.background, 'terminal.background'),
      textColor: color(t.textColor, 'terminal.textColor'),
      fontSize: num(t.fontSize, 6, 40, 'terminal.fontSize'),
    },
    window: { background: color(w.background, 'window.background') },
    panels: arr(d.panels, 'panels').map((p, i) => panel(p, `panels[${i}]`)),
    chat: d.chat === undefined ? DEFAULT_DESIGN.chat : chat(d.chat),
    userBox: d.userBox === undefined ? DEFAULT_DESIGN.userBox : box(d.userBox, 'userBox'),
    claudeBox: d.claudeBox === undefined ? DEFAULT_DESIGN.claudeBox : box(d.claudeBox, 'claudeBox'),
    headings: d.headings === undefined ? DEFAULT_DESIGN.headings : headings(d.headings),
    body: d.body === undefined ? DEFAULT_DESIGN.body : { size: num(obj(d.body, ['size'], 'body').size, 6, 40, 'body.size') },
    bold: d.bold === undefined ? DEFAULT_DESIGN.bold : { color: color(obj(d.bold, ['color'], 'bold').color, 'bold.color') },
    code: d.code === undefined ? DEFAULT_DESIGN.code : { background: color(obj(d.code, ['background'], 'code').background, 'code.background') },
  };
}
