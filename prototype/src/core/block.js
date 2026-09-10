/**
 * Block — equivalent of Scripts/Gameplay/BlockController.cs (tech doc §4)
 *
 * Pure data, no DOM access. A block is a polyomino: a list of relative cells, a
 * colour, and an origin position on the grid.
 */

/**
 * Nature of a block. The last few kinds are the game's "effects"; they reuse
 * proven mechanics of the genre rather than inventing new ones:
 *
 *  - RAIL   : a block mounted on a slide, which only moves along one axis. This
 *             is the Rush Hour mechanic, and by far the most effective way to
 *             create difficulty without adding a rule to explain.
 *  - JOKER  : a multicoloured block that exits through any gate. Acts as a
 *             relief valve: it loosens an over-constrained grid.
 *  - LOCKED : a block sealed until N blocks have exited. The condition is a
 *             plain countdown, printed on the block — the player must be able
 *             to read what will open it rather than guess.
 *  - ANCHOR : a block that only advances TOWARDS its gate, never backwards nor
 *             sideways. A rail forbids one axis, an anchor forbids three
 *             directions out of four: you cannot shove it aside to clear a
 *             path, you have to go around.
 *  - BULKY  : a block that consumes TWICE its size from its gate's capacity. It
 *             changes nothing about movement and everything about routing: the
 *             gate that takes it closes on the others.
 *  - DUAL   : a two-coloured block, which exits through either of its two
 *             colours. Where the joker opens every gate, this one opens exactly
 *             one more — enough to offer a choice, not enough to spare the
 *             player from choosing.
 *
 * Each realm introduces only one of them (see REALMS in levels.js). A block
 * kind never seen before must be learnable on an otherwise familiar grid,
 * otherwise the player cannot tell what the difficulty comes from.
 */
export const KIND = Object.freeze({
  NORMAL: 'normal',
  WALL: 'wall',
  LOCKED: 'locked',
  RAIL: 'rail',
  JOKER: 'joker',
  ANCHOR: 'anchor',
  BULKY: 'bulky',
  DUAL: 'dual',
});

/** Kinds a player can grab (walls, no). */
export const MOVABLE = new Set([
  KIND.NORMAL, KIND.LOCKED, KIND.RAIL, KIND.JOKER, KIND.ANCHOR, KIND.BULKY,
  KIND.DUAL,
]);

/**
 * The colours a gate accepts, or that a block carries.
 *
 * A shared gate serves two, a dual block carries two: in both cases `colors`
 * complements `color`. Going through this function rather than reading `color`
 * directly is what lets the engine, the solver and the generator agree — a
 * single one of them forgetting it would produce impossible levels, or let a
 * block exit where it should not.
 */
export function colorsOf(target) {
  return target.colors?.length ? target.colors : [target.color];
}

/**
 * What this block costs the gate that swallows it, in capacity cells.
 *
 * Shared by the engine, the solver and the generator: this is the only way to
 * guarantee all three count the same thing. A generator that provisioned less
 * than what the engine consumes would produce impossible levels, and the player
 * would have no way to see it coming.
 */
export function capacityCost(block) {
  return block.cells.length * (block.kind === KIND.BULKY ? 2 : 1);
}

/**
 * Palette. The glyph is not decorative: it — not the hue — is what identifies a
 * family. It never changes, whereas the colours change with every realm.
 *
 * Gates used to carry it too, which gave block/gate matching without relying on
 * colour. Gates now display the exit DIRECTION (▲▶▼◀) instead; matching
 * therefore goes through the hue, and the colour name stays in the gate's
 * tooltip.
 */
export const COLORS = Object.freeze([
  { id: 0, name: 'Ruby', glyph: '●' },
  { id: 1, name: 'Sapphire', glyph: '◆' },
  { id: 2, name: 'Emerald', glyph: '▲' },
  { id: 3, name: 'Amber', glyph: '★' },
  { id: 4, name: 'Amethyst', glyph: '■' },
  { id: 5, name: 'Topaz', glyph: '⬢' },
]);

/**
 * Available shapes. `cells` lists the relative cells; `w`/`h` the bounding box.
 * A shape can only exit through a gate at least as wide as its footprint
 * perpendicular to the exit.
 */
