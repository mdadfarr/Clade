// Plain script, loaded after renderer.js. The workspace: the panes (renderer.ts createPane) laid out by a
// split tree (layout.ts). Every pane is its own chat with its own claude; moving a pane only moves its
// element, so its chat and claude keep running. This file opens, closes, focuses and maximizes panes,
// draws the tree, and starts the page.
let ws: LWorkspace = { v: 1, root: { t: 'pane', id: 'p0' }, panes: {}, focus: '', max: null };
const wsEl = byId('workspace');
const parking = byId('parking'); // panes not in view (behind a maximized one): kept alive, out of sight
const MIN_W = 240; // smallest pane, px
const MIN_H = 160;
const GAP = 5; // divider

function newPaneId(): string {
  for (;;) {
    const pid = 'p' + Math.random().toString(36).slice(2, 10);
    if (!panes.has(pid) && Lay.PANE_ID.test(pid)) return pid;
  }
}

/** Would the tree fit in the workspace with every pane at least its minimum size? */
function fits(root: LNode): boolean {
  return Lay.minSize(root, 'row', MIN_W, MIN_H, GAP) <= wsEl.clientWidth + 1 && Lay.minSize(root, 'col', MIN_W, MIN_H, GAP) <= wsEl.clientHeight + 1;
}

/** Draw the tree: split boxes in rows and columns, the panes' own elements moved into them. */
function renderLayout(): void {
  const active = document.activeElement;
  const holds = [...panes.values()].map((v) => v.holdScroll());
  const shown = ws.max && panes.has(ws.max) ? ({ t: 'pane', id: ws.max } as LNode) : ws.root;
  const visible = new Set(Lay.paneIds(shown));
  for (const v of panes.values()) if (!visible.has(v.id) && v.el.parentElement !== parking) parking.appendChild(v.el);
  // `path`: the child indexes from the root to this node (for the dividers; `shown` is the root or one pane)
  const build = (n: LNode, path: number[]): HTMLElement => {
    if (n.t === 'pane') return panes.get(n.id)!.el;
    const box = document.createElement('div');
    box.className = `split ${n.dir}`;
    n.kids.forEach((k, i) => {
      if (i > 0) box.appendChild(makeDivider(path, i - 1, n.dir));
      const c = build(k, [...path, i]);
      c.style.flexGrow = String(n.sizes[i]);
      c.style.minWidth = `${Lay.minSize(k, 'row', MIN_W, MIN_H, GAP)}px`;
      c.style.minHeight = `${Lay.minSize(k, 'col', MIN_W, MIN_H, GAP)}px`;
      box.appendChild(c);
    });
    return box;
  };
  const top = build(shown, []);
  top.style.flexGrow = '';
  top.style.minWidth = top.style.minHeight = '';
  wsEl.replaceChildren(top);
  document.body.classList.toggle('multi', panes.size > 1);
  for (const v of panes.values()) {
    v.el.classList.toggle('focused', v.id === focusId);
    v.el.classList.toggle('maxed', ws.max === v.id);
    const mb = v.el.querySelector('.panebtn.max') as HTMLElement;
    mb.hidden = panes.size < 2;
    mb.title = ws.max === v.id ? 'Restore the layout (Cmd+Shift+Enter, or double-click the title bar)' : 'Maximize (Cmd+Shift+Enter, or double-click the title bar)';
    mb.setAttribute('aria-label', ws.max === v.id ? 'Restore' : 'Maximize');
  }
  for (const h of holds) h();
  if (active instanceof HTMLElement && active.isConnected && active !== document.body) active.focus({ preventScroll: true });
  for (const v of panes.values()) v.refit();
  placeArtifact();
}

/** The divider between children i and i+1 of the split at `path`. Dragging it moves space between those
 *  two only (the other children keep theirs); it stops where either would go below its minimum size.
 *  While dragging only the two elements' flex-grow changes; on release the sizes go into the tree and
 *  the terminals are fitted once. Sizes live in `ws` only (not saved across restarts). */
