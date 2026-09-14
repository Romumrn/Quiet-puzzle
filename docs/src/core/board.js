/**
 * BoardManager — equivalent of Scripts/Gameplay/BoardManager.cs (tech doc §5.1)
 *
 * A block puzzle where pieces must exit through coloured gates. The technical
 * document already called this win condition `AreAllDoorsComplete()`: here it is
 * actually implemented — the grid is solved when every movable block has left
 * through a gate of its colour.
 *
 * GOLDEN RULE: no DOM access whatsoever. Every gesture produces events
 * ({type:'move'|'exit'|'unlock'|'blocked'}) that render/boardView.js replays as
 * animation. That is what makes this logic testable under Node and its port to
 * C# mechanical.
 */

import { Block, KIND, MOVABLE, capacityCost, colorsOf } from './block.js';
import { GameState } from './gameState.js';

/** The four sides, with their exit vector. */
export const SIDES = Object.freeze({
  top: [0, -1],
  right: [1, 0],
  bottom: [0, 1],
  left: [-1, 0],
});

export class Board {
  /** @param {object} level  level object in the `GET /api/level/{n}` format */
  constructor(level) {
    this.level = level;
    this.W = level.width;
    this.H = level.height;
    this.gates = level.gates.map((g) => ({ ...g }));

    this.blocks = new Map();
    for (const data of level.blocks) this.blocks.set(data.id, new Block(data));

    this.movesRemaining = level.moveLimit;
    this.timeRemaining = level.timeLimit;
    this.exited = [];          // ids that left, in order
    this.gameState = GameState.PLAYING;

    this._occupancy = new Map();
    this._reindex();
  }

  // --- Grid occupancy ------------------------------------------------------

  _key(x, y) { return y * this.W + x; }

  _reindex() {
    this._occupancy.clear();
    for (const b of this.blocks.values()) {
      for (const [x, y] of b.absolute()) this._occupancy.set(this._key(x, y), b.id);
    }
  }

  blockAt(x, y) {
    const id = this._occupancy.get(this._key(x, y));
    return id === undefined ? null : this.blocks.get(id);
  }

  inside(x, y) { return x >= 0 && x < this.W && y >= 0 && y < this.H; }

  // --- Locking -------------------------------------------------------------

  /** A locked block stays locked until its condition is met. */
  conditionMet(block) {
    const c = block.condition;
    if (!c) return true;
    if (c.type === 'exits') return this.exited.length >= c.count;
    if (c.type === 'color') {
      for (const b of this.blocks.values()) if (b.color === c.color) return false;
      return true;
    }
    // A key: one specific block whose exit opens this lock.
    if (c.type === 'block') return this.exited.includes(c.id);
    return true;
  }

  canMove(block) {
    if (!block || !MOVABLE.has(block.kind)) return false;
    if (block.kind === KIND.LOCKED) return this.conditionMet(block);
    return true;
  }

  /** Does this block accept a move in this direction? */
  acceptsDirection(block, dx, dy) {
    if (block.kind === KIND.RAIL) return block.axis === 'h' ? dy === 0 : dx === 0;
    // An anchor has a single way to travel: towards its gate. It can therefore
    // never step aside to let anything through, which is the whole point.
    if (block.kind === KIND.ANCHOR && block.dir) {
      const [ax, ay] = SIDES[block.dir];
      return dx === ax && dy === ay;
    }
    return true;
  }

  /** How many blocks still have to exit before a lock opens. */
  remainingBeforeUnlock(block) {
    const c = block.condition;
    if (!c || c.type !== 'exits') return 0;
    return Math.max(0, c.count - this.exited.length);
  }

  /** Blocks that just unlocked — for the animation and the HUD. */
  _collectUnlocks() {
    const out = [];
    for (const b of this.blocks.values()) {
      if (b.kind !== KIND.LOCKED) continue;
      const met = this.conditionMet(b);
      if (met && !b._wasUnlocked) { b._wasUnlocked = true; out.push({ type: 'unlock', id: b.id }); }
      else if (!met) b._wasUnlocked = false;
    }
    return out;
  }

  // --- Movement ------------------------------------------------------------

  /**
   * Moves a block by one cell. If the step leaves the grid, attempts an exit
   * through a gate.
   * @returns {{ok:boolean, event?:object, reason?:string}}
   */
  step(id, dx, dy) {
    const block = this.blocks.get(id);
    if (!block) return { ok: false, reason: 'unknown' };
    if (this.gameState !== GameState.PLAYING) return { ok: false, reason: 'finished' };
    if (!this.canMove(block)) return { ok: false, reason: 'locked' };
    if (!this.acceptsDirection(block, dx, dy)) return { ok: false, reason: 'rail' };

    const target = block.absolute().map(([x, y]) => [x + dx, y + dy]);
    const leaves = target.some(([x, y]) => !this.inside(x, y));

    // Target cells that stay INSIDE the grid must be free, whether the block
    // exits or not. Without this check on the exit path, a block with a single
    // end reaching its gate went through it straight across the blocks that
    // were still in its way.
    if (!this.pathClear(block, dx, dy)) return { ok: false, reason: 'occupied' };

    if (leaves) {
      const gate = this._gateFor(block, dx, dy);
      if (!gate) return { ok: false, reason: 'wall' };
      return { ok: true, event: this._exit(block, gate, dx, dy) };
    }

    block.x += dx;
    block.y += dy;
    this._reindex();
    return { ok: true, event: { type: 'move', id, x: block.x, y: block.y } };
  }

