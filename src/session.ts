// Turns the text of a Claude Code session file (.jsonl) into chat items. Read only.

export interface ChatItem {
  role: 'user' | 'claude' | 'tool';
  text: string;
  uuid?: string; // uuid of the session line this message came from
}

export interface Chat {
  items: ChatItem[];
  working: boolean; // true while the turn is not finished
  lastUuid: string | null; // uuid of the last user/assistant line: the fork point for a new branch
  first: string; // the first message the user typed
  created: string | null; // timestamp of the first message
}

/** Parse a session file. With stopUuid, stop after that line (used to show a parent up to a fork point). */
export function parseSession(text: string, stopUuid?: string): Chat {
  const chat: Chat = { items: [], working: false, lastUuid: null, first: '', created: null };
  const items = chat.items;
  for (const line of text.split('\n')) {
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue; // empty or half-written line
    }
    if (!d || d.isMeta || d.isSidechain || (d.type !== 'user' && d.type !== 'assistant')) continue;
    const uuid = typeof d.uuid === 'string' ? d.uuid : undefined;
    if (uuid) chat.lastUuid = uuid;
    if (!chat.created && typeof d.timestamp === 'string') chat.created = d.timestamp;
    const content = d.message?.content;
    const blocks: any[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    const said = blocks.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim();

    if (d.type === 'user') {
      if (blocks.some((b) => b?.type === 'tool_result')) chat.working = true;
      if (said && !said.startsWith('<')) {
        // (lines starting with "<" are slash commands and injected notes)
        if (said.startsWith('[Request interrupted')) {
          items.push({ role: 'tool', text: 'Interrupted' });
          chat.working = false;
        } else {
          items.push({ role: 'user', text: said, uuid });
          if (!chat.first) chat.first = said;
          chat.working = true;
        }
      }
    } else {
      if (said) items.push({ role: 'claude', text: said, uuid });
      const tools = blocks.filter((b) => b?.type === 'tool_use').map((b) => String(b.name));
      if (tools.length) {
        const last = items[items.length - 1];
        if (last?.role === 'tool' && last.text.startsWith('Tools: ')) last.text += ', ' + tools.join(', ');
        else items.push({ role: 'tool', text: 'Tools: ' + tools.join(', ') });
      }
      const stop = d.message?.stop_reason;
      chat.working = stop ? stop === 'tool_use' : tools.length > 0 || !said;
    }
    if (stopUuid && uuid === stopUuid) break;
  }
  return chat;
}