function makeDivider(path: number[], i: number, dir: LDir): HTMLElement {
  const d = document.createElement('div');
  d.className = 'divider';
  d.setAttribute('role', 'separator');
  d.setAttribute('aria-orientation', dir === 'row' ? 'vertical' : 'horizontal');
  d.title = 'Drag to resize';
  d.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const split = Lay.at(ws.root, path);
    const box = d.parentElement;
    const a = d.previousElementSibling as HTMLElement | null;
    const b = d.nextElementSibling as HTMLElement | null;
    if (!split || split.t !== 'split' || !box || !a || !b) return;
    const row = dir === 'row';
    const len = (row ? box.clientWidth : box.clientHeight) - GAP * (split.kids.length - 1); // shared by the children
    if (len <= 0) return;
    e.preventDefault();
    const minShare = (k: LNode) => Lay.minSize(k, dir, MIN_W, MIN_H, GAP) / len;
    const minA = minShare(split.kids[i]);
    const minB = minShare(split.kids[i + 1]);
    const sizes0 = split.sizes;
    const p0 = row ? e.clientX : e.clientY;
    let sizes = sizes0;
    const sizing = row ? 'sizing-row' : 'sizing-col';
    d.setPointerCapture(e.pointerId);
    d.classList.add('drag');
    document.body.classList.add(sizing);
    holdFit = true;
    const move = (m: PointerEvent) => {
      sizes = Lay.dragDivider(sizes0, i, ((row ? m.clientX : m.clientY) - p0) / len, minA, minB);
      a.style.flexGrow = String(sizes[i]);
      b.style.flexGrow = String(sizes[i + 1]);
    };
    const up = () => {
      d.removeEventListener('pointermove', move);
      d.removeEventListener('pointerup', up);
      d.removeEventListener('pointercancel', up);
      d.classList.remove('drag');
      document.body.classList.remove(sizing);
      holdFit = false;
      // the tree may have changed meanwhile (a pane closed): then the next draw uses the tree's own sizes
      if (sizes !== sizes0 && Lay.at(ws.root, path) === split) ws.root = Lay.withSizes(ws.root, path, sizes);
      for (const v of panes.values()) v.refit();
      placeArtifact();
    };
    d.addEventListener('pointermove', move);
    d.addEventListener('pointerup', up);
    d.addEventListener('pointercancel', up);
  });
  return d;
}

function focusPaneView(v: PaneView | undefined, typeHere = false): void {
  if (!v) return;
  const changed = focusId !== v.id;
  focusId = ws.focus = v.id;
  for (const x of panes.values()) x.el.classList.toggle('focused', x.id === focusId);
  if (changed) {
    api.paneFocus(v.id);
    setGraph(v.graph);
    renderToolbar();
  }
  if (typeHere) v.focusInput();
}

/** The pane's chat changed (opened another, Retry, new chat): its link in the layout follows. */
function onPaneSession(v: PaneView): void {
  const p = ws.panes[v.id];
  if (p && p.session !== v.chat.session) {
    p.session = v.chat.session;
    if (p.branchOf && p.branchOf === v.chat.session) delete p.branchOf;
  }
}

/** Make a pane's element and wire its title bar. */
function makePane(pid: string): PaneView {
  const v = createPane(pid);
  panes.set(pid, v);
  parking.appendChild(v.el);
  const headEl = v.el.querySelector('.panehead') as HTMLElement;
  v.el.addEventListener('pointerdown', () => focusPaneView(v), true);
  v.el.addEventListener('focusin', () => focusPaneView(v));
  (v.el.querySelector('.panebtn.close') as HTMLElement).addEventListener('click', () => closePane(v));
  (v.el.querySelector('.panebtn.max') as HTMLElement).addEventListener('click', () => toggleMax(v));
  (v.el.querySelector('.panebtn.split') as HTMLElement).addEventListener('click', () => paneMenu(v));
  headEl.addEventListener('dblclick', (e) => {
    if (!(e.target as Element).closest('button, input, .panemenu')) toggleMax(v);
  });
  return v;
}

