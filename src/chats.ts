// The chat list: one line per chat. A chat is a root session plus every branch that descends from
// it (through branches.json), so a Branch or a Retry never adds a line. Pure functions.
import { Branch } from './branches';
import { Chat, firstWordsOf } from './session';

export interface SessionInfo {
  id: string;
  chat: Chat | null; // null: no file yet
  mtime: number; // last change of the session file (epoch ms), 0 if none
}

export interface ChatRow {
  id: string; // the chat's root session (also when that file is gone)
  title: string;
  full: string; // the first message, for the tooltip
  updated: number; // newest change in any of its sessions
  group: string; // Today, Yesterday, Previous 7 days, Earlier
  branches: number; // sessions in the chat besides the first
  open: string; // the session a click opens: the one changed last
  current: boolean;
  sessions: string[];
}

const TITLE_MAX = 40;

export function chatTitle(first: string): string {
  const t = first.replace(/\s+/g, ' ').trim();
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX - 1).trimEnd() + '…' : t;
}

/** Which date group a time falls in, by calendar days before `now` (local time). */
export function dateGroup(time: number, now: number): string {
  const day = (t: number) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((day(now) - day(time)) / 86_400_000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days <= 7 ? 'Previous 7 days' : 'Earlier';
}

/** The root of a session: follow branches.json upward as far as it goes (also past deleted files). */
export function rootOf(id: string, branches: Branch[]): string {
  const parent = new Map(branches.map((b) => [b.id, b.parent]));
  const seen = new Set<string>();
  let at = id;
  while (parent.has(at) && !seen.has(at)) {
    seen.add(at);
    at = parent.get(at)!;
  }
  return at;
}

export function buildChats(sessions: SessionInfo[], branches: Branch[], current: string, now: number): ChatRow[] {
  const families = new Map<string, SessionInfo[]>();
  for (const s of sessions) {
    const root = rootOf(s.id, branches);
    families.set(root, [...(families.get(root) ?? []), s]);
  }
  const rows: ChatRow[] = [];
  for (const [root, members] of families) {
    const isCurrent = members.some((s) => s.id === current);
    // The first message: the root's, or (root file gone or empty) the oldest member's that has one.
    const byAge = [...members].sort((a, b) => (a.chat?.created ?? '~').localeCompare(b.chat?.created ?? '~'));
    const first = (members.find((s) => s.id === root)?.chat?.first || byAge.find((s) => s.chat?.first)?.chat?.first) ?? '';
    if (!first && !isCurrent) continue; // nothing was ever said in it
    const newest = members.reduce((a, b) => (b.mtime > a.mtime ? b : a));
    const updated = newest.mtime || now;
    rows.push({
      id: root,
      title: first ? chatTitle(firstWordsOf(first, 12) || first) : 'New chat',
      full: first || 'New chat, no messages yet',
      updated,
      group: dateGroup(updated, now),
      branches: members.length - 1,
      open: newest.id,
      current: isCurrent,
      sessions: members.map((s) => s.id),
    });
  }
  return rows.sort((a, b) => b.updated - a.updated);
}
