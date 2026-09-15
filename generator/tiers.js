/**
 * Difficulty tiers — the named steps a realm sits on.
 *
 * A realm row used to carry seventeen numeric knobs, and the ten realms of the
 * last stretch repeated the same seven of them verbatim. Nothing said which
 * numbers were the SETTING (this realm is purple and teaches anchors) and which
 * were the DIFFICULTY (this realm is one of the brutal ones). Retuning a step of
 * the curve meant editing ten rows and hoping none was missed.
 *
 * A tier holds the difficulty half. A realm names one and overrides only what it
 * genuinely does differently:
 *
 *     { id: 25, name: …, hue: 55, W: 9, H: 11,
 *       tier: 'punishing', demandTarget: 96 }
 *
 * Resolution is `{ ...TIERS[realm.tier], ...realm }` in `curve.js`: a field
 * written on the realm always wins over its tier. That is what let the tiers be
 * introduced without moving a single published grid — a realm that still spells
 * out a value gets exactly that value.
 *
 * ---------------------------------------------------------------------------
 *
 * `minDrags` is the newcomer, and the one to reach for when tuning a new world.
 *
 * Every other knob asks for a grid that LOOKS hard: more blocks, tighter gates,
 * bigger pieces. None of them promises the level takes long to solve — a dense
 * grid whose blocks never obstruct each other still falls in one pass. A floor
 * on the reference solution's gesture count is the only lever that states the
 * intent directly: below this many drags, the grid is not this realm's problem.
 *
 * It is `null` on every tier here, deliberately. Switching it on for a published
 * realm changes which candidate grid is kept, hence the grid itself, hence the
 * star thresholds and the records already set against them. New worlds declare
 * their own — see `relentless`, which is what realm 30 onwards should use.
 */

/**
 * EVERY tier is curated.
 *
 * `curve(n)` ramps the quantities across a realm honestly, but it cannot promise
 * the RESULT: generation searches random grids and what comes out scatters.
 * Realm 3 shipped as 13 13 13 12 13 13 15 13 16 13 18 20 14 16 15 18 17 17 15 22
 * — a staircase with its steps out of order, where level 12 is harder than 14
 * and the player feels it.
 *
 * Curation generates a realm's twenty levels, MEASURES them, and orders them by
 * what they turned out to be: ascending, the hardest kept last, and one easy
 * level dropped back in at random inside the run so the climb has somewhere to
 * breathe. It is what makes a thousand levels read as one curve.
 */
export const TIERS = {
  /**
   * No capacity on the gates at all (`margin: null`). Nothing can be done
   * wrong: clearing a block only ever frees room. Reserved for the first realm,
   * where the player is learning what a gate is.
   */
  tutorial: {
    curated: true,
    margin: null,
    jokers: 0,
    colorSeal: false,
    minDrags: null,
  },

  /** Capacity arrives, with one slot of slack: a mistake is survivable. */
  gentle: {
    curated: true,
    margin: 1,
    jokers: 0,
    colorSeal: false,
    minDrags: null,
  },

  /**
   * Zero slack — the exit order has to be right. This is the game's baseline,
   * and the tier a realm gets when it names none.
   */
  steady: {
    curated: true,
    margin: 0,
    minDrags: null,
  },

  /** Baseline severity, with the grid filled harder and large pieces allowed. */
  dense: {
    curated: true,
    margin: 0,
    jokers: 1,
    colorSeal: false,
    minDrags: null,
  },

  /**
   * Grids arbitrated by the SOLVER: among the candidates, the one that forces
   * the most backtracking is kept. Costs seconds per level at build time, paid
   * once. `demandTarget` (states explored per block) stays on the realm — it is
   * what climbs from one realm to the next inside this tier.
   */
  demanding: {
    curated: true,
    margin: 0,
    largeShapes: true,
    colorSeal: true,
    key: true,
    minDrags: null,
  },

  /**
   * The last stretch. Narrow gates, no one-cell filler pieces, large shapes in
   * tight corridors. These ten realms all carried these seven values inline.
   */
  punishing: {
    curated: true,
    margin: 0,
    density: [0.22, 0.28],
    wideGateRatio: 0.12,
    minShapeSize: 2,
    largeShapes: true,
    colorSeal: true,
    key: true,
    jokers: 0,
    minDrags: null,
  },

  /**
   * For worlds past the thirtieth — the first tier to state a gesture floor.
   *
   * `[26, 30]` reads as: the realm's first level must need at least twenty-six
   * drags, its twentieth at least thirty, interpolated in between like every
   * other `[start, end]` pair. If the generator cannot reach it, the build says
   * so per level rather than shipping something easier than advertised.
   *
   * Why those numbers, and why the density is NOT `punishing`'s:
   *
   * Measured over the shipped database, the last ten realms sit at a median of
   * 21–23 drags — the level of realm 11, and below realm 13's 26. `punishing`
   * trades gestures for backtracking: its `[0.22, 0.28]` density and
   * `minShapeSize: 2` mean fewer, larger blocks, so fewer exits to play. That is
   * a defensible axis, but a realm inheriting it CANNOT clear a high floor —
   * the grid has no blocks left to spend.
   *
   * So the floor comes with the blocks to pay for it: density back up to
   * `[0.26, 0.32]`, near `dense`'s, while keeping the narrow gates and the
   * two-cell minimum that make the last stretch what it is.
   *
   * Both numbers are measured, not guessed. Run on realm 29 (9×11) this tier
   * lifts the median from 23 to 27 and the minimum from 19 to 26, and tops out
   * at 29 — a `[26, 34]` band produced exactly the same grids but reported
   * sixteen misses instead of eight, which is noise that hides real problems.
   * THIRTY IS THE CEILING OF A 9×11 GRID: a realm that wants more gestures needs
   * a bigger board, not a higher floor.
   */
  relentless: {
    margin: 0,
    density: [0.26, 0.32],
    wideGateRatio: 0.12,
    minShapeSize: 2,
    largeShapes: true,
    colorSeal: true,
    key: true,
    jokers: 0,
    demandTarget: 140,
    minDrags: [26, 30],
    /**
     * NO PARKING on this tier, and the measurement is why.
     *
     * Built as a real realm (10x12, 30-39 blocks) with `parking: [1, 1]`, the
     * generator delivered it on ZERO levels out of twenty. Dropping the density
     * to `[0.18, 0.23]` got one out of twenty — and cost the whole difficulty
     * gain, back to 22-29 gestures, the level of the realms already shipped.
     *
     * The two levers fight: a gesture floor wants blocks on the board, a park
     * wants an empty pocket to put one in. `injectParking` works on the lighter
     * realms — three grids in eight on realm 2 — and cannot work here, because
     * it moves a block into a finished grid and a finished dense grid has
     * nowhere free.
     *
     * Parking on a full board needs the walk itself to cross an earlier block,
     * so the generator lays the remaining pieces AROUND the park and leaves the
     * pocket on purpose. Until then this tier is the long, dense one, and
     * parking belongs to a lighter realm.
     */
    parking: null,
    /**
     * Twenty levels generated as a pool, measured, then ordered — see
     * `curateRealm`. The quantity ramps are honest but the RESULT scatters, and
     * on a realm built around a new mechanic a level that is easier than the one
     * before it reads as the mechanic failing rather than as luck.
     */
    curated: true,
  },
};

/** A realm's knobs, with its tier filling in whatever it does not spell out. */
export const resolve = (realm) => ({ ...(TIERS[realm.tier] || TIERS.steady), ...realm });