/** Open a pane in the layout and start its chat in the main process (a given chat is only shown; none:
 *  a new chat starts at once). */
function addPane(place: (root: LNode, pid: string) => LNode, o: { session?: string; branchOf?: string } = {}): PaneView | null {
  const pid = newPaneId();
  let root: LNode;
  try {
    root = place(ws.root, pid);
  } catch {
    return null;
  }
  if (!fits(root)) {
    fp()?.note('No room for another pane there. Close a pane, or make the window bigger.', 6000);
    return null;
  }
  ws.max = null;
  ws.root = root;
  ws.panes[pid] = { session: o.session ?? '', ...(o.branchOf ? { branchOf: o.branchOf } : {}) };
  const v = makePane(pid);
  renderLayout();
  api.paneOpen(pid, { ...o, ...v.termSize() });
  focusPaneView(v, true);
  return v;
}
const splitPane = (v: PaneView | undefined, side: LSide, o: { session?: string; branchOf?: string } = {}) =>
  v ? addPane((root, pid) => Lay.insertBeside(root, v.id, pid, side), o) : null;

/** Close a pane; its neighbours take its space. Its claude stops, so a pane that is working asks for a
 *  second close. The last pane is replaced by a new chat. */
let closeArmed = '';
let closeTimer: number | undefined;
function closePane(v: PaneView | undefined): void {
  if (!v) return;
  if (v.busy() && closeArmed !== v.id) {
    closeArmed = v.id;
    clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => (closeArmed = ''), 4000);
    return v.note('Claude is working in this pane. Close it again to stop Claude and close the pane.', 4000);
  }
  closeArmed = '';
  const next = panes.size > 1 ? Lay.nextPane(ws.root, v.id, Lay.paneIds(ws.root).indexOf(v.id) === 0 ? 1 : -1) : '';
  const root = Lay.removePane(ws.root, v.id);
  panes.delete(v.id);
  delete ws.panes[v.id];
  api.paneClose(v.id);
  v.destroy();
  if (ws.max === v.id || panes.size < 2) ws.max = null;
  if (!root) {
    const pid = newPaneId();
    ws.root = { t: 'pane', id: pid };
    ws.panes[pid] = { session: '' };
    const nv = makePane(pid);
    renderLayout();
    api.paneOpen(pid, nv.termSize());
    return focusPaneView(nv, true);
  }
  ws.root = root;
  renderLayout();
  focusPaneView(panes.get(next) ?? fp(), true);
}

/** Maximize: one pane fills the workspace; the others keep running out of sight. Again: back. */
function toggleMax(v: PaneView | undefined): void {
  if (!v || panes.size < 2) return;
  ws.max = ws.max === v.id ? null : v.id;
  renderLayout();
  focusPaneView(v, true);
}

function focusStep(step: number): void {
  const v = fp();
  if (!v) return;
  if (ws.max) ws.max = null; // moving on shows the whole layout again
  renderLayout();
  focusPaneView(panes.get(Lay.nextPane(ws.root, v.id, step)), true);
}