export const SHAPES = Object.freeze([
  { key: 'i1', cells: [[0, 0]] },
  { key: 'i2h', cells: [[0, 0], [1, 0]] },
  { key: 'i2v', cells: [[0, 0], [0, 1]] },
  { key: 'i3h', cells: [[0, 0], [1, 0], [2, 0]] },
  { key: 'i3v', cells: [[0, 0], [0, 1], [0, 2]] },
  { key: 'o4', cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { key: 'l3a', cells: [[0, 0], [0, 1], [1, 1]] },
  { key: 'l3b', cells: [[1, 0], [0, 1], [1, 1]] },
  { key: 'l3c', cells: [[0, 0], [1, 0], [0, 1]] },
  { key: 'l3d', cells: [[0, 0], [1, 0], [1, 1]] },
  { key: 't4', cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  // Large shapes: reserved for advanced realms (see LARGE_SHAPES and
  // `largeShapes` in REALMS, src/core/levels.js) — on a small grid a 4-cell bar
  // or a 6-cell slab takes up a whole row on its own.
  { key: 'i4h', cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { key: 'i4v', cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
  { key: 'r6h', cells: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]] },
  { key: 'r6v', cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]] },
].map((s) => ({
  ...s,
  w: Math.max(...s.cells.map((c) => c[0])) + 1,
  h: Math.max(...s.cells.map((c) => c[1])) + 1,
})));

/** Keys of the shapes reserved for advanced realms — see `largeShapes`. */
export const LARGE_SHAPES = new Set(['i4h', 'i4v', 'r6h', 'r6v']);

let nextId = 1;

export class Block {
  /** @param {{id?, color, colors?, cells, x, y, kind?, axis?, dir?, isKey?, condition?}} data */
  constructor(data) {
    this.id = data.id ?? nextId++;
    this.color = data.color;
    this.cells = data.cells.map(([dx, dy]) => [dx, dy]);
    this.x = data.x;
    this.y = data.y;
    this.kind = data.kind || KIND.NORMAL;
    /**
     * Axis a RAIL block is allowed to move along: 'h' (horizontal) or 'v'
     * (vertical).
     */
    this.axis = data.axis || null;
    /**
     * Direction an ANCHOR block is allowed to move in: 'top' | 'right' |
     * 'bottom' | 'left'. It is the direction of its gate, and the arrow drawn
     * on the block says so.
     */
    this.dir = data.dir || null;
    /**
     * Extra colours of a DUAL block. `color` stays the first one: it gives the
     * block its main hue and is used everywhere a single colour is enough.
     */
    this.colors = data.colors ? [...data.colors] : null;
    /**
     * This block is the level's KEY: its exit opens every lock waiting on it
     * (`condition: { type: 'block', id }`). The flag only exists to display it
     * — the rule itself lives in the locks' condition.
     */
    this.isKey = data.isKey === true;
    /**
     * Unlock condition of a LOCKED block. Two forms:
     *   { type: 'exits', count: n }  — n blocks must have exited
     *   { type: 'color', color: c }  — colour c must have left the grid
     *
     * The countdown is read off the block. The colour condition was long
     * dismissed as unguessable — the player does not know how many blocks of
     * that colour remain — until the block started carrying the glyph of the
     * expected colour: counting what is on screen is then enough. It only shows
     * up in the last realm, once the countdown form has been learnt.
     */
    this.condition = data.condition || null;
  }

  /** Absolute cells occupied on the grid. */
  absolute() {
    return this.cells.map(([dx, dy]) => [this.x + dx, this.y + dy]);
  }

  get width() { return Math.max(...this.cells.map((c) => c[0])) + 1; }
  get height() { return Math.max(...this.cells.map((c) => c[1])) + 1; }

  /** Rows (resp. columns) covered — used to test passage through a gate. */
  rows() { return [...new Set(this.cells.map((c) => this.y + c[1]))]; }
  cols() { return [...new Set(this.cells.map((c) => this.x + c[0]))]; }

  clone() {
    return new Block({ id: this.id, color: this.color, cells: this.cells, x: this.x, y: this.y,
                       kind: this.kind, axis: this.axis, dir: this.dir,
                       colors: this.colors, isKey: this.isKey, condition: this.condition });
  }
}

export function resetBlockIds() { nextId = 1; }
