/**
 * Reminders — local notifications, scheduled on the phone (no server).
 *
 * Few on purpose (user decision: "not too many, and an option to turn them
 * off"). Planned while the game is OPEN — at start, on resume, and whenever
 * the hearts or the streak change (`watch()`): Android freezes the page as
 * soon as the app goes to the background, so planning on `pause` never got to
 * the end. Each plan replaces the last, so coming back pushes tomorrow's
 * reminder one day further:
 *
 *  - LIVES: hearts back to full, if they were short — the same day, between
 *    9:00 and 21:00, never at night;
 *  - TOMORROW, one only: the streak about to break (from STREAK_FROM days),
 *    else the daily puzzle. Ignored, it is not repeated: the next one waits
 *    for the next visit.
 *
 * So one a day at most, and nothing at all for a player who stopped
 * coming. Switch: Settings → "Reminders" (`notifications` in save.js).
 * Android 13+ asks for permission: once, after a win from ASK_FROM_LEVEL —
 * never at first launch, before the player knows the game.
 */

import { LocalNotifications } from '../../vendor/capacitor-local-notifications.esm.js';
import { isNative } from './capacitor.js';
import * as store from '../data/save.js';
import * as lives from '../meta/lives.js';
import { t } from '../ui/i18n.js';
import { subscribe } from '../data/events.js';

const ID = Object.freeze({ LIVES: 1, TOMORROW: 2 });
const ASK_FROM_LEVEL = 3;
const STREAK_FROM = 3;
const DAY_START = 9, DAY_END = 21;
const PUZZLE_HOUR = 18, STREAK_HOUR = 19;

export const enabled = () => store.load().notifications !== false;

async function granted() {
  try { return (await LocalNotifications.checkPermissions()).display === 'granted'; } catch { return false; }
}

/** The permission, asked once, after a win: the player knows the game by then. */
export async function afterWin(level) {
  if (!isNative() || level < ASK_FROM_LEVEL || !enabled()) return;
  const d = store.load();
  if (d.notificationsAsked) return;
  d.notificationsAsked = true;
  store.save(d);
  try { await LocalNotifications.requestPermissions(); } catch { /* the switch can ask again */ }
  plan();
}

/** The settings switch. Turning it on asks again; false: Android refuses (blocked in its settings). */
export async function setEnabled(on) {
  const d = store.load();
  d.notifications = on;
  store.save(d);
  if (!isNative()) return true;
  if (!on) { await cancel(); return true; }
  let ok = await granted();
  if (!ok) {
    try { ok = (await LocalNotifications.requestPermissions()).display === 'granted'; } catch { ok = false; }
  }
  if (ok) plan();
  return ok;
}

export async function cancel() {
  if (!isNative()) return;
  try { await LocalNotifications.cancel({ notifications: [{ id: ID.LIVES }, { id: ID.TOMORROW }] }); } catch { /* none pending */ }
}

const atHour = (daysAhead, hour) => {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d;
};

/** What changes a reminder: the hearts, the day's session, the streak. */
const REPLAN_ON = new Set(['life_lost', 'life_gained', 'session_started', 'streak_continued', 'streak_started']);
let replanTimer = null;
let watching = false;

/** Once, at game start: replans (debounced) after any event in REPLAN_ON. */
export function watch() {
  if (!isNative() || watching) return;
  watching = true;
  subscribe((e) => {
    if (!REPLAN_ON.has(e.eventName)) return;
    clearTimeout(replanTimer);
    replanTimer = setTimeout(plan, 500);
  });
}

/** Replaces whatever was planned with what the game's state calls for now. */
export async function plan() {
  if (!isNative()) return;
  await cancel();
  if (!enabled() || !await granted()) return;
  const notifications = [];

  if (lives.count() < lives.MAX_LIVES) {
    // One heart per tick, halves included: 3.5 and 3 both need two.
    const ticks = Math.ceil(lives.MAX_LIVES - lives.count());
    const full = new Date(Date.now() + lives.msToNext() + (ticks - 1) * lives.REGEN_MS);
    const h = full.getHours();
    // The same day only: tomorrow already has its reminder.
    if (full.toDateString() === new Date().toDateString() && h >= DAY_START && h < DAY_END) {
      notifications.push({ id: ID.LIVES, title: t('notif.lives.title'), body: t('notif.lives.body'), schedule: { at: full } });
    }
  }

  const streak = store.load().streak || 0;
  notifications.push(streak >= STREAK_FROM
    ? { id: ID.TOMORROW, title: t('notif.streak.title', { n: streak }), body: t('notif.streak.body'), schedule: { at: atHour(1, STREAK_HOUR) } }
    : { id: ID.TOMORROW, title: t('notif.daily.title'), body: t('notif.daily.body'), schedule: { at: atHour(1, PUZZLE_HOUR) } });

  try {
    await LocalNotifications.schedule({
      // isExactNotification false: a reminder needs no exact minute, and the
      // default (true) sent Android 12+ players to the "Alarms & reminders"
      // settings page on every plan — a permission we leave out on purpose.
      notifications: notifications.map((n) => ({ ...n, smallIcon: 'ic_stat_notify', iconColor: '#c9577b', isExactNotification: false })),
    });
  } catch { /* nothing to remind of */ }
}