// ---- the title bar's menu: new chat or branch beside the pane, and the pane commands, with their keys ----
let menuFor: PaneView | null = null;
function closePaneMenu(): void {
  if (!menuFor) return;
  const m = menuFor.el.querySelector('.panemenu') as HTMLElement;
  m.hidden = true;
  menuFor.el.querySelector('.panebtn.split')?.classList.remove('open');
  menuFor = null;
}
function paneMenu(v: PaneView): void {
  if (menuFor === v) return closePaneMenu();
  closePaneMenu();
  menuFor = v;
  const m = v.el.querySelector('.panemenu') as HTMLElement;
  m.replaceChildren();
  v.el.querySelector('.panebtn.split')?.classList.add('open');
  const item = (label: string, keys: string, off: string, run: () => void) => {
    const b = add(m, 'button', 'popitem');
    b.setAttribute('role', 'menuitem');
    const main = add(b, 'span', 'popmain');
    add(main, 'div').textContent = label;
    if (off) add(main, 'div', 'popdesc').textContent = off;
    if (keys) add(b, 'span', 'popkey').textContent = keys;
    b.setAttribute('aria-disabled', String(!!off));
    b.addEventListener('click', () => {
      if (off) return;
      closePaneMenu();
      run();
    });
  };
  add(m, 'div', 'poptitle').textContent = 'New chat beside this one';
  item('Split right', '⌘D', '', () => splitPane(v, 'right'));
  item('Split down', '⇧⌘D', '', () => splitPane(v, 'bottom'));
  item('New chat pane at the right edge', '⌘T', '', () => addPane((root, pid) => Lay.appendRoot(root, pid, 'right')));
  add(m, 'div', 'poptitle').textContent = 'This pane';
  item('Rename…', '', '', () => renamePane(v));
  if (panes.size > 1) {
    item(ws.max === v.id ? 'Restore layout' : 'Maximize', '⇧⌘↩', '', () => toggleMax(v));
    item('Next pane', '⌘]', '', () => focusStep(1));
    item('Previous pane', '⌘[', '', () => focusStep(-1));
  }
  item('Close pane', '⌘W', '', () => closePane(v));
  m.hidden = false;
}
document.addEventListener('pointerdown', (e) => {
  if (menuFor && e.target instanceof Element && !e.target.closest('.panemenu, .panebtn.split')) closePaneMenu();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePaneMenu();
});

/** Rename the pane's chat in its title bar. A root chat's name is also its name in the chat list. */
function renamePane(v: PaneView): void {
  const t = v.el.querySelector('.panetitle') as HTMLElement;
  const sid = v.chat.session;
  if (!sid || renaming) return;
  renameIn(t, sid, v.title.named || v.title.title, true);
}

// ---- the chat list and New chat act on the focused pane, or beside it while it works ----
function openChat(session: string, inPanes: string[]): void {
  const here = [...panes.values()].find((x) => x.chat.session === session);
  if (here) return focusPaneView(here, true);
  const v = fp();
  if (v && !v.busy()) {
    api.openSession(v.id, session);
    return v.focusInput();
  }
  const near = inPanes.map((p) => panes.get(p)).find(Boolean);
  splitPane(near ?? v, 'right', { session });
}
function newChatHere(): void {
  const v = fp();
  if (v && !v.busy()) {
    api.newChat(v.id);
    return v.focusInput();
  }
  splitPane(v, 'right');
}
api.onFocusPane((p) => focusPaneView(panes.get(p), true));

// ---- drag a chat from the chat list onto the workspace (like VS Code). The pane under the pointer splits
// toward its nearest edge; near the workspace's own edge a full-length column or row opens instead. A
// shadow shows where the chat will be. A chat already open in a pane moves there with its pane (its claude
// keeps running). Where the new pane would not fit, there is no shadow and the drop does nothing. ----
let dragChat = ''; // the session being dragged from the chat list ('' when none)
let lastPlan: DropPlan | null = null; // kept while the pointer crosses a divider (no pane under it)
const OUTER = 28; // px from the workspace edge that count as its edge
const DROP_ID = 'pdrop'; // stands in for the new pane while planning
const shadow = byId('dropzone'); // index.html; styled in app.css (.dropzone)

function startChatDrag(session: string): void {
  dragChat = session;
  lastPlan = null;
}
function endChatDrag(): void {
  if (!dragChat) return;
  dragChat = '';
  lastPlan = null;
  shadow.hidden = true;
  renderChats(); // held back during the drag
}