  /**
   * Are the target cells still inside the grid free? A block does not go
   * through what stands in its way, even when part of it is already crossing
   * the gate.
   */
  pathClear(block, dx, dy) {
    for (const [x, y] of block.absolute()) {
      const nx = x + dx, ny = y + dy;
      if (!this.inside(nx, ny)) continue;
      const occupant = this._occupancy.get(this._key(nx, ny));
      if (occupant !== undefined && occupant !== block.id) return false;
    }
    return true;
  }

  /**
   * Can this block actually exit in this direction? Combines the gate AND the
   * path. This is the method the solver and the generator must use, so that
   * they see exactly what the engine sees.
   */
  exitPossible(block, dx, dy) {
    if (!this.acceptsDirection(block, dx, dy)) return null;
    if (!block.absolute().some(([x, y]) => !this.inside(x + dx, y + dy))) return null;
    if (!this.pathClear(block, dx, dy)) return null;
    return this._gateFor(block, dx, dy);
  }

  /**
   * Does this gate accept this block, on colour alone?
   *
   * A joker goes anywhere; otherwise it is enough that one of the block's
   * colours — a DUAL block carries two — meets one of the gate's colours — a
   * shared gate serves two. A single rule, borrowed by the solver and the
   * generator.
   */
  acceptsColor(gate, block) {
    if (block.kind === KIND.JOKER) return true;
    const gateColors = colorsOf(gate);
    return colorsOf(block).some((c) => gateColors.includes(c));
  }

  /**
   * The gate that would let this block out in this direction, or null.
   * The block must be flush against the wall AND fit entirely within the gate:
   * a shape two cells wide does not go through a one-cell gate.
   */
  _gateFor(block, dx, dy) {
    const side = dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'bottom' : 'top';

    const cells = block.absolute();
    const flush =
      side === 'right' ? Math.max(...cells.map((c) => c[0])) === this.W - 1 :
      side === 'left' ? Math.min(...cells.map((c) => c[0])) === 0 :
      side === 'bottom' ? Math.max(...cells.map((c) => c[1])) === this.H - 1 :
      Math.min(...cells.map((c) => c[1])) === 0;
    if (!flush) return null;

    const across = side === 'left' || side === 'right' ? block.rows() : block.cols();
    for (const gate of this.gates) {
      if (gate.side !== side || !this.acceptsColor(gate, block)) continue;
      // Saturated gate: it no longer accepts this block. A bulky block costs
      // double, and is therefore turned away by a gate that would accept its
      // ordinary twin — which is what makes it a routing problem.
      if (gate.capacity !== undefined && gate.capacity < capacityCost(block)) continue;
      const covers = across.every((v) => v >= gate.start && v < gate.start + gate.length);
      if (covers) return gate;
    }
    return null;
  }

  _exit(block, gate, dx, dy) {
    this.blocks.delete(block.id);
    this.exited.push(block.id);
    if (gate.capacity !== undefined) gate.capacity -= capacityCost(block);
    this._reindex();
    return { type: 'exit', id: block.id, gate, dx, dy, remaining: this.remaining() };
  }

  // --- Complete gesture ----------------------------------------------------

  /**
   * Advances a block towards a target position, cell by cell, preferring the
   * axis with the most travel left. This is the expected behaviour of a finger
   * drag: the block follows, works around obstacles if it can, and stops when
   * blocked.
   * @returns {{events:Array, exited:boolean}}
   */
  dragTowards(id, targetX, targetY, maxSteps = 24) {
    const events = [];
    for (let i = 0; i < maxSteps; i++) {
      const block = this.blocks.get(id);
      if (!block) break;
      const ex = targetX - block.x;
      const ey = targetY - block.y;
      if (ex === 0 && ey === 0) break;

      const attempts = Math.abs(ex) >= Math.abs(ey)
        ? [[Math.sign(ex), 0], [0, Math.sign(ey)]]
        : [[0, Math.sign(ey)], [Math.sign(ex), 0]];

      let advanced = false;
      for (const [dx, dy] of attempts) {
        if (dx === 0 && dy === 0) continue;
        const r = this.step(id, dx, dy);
        if (r.ok) { events.push(r.event); advanced = true; if (r.event.type === 'exit') return { events, exited: true }; break; }
      }
      if (!advanced) break;
    }
    return { events, exited: false };
  }

  /** Ends a gesture: spends a move if it actually shifted something. */
  endGesture(hasMoved) {
    const events = [];
    if (!hasMoved) return events;
    this.movesRemaining--;
    events.push(...this._collectUnlocks());
    this._settle(events);
    return events;
  }

  /** Time passing, called by the game loop (1 s). */
  tick(seconds = 1) {
    if (this.gameState !== GameState.PLAYING) return [];
    this.timeRemaining = Math.max(0, this.timeRemaining - seconds);
    const events = [];
    this._settle(events);
    return events;
  }

