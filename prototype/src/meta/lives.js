/**
 * Lives — five hearts, one back every twenty minutes.
 *
 * A failed map level costs a heart, restarting one in progress half a heart.
 * At zero the player waits, or watches an ad for one straight away. The daily
 * puzzle and the editor's trials are outside the system: they are not part of
 * the progression, and main.js does not charge them (`usesLives()`).
 *
 * Regeneration is computed, not ticked: the save keeps a count and the moment
 * the current heart started refilling (`livesAt`), and every read settles the
 * time elapsed since — so hearts come back while the app is closed, and no
 * timer has to survive a reload.
 *
 * Counts move in halves (a restart costs ½). 0.5 steps are exact in floating
 * point, so no rounding creeps in.
 */

import * as store from '../data/save.js';
import { track } from '../data/events.js';

export const MAX_LIVES = 5;
export const REGEN_MS = 20 * 60 * 1000;
export const COST = Object.freeze({ FAIL: 1, RESTART: 0.5 });

/** Loads the save with the hearts regained since the last read added in. */
function settle(now = Date.now()) {
  const d = store.load();
  let changed = false;
  if (typeof d.lives !== 'number') { d.lives = MAX_LIVES; changed = true; }
  // A clock set back would otherwise hold the next heart hostage until the
  // device's time caught up with it again.
  if (typeof d.livesAt !== 'number' || d.livesAt > now) { d.livesAt = now; changed = true; }
  if (d.lives < MAX_LIVES) {
    const gained = Math.floor((now - d.livesAt) / REGEN_MS);
    if (gained > 0) {
      d.lives = Math.min(MAX_LIVES, d.lives + gained);
      d.livesAt += gained * REGEN_MS;
      changed = true;
    }
  }
  if (changed) store.save(d);
  return d;
}

export function count() { return settle().lives; }

/** Half a heart is still enough to start a level. */
export function canPlay() { return count() > 0; }

/** Milliseconds until the next heart, or 0 when full. */
export function msToNext(now = Date.now()) {
  const d = settle(now);
  return d.lives >= MAX_LIVES ? 0 : Math.max(0, REGEN_MS - (now - d.livesAt));
}

export function spend(amount, reason) {
  const now = Date.now();
  const d = settle(now);
  // Full, the refill clock stood still: it starts with the first heart spent.
  if (d.lives >= MAX_LIVES) d.livesAt = now;
  d.lives = Math.max(0, d.lives - amount);
  store.save(d);
  track('life_lost', { amount, reason, left: d.lives });
}

export function gain(amount, source) {
  const d = settle();
  d.lives = Math.min(MAX_LIVES, d.lives + amount);
  store.save(d);
  track('life_gained', { amount, source, left: d.lives });
}

/** "4", "4½", "½". */
export function label(n = count()) {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  return half ? (whole ? `${whole}½` : '½') : String(whole);
}

/** "12:05" — minutes and seconds to the next heart. */
export function clock(ms = msToNext()) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
