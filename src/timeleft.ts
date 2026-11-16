// Time left on a permission or question card. Plain script: loaded by index.html before
// renderer.js (a global function there) and by the tests through require().

/** Cards expire this long after their hook request arrived. */
const CARD_LIFETIME_MS = 590_000;

interface TimeLeft {
  ms: number; // milliseconds left, never below 0
  fraction: number; // time left: 1 = just arrived, 0 = expired (the bar fills with 1 - fraction)
  text: string; // e.g. "9:24 left"
  level: 'normal' | 'urgent' | 'expired';
}

/** expires: when the card expires (epoch ms, from the request's arrival). now: Date.now(). */
function timeLeft(expires: number, now: number, lifetime: number = CARD_LIFETIME_MS): TimeLeft {
  const ms = Math.max(0, Math.min(lifetime, expires - now));
  const secs = Math.ceil(ms / 1000);
  const text = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} left`;
  // from the shown seconds, so "0:30 left" is never already red
  const level = secs <= 0 ? 'expired' : secs < 30 ? 'urgent' : 'normal';
  return { ms, fraction: ms / lifetime, text, level };
}

if (typeof module !== 'undefined') module.exports = { timeLeft, CARD_LIFETIME_MS };
