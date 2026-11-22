// The workspace layout: a split tree of chat panes, like VS Code's terminal panels. Pure functions; plain
// script (no imports): loaded by index.html before workspace.js and by the tests through require().
//
// A node is a pane (one chat) or a split. A split lays out 2 or more children in a row (side by side) or a
// column (one above the other); `sizes` are the children's shares of its length (fractions that sum to 1).
// Strips and grids are only what splitting gives: there are no other modes. The functions never change
// their input; they return a new tree, already normalized (no 1-child splits, no split inside a split of
// the same direction, sizes that sum to 1).

type LDir = 'row' | 'col';
type LSide = 'left' | 'right' | 'top' | 'bottom';
type LNode = { t: 'pane'; id: string } | { t: 'split'; dir: LDir; kids: LNode[]; sizes: number[] };
interface LPane {
  session: string; // the chat shown in the pane ('' only before its first start)
  branchOf?: string; // the session it was branched from in the workspace
}
interface LWorkspace {
  v: 1;
  root: LNode;
  panes: Record<string, LPane>;
  focus: string;
  max: string | null; // the maximized pane (the others keep running, out of sight)
}

const Lay = (() => {
  const PANE_ID = /^p[a-z0-9]{1,24}$/;
  const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const MAX_PANES = 32;
  const MAX_DEPTH = 16;

  const leaf = (id: string): LNode => ({ t: 'pane', id });
  const dirOf = (side: LSide): LDir => (side === 'left' || side === 'right' ? 'row' : 'col');
  const after = (side: LSide) => side === 'right' || side === 'bottom';

  /** Shares that sum to 1 (equal shares if they cannot be used). */
  function shares(sizes: number[], n: number): number[] {
    const ok = sizes.length === n && sizes.every((s) => Number.isFinite(s) && s > 0);
    const sum = ok ? sizes.reduce((a, b) => a + b, 0) : 0;
    return ok && sum > 0 ? sizes.map((s) => s / sum) : Array.from({ length: n }, () => 1 / n);
  }

  /** No empty or 1-child splits; a split inside a split of the same direction is merged into it. */
  function normalize(n: LNode): LNode | null {
    if (n.t === 'pane') return n;
    const kids: LNode[] = [];
    const sizes: number[] = [];
    const own = shares(n.sizes, n.kids.length);
    n.kids.forEach((k, i) => {
      const c = normalize(k);
      if (!c) return;
      if (c.t === 'split' && c.dir === n.dir) {
        c.kids.forEach((g, j) => {
          kids.push(g);
          sizes.push(own[i] * c.sizes[j]);
        });
      } else {
        kids.push(c);
        sizes.push(own[i]);
      }
    });
    if (!kids.length) return null;
    if (kids.length === 1) return kids[0];
    return { t: 'split', dir: n.dir, kids, sizes: shares(sizes, kids.length) };
  }

  /** Pane ids in reading order (left to right, top to bottom, depth first): the focus order. */
  function paneIds(n: LNode | null): string[] {
    if (!n) return [];
    return n.t === 'pane' ? [n.id] : n.kids.flatMap(paneIds);
  }

  /** Put a new pane beside `target` on that side. In a split of the same direction it becomes a sibling
   *  and takes half of the target's share; otherwise the target becomes a 2-pane split. */
  function insertBeside(root: LNode, target: string, id: string, side: LSide): LNode {
    if (!paneIds(root).includes(target)) throw new Error('no such pane');
    if (paneIds(root).includes(id)) throw new Error('pane already in the layout');
    const dir = dirOf(side);
    const walk = (n: LNode): LNode => {
      if (n.t === 'pane') {
        if (n.id !== target) return n;
        return { t: 'split', dir, kids: after(side) ? [n, leaf(id)] : [leaf(id), n], sizes: [0.5, 0.5] };
      }
      const at = n.kids.findIndex((k) => k.t === 'pane' && k.id === target);
      if (n.dir === dir && at >= 0) {
        const kids = [...n.kids];
        const sizes = [...n.sizes];
        const half = sizes[at] / 2;
        sizes[at] = half;
        const pos = after(side) ? at + 1 : at;
        kids.splice(pos, 0, leaf(id));
        sizes.splice(pos, 0, half);
        return { ...n, kids, sizes };
      }
      return { ...n, kids: n.kids.map(walk) };
    };
    return normalize(walk(root))!;
  }

  /** A new pane at an outer edge of the whole workspace (a new column at the right, say). In a root split
   *  of that direction every pane gives up the same part of its share. */
  function appendRoot(root: LNode, id: string, side: LSide): LNode {
    if (paneIds(root).includes(id)) throw new Error('pane already in the layout');
    const dir = dirOf(side);
    if (root.t === 'split' && root.dir === dir) {
      const n = root.kids.length;
      const sizes = root.sizes.map((s) => (s * n) / (n + 1));
      return after(side)
        ? { ...root, kids: [...root.kids, leaf(id)], sizes: [...sizes, 1 / (n + 1)] }
        : { ...root, kids: [leaf(id), ...root.kids], sizes: [1 / (n + 1), ...sizes] };
    }
    return normalize({ t: 'split', dir, kids: after(side) ? [root, leaf(id)] : [leaf(id), root], sizes: [0.5, 0.5] })!;
  }

  /** Take a pane out. Its share goes to its siblings (each keeps its proportion); a split left with one
   *  child is replaced by that child. null: the tree is empty now. */
  function removePane(root: LNode, id: string): LNode | null {
    const walk = (n: LNode): LNode | null => {
      if (n.t === 'pane') return n.id === id ? null : n;
      const kids: LNode[] = [];
      const sizes: number[] = [];
      n.kids.forEach((k, i) => {
        const c = walk(k);
        if (c) {
          kids.push(c);
          sizes.push(n.sizes[i]);
        }
      });
      return kids.length ? { ...n, kids, sizes: shares(sizes, kids.length) } : null;
    };
    const r = walk(root);
    return r ? normalize(r) : null;
  }

  /** Drag and drop: move `src` beside `target` (a new split there). Dropping on itself changes nothing. */
  function movePane(root: LNode, src: string, target: string, side: LSide): LNode {
    if (src === target) return root;
    const ids = paneIds(root);
    if (!ids.includes(src) || !ids.includes(target)) throw new Error('no such pane');
    return insertBeside(removePane(root, src)!, target, src, side);
  }

  /** Drop on the center: the two panes trade places (sizes stay with the places). */
  function swapPanes(root: LNode, a: string, b: string): LNode {
    const walk = (n: LNode): LNode => (n.t === 'pane' ? (n.id === a ? leaf(b) : n.id === b ? leaf(a) : n) : { ...n, kids: n.kids.map(walk) });
    return walk(root);
  }

  /** The smallest length (px) a node can have along a direction: a row needs the sum of its children's
   *  widths, a column the widest child; `gap` is the divider between two children. */
  function minSize(n: LNode, dir: LDir, minW: number, minH: number, gap: number): number {
    if (n.t === 'pane') return dir === 'row' ? minW : minH;
    const each = n.kids.map((k) => minSize(k, dir, minW, minH, gap));
    return n.dir === dir ? each.reduce((a, b) => a + b, 0) + gap * (n.kids.length - 1) : Math.max(...each);
  }

  /** The node at a path of child indexes ([] is the root). */
  function at(root: LNode, path: number[]): LNode | null {
    let n: LNode | null = root;
    for (const i of path) n = n && n.t === 'split' ? (n.kids[i] ?? null) : null;
    return n;
  }

  /** The same tree with new sizes for the split at `path`. */
  function withSizes(root: LNode, path: number[], sizes: number[]): LNode {
    if (!path.length) {
      if (root.t !== 'split') return root;
      return { ...root, sizes: shares(sizes, root.kids.length) };
    }
    if (root.t !== 'split') return root;
    const kids = [...root.kids];
    kids[path[0]] = withSizes(kids[path[0]], path.slice(1), sizes);
    return { ...root, kids };
  }

  /** Drag the divider after child i by `delta` (a share of the split's length). Only the two children
   *  beside the divider change; each keeps at least its minimum share. */
  function dragDivider(sizes: number[], i: number, delta: number, minA: number, minB: number): number[] {
    const out = [...sizes];
    const pair = out[i] + out[i + 1];
    const lo = Math.min(minA, pair / 2);
    const hi = pair - Math.min(minB, pair / 2);
    const a = Math.min(hi, Math.max(lo, out[i] + delta));
    out[i] = a;
    out[i + 1] = pair - a;
    return out;
  }

  /** Double-click a divider: the two children beside it get equal shares (the others keep theirs). */
  function equalPair(sizes: number[], i: number): number[] {
    const out = [...sizes];
    const half = (out[i] + out[i + 1]) / 2;
    out[i] = out[i + 1] = half;
    return out;
  }

  /** Which drop zone a point falls in, from its place in the target pane (fractions 0..1): the middle
   *  is the center (swap); elsewhere the nearest edge. */
  function dropZone(fx: number, fy: number): LSide | 'center' {
    if (fx > 0.3 && fx < 0.7 && fy > 0.3 && fy < 0.7) return 'center';
    return edgeZone(fx, fy);
  }

  /** The nearest edge to a point in a box (fractions 0..1); no center. */
  function edgeZone(fx: number, fy: number): LSide {
    const d: [LSide, number][] = [['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy]];
    return d.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
  }

  /** Where every pane sits (px from the top left) when the tree fills w×h: each split gives its children
   *  their shares of the length left after the dividers. Minimum sizes are not applied. */
  function rects(root: LNode, w: number, h: number, gap: number): Record<string, { x: number; y: number; w: number; h: number }> {
    const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
    const walk = (n: LNode, x: number, y: number, w: number, h: number) => {
      if (n.t === 'pane') return void (out[n.id] = { x, y, w, h });
      const row = n.dir === 'row';
      const free = Math.max(0, (row ? w : h) - gap * (n.kids.length - 1));
      let at = row ? x : y;
      n.kids.forEach((k, i) => {
        const len = free * n.sizes[i];
        if (row) walk(k, at, y, len, h);
        else walk(k, x, at, w, len);
        at += len + gap;
      });
    };
    walk(root, 0, 0, w, h);
    return out;
  }

  /** The next or previous pane in focus order (wraps around). */
  function nextPane(root: LNode, id: string, step: number): string {
    const ids = paneIds(root);
    const i = ids.indexOf(id);
    if (!ids.length) return id;
    return ids[(((i < 0 ? 0 : i) + step) % ids.length + ids.length) % ids.length];
  }

  function single(id: string, session: string): LWorkspace {
    return { v: 1, root: leaf(id), panes: { [id]: { session } }, focus: id, max: null };
  }

  /** A saved workspace, checked. Anything that does not fit gives null (the app then starts with one
   *  empty pane). Pane ids are unique, each pane has a session id, sizes are shares. */
  function parseWorkspace(text: string | null): LWorkspace | null {
    let raw: any;
    try {
      raw = text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
    if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
    const seen = new Set<string>();
    const node = (n: any, depth: number): LNode | null => {
      if (!n || typeof n !== 'object' || depth > MAX_DEPTH) return null;
      if (n.t === 'pane') {
        if (typeof n.id !== 'string' || !PANE_ID.test(n.id) || seen.has(n.id) || seen.size >= MAX_PANES) return null;
        seen.add(n.id);
        return leaf(n.id);
      }
      if (n.t !== 'split' || (n.dir !== 'row' && n.dir !== 'col') || !Array.isArray(n.kids) || n.kids.length < 1) return null;
      const kids: LNode[] = [];
      for (const k of n.kids) {
        const c = node(k, depth + 1);
        if (!c) return null;
        kids.push(c);
      }
      const sizes = Array.isArray(n.sizes) ? n.sizes.map(Number) : [];
      return { t: 'split', dir: n.dir, kids, sizes: shares(sizes, kids.length) };
    };
    const root = node(raw.root, 0);
    const tree = root && normalize(root);
    if (!tree) return null;
    const panes: Record<string, LPane> = {};
    const sessions = new Set<string>();
    for (const id of paneIds(tree)) {
      const p = raw.panes?.[id];
      const session = typeof p?.session === 'string' ? p.session : '';
      if (!SESSION.test(session) || sessions.has(session)) return null; // one session in one pane only
      sessions.add(session);
      panes[id] = { session };
      if (typeof p.branchOf === 'string' && SESSION.test(p.branchOf)) panes[id].branchOf = p.branchOf;
    }
    const ids = paneIds(tree);
    const focus = ids.includes(raw.focus) ? raw.focus : ids[0];
    const max = typeof raw.max === 'string' && ids.includes(raw.max) && ids.length > 1 ? raw.max : null;
    return { v: 1, root: tree, panes, focus, max };
  }

  return { normalize, paneIds, insertBeside, appendRoot, removePane, movePane, swapPanes, minSize, at, withSizes, dragDivider, equalPair, dropZone, edgeZone, rects, nextPane, single, parseWorkspace, PANE_ID, MAX_PANES };
})();

if (typeof module !== 'undefined') module.exports = Lay;
