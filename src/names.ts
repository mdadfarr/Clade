// chat-names.json: names the user gave chats in the app, by the chat's root session id. Data only.
// The app never writes Claude Code's session files, so a rename lives here. Pure functions.
import { UUID } from './branches';

export const NAME_MAX = 60;

/** A name as it is stored: one line, control characters dropped, at most NAME_MAX characters. '' = no name. */
export function cleanName(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

/** Read the file. Anything broken or unknown is left out; never throws. */
export function parseNames(text: string | null): Record<string, string> {
  let raw: any;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  const names = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.names : null;
  if (!names || typeof names !== 'object' || Array.isArray(names)) return out;
  for (const [id, n] of Object.entries(names)) {
    const name = cleanName(n);
    if (UUID.test(id) && name) out[id] = name;
  }
  return out;
}

/** The file with one chat renamed; an empty name removes it (the chat goes back to its own title). */
export function setName(text: string | null, id: string, name: unknown): string {
  if (!UUID.test(id)) throw new Error('not a session id');
  const names = parseNames(text);
  const n = cleanName(name);
  if (n) names[id] = n;
  else delete names[id];
  return JSON.stringify({ names }, null, 2) + '\n';
}
