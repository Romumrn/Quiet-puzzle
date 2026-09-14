/**
 * Difficulty ramps and limit formulas — the whole progression, in one file.
 *
 * `curve(n)` says WHAT to produce for level `n`: sizes, quantities, margins.
 * `limitsFor(n, grid)` says how tight the level is once its grid exists: star
 * thresholds, move limit, time limit.
 *
 * Everything comes from the realm table. A realm fixes the setting and the
 * ceilings; the position WITHIN the realm fixes the quantities — `t` is 0 at
 * the realm's first level and 1 at its twentieth, and every `[start, end]`
 * interval is read at that point.
 */

import { SHAPES, LARGE_SHAPES, KIND } from '../prototype/src/core/block.js';
import { starThresholds } from '../prototype/src/core/stars.js';
import { LEVELS_PER_REALM, TOTAL_LEVELS, realmOf } from './realms.js';
import { resolve } from './tiers.js';

/**
 * Difficulty curve: what the generator must produce for level `n`.
 *
 * Everything comes from the REALMS table. The realm fixes the setting and the
 * ceilings, the position WITHIN the realm fixes the quantities: `t` is 0 at the
 * realm's first level and 1 at its twentieth, and every `[start, end]` interval
 * is read at that point. A mechanic therefore arrives drop by drop — one anchor
 * at level 101, six at level 120 — instead of landing all at once when the
 * realm changes.
 */
export function curve(n) {
  // The realm's own fields, over the defaults of the tier it names. A realm
  // that spells a value out always wins over its tier — that is what let the
  // tiers be introduced without moving a published grid.
  const R = resolve(realmOf(n));
  const rank = (n - 1) % LEVELS_PER_REALM;                 // 0 … 19
  const t = LEVELS_PER_REALM > 1 ? rank / (LEVELS_PER_REALM - 1) : 0;
  const ramp = ([a, b]) => Math.round(a + (b - a) * t);

  // DENSITY makes the difficulty, not path length: an isolated block always
  // reaches its gate in a single drag. What makes you think is that blocks get
  // in each other's way and impose an exit order. So we aim for a well-filled
  // grid (55 to 70 % of cells occupied).
  //
  // The block count is derived from the AREA rather than from an absolute ramp:
  // that is the only way to get a grid as full at a realm's first level as at
  // the previous realm's last one, when the grid has just grown. A shape
  // averages 2.3 cells, hence the coefficients.
  const [lowDensity, highDensity] = R.density || [0.24, 0.33];
  const minShapeSize = R.minShapeSize ?? 1;
  // Four-cell bar, six-cell slab: reserved for the realms that announce them —
  // on a small grid, a single such piece blocks a whole row.
  const largeShapes = R.largeShapes === true;
  const shapeAllowed = (f) => largeShapes || !LARGE_SHAPES.has(f.key);

  // The block count is derived from the AREA, but it has to be corrected by the
  // SIZE of the available pieces: forbidding one-cell pieces raises the average,
  // and aiming for the same count amounted to asking for a grid 97 % full — the
  // generator could not manage it and the level became unfindable. The same
  // correction applies to large shapes when a realm excludes them: without it,
  // their mere presence in `SHAPES` would have skewed the density calibration
  // of every realm that does not use them.
  const meanSize = (min) => {
    const available = SHAPES.filter((f) => f.cells.length >= min && shapeAllowed(f));
    return available.reduce((sum, f) => sum + f.cells.length, 0) / available.length;
  };
  const correction = meanSize(1) / meanSize(minShapeSize);
  const blockCount = Math.round(
    R.W * R.H * (lowDensity + (highDensity - lowDensity) * t) * correction);


  return {
    W: R.W, H: R.H, colorCount: R.colorCount, gateCount: R.gateCount,
    walls: ramp(R.walls),
    locks: ramp(R.locks),
    rails: ramp(R.rails),
    anchors: ramp(R.anchors),
    bulky: ramp(R.bulky),
    duals: ramp(R.duals || [0, 0]),
    sharedGates: ramp(R.sharedGates || [0, 0]),
    // Share of three-cell gates, and minimum shape size: two levers that cost
    // the engine nothing and tighten the grid a great deal.
    wideGateRatio: R.wideGateRatio ?? 0.35,
    minShapeSize: R.minShapeSize ?? 1,
    largeShapes,
    key: R.key === true,
    // A "demanding" realm has its grids arbitrated by the solver: we keep the
    // one that requires the most backtracking rather than the densest one.
    // Expensive — a few seconds per level — so it is reserved for the realms
    // that make it their subject, and paid once at build time.
    demanding: R.demanding === true || R.demandTarget > 0,
    /**
     * States explored per block to reach before the search stops looking.
     *
     * This is the ONLY lever that still scales. Grid, colours, gates, block
     * kinds: everything is at its playable maximum, and piling on quantities
     * would only fill space. A target that rises from one realm to the next, on
     * the other hand, asks for grids where you go wrong more and more often
     * before finding the way — and that is exactly what "thinking" means here.
     */
    demandTarget: R.demandTarget ?? 12,
    /**
     * MINIMUM number of gestures the reference solution must need.
     *
     * The one lever that states the intent instead of approximating it. Every
     * other knob asks for a grid that looks hard — more blocks, tighter gates,
     * bigger pieces — and none of them promises the level takes more than one
     * pass to solve. A grid that comes out under this floor is rejected in
     * `build()`, whatever its density or its score.
     *
     * 0 = no floor, which is every realm published so far: switching one on
     * changes which candidate is kept, hence the grid, hence the star
     * thresholds and the records already set against them.
     */
    minDragsFloor: R.minDrags ? ramp(R.minDrags) : 0,
    jokers: R.jokers,
    blockCount,
    /**
     * Length of the backward walk, indexed on the REALM and not on how far the
     * player is through the whole game.
     *
     * It used to be: `11 + 5 × (n / TOTAL_LEVELS)`. Adding realms then changed
     * the walk-back of EVERY already-published level — hence their grid, hence
     * players' records. A quantity that decides the shape of a grid must depend
     * only on its realm, never on the length of the game.
     */
    walkBack: R.walkBack || [6, 11 + Math.min(5, R.id)],
    // `margin` is the slack granted to capacity gates, on top of what the
    // reference solution routes through them. Without capacity, no exit order
    // can be a bad one — clearing a block only frees up room — and the level
    // solves itself on the first try whatever the method. Capacity is the only
    // lever that creates a real puzzle; the shrinking margin tunes its severity,
    // down to zero in the last realm.
    capacity: R.margin !== null,
    margin: R.margin ?? 0,
    colorSeal: R.colorSeal,
  };
}

