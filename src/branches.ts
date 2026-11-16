// branches.json: the branch tree. Data only. Every id is checked to be a UUID before it is ever
// passed to claude, so a hand-edited file cannot smuggle command-line flags in.

export interface Branch {
  id: string; // the branch's session id
  parent: string; // session id it was forked from
  forkUuid: string; // uuid of the parent's last message when Branch was pressed
  forkWords: string; // first words of that message
  created: string; // ISO time
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEYS = ['id', 'parent', 'forkUuid', 'forkWords', 'created'];

/** Throws with a one-line message if the file is not valid. */
export function parseBranches(text: string): Branch[] {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`bad JSON: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sessions) || Object.keys(raw).length !== 1) {
    throw new Error('expected { "sessions": [...] }');
  }
  return raw.sessions.map((s: any, i: number) => {
    const where = `sessions[${i}]`;
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error(`${where} must be an object`);
    for (const k of Object.keys(s)) if (!KEYS.includes(k)) throw new Error(`unknown key "${k}" in ${where}`);
    for (const k of KEYS) if (typeof s[k] !== 'string') throw new Error(`${where}.${k} must be a string`);
    for (const k of ['id', 'parent']) if (!UUID.test(s[k])) throw new Error(`${where}.${k} must be a session id`);
    return { id: s.id, parent: s.parent, forkUuid: s.forkUuid, forkWords: s.forkWords, created: s.created };
  });
}

export function firstWords(text: string, n = 6): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  return words.slice(0, n).join(' ') + (words.length > n ? ' …' : '');
}
