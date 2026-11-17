// The message box's attachments: what a chip says, and the text that is typed into Claude Code.
// Only file PATHS are ever sent; Claude Code reads the files itself. Pure functions. Plain script:
// loaded by index.html (global functions) and by the tests through require().

interface Chip {
  path: string; // absolute
  name: string;
  size: number; // bytes (0 for a folder)
  dir: boolean;
}

const BIG_FILE = 20_000_000;
const MAX_CHIPS = 20;
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
// Kinds Claude Code cannot read as files (archives, media, binaries, office files).
const UNREADABLE_EXT = ('zip tar gz tgz bz2 xz 7z rar dmg iso pkg exe bin dll so dylib o a class jar wasm mp3 wav flac aac ogg m4a mp4 mov avi mkv webm ' +
  'doc docx xls xlsx ppt pptx key pages numbers sqlite db psd ai sketch fig heic tiff bmp ico ttf otf woff woff2').split(' ');

const extOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

function fileKind(c: Pick<Chip, 'name' | 'dir'>): 'folder' | 'image' | 'pdf' | 'unreadable' | 'text' {
  if (c.dir) return 'folder';
  const ext = extOf(c.name);
  return IMAGE_EXT.includes(ext) ? 'image' : ext === 'pdf' ? 'pdf' : UNREADABLE_EXT.includes(ext) ? 'unreadable' : 'text';
}

/** '' or a short warning for the chip's tooltip. Nothing is ever blocked: only the path is sent. */
function chipWarning(c: Chip): string {
  const kind = fileKind(c);
  if (kind === 'unreadable') return 'Claude probably cannot read this type of file.';
  if (c.size > BIG_FILE) return 'Large file. Claude Code may refuse it or read only part of it.';
  return '';
}

function sizeText(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
}

/** Claude Code's file mention: @/path, or @"/path with spaces". null: the path cannot be written that way. */
function mention(path: string): string | null {
  if (!path.startsWith('/') || /["\n\r\t\x00-\x1f]/.test(path)) return null;
  return /\s/.test(path) ? `@"${path}"` : `@${path}`;
}

/** The text typed into Claude Code: the mentions first, then the message. Paths that cannot be a mention go on their own lines. */
function buildMessage(text: string, chips: Chip[]): string {
  const mentions: string[] = [];
  const plain: string[] = [];
  for (const c of chips.slice(0, MAX_CHIPS)) {
    const m = mention(c.path);
    if (m) mentions.push(m);
    else plain.push(`Attached file: ${c.path.replace(/[\x00-\x1f]/g, ' ')}`);
  }
  return [[...mentions, text.trim()].filter(Boolean).join(' '), ...plain].filter(Boolean).join('\n');
}

/** Add files to the chips: no doubles, at most MAX_CHIPS. */
function addChips(have: Chip[], more: Chip[]): Chip[] {
  const out = [...have];
  for (const c of more) if (out.length < MAX_CHIPS && !out.some((x) => x.path === c.path)) out.push(c);
  return out;
}

const PASTE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
/** File name for a pasted image, e.g. pasted-20261116-231502-1.png. null: not an image kind the app saves. */
function pastedName(mime: string, when: Date, n: number): string | null {
  const ext = PASTE_TYPES[mime];
  if (!ext) return null;
  const p = (v: number) => String(v).padStart(2, '0');
  return `pasted-${when.getFullYear()}${p(when.getMonth() + 1)}${p(when.getDate())}-${p(when.getHours())}${p(when.getMinutes())}${p(when.getSeconds())}-${n}.${ext}`;
}

if (typeof module !== 'undefined') module.exports = { fileKind, chipWarning, sizeText, mention, buildMessage, addChips, pastedName, BIG_FILE, MAX_CHIPS, PASTE_TYPES };