  // --- History and boosters ------------------------------------------------

  /**
   * Records a state for undo. A snapshot taken earlier may be passed in: the
   * caller photographs the board BEFORE attempting the gesture, then only
   * pushes it if the gesture actually succeeded — otherwise a blocked drag
   * would light up the "undo" button with nothing to undo.
   */
  remember(snap = null) {
    if (!this._history) this._history = [];
    this._history.push(snap || this.snapshot());
    if (this._history.length > 30) this._history.shift();
  }

  canUndo() { return !!this._history?.length; }

  /** "Undo" booster: goes back to the state before the last gesture. */
  undo() {
    const snap = this._history?.pop();
    if (!snap) return false;
    this.restore(snap);
    return true;
  }

  /** "Hammer" booster: removes a block without it having to reach its gate. */
  smash(id) {
    const block = this.blocks.get(id);
    if (!block || block.kind === KIND.WALL) return null;
    this.remember();
    this.blocks.delete(id);
    this.exited.push(id);
    this._reindex();
    const events = this._collectUnlocks();
    this._settle(events);
    return { type: 'smash', id, events, remaining: this.remaining() };
  }

  /** "Time" booster: extends the clock. */
  addTime(seconds) {
    this.timeRemaining += seconds;
  }

  // --- Snapshot ------------------------------------------------------------

  /**
   * Photographs the state of the blocks. Used to explore moves without playing
   * them (balancing measurements today, undo and hints tomorrow).
   */
  snapshot() {
    // The Block objects themselves are kept: a simulation may make a block
    // exit, and it must be possible to put it back afterwards.
    return {
      blocks: [...this.blocks.values()].map((b) => ({ b, x: b.x, y: b.y })),
      exited: [...this.exited],
      moves: this.movesRemaining,
      state: this.gameState,
      // Gate capacity is consumed: without it in the snapshot, an undo would
      // give the block back but not its room in the gate.
      capacities: this.gates.map((g) => g.capacity),
    };
  }

  restore(snap) {
    this.blocks.clear();
    for (const { b, x, y } of snap.blocks) { b.x = x; b.y = y; this.blocks.set(b.id, b); }
    this.exited = [...snap.exited];
    this.movesRemaining = snap.moves;
    this.gameState = snap.state;
    this.gates.forEach((g, i) => { g.capacity = snap.capacities[i]; });
    this._reindex();
  }

  /**
   * Next block to play, according to the reference solution.
   *
   * The player may have strayed from the canonical order: so rather than just
   * reading the solution, we VERIFY by simulation that the suggested block can
   * really exit in the current state of the grid. That is what makes the hint
   * reliable — and therefore sellable.
   *
   * @returns {{id:number, gate:string, path:Array}|null}
   */
  hint() {
    // Level written in the editor: no reference solution, so ask the solver.
    if (!this.level.solution?.length) {
      const { solve } = this._solver || {};
      if (!solve) return null;
      const r = solve(this);
      return r.solvable ? { id: r.order[0], gate: null, path: [] } : null;
    }
    for (const step of this.level.solution) {
      const block = this.blocks.get(step.id);
      if (!block || !this.canMove(block)) continue;

      const rawPath = Array.isArray(step.path) ? step.path : Array.isArray(step.chemin) ? step.chemin : [];
      if (!rawPath.length) continue;

      const snap = this.snapshot();
      for (const pos of rawPath.slice(1)) this.dragTowards(step.id, pos.x, pos.y);
      let leaves = !this.blocks.has(step.id);
      if (!leaves) {
        const [dx, dy] = SIDES[step.gate];
        leaves = this.step(step.id, dx, dy).ok;
      }
      this.restore(snap);
      if (leaves) return { id: step.id, gate: step.gate, path: rawPath };
    }
    return null;
  }

  // --- End of level --------------------------------------------------------

  /** Blocks still to be cleared (walls do not count). */
  remaining() {
    let n = 0;
    for (const b of this.blocks.values()) if (b.kind !== KIND.WALL) n++;
    return n;
  }

  isSolved() { return this.remaining() === 0; }

  _settle(events) {
    if (this.isSolved()) { this.gameState = GameState.WON; return; }
    if (this.movesRemaining <= 0) { this.gameState = GameState.FAILED; this.failReason = 'moves'; return; }
    if (this.timeRemaining <= 0) { this.gameState = GameState.FAILED; this.failReason = 'time'; }
  }

  /** Drags actually spent since the start of the level. */
  dragsUsed() { return this.level.moveLimit - this.movesRemaining; }

  /**
   * 0 to 3 stars. 1★ = level solved; 2★ and 3★ measure how economical the
   * player was compared to the reference solution (`starDrags`). The clock and
   * the move limit remain defeat conditions, not grading scales: mixing the two
   * made the grade unreadable.
   */
  stars() {
    if (!this.isSolved()) return 0;
    const [for3, for2] = this.level.starDrags;
    const used = this.dragsUsed();
    if (used <= for3) return 3;
    if (used <= for2) return 2;
    return 1;
  }
}
