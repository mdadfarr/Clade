// Counting for the color-rule report (plan 3, section 6): what a reply does with headings, color tags,
// the label, maps and other blocks. Pure functions; used by the test runs, not by the app.

export const COLOR_TAGS = ['accent', 'muted', 'good', 'warn', 'bad', 'blue', 'green', 'orange', 'purple', 'pink', 'teal'] as const;
const BLOCKS = ['map', 'mem', 'timeline', 'compare', 'flow'] as const;

export interface Section {
  heading: string; // '' for the text before the first heading
  colors: number; // colored phrases in it
}

export interface ReplyCount {
  sections: Section[]; // the heading sections (the text before the first heading only when there is no heading)
  headings: number;
  colors: number; // colored phrases in the whole reply (outside code and blocks)
  uncolored: number; // heading sections with no color
  long: string[]; // colored phrases longer than 4 words
  label: boolean;
  map: boolean;
  mapDepth: number; // levels below the root (0: no map or a flat root)
  blocks: string[]; // other block kinds used: mem, timeline, compare, flow, table, callout
  pass: boolean; // every section has 1 to 3 colored phrases and none is longer than 4 words
}

const TAG = new RegExp(`\\{((?:${COLOR_TAGS.join('|')})(?: (?:big|small))?|(?:big|small) (?:${COLOR_TAGS.join('|')}))\\}([\\s\\S]*?)\\{\\/\\}`, 'g');
const words = (s: string) => s.replace(/[`*_]/g, ' ').trim().split(/\s+/).filter(Boolean).length;

/** Map block lines to its depth below the root: the indent step is the smallest indent used. */
function mapDepth(lines: string[]): number {
  const ind = lines.filter((l) => l.trim()).map((l) => (l.match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '  ').length);
  if (!ind.length) return 0;
  const base = Math.min(...ind);
  const steps = ind.map((i) => i - base).filter((i) => i > 0);
  if (!steps.length) return 0;
  const step = Math.min(...steps);
  return Math.max(...steps.map((i) => Math.round(i / step)));
}

export function countReply(text: string): ReplyCount {
  const lines = text.split('\n');
  const prose: string[] = []; // lines outside fences, with fences replaced by blanks
  const blocks = new Set<string>();
  let map = false;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^\s*(```+|~~~+)\s*([\w-]*)/);
    if (!open) {
      prose.push(lines[i]);
      continue;
    }
    const lang = open[2].toLowerCase();
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !lines[j].trim().startsWith(open[1])) body.push(lines[j++]);
    if (lang === 'map') {
      map = true;
      depth = Math.max(depth, mapDepth(body));
    } else if ((BLOCKS as readonly string[]).includes(lang)) blocks.add(lang);
    prose.push('');
    i = j;
  }
  const sections: Section[] = [{ heading: '', colors: 0 }];
  const long: string[] = [];
  let total = 0;
  for (const l of prose) {
    const h = l.match(/^#{1,6}\s+(.*)$/);
    if (h) sections.push({ heading: h[1].replace(/\{[^}]*\}/g, '').trim(), colors: 0 });
    if (/^\s*\|.*\|\s*$/.test(l)) blocks.add('table');
    if (/^\s*>\s*\[!\w+\]/.test(l)) blocks.add('callout');
    for (const m of l.matchAll(TAG)) {
      total++;
      sections[sections.length - 1].colors++;
      if (words(m[2]) > 4) long.push(m[2].trim());
    }
  }
  const headed = sections.slice(1);
  const counted = headed.length ? headed : sections;
  const pass = !long.length && counted.every((s) => s.colors >= 1 && s.colors <= 3) && (headed.length > 0 || total >= 1);
  return {
    sections: counted,
    headings: headed.length,
    colors: total,
    uncolored: headed.filter((s) => !s.colors).length,
    long,
    label: /\{label=[^{}\n]*\}/.test(text),
    map,
    mapDepth: depth,
    blocks: [...blocks].sort(),
    pass,
  };
}
