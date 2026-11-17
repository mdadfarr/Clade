// Trackpad pinch: a continuous zoom that moves between the chat and the reply graph. Plain script:
// loaded by index.html before renderer.js (global functions there) and by the tests through require().
//
// On macOS, Chromium turns a trackpad pinch into wheel events with ctrlKey = true and
// deltaY = -100 * ln(scale step): fingers moving together give deltaY > 0 (zoom out),
// fingers moving apart give deltaY < 0 (zoom in). A two-finger scroll has ctrlKey = false.
//
// The chat is the graph zoomed all the way into one reply. Between ENTER_S (graph fully shown)
// and the fill zoom (that reply's box fills the window) the graph fades and the chat shows
// through, so the move follows the fingers. When the fingers stop half way, it settles to the
// nearer end.

/** Graph zoom change per unit of deltaY: zoom *= e^(-PINCH_RATE * deltaY). */
const PINCH_RATE = 0.02;
/** Zoom where the move into a reply's chat starts (graph fully shown at or below it). */
const ENTER_S = 2.5;
/** No pinch event for this long: the fingers stopped, settle to the nearer end. */
const PINCH_END_MS = 140;
/** Length of the settle animation. */
const SETTLE_MS = 220;

/** The zoom after one pinch event. */
function pinchZoom(s: number, deltaY: number): number {
  return s * Math.exp(-PINCH_RATE * deltaY);
}

/** How much of the graph is shown at zoom s: 1 at or below enterS, 0 at or above fillS (log scale). */
function graphShown(s: number, enterS: number, fillS: number): number {
  if (fillS <= enterS) return s >= fillS ? 0 : 1;
  const t = (Math.log(fillS) - Math.log(s)) / (Math.log(fillS) - Math.log(enterS));
  return Math.min(1, Math.max(0, t));
}

/** Where a move stopped half way settles: 'chat' when less than half of the graph shows. */
const settleTo = (shown: number): 'chat' | 'graph' => (shown < 0.5 ? 'chat' : 'graph');

/** Smooth 0..1 easing for fades. */
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Zoom at which a node of nodeW x nodeH fills a view of viewW x viewH (with a small margin). */
function fillScale(viewW: number, viewH: number, nodeW: number, nodeH: number): number {
  const s = Math.min(viewW / nodeW, viewH / nodeH) * 0.9;
  return s > 0 && Number.isFinite(s) ? s : 1;
}

if (typeof module !== 'undefined') module.exports = { pinchZoom, graphShown, settleTo, smooth, fillScale, PINCH_RATE, ENTER_S, PINCH_END_MS, SETTLE_MS };
