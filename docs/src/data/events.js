/**
 * EventTracker — equivalent of Scripts/Backend/EventTracker.cs (tech doc §4)
 *
 * Analytics event log. The names are exactly those listed in §6.1 of the
 * document (`level_started`, `ad_watched`, …): wiring up Firebase Analytics or
 * AppsFlyer will amount to replacing the body of `track()`.
 *
 * Without this log no advertising setting is steerable: we would not know how
 * many ads are actually shown, nor at what point players drop out.
 */

const MAX = 200; // the prototype only keeps a recent window

const log = [];
const subscribers = new Set();
const sessionId = `s_${Date.now().toString(36)}`;

/** POST /api/event/track — asynchronous, never blocks the game. */
export function track(eventName, eventData = {}) {
  const entry = {
    eventName,
    eventData,
    timestamp: new Date().toISOString(),
    sessionId,
  };
  log.push(entry);
  if (log.length > MAX) log.shift();
  for (const fn of subscribers) fn(entry);
  return entry;
}

export function recent(n = 40) {
  return log.slice(-n).reverse();
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Counts occurrences of an event — used by the ad pacing rules. */
export function count(eventName) {
  return log.reduce((n, e) => n + (e.eventName === eventName ? 1 : 0), 0);
}

export const SESSION_ID = sessionId;
