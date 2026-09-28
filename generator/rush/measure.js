/**
 * How many gestures a reference solution really takes — what the star
 * thresholds and the move limit are computed from.
 */

import { Board } from '../../prototype/src/core/board.js';
import { KIND } from '../../prototype/src/core/block.js';

const EXIT_VECTORS = { right: [1, 0], left: [-1, 0], bottom: [0, 1], top: [0, -1] };

/**
 * Number of GESTURES actually needed to solve the level.
 *
 * It cannot be deduced from the turns in the path: a finger following an
 * L-shaped track turns the block in a single drag, the engine advancing cell by
 * cell towards the target position. Counting direction changes therefore
 * overestimated the cost by 60 %, and the star thresholds became unreachable
 * the other way round — everybody got 3★.
 *
 * So we measure: for each block, we look for the furthest point on its path
 * reachable in a single gesture, play it, and start again.
 */
export function measureGestures(base) {
  const b = new Board({ ...base, moveLimit: 9999, timeLimit: 9999, starDrags: [0, 0] });
  const kindOf = new Map((base.blocks || []).map((x) => [x.id, x.kind]));
  let gestures = 0;

  for (const step of base.solution) {
    /**
     * A SLIDER is ONE gesture, whatever its route.
     *
     * It cannot be stopped in mid-run, so there is nothing to count: the finger
     * goes down, the block goes until something catches it, the finger lifts.
     * The waypoint search below assumes a block can be halted anywhere along its
     * path and, faced with one that cannot, falls back on its "advance one
     * notch" safety over and over — measured at 40 to 52 gestures on levels that
     * really take a little under thirty. That number sets the star thresholds
     * and the move limit, so overcounting it hands the player three stars for
     * nothing.
     */
    if (kindOf.get(step.id) === KIND.SLIDE) {
      const last = step.path[step.path.length - 1];
      b.dragTowards(step.id, last.x, last.y);
      if (step.gate && b.blocks.has(step.id)) {
        const [dx, dy] = EXIT_VECTORS[step.gate];
        b.step(step.id, dx, dy);
      }
      gestures++;
      b.endGesture(true);
      continue;
    }

    const path = step.path;
    const last = path.length - 1;
    let pos = 0;
    let guard = 0;

    while (pos < last && guard++ < 40) {
      let reached = pos;
      for (let j = last; j > pos; j--) {
        const snap = b.snapshot();
        b.dragTowards(step.id, path[j].x, path[j].y);
        const block = b.blocks.get(step.id);
        const ok = block && block.x === path[j].x && block.y === path[j].y;
        b.restore(snap);
        if (ok) { reached = j; break; }
      }
      if (reached === pos) reached = pos + 1; // safety: advance one notch
      b.dragTowards(step.id, path[reached].x, path[reached].y);
      gestures++;
      pos = reached;
    }

    /**
     * A step with NO GATE is a PARK: the block is moved somewhere it does not
     * leave from, to free the way for another. The drags above already counted
     * it; there is simply no exit to extend them with.
     *
     * `gate: null` rather than a `type` field on purpose — every step written
     * before parking existed carries a gate, so the whole shipped database
     * stays valid unread, and this is the only line that had to learn the
     * difference.
     */
    if (step.gate && b.blocks.has(step.id)) {
      // The exit extends the last drag: the finger does not lift.
      const [dx, dy] = EXIT_VECTORS[step.gate];
      if (b.step(step.id, dx, dy).ok && pos === 0) gestures++;
    }
    b.endGesture(true);
  }
  return Math.max(base.solution.length, gestures);
}
