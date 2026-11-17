// Turns the text of a Claude Code session file (.jsonl) into chat items, and cuts a session file
// at an earlier point to make a branch. Pure functions: no file access here.

export interface ChatItem {
  role: 'user' | 'claude' | 'tool' | 'notice' | 'artifact';
  text: string;
  uuid?: string; // uuid of the session line this message came from
  reply?: number; // index into Chat.replies for Claude's side of an exchange
  paths?: string[]; // tool lines: the files that Write/Edit calls named (the app shows artifact cards for some)
}

/** Everything between one real user message and the next. */
export interface Reply {
  id: string; // uuid of the user message that started it
  userText: string; // that message, to send again on Retry
  first: boolean; // first exchange of the file: Retry starts a fresh session
  retryCut: string | null; // where Retry cuts: the end of the previous reply (the user message's parent)
  forkUuid: string | null; // where Branch cuts: the last chained entry of this reply (null while working)
  text: string; // Claude's real text in this reply (notices left out)
  copy: string; // text with {c= s=} tags removed, for Copy
  label: string; // from Claude's {label=...} tag, else the reply's first three words
  created: string; // timestamp of the user message
}

export interface Chat {
  items: ChatItem[];
  replies: Reply[];
  working: boolean; // true while the turn is not finished
  lastUuid: string | null; // uuid of the last user/assistant line
  lastAny: string | null; // uuid of the last chained entry of any kind (user, assistant, system, attachment)
  first: string; // the first message the user typed
  model: string; // the model that wrote the newest reply ('' if none yet)
  created: string | null; // timestamp of the first message
}

const CHAINED = ['user', 'assistant', 'system', 'attachment'];
const WRITERS = ['Write', 'Edit', 'MultiEdit'];

const LABEL = /\{label=([^{}\n]*)\}/g;

