/**
 * EventTracker — équivalent de Scripts/Backend/EventTracker.cs (doc §4)
 *
 * Journal d'évènements analytics. Les noms sont exactement ceux listés au §6.1
 * du document (`level_started`, `ad_watched`, …) : brancher Firebase Analytics
 * ou AppsFlyer reviendra à remplacer le corps de `track()`.
 *
 * Sans ce journal, aucun réglage publicitaire n'est pilotable : on ne saurait
 * pas combien de pubs sont réellement affichées, ni à quel moment les joueurs
 * abandonnent.
 */

const MAX = 200; // le prototype ne garde qu'une fenêtre récente

const journal = [];
const abonnes = new Set();
const sessionId = `s_${Date.now().toString(36)}`;

/** POST /api/event/track — asynchrone, ne bloque jamais le jeu. */
export function track(eventName, eventData = {}) {
  const entree = {
    eventName,
    eventData,
    timestamp: new Date().toISOString(),
    sessionId,
  };
  journal.push(entree);
  if (journal.length > MAX) journal.shift();
  for (const fn of abonnes) fn(entree);
  return entree;
}

export function recent(n = 40) {
  return journal.slice(-n).reverse();
}

export function subscribe(fn) {
  abonnes.add(fn);
  return () => abonnes.delete(fn);
}

/** Compte les occurrences d'un évènement — utilisé par le cadencement des pubs. */
export function count(eventName) {
  return journal.reduce((n, e) => n + (e.eventName === eventName ? 1 : 0), 0);
}

export const SESSION_ID = sessionId;