type DropPlan = { root: LNode; place: (root: LNode, pid: string) => LNode; moving: PaneView | null; pid: string };
function planDrop(x: number, y: number): DropPlan | null {
  const box = wsEl.getBoundingClientRect();
  if (x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
  const moving = [...panes.values()].find((v) => v.chat.session === dragChat) ?? null;
  const base = moving ? Lay.removePane(ws.root, moving.id) : ws.root;
  if (!base) return null; // the only pane, dropped on itself
  const pid = moving ? moving.id : DROP_ID;
  const edges: [LSide, number][] = [['left', x - box.left], ['right', box.right - x], ['top', y - box.top], ['bottom', box.bottom - y]];
  const [edge, dist] = edges.reduce((a, b) => (b[1] < a[1] ? b : a));
  let place: DropPlan['place'];
  if (dist < OUTER) place = (root, id) => Lay.appendRoot(root, id, edge);
  else {
    const hit = document.elementFromPoint(x, y);
    if (hit?.closest('#workspace .divider')) return lastPlan;
    const el = hit?.closest('#workspace .pane') as HTMLElement | null;
    const target = el?.dataset.pane;
    if (!el || !target || target === moving?.id) return null;
    const r = el.getBoundingClientRect();
    const side = Lay.edgeZone((x - r.left) / r.width, (y - r.top) / r.height);
    place = (root, id) => Lay.insertBeside(root, target, id, side);
  }
  let root: LNode;
  try {
    root = place(base, pid);
  } catch {
    return null;
  }
  return fits(root) ? { root, place, moving, pid } : null;
}

wsEl.addEventListener(
  'dragover',
  (e) => {
    if (!dragChat || !e.dataTransfer) return;
    e.preventDefault();
    e.stopPropagation();
    if (ws.max) {
      ws.max = null; // show the whole layout to drop into
      renderLayout();
    }
    const plan = (lastPlan = planDrop(e.clientX, e.clientY));
    e.dataTransfer.dropEffect = plan ? 'move' : 'none';
    if (!plan) return void (shadow.hidden = true);
    const box = wsEl.getBoundingClientRect();
    const r = Lay.rects(plan.root, box.width, box.height, GAP)[plan.pid];
    shadow.style.left = `${box.left + r.x}px`;
    shadow.style.top = `${box.top + r.y}px`;
    shadow.style.width = `${r.w}px`;
    shadow.style.height = `${r.h}px`;
    shadow.hidden = false;
  },
  true,
);
// Chromium's dragleave often has no relatedTarget (it fires between child elements too): use the point.
wsEl.addEventListener('dragleave', (e) => {
  const b = wsEl.getBoundingClientRect();
  if (dragChat && (e.clientX <= b.left || e.clientX >= b.right || e.clientY <= b.top || e.clientY >= b.bottom)) shadow.hidden = true;
});
wsEl.addEventListener(
  'drop',
  (e) => {
    if (!dragChat) return;
    e.preventDefault();
    e.stopPropagation();
    const session = dragChat;
    const plan = planDrop(e.clientX, e.clientY);
    endChatDrag();
    if (!plan) return;
    if (!plan.moving) return void addPane(plan.place, { session });
    ws.root = plan.root;
    ws.max = null;
    renderLayout();
    focusPaneView(plan.moving, true);
  },
  true,
);

// ---- keys (from the app menu, so they work wherever the focus is) ----
api.onShortcut((name) => {
  const v = fp();
  if (name === 'settings') return openSettings(byId('settings').hidden);
  if (name === 'attach') return v?.pickFiles();
  if (['mode', 'effort', 'model', 'skills'].includes(name)) return v?.openPicker(name);
  if (name === 'pane-new') addPane((root, pid) => Lay.appendRoot(root, pid, 'right'));
  else if (name === 'pane-split-right') splitPane(v, 'right');
  else if (name === 'pane-split-down') splitPane(v, 'bottom');
  else if (name === 'pane-next') focusStep(1);
  else if (name === 'pane-prev') focusStep(-1);
  else if (name === 'pane-max') toggleMax(v);
  else if (name === 'pane-close') closePane(v);
});

// ---- start: one pane with a new chat ----
async function boot(): Promise<void> {
  await api.appStart();
  const pid = newPaneId();
  ws = Lay.single(pid, '');
  const v = makePane(pid);
  renderLayout();
  api.paneOpen(pid, v.termSize());
  focusPaneView(v, true);
}
void boot();
