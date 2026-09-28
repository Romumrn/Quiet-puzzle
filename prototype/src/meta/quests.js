/**
 * Daily quests — three goals a day, paid in coins, with a chest for all three.
 *
 * Why quests and not just the daily gift: a gift rewards opening the app, a
 * quest rewards PLAYING it, and gives the session a shape ("two more levels and
 * the chest is mine"). Royal Match, Candy Crush and Toy Blast all run them; the
 * one lesson they share is to call them what they are and show them up front.
 *
 * The first quest is always the daily puzzle — the one thing everybody plays
 * the same day. The other two are drawn from the pool below, seeded by the
 * date, among the quests the player can actually do (no joker quest before the
 * joker world).
 *
 * Everything is local (the save): quests are a pacing device, not a ledger.
 */

import * as store from '../data/save.js';
import { track } from '../data/events.js';
import * as currency from '../monetization/currency.js';

/** kind → how it is counted, its range, its reward, and from which level it may be drawn. */
export const POOL = Object.freeze({
  levels: { range: [3, 5], coins: 15, from: 1 },
  exits: { range: [40, 70], coins: 15, from: 1 },
  stars: { range: [6, 10], coins: 15, from: 1 },
  perfect: { range: [2, 3], coins: 20, from: 5 },
  hard: { range: [1, 1], coins: 20, from: 5 },
  streak: { range: [3, 3], coins: 20, from: 10 },
  jokers: { range: [3, 5], coins: 20, from: 81 },
});
export const DAILY = Object.freeze({ kind: 'daily', target: 1, coins: 25 });
export const CHEST = 40;

const today = () => new Date().toISOString().slice(0, 10);

function seeded(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = (h + 0x6d2b79f5) >>> 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function draw(date, unlocked) {
  const rng = seeded(`quests:${date}`);
  const kinds = Object.keys(POOL).filter((k) => unlocked >= POOL[k].from);
  const picked = [];
  while (picked.length < 2 && kinds.length) picked.push(kinds.splice(Math.floor(rng() * kinds.length), 1)[0]);
  return [
    { ...DAILY, progress: 0, claimed: false },
    ...picked.map((kind) => {
      const [a, b] = POOL[kind].range;
      let target = a + Math.floor(rng() * (b - a + 1));
      if (target >= 20) target = Math.round(target / 5) * 5; // "60 blocks", not "61"
      return { kind, target, coins: POOL[kind].coins, progress: 0, claimed: false };
    }),
  ];
}

/** Today's quests, drawn on first read of the day. */
export function list() {
  const d = store.load();
  if (d.quests?.date !== today()) {
    d.quests = { date: today(), list: draw(today(), d.unlockedLevel || 1), chest: false };
    store.save(d);
  }
  return d.quests;
}

/** Adds progress; returns the quests that have just been completed. */
function advance(changes) {
  list();
  const d = store.load();
  const done = [];
  for (const q of d.quests.list) {
    const add = changes[q.kind];
    if (!add || q.progress >= q.target) continue;
    q.progress = changes.absolute?.includes(q.kind) ? Math.max(q.progress, Math.min(q.target, add)) : Math.min(q.target, q.progress + add);
    if (q.progress >= q.target) done.push(q);
  }
  store.save(d);
  for (const q of done) track('quest_completed', { kind: q.kind, target: q.target });
  return done;
}

/**
 * A map level won.
 * @param r { stars, exits, jokers, tier, streak }
 */
export function onLevelWon(r) {
  return advance({
    levels: 1, exits: r.exits, stars: r.stars, jokers: r.jokers,
    perfect: r.stars === 3 ? 1 : 0, hard: r.tier ? 1 : 0,
    streak: r.streak, absolute: ['streak'],
  });
}

/** The daily puzzle won. Its blocks count towards the exit quest too. */
export function onDailyWon({ exits }) {
  return advance({ daily: 1, exits });
}

export const readyToClaim = () => list().list.filter((q) => q.progress >= q.target && !q.claimed).length
  + (chestReady() ? 1 : 0);

export const chestReady = () => { const q = list(); return q.list.every((x) => x.claimed) && !q.chest; };

/** @returns coins credited, 0 if nothing to claim. */
export function claim(index) {
  list();
  const d = store.load();
  const q = d.quests.list[index];
  if (!q || q.claimed || q.progress < q.target) return 0;
  q.claimed = true;
  store.save(d);
  currency.credit(q.coins, `quest_${q.kind}`);
  return q.coins;
}

export function claimChest() {
  if (!chestReady()) return 0;
  const d = store.load();
  d.quests.chest = true;
  store.save(d);
  currency.credit(CHEST, 'quest_chest');
  track('quest_chest_claimed', {});
  return CHEST;
}
