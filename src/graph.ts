// The reply graph: one node per Claude reply across all sessions of the folder. Pure functions.
//
// A branch file is a cut copy of its parent, so it starts with the parent's replies (same message
// uuids). Those are the parent's nodes; the branch's own replies hang under the last one. So a
// Branch forks at the reply it started from, and a Retry (cut before the replaced reply) puts its
// new reply beside the replaced one, as a sibling.

import { Branch } from './branches';
import { Chat } from './session';

export interface GraphNode {
  id: string; // "<session>:<reply id>"
  session: string; // the session that owns the reply
  reply: string; // uuid of the user message that started the reply
  parent: string | null; // node id of the previous reply
  beside: string | null; // for a root that is a Retry of a first reply: the root it replaces
  label: string;
  first: string; // first line of the reply, for the hover
  created: string;
  canBranch: boolean; // the reply has a fork point (false while it is still being written)
}

export interface Graph {
  nodes: GraphNode[];
  current: string | null; // the shown session's newest reply
}

const firstLine = (s: string) => (s.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 300);

export function buildGraph(sessions: { id: string; chat: Chat | null }[], branches: Branch[], currentSession: string): Graph {
  const chats = new Map(sessions.map((s) => [s.id, s.chat]));
  const branchOf = new Map(branches.filter((b) => chats.has(b.id)).map((b) => [b.id, b]));
  const created = (id: string) => chats.get(id)?.created ?? branchOf.get(id)?.created ?? '';
  const byTime = (a: string, b: string) => created(a).localeCompare(created(b));

  // Parents before their branches.
  const order: string[] = [];
  const done = new Set<string>();
  const kids = new Map<string, string[]>();
  for (const b of branchOf.values()) if (chats.has(b.parent) && b.parent !== b.id) kids.set(b.parent, [...(kids.get(b.parent) ?? []), b.id]);
  const visit = (id: string) => {
    if (done.has(id)) return;
    done.add(id);
    order.push(id);
    for (const k of (kids.get(id) ?? []).sort(byTime)) visit(k);
  };
  const roots = [...chats.keys()].filter((id) => !branchOf.has(id) || !chats.has(branchOf.get(id)!.parent));
  for (const id of roots.sort(byTime)) visit(id);
  for (const id of [...chats.keys()].sort(byTime)) visit(id); // a loop in branches.json

  const nodes: GraphNode[] = [];
  const nodeOfReply = new Map<string, string>();
  const nodeOfFork = new Map<string, string>(); // a reply's fork point -> its node
  let current: string | null = null;
  for (const sid of order) {
    const chat = chats.get(sid);
    let prev: string | null = null;
    let firstOwn = true;
    for (const r of chat?.replies ?? []) {
      if (!r.id) continue;
      const known = nodeOfReply.get(r.id);
      if (known) {
        prev = known; // inherited from the parent's file
        continue;
      }
      const b = branchOf.get(sid);
      const beside = firstOwn && !prev && b && !b.forkUuid ? (chats.get(b.parent)?.replies[0]?.id ?? null) : null;
      const node: GraphNode = {
        id: `${sid}:${r.id}`,
        session: sid,
        reply: r.id,
        parent: prev,
        beside: beside ? (nodeOfReply.get(beside) ?? null) : null,
        label: r.label,
        first: firstLine(r.copy),
        created: r.created,
        canBranch: !!r.forkUuid,
      };
      nodes.push(node);
      nodeOfReply.set(r.id, node.id);
      if (r.forkUuid) nodeOfFork.set(r.forkUuid, node.id);
      prev = node.id;
      firstOwn = false;
    }
    if (sid === currentSession) current = prev;
  }
  // The shown session has no replies of its own yet (a new branch): its fork point.
  const b = branchOf.get(currentSession);
  if (!current && b?.forkUuid) current = nodeOfFork.get(b.forkUuid) ?? null;
  return { nodes, current };
}

export interface Placed {
  node: GraphNode;
  x: number; // column
  y: number; // row (reply depth)
}

/** Rows by depth, columns so each chain runs straight down and branches step to the right. */
export function layoutGraph(nodes: GraphNode[]): Placed[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string | null, GraphNode[]>();
  for (const n of nodes) {
    const p = n.parent && byId.has(n.parent) ? n.parent : null;
    children.set(p, [...(children.get(p) ?? []), n]);
  }
  const byTime = (a: GraphNode, b: GraphNode) => a.created.localeCompare(b.created);
  // Roots by time, but a Retry of a first reply right after the root it replaces.
  const roots = (children.get(null) ?? []).sort(byTime);
  const ordered: GraphNode[] = [];
  const placedRoot = new Set<string>();
  const addRoot = (r: GraphNode) => {
    if (placedRoot.has(r.id)) return;
    placedRoot.add(r.id);
    ordered.push(r);
    for (const s of roots) if (s.beside === r.id) addRoot(s);
  };
  for (const r of roots) if (!r.beside || !roots.some((x) => x.id === r.beside)) addRoot(r);
  for (const r of roots) addRoot(r);

  const out: Placed[] = [];
  const seen = new Set<string>();
  let col = 0;
  // Iterative depth-first walk (long chats would overflow a recursive one).
  for (const root of ordered) {
    const stack: { n: GraphNode; depth: number; kids: GraphNode[]; i: number; placed?: Placed }[] = [];
    const push = (n: GraphNode, depth: number) => {
      if (seen.has(n.id)) return;
      seen.add(n.id);
      stack.push({ n, depth, kids: (children.get(n.id) ?? []).sort(byTime), i: 0 });
    };
    push(root, 0);
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (!top.placed) {
        top.placed = { node: top.n, x: col, y: top.depth };
        out.push(top.placed);
      }
      if (top.i < top.kids.length) {
        const k = top.kids[top.i++];
        if (top.i > 1) col++; // every child after the first starts a new column
        push(k, top.depth + 1);
      } else stack.pop();
    }
    col++;
  }
  return out;
}
