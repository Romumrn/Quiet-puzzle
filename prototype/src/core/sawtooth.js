/**
 * The shape of a realm: a SAWTOOTH, not a ramp — shared by the generator
 * (`generator/index.js`, which asks each level for its slot's difficulty) and
 * the game (`levelStore.tierOf`, which labels the peaks on the map and the
 * briefing screen). One function, so the two can never disagree.
 *
 * A realm is cut into cycles of three to six levels, drawn at random per realm
 * (seeded by its id: the same realm always gets the same cut). Each cycle opens
 * easy — a breather after the peak before it — climbs, and peaks on its last
 * level, labelled HARD — except the last cycle, which climbs to the realm's
 * summit, SUPER HARD. Each cycle sits a little higher than the one before.
 *
 * Why: twenty levels of steadily rising difficulty read as a grind, and a
 * player who hits a wall with nothing easier in sight quits. Royal Match and
 * its peers pace levels the same way — a short cycle, a labelled peak, an easy
 * level right after. Cycles of uneven length keep the peaks from falling on a
 * beat the player can count.
 *
 * `f` is the position between the realm's easiest and hardest level (0…1).
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Realms laid out as a steady RAMP instead of a sawtooth: the first two, where
 * a new player learns the game. Playtesters found them "very irregular" — a
 * cycle's easy opening right after its hard peak read as random jumps (2, 5,
 * 2, 2, 4… parks), not as a breather (2026-09-30). Here each level is a notch
 * harder than the one before, and only the summit is labelled.
 */
export const RAMP_REALMS = new Set([0, 1]);

const cache = new Map();

/** @returns {Array<{ f: number, tier: 'hard'|'superhard'|null }>} one entry per level */
export function realmShape(realmId, count = 20) {
  const key = `${realmId}:${count}`;
  if (cache.has(key)) return cache.get(key);
  if (RAMP_REALMS.has(realmId)) {
    const ramp = Array.from({ length: count }, (_, k) => ({
      f: count > 1 ? k / (count - 1) : 1,
      tier: k === count - 1 ? 'superhard' : null,
    }));
    cache.set(key, ramp);
    return ramp;
  }
  const rng = mulberry32(0x5a17 + realmId * 7919);
  const out = [];
  let left = count;
  let first = true;
  while (left > 0) {
    // 3 to 6, never leaving a stub of 1 or 2 behind, and a first cycle of 4 at
    // least: the player needs a few levels to warm up to a new mechanic.
    let len = 3 + Math.floor(rng() * 4);
    if (first) len = Math.max(len, 4);
    if (left - len < 3) len = left <= 6 ? left : left - 3;
    const last = left === len; // the final cycle climbs to the summit
    for (let pos = 0; pos < len; pos++) {
      const drift = 0.15 * (out.length / count);
      const climb = len > 1 ? pos / (len - 1) : 1;
      const jitter = pos > 0 && pos < len - 1 ? (rng() - 0.5) * 0.1 : 0;
      const peak = pos === len - 1;
      out.push({
        f: last && peak ? 1 : Math.min(1, Math.max(0, drift + 0.8 * climb + jitter)),
        tier: peak ? (last ? 'superhard' : 'hard') : null,
      });
    }
    left -= len;
    first = false;
  }
  cache.set(key, out);
  return out;
}