/** Remove {label=...} tags. Returns the text without them and the last label found ('' if none). */
export function takeLabel(s: string): { text: string; label: string } {
  let label = '';
  const text = s
    .replace(LABEL, (_m, l: string) => {
      label = l.trim() || label;
      return '';
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, label };
}

export function firstWordsOf(s: string, n: number): string {
  return s.replace(/[#*`>$_{}\[\]()|~-]/g, ' ').split(/\s+/).filter(Boolean).slice(0, n).join(' ');
}

/** Tags removed, inner text kept: {accent}text{/}, {warn big}text{/}, {fx=dither}text{/} and the old
 *  {c=#fff s=1.4}text{/}. LaTeX and everything else stay as written. (Same rule as stripTags in markup.ts.) */
export function stripStyleTags(s: string): string {
  return s.replace(/\{(?:(?:c|s)=[^\s{}]+(?: (?:c|s)=[^\s{}]+)?|fx=[a-z]+|[a-z]+(?: [a-z]+)?)\}([^]*?)\{\/\}/g, '$1');
}

/** A message Claude Code wrote itself (usage limit, API error, "No response requested."), not Claude's own reply. */
function isNotice(d: any, said: string): boolean {
  return d.message?.model === '<synthetic>' || d.isApiErrorMessage === true || /^You've hit your .*limit/.test(said);
}

/** Parse a session file. With stopUuid, stop after that line (used to show a parent up to a fork point). */
export function parseSession(text: string, stopUuid?: string): Chat {
  const chat: Chat = { items: [], replies: [], working: false, lastUuid: null, lastAny: null, first: '', model: '', created: null };
  const { items, replies } = chat;
  for (const line of text.split('\n')) {
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue; // empty or half-written line
    }
    if (!d || d.isSidechain) continue;
    const uuid = typeof d.uuid === 'string' ? d.uuid : undefined;
    if (uuid && CHAINED.includes(d.type)) chat.lastAny = uuid;
    if (!d.isMeta && (d.type === 'user' || d.type === 'assistant')) {
      if (uuid) chat.lastUuid = uuid;
      if (!chat.created && typeof d.timestamp === 'string') chat.created = d.timestamp;
      const content = d.message?.content;
      const blocks: any[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
      const raw = blocks.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim();
      const { text: said, label } = d.type === 'assistant' ? takeLabel(raw) : { text: raw, label: '' };
      const reply = replies.length ? replies.length - 1 : undefined;

      if (d.type === 'user') {
        if (blocks.some((b) => b?.type === 'tool_result')) chat.working = true;
        if (said && !said.startsWith('<')) {
          // (lines starting with "<" are slash commands and injected notes)
          if (said.startsWith('[Request interrupted')) {
            items.push({ role: 'tool', text: 'Interrupted', reply });
            chat.working = false;
          } else {
            const parent = typeof d.parentUuid === 'string' ? d.parentUuid : null;
            if (replies.length) replies[replies.length - 1].forkUuid = parent;
            const created = typeof d.timestamp === 'string' ? d.timestamp : '';
            replies.push({ id: uuid ?? '', userText: said, first: !replies.length, retryCut: replies.length ? parent : null, forkUuid: null, text: '', copy: '', label: '', created });
            items.push({ role: 'user', text: said, uuid });
            if (!chat.first) chat.first = said;
            chat.working = true;
          }
        }
      } else {
        if (typeof d.message?.model === 'string' && d.message.model !== '<synthetic>') chat.model = d.message.model;
        if (said && isNotice(d, said)) items.push({ role: 'notice', text: said, uuid, reply });
        else if (said) {
          items.push({ role: 'claude', text: said, uuid, reply });
          if (reply !== undefined) replies[reply].text += (replies[reply].text ? '\n\n' : '') + said;
        }
        if (label && reply !== undefined) replies[reply].label = label;
        const uses = blocks.filter((b) => b?.type === 'tool_use');
        const tools = uses.map((b) => String(b.name));
        if (tools.length) {
          const paths = uses.filter((b) => WRITERS.includes(b.name) && typeof b.input?.file_path === 'string').map((b) => b.input.file_path as string);
          let last = items[items.length - 1];
          if (last?.role === 'tool' && last.text.startsWith('Tools: ')) last.text += ', ' + tools.join(', ');
          else items.push((last = { role: 'tool', text: 'Tools: ' + tools.join(', '), reply }));
          if (paths.length) last.paths = [...(last.paths ?? []), ...paths];
        }
        const stop = d.message?.stop_reason;
        chat.working = stop ? stop === 'tool_use' : tools.length > 0 || !raw;
      }
    }
    if (stopUuid && uuid === stopUuid) break;
  }
  const last = replies[replies.length - 1];
  if (last && !chat.working) last.forkUuid = chat.lastAny;
  for (const r of replies) {
    r.copy = stripStyleTags(r.text);
    if (!r.label) r.label = firstWordsOf(r.copy, 3);
  }
  return chat;
}

/**
 * Make a branch file: keep only the entries on the parentUuid chain from cutUuid back to the root,
 * in order, with sessionId set to newId. Throws if the cut would split a tool call from its result.
 */
export function cutSession(text: string, cutUuid: string, newId: string): string {
  const byUuid = new Map<string, any>();
  for (const line of text.split('\n')) {
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d && typeof d.uuid === 'string' && !d.isSidechain) byUuid.set(d.uuid, d);
  }
  const chain: any[] = [];
  const seen = new Set<string>();
  for (let u: unknown = cutUuid; typeof u === 'string'; u = byUuid.get(u)?.parentUuid) {
    const d = byUuid.get(u);
    if (!d) throw new Error(chain.length ? 'the session file is missing an earlier message' : 'fork point not found in the session file');
    if (seen.has(u)) throw new Error('the session file has a loop');
    seen.add(u);
    chain.push(d);
  }
  chain.reverse();
  const used = new Set<string>();
  const answered = new Set<string>();
  for (const d of chain) {
    const c = d.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (d.type === 'assistant' && b?.type === 'tool_use') used.add(b.id);
      if (d.type === 'user' && b?.type === 'tool_result') answered.add(b.tool_use_id);
    }
  }
  for (const id of used) if (!answered.has(id)) throw new Error('that point is between a tool call and its result');
  return chain.map((d) => JSON.stringify('sessionId' in d ? { ...d, sessionId: newId } : d)).join('\n') + '\n';
}
