// Artifacts: one self-contained file per artifact in <project>/artifacts/, shown in a sandboxed
// side panel. This file holds the pure parts: name rules, the URL-to-file mapping of the
// clade-artifact: scheme, version numbering, the response policy and the permission rule merge.
import * as path from 'path';

export const SCHEME = 'clade-artifact';
export const ARTIFACT_NAME = /^[A-Za-z0-9_-]{1,60}\.(html|svg|md)$/;
export const MAX_BYTES = 5_000_000;
export const MAX_VERSIONS = 50;

export type ArtifactType = 'html' | 'svg' | 'md';
export const typeOf = (name: string) => name.slice(name.lastIndexOf('.') + 1) as ArtifactType;

/** The artifact a tool call wrote, if its path is a valid file directly inside <folder>/artifacts. */
export function artifactName(filePath: string, folder: string): string | null {
  const full = path.resolve(folder, filePath);
  const name = path.basename(full);
  return path.dirname(full) === path.join(path.resolve(folder), 'artifacts') && ARTIFACT_NAME.test(name) ? name : null;
}

// Libraries an artifact may load as lib/<name>. Paths are inside the app's own node_modules.
export const LIBS: Record<string, { file: string; type: string }> = {
  'chart.js': { file: 'chart.js/dist/chart.umd.js', type: 'text/javascript' },
  'd3.js': { file: 'd3/dist/d3.min.js', type: 'text/javascript' },
  'katex.js': { file: 'katex/dist/katex.min.js', type: 'text/javascript' },
  'katex.css': { file: 'katex/dist/katex.min.css', type: 'text/css' },
};
const KATEX_FONT = /^fonts\/(KaTeX_[A-Za-z0-9_-]{1,40}\.(woff2|woff|ttf))$/;
const FONT_TYPES: Record<string, string> = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf' };

export type Target =
  | { kind: 'file'; name: string; version: number | null } // the artifact itself (null: the current file)
  | { kind: 'view'; name: string; version: number | null } // a blank page that shows an .svg as an image
  | { kind: 'lib'; file: string; type: string }; // a bundled library file, relative to node_modules

/**
 * What a clade-artifact: URL may read. Only three shapes exist:
 *   clade-artifact://current/<name>      clade-artifact://v<n>/<name>
 *   clade-artifact://<host>/view/<name>  (svg only)
 *   clade-artifact://<host>/lib/<known library file>
 * Anything else is null (answered with 404). No part of the URL is ever used as a path.
 */
export function resolveUrl(url: string): Target | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${SCHEME}:` || u.username || u.password || u.port) return null;
  const host = /^(current|v([1-9][0-9]{0,3}))$/.exec(u.hostname);
  if (!host) return null;
  const version = host[2] ? Number(host[2]) : null;
  const p = u.pathname.slice(1); // as sent: an encoded slash or dot stays encoded and matches nothing below
  if (p.startsWith('lib/')) {
    const lib = p.slice(4);
    if (Object.hasOwn(LIBS, lib)) return { kind: 'lib', ...LIBS[lib] };
    const font = KATEX_FONT.exec(lib);
    return font ? { kind: 'lib', file: `katex/dist/fonts/${font[1]}`, type: FONT_TYPES[font[2]] } : null;
  }
  if (p.startsWith('view/')) {
    const name = p.slice(5);
    return ARTIFACT_NAME.test(name) && typeOf(name) === 'svg' ? { kind: 'view', name, version } : null;
  }
  return ARTIFACT_NAME.test(p) ? { kind: 'file', name: p, version } : null;
}

export const urlFor = (name: string, version: number | null) => `${SCHEME}://${version ? `v${version}` : 'current'}/${typeOf(name) === 'svg' ? 'view/' : ''}${name}`;

export const CONTENT_TYPES: Record<ArtifactType, string> = { html: 'text/html; charset=utf-8', svg: 'image/svg+xml', md: 'text/plain; charset=utf-8' };

/** Sent with every response. Scripts and styles may only be inline or from the scheme itself; no connections at all. */
export const CSP =
  `default-src 'none'; script-src 'unsafe-inline' ${SCHEME}:; style-src 'unsafe-inline' ${SCHEME}:; img-src data: blob: ${SCHEME}:; ` +
  `font-src data: ${SCHEME}:; media-src data: blob:; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'`;

/** The page that shows an .svg artifact as an image (scripts inside an image do not run). */
export const svgPage = (name: string) =>
  `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#fff}body{display:flex;align-items:center;justify-content:center}img{max-width:100%;max-height:100%}</style><img src="../${name}" alt="">`;

// ---- versions: artifacts/.versions/<name>/<n>.<ext>, n = 1, 2, 3... ----
export const versionPath = (name: string, n: number) => path.join('.versions', name, `${n}.${typeOf(name)}`);

/** Version numbers found in a version folder's file names (sorted). */
export function versionNumbers(files: string[], name: string): number[] {
  const ext = typeOf(name);
  return files
    .map((f) => new RegExp(`^([1-9][0-9]{0,5})\\.${ext}$`).exec(f)?.[1])
    .filter((n): n is string => !!n)
    .map(Number)
    .sort((a, b) => a - b);
}
export const nextVersion = (nums: number[]) => (nums.length ? nums[nums.length - 1] + 1 : 1);
/** The oldest versions to delete so that at most `max` remain. */
export const versionsToPrune = (nums: number[], max = MAX_VERSIONS) => nums.slice(0, Math.max(0, nums.length - max));

// ---- .claude/settings.local.json: "always allow" for file writes inside artifacts/, and nothing else ----
export const ALLOW_RULES = ['Write(/artifacts/**)', 'Edit(/artifacts/**)'] as const;

/** The settings text with the two rules added (everything else kept). null = nothing to change. Throws if the file is not a JSON object. */
export function mergeAllow(text: string | null): string | null {
  let raw: any = {};
  if (text !== null && text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new Error(`bad JSON: ${(e as Error).message}`);
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('expected a JSON object');
  const perms = raw.permissions ?? {};
  if (typeof perms !== 'object' || perms === null || Array.isArray(perms)) throw new Error('"permissions" must be an object');
  const allow = perms.allow ?? [];
  if (!Array.isArray(allow)) throw new Error('"permissions.allow" must be a list');
  const missing = ALLOW_RULES.filter((r) => !allow.includes(r));
  if (!missing.length) return null;
  return JSON.stringify({ ...raw, permissions: { ...perms, allow: [...allow, ...missing] } }, null, 2) + '\n';
}