/**
 * How tight level `n` is, once its grid is known.
 *
 * Extracted from `getLevel` so that every number a player feels — the grade
 * scale and the two limits — is decided in the same file as the ramps that
 * shaped the grid. Tuning a tier means reading one file, not two.
 */
export function limitsFor(n, g) {
  // Margins tighten across the WHOLE progression, not over its first twenty
  // levels: indexed on an absolute number, this factor bottomed out before the
  // end of the first realm and had nothing left to give afterwards. Tightening
  // pushed to the maximum: up to 60 % less at the last level, so that failure —
  // and the offer to continue in exchange for an ad — becomes frequent again
  // even late in the game.
  const tighten = 1 - 0.6 * ((n - 1) / (TOTAL_LEVELS - 1));

  const starDrags = starThresholds(g.minDrags);

  /**
   * The move limit is a SAFETY NET, not a grading scale — the clock carries the
   * tension. So it sits above the 2★ threshold: below it, a laborious player
   * lost instead of earning a star, and the result screen promised a grade no
   * play-through could reach. The floor (`+1`) is the minimum that keeps that
   * threshold reachable: the margin is trimmed to the strict minimum so failure
   * punishes the slightest wasted gesture rather than comfortably absorbing
   * trial and error.
   */
  const moveLimit = starDrags[1] + Math.max(1, Math.round(g.minDrags * 0.15 * tighten));

  // Time plays on thinking, not on the number of gestures: it is sized on the
  // number of blocks to clear. Tightened to the maximum, but never below 3
  // seconds per drag of the reference solution — under that it is no longer a
  // tight time, it is a time no finger can hold whatever the skill level.
  // `tools/balance.mjs` checks this floor across the whole database.
  const playable = g.blocks.filter((b) => b.kind !== KIND.WALL).length;
  const timeLimit = Math.max(3 * g.minDrags,
    Math.min(120, Math.max(25, Math.round((playable * 4 + 8) * tighten / 5) * 5)));

  return { starDrags, moveLimit, timeLimit, playable };
}
