// Draws the visual blocks Claude can write (mem, timeline, compare, flow) from the parsed data in
// markup.ts. Plain script, loaded by index.html after md.js. Everything is DOM and SVG built here:
// labels go in as text nodes, colors come from the theme's classes.

interface Wire {
  from: HTMLElement;
  to: HTMLElement;
  label: string;
  side: 'auto' | 'down' | 'left' | 'right'; // auto: mem pointers; the rest: flow arrows
}

let wireWatch: ResizeObserver | null = null;
const wiresOf = new WeakMap<Element, Wire[]>();

/** Arrows between elements inside `host`, on an SVG layer over it. Redrawn whenever the host changes size. */
function wire(host: HTMLElement, wires: Wire[]): void {
  if (!wires.length) return;
  wiresOf.set(host, wires);
  wireWatch ??= new ResizeObserver((entries) => entries.forEach((e) => e.target.isConnected && drawWires(e.target as HTMLElement)));
  wireWatch.observe(host); // also draws once now
}

function drawWires(host: HTMLElement): void {
  host.querySelector(':scope > svg.wires')?.remove();
  const wires = wiresOf.get(host) ?? [];
  const box = host.getBoundingClientRect();
  if (!box.width || !wires.length) return;
  const layer = svg(host, 'svg', { class: 'wires', width: host.scrollWidth, height: host.scrollHeight });
  const marker = svg(svg(layer, 'defs', {}), 'marker', { id: 'wirehead', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto' });
  svg(marker, 'path', { d: 'M0 0.5 7.5 4 0 7.5z', class: 'wirehead' });
  const at = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { l: r.left - box.left + host.scrollLeft, r: r.right - box.left + host.scrollLeft, t: r.top - box.top, b: r.bottom - box.top, cx: (r.left + r.right) / 2 - box.left + host.scrollLeft, cy: (r.top + r.bottom) / 2 - box.top };
  };
  wires.forEach((w, i) => {
    const s = at(w.from);
    const t = at(w.to);
    let d: string;
    let lx: number;
    let ly: number;
    const lane = 26 + (i % 5) * 9; // side arrows fan out so they do not lie on each other
    if (w.side === 'down') {
      d = `M${s.cx} ${s.b}L${t.cx} ${t.t - 1}`;
      [lx, ly] = [s.cx + 8, (s.b + t.t) / 2 + 4];
    } else if (w.side === 'left' || w.side === 'right') {
      const x0 = w.side === 'left' ? Math.min(s.l, t.l) : Math.max(s.r, t.r);
      const [sx, tx] = w.side === 'left' ? [s.l, t.l - 1] : [s.r, t.r + 1];
      const cx = x0 + (w.side === 'left' ? -lane : lane);
      d = `M${sx} ${s.cy}C${cx} ${s.cy} ${cx} ${t.cy} ${tx} ${t.cy}`;
      [lx, ly] = [x0 + (w.side === 'left' ? -1 : 1) * (lane * 0.75 + 5), (s.cy + t.cy) / 2 + 4]; // just outside the curve's widest point
    } else {
      // mem pointer: leaves from the right edge of the pointer's own box
      const row = w.from.closest('.memrow') as HTMLElement | null;
      const o = row ? at(row) : s;
      [lx, ly] = [0, 0];
      if (w.to.classList.contains('memcell')) {
        const up = t.cy < o.cy; // an array cell is entered from below or above, at its middle
        const ty = up ? t.b + 1 : t.t - 1;
        d = `M${o.r} ${o.cy}C${o.r + lane + 14} ${o.cy} ${t.cx} ${ty + (up ? 46 : -46)} ${t.cx} ${ty}`;
      } else if (t.l > o.r + 12) {
        const bend = Math.max(24, (t.l - o.r) / 2); // target in the column to the right
        d = `M${o.r} ${o.cy}C${o.r + bend} ${o.cy} ${t.l - bend} ${t.cy} ${t.l - 1} ${t.cy}`;
      } else if (t.r < o.l - 12) {
        const bend = Math.max(24, (o.l - t.r) / 2);
        d = `M${o.l} ${o.cy}C${o.l - bend} ${o.cy} ${t.r + bend} ${t.cy} ${t.r + 1} ${t.cy}`;
      } else {
        const cx = Math.max(o.r, t.r) + lane; // same column: out to the side and back
        d = `M${o.r} ${o.cy}C${cx} ${o.cy} ${cx} ${t.cy} ${t.r + 1} ${t.cy}`;
      }
    }
    svg(layer, 'path', { d, class: 'wire', 'marker-end': 'url(#wirehead)' });
    if (w.label) svg(layer, 'text', { x: lx, y: ly, class: 'wirelabel', 'text-anchor': w.side === 'left' ? 'end' : 'start' }).textContent = w.label;
  });
}

// ---- mem ----
function memBlock(parent: HTMLElement, regions: MemRegion[]): void {
  const host = add(parent, 'div', 'diagram mem');
  const cols = add(host, 'div', 'memcols');
  const left = add(cols, 'div', 'memcol');
  const right = add(cols, 'div', 'memcol');
  const els = new Map<string, HTMLElement>();
  const pointers: { from: HTMLElement; region: number; target: string }[] = [];

  const box = (into: HTMLElement, v: MemVar, ri: number) => {
    const b = add(into, 'div', 'membox');
    els.set(v.id, b);
    const row = add(b, 'div', 'memrow');
    add(row, 'span', 'memname' + (v.tone ? ` t-${v.tone}` : '')).textContent = v.name;
    if (v.type) add(row, 'span', 'memtype').textContent = v.type;
    const val = add(row, 'span', 'memval');
    if (v.cells) {
      const shown = v.cells.length > MEM_MAX_CELLS ? v.cells.slice(0, MEM_MAX_CELLS - 1) : v.cells;
      shown.forEach((c, i) => {
        const cell = add(val, 'span', 'memcell');
        add(cell, 'i').textContent = String(i);
        add(cell, 'span').textContent = c;
        els.set(`${v.id}[${i}]`, cell);
      });
      if (shown.length < v.cells.length) add(val, 'span', 'memcell more').textContent = '…';
    } else if (v.target) {
      const p = add(val, 'span', 'memptr');
      p.textContent = v.target;
      pointers.push({ from: p, region: ri, target: v.target });
    } else if (v.value) val.textContent = v.value;
    if (v.addr) add(row, 'span', 'memaddr').textContent = v.addr;
    if (v.fields.length) {
      const fields = add(b, 'div', 'memfields');
      for (const f of v.fields) box(fields, f, ri);
    }
  };
  regions.forEach((r, ri) => {
    const reg = add(r.kind === 'stack' ? left : right, 'div', 'memregion');
    add(reg, 'div', 'memtitle').textContent = r.kind === 'stack' ? `stack · ${r.name || 'frame'}` : r.kind;
    for (const v of r.vars) box(reg, v, ri);
  });
  if (!left.childElementCount) left.remove();
  if (!right.childElementCount) right.remove();

  const wires: Wire[] = [];
  for (const p of pointers) {
    const id = memTarget(regions, p.region, p.target);
    const to = els.get(id);
    if (id === 'null') {
      p.from.classList.add('null');
      p.from.textContent = 'null';
    } else if (!to) {
      p.from.classList.add('missing');
      p.from.title = `No box named ${p.target}`;
    } else wires.push({ from: p.from, to, label: '', side: 'auto' });
  }
  wire(host, wires);
}

// ---- timeline ----
function timelineBlock(parent: HTMLElement, entries: TimelineEntry[], o: MdOptions): void {
  const host = add(parent, 'div', 'diagram timeline');
  for (const e of entries) {
    add(host, 'div', 'tlwhen' + (e.tone ? ` t-${e.tone}` : '')).textContent = e.when;
    add(host, 'div', 'tldot');
    inline(add(host, 'div', 'tlwhat'), e.what, o);
  }
}

// ---- compare ----
function compareBlock(parent: HTMLElement, c: Compare, o: MdOptions): void {
  const host = add(parent, 'div', 'diagram compare');
  host.style.gridTemplateColumns = `repeat(${c.cols.length}, minmax(0, 1fr))`; // 2 to 4, from the parser
  for (const name of c.cols) add(host, 'div', 'cmphead').textContent = name;
  for (const row of c.rows) {
    for (const cell of row.cells) {
      const el = add(host, 'div', 'cmpcell');
      add(el, 'div', 'cmpaspect').textContent = row.aspect;
      inline(add(el, 'div'), cell, o);
    }
  }
}

// ---- flow ----
function flowBlock(parent: HTMLElement, f: Flow): void {
  const host = add(parent, 'div', 'diagram flow');
  const els = f.nodes.map((n) => {
    const el = add(host, 'div', 'flownode' + (n.endsWith('?') ? ' ask' : ''));
    el.textContent = n;
    return el;
  });
  // An arrow to the very next node goes straight down. Others run along a side: back up on the left, forward on the right.
  wire(host, f.edges.map((e) => ({ from: els[e.from], to: els[e.to], label: e.label, side: e.to === e.from + 1 ? 'down' : e.to < e.from ? 'left' : 'right' })));
}

// ---- inline drawings (```svg / ```draw), parsed and checked by draw.ts. Each node is made here with
// createElementNS; only the checked names and values are set. Colors are the app's CSS variables. ----
let drawSeq = 0;
const SAVE_ICON = ['M8 2.5v7.5', 'M4.5 6.5 8 10l3.5-3.5', 'M3 12.5h10'];

function drawNodes(parent: Element, n: DrawNode): Element {
  const el = parent.appendChild(document.createElementNS(SVG, n.tag));
  for (const [k, v] of n.attrs) el.setAttribute(k, v);
  for (const [k, name] of n.colors) (el as SVGElement).style.setProperty(k, name === 'none' ? 'none' : `var(${DRAW_COLORS[name]})`);
  for (const c of n.kids) {
    if (typeof c === 'string') el.appendChild(document.createTextNode(c));
    else drawNodes(el, c);
  }
  return el;
}

/** The picture's box: as wide as its viewBox in CSS pixels, at most the column, height from the ratio.
 *  The placeholder during streaming uses the same box, so nothing moves when the picture arrives. */
function drawFrame(box: HTMLElement, width: number | null, height: number | null): void {
  if (width && height) {
    box.style.setProperty('--draw-w', `${width}px`);
    box.style.setProperty('--draw-ratio', `${width} / ${height}`);
  }
}

/** A drawing in a reply. src: the block as written (for Copy). Returns false if it is not a drawing. */
function drawingBlock(parent: HTMLElement, src: string, o: MdOptions): boolean {
  const d = parseDrawing(src, `dw${++drawSeq}-`);
  if (!d) return false;
  const box = add(parent, 'figure', 'drawing');
  drawFrame(box, d.width, d.height);
  const pic = drawNodes(box, d.root) as SVGSVGElement;
  pic.classList.add('drawsvg');
  pic.setAttribute('role', 'img');
  const title = d.root.kids.find((k): k is DrawNode => typeof k !== 'string' && k.tag === 'title');
  const name = title?.kids.filter((k): k is string => typeof k === 'string').join('').trim() ?? '';
  pic.setAttribute('aria-label', name || 'Drawing');
  const bar = add(box, 'div', 'drawbar');
  const button = (label: string, paths: string[], click: (b: HTMLElement) => void) => {
    const b = add(bar, 'button', 'drawbtn');
    icon(b, paths, 13);
    add(b, 'span').textContent = label;
    b.title = label === 'Copy' ? 'Copy the drawing as SVG' : 'Save the drawing as an .svg file';
    b.addEventListener('click', () => click(b));
  };
  button('Copy', COPY_ICON, (b) => {
    o.copy(src.trim() + '\n');
    b.lastElementChild!.textContent = 'Copied';
    setTimeout(() => (b.lastElementChild!.textContent = 'Copy'), 1500);
  });
  if (o.saveDrawing)
    button('Save', SAVE_ICON, () => {
      // the colors as they are on screen now, so the file looks the same outside the app
      const st = getComputedStyle(document.body);
      const palette: Record<string, string> = {};
      for (const [k, v] of Object.entries(DRAW_COLORS)) palette[k] = st.getPropertyValue(v).trim();
      o.saveDrawing!(drawSerialize(d, palette, st.getPropertyValue('--font-ui')), name);
    });
  return true;
}

/** The quiet box that holds a drawing's place while Claude is still writing it. */
function drawingPlaceholder(parent: HTMLElement, width: number | null, height: number | null): void {
  const box = add(parent, 'figure', 'drawing pending');
  drawFrame(box, width, height);
  const pad = add(box, 'div', 'drawpad');
  pad.setAttribute('aria-label', 'Drawing, still being written');
  add(pad, 'span').textContent = 'Drawing…';
}
