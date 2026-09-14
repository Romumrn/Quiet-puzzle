/**
 * BoardView — equivalent of Scripts/Animation/BlockAnimator.cs + VFXManager.cs
 *
 * The only module allowed to touch the board's DOM. It decides nothing: it
 * replays the events produced by core/board.js.
 *
 * Blocks are polyominoes: each cell carries a corner radius computed from its
 * neighbours, which gives a single merged shape rather than a string of
 * squares.
 */

import { COLORS, KIND, colorsOf } from '../core/block.js';
import { t, colorName } from '../ui/i18n.js';

/**
 * Accessibility option: the player asked for the family symbols.
 *
 * The six colours are normally told apart by hue alone; this flag gives them
 * their glyph back, on blocks as well as on gates. We read it off the DOM
 * rather than passing it as a parameter on every call: the board is fully
 * redrawn when the option changes, and a single place decides.
 */
const withGlyphs = () => document.getElementById('app')?.classList.contains('with-glyphs');

/** Fraction of a cell beyond which a grab reaches into the neighbouring cell. */
const GRAB_MARGIN = 0.22;

const BASE_TIMING = { MOVE: 95, POP: 130, EXIT: 300, UNLOCK: 420, BUMP: 130 };
export const TIMING = { ...BASE_TIMING };

export function setSpeed(multiplier) {
  for (const k of Object.keys(BASE_TIMING)) TIMING[k] = Math.max(1, Math.round(BASE_TIMING[k] * multiplier));
  return TIMING;
}
if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setSpeed(0.15);

/**
 * Animation wait. In the background we do not wait: the logic of the move is
 * already resolved, only the display is left to lay down. Without this
 * short-circuit, coming back to the app would replay the whole animation in
 * slow motion (browsers throttle hidden pages' timers to one second minimum).
 */
const wait = (ms) => (document.hidden ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

/** Exit direction, as shown on the gate. */
const ARROWS = { top: '▲', right: '▶', bottom: '▼', left: '◀' };

/**
 * Padlock for a key lock.
 *
 * Drawn, not 🔒: the emoji lands in bright yellow in the middle of a pastel
 * palette and becomes the first place the eye falls. It replaces the ◈ diamond
 * that echoed the key's — an abstract symbol you had to have learnt, where a
 * padlock says "shut" without teaching anything. The key keeps its diamond:
 * that is what distinguishes it from what it opens.
 */
const PADLOCK_SVG = `<svg class="padlock" viewBox="0 0 20 20" aria-hidden="true">
  <path d="M6.7 9V6.6a3.3 3.3 0 0 1 6.6 0V9" fill="none" stroke-width="2" stroke-linecap="round"/>
  <rect x="3.9" y="8.7" width="12.2" height="9.1" rx="2.8"/>
  <circle cx="10" cy="12.6" r="1.45"/>
</svg>`;

export class BoardView {
  constructor(root) {
    this.root = root;
    this.wrap = root.parentElement;
    this.gateLayer = root.querySelector('.gate-layer');
    this.blockLayer = root.querySelector('.block-layer');
    this.fxLayer = root.querySelector('.fx-layer');
    this.gridLayer = root.querySelector('.grid-layer');
    this.nodes = new Map(); // id -> element
    this.board = null;
    this.cell = 0;

    this._ro = new ResizeObserver(() => this.layout());
    this._ro.observe(this.wrap);
  }

  destroy() { this._ro.disconnect(); }

  // --- Layout --------------------------------------------------------------

  layout() {
    if (!this.board) return;
    const { W, H } = this.board;
    const wall = 14;
    const availW = this.wrap.clientWidth - 2 * wall - 6;
    const availH = this.wrap.clientHeight - 2 * wall - 6;
    const cell = Math.max(24, Math.floor(Math.min(availW / W, availH / H)));

    this.cell = cell;
    this.root.style.setProperty('--cell', `${cell}px`);
    this.root.style.setProperty('--wall', `${wall}px`);
    this.root.style.width = `${cell * W}px`;
    this.root.style.height = `${cell * H}px`;

    for (const [id, node] of this.nodes) {
      const b = this.board.blocks.get(id);
      if (b) this._place(node, b.x, b.y);
    }
    this._drawGates();
  }

  _place(node, x, y) {
    node.style.transform = `translate3d(${x * this.cell}px, ${y * this.cell}px, 0)`;
  }

  // --- Mounting ------------------------------------------------------------

  mount(board) {
    this.board = board;
    this.nodes.clear();
    this.blockLayer.replaceChildren();
    this.gateLayer.replaceChildren();
    this.gridLayer.replaceChildren();
    this.fxLayer.replaceChildren();

    this.layout();

    // Chequered background: a visual guide for anticipating moves.
    for (let y = 0; y < board.H; y++) {
      for (let x = 0; x < board.W; x++) {
        const c = document.createElement('div');
        c.className = 'grid-cell';
        this.gridLayer.appendChild(c);
        this._place(c, x, y);
      }
    }

    for (const b of board.blocks.values()) this._createBlock(b);
    this._drawGates();
  }

  _drawGates() {
    if (!this.board) return;
    this.gateLayer.replaceChildren();
    for (const g of this.board.gates) {
      const el = document.createElement('div');
      const shared = colorsOf(g).length > 1;
      el.className = `gate gate-${g.side} c${g.color}` + (shared ? ' gate-shared' : '');
      // Shared gate: the second colour goes into a variable, and the CSS
      // gradient shows both families it accepts.
      if (shared) el.style.setProperty('--c-alt', `var(--c${colorsOf(g)[1]})`);
      const length = `${g.length * this.cell}px`;
      const start = `${g.start * this.cell}px`;
      if (g.side === 'top' || g.side === 'bottom') { el.style.left = start; el.style.width = length; }
      else { el.style.top = start; el.style.height = length; }
      // An arrow pointing OUTWARDS, the way blocks leave the grid. The colour
      // glyph used to sit here, mirrored exactly on the blocks, and served to
      // match block and gate without relying on colour; it is still carried by
      // the blocks, and the matching aid has moved to the gate's tooltip (see
      // `title`).
      const arrow = document.createElement('span');
      arrow.className = 'gate-arrow';
      // The glyph precedes the arrow, not the other way round: the glyph is
      // what identifies the gate, the arrow only recalls the exit direction.
      arrow.textContent = (withGlyphs()
        ? colorsOf(g).map((c) => COLORS[c]?.glyph ?? '').join('')
        : '') + ARROWS[g.side];
      el.appendChild(arrow);
      el.title = t('gate.exit', { color: colorsOf(g).map(colorName).join(' / ') });

      // A gate with limited capacity MUST show what it has left: an invisible
      // constraint reads like a bug, not like a rule.
      if (g.capacity !== undefined) {
        const gauge = document.createElement('b');
        gauge.className = 'gate-cap';
        gauge.textContent = g.capacity;
        el.appendChild(gauge);
      }
      this.gateLayer.appendChild(el);
    }
  }

  _createBlock(b) {
    const node = document.createElement('div');
    node.className = `block k-${b.kind}`
      + (b.isKey ? ' is-key' : '')
      + (b.color >= 0 && b.kind !== KIND.JOKER ? ` c${b.color}` : '')
      + (b.kind === KIND.RAIL ? ` axis-${b.axis}` : '')
      + (b.kind === KIND.ANCHOR ? ` dir-${b.dir}` : '');
    node.dataset.id = b.id;
    // Dual block: its second colour feeds the gradient that sets it apart.
    if (b.kind === KIND.DUAL) node.style.setProperty('--c-alt', `var(--c${colorsOf(b)[1]})`);
    node.style.width = `${b.width * this.cell}px`;
    node.style.height = `${b.height * this.cell}px`;

    const has = (dx, dy) => b.cells.some(([p, q]) => p === dx && q === dy);
    for (const [dx, dy] of b.cells) {
      const c = document.createElement('i');
      c.className = 'block-cell';
      c.style.left = `${dx * this.cell}px`;
      c.style.top = `${dy * this.cell}px`;
      // The highlight is anchored on the BLOCK'S BOX, not on the cell: each
      // cell shows only its own portion, and the whole shape looks like one
      // piece.
      c.style.backgroundSize = `${b.width * this.cell}px ${b.height * this.cell}px`;
      c.style.backgroundPosition = `${-dx * this.cell}px ${-dy * this.cell}px`;
      // The four sides ACTUALLY outside the shape, marked on the cell. That is
      // what lets the styles light and shade only the polyomino's silhouette:
      // an interior edge must draw nothing, otherwise the block breaks back
      // into little squares.
      if (!has(dx, dy - 1)) c.classList.add('e-t');
      if (!has(dx, dy + 1)) c.classList.add('e-b');
      if (!has(dx - 1, dy)) c.classList.add('e-l');
      if (!has(dx + 1, dy)) c.classList.add('e-r');
      // Rounded corners only where they are genuinely outside the shape.
      const r = 'var(--bevel)';
      c.style.borderTopLeftRadius = !has(dx, dy - 1) && !has(dx - 1, dy) ? r : '0';
      c.style.borderTopRightRadius = !has(dx, dy - 1) && !has(dx + 1, dy) ? r : '0';
      c.style.borderBottomLeftRadius = !has(dx, dy + 1) && !has(dx - 1, dy) ? r : '0';
      c.style.borderBottomRightRadius = !has(dx, dy + 1) && !has(dx + 1, dy) ? r : '0';
      node.appendChild(c);
    }

    // A block only carries a mark if that mark says something about its
    // behaviour: padlock, weight, joker. Colour alone identifies its gate — the
    // family glyphs (●◆▲★■⬢) cluttered it without teaching anything to someone
    // already playing by colour.
    const glyph = withGlyphs() && b.color >= 0 && b.kind !== KIND.WALL && b.kind !== KIND.JOKER;
    const hasMark = glyph || b.isKey
      || b.kind === KIND.LOCKED || b.kind === KIND.BULKY || b.kind === KIND.JOKER;
    if (hasMark) {
      const mark = document.createElement('span');
      mark.className = 'block-mark';
      const [mx, my, mw, mh] = this._markBox(b);
      mark.style.left = `${mx}px`;
      mark.style.top = `${my}px`;
      mark.style.width = `${mw}px`;
      mark.style.height = `${mh}px`;
      if (b.kind === KIND.LOCKED) {
        // What the lock is waiting for: a padlock if it waits for the key, a
        // dot of the colour it watches, a countdown otherwise. `_updateLock`
        // chooses, and refreshes it on every block cleared.
        mark.innerHTML = '<b class="lock-count"></b>';
      } else if (b.kind === KIND.BULKY) {
        // What this block will cost its gate, written on it: without the
        // figure, a bulky block looks like an ordinary one and the player
        // cannot anticipate which gate it is about to saturate.
        mark.classList.add('weight-mark');
        mark.innerHTML = (glyph ? `<span>${COLORS[b.color].glyph}</span>` : '') + '<b>×2</b>';
      } else if (b.kind === KIND.JOKER) {
        mark.textContent = '✳';
      } else if (b.isKey) {
        // The key carries its mark even without the "symbols" option: it is a
        // rule of the level, not a colour-reading aid. A diamond rather than a
        // key emoji, in the same register as the rest of the board.
        mark.textContent = '◈';
      } else {
        mark.textContent = colorsOf(b).map((c) => COLORS[c].glyph).join('');
      }
      node.appendChild(mark);
    }

    // Rail: a bar running right through, saying at a glance which axis the
    // block can travel along.
    if (b.kind === KIND.RAIL) {
      const rail = document.createElement('u');
      rail.className = 'block-rail';
      node.appendChild(rail);
    }

    // Anchor: an arrow towards its gate. The rail shows an axis and reads both
    // ways; the anchor has only one, and that is precisely what sets it apart —
    // so the mark must point, not cross.
    if (b.kind === KIND.ANCHOR) {
      const arrow = document.createElement('u');
      arrow.className = 'block-arrow';
      arrow.textContent = ARROWS[b.dir] || '';
      // Same anchor point as the marks — using the block's box put an L's arrow
      // in the hollow of its angle, hence outside the shape. An anchor can also
      // be the level's key: the arrow then retreats into a corner so as not to
      // cover the diamond.
      if (hasMark) {
        arrow.classList.add('arrow-corner');
      } else {
        const [fx, fy, fw, fh] = this._markBox(b);
        arrow.style.left = `${fx}px`;
        arrow.style.top = `${fy}px`;
        arrow.style.width = `${fw}px`;
        arrow.style.height = `${fh}px`;
      }
      node.appendChild(arrow);
    }

    if (b.kind === KIND.LOCKED) this._updateLock(node, b);

    this._place(node, b.x, b.y);
    this.blockLayer.appendChild(node);
    this.nodes.set(b.id, node);
    return node;
  }

  /**
   * Where to put a mark: `[left, top, width, height]` in pixels.
   *
   * On the BLOCK'S BOX as soon as its centre falls inside the shape — a "×2" or
   * a padlock centred on a CELL read crooked on any block with several of them.
   * An L or a T, whose centre falls into the hollow of the angle, falls back on
   * the corner cell (see `_centerCell`).
   */
  _markBox(b) {
    const cx = b.width / 2, cy = b.height / 2;
    const xs = [...new Set([Math.ceil(cx) - 1, Math.floor(cx)])];
    const ys = [...new Set([Math.ceil(cy) - 1, Math.floor(cy)])];
    const inside = xs.every((x) => ys.every((y) => b.cells.some(([p, q]) => p === x && q === y)));
    if (inside) return [0, 0, b.width * this.cell, b.height * this.cell];
    const [dx, dy] = this._centerCell(b);
    return [dx * this.cell, dy * this.cell, this.cell, this.cell];
  }

  /**
   * The cell to put a mark on when the block's centre falls outside the shape:
   * the ANGLE's cell, that is, the most surrounded one.
   *
   * Distance to the centre alone did not separate an L — its three cells are
   * equidistant — and returned whichever came first, hence the tip of an arm,
   * at the mercy of the order of `cells`. The most surrounded cell is an L's
   * elbow, a T's junction, the middle of a line: every time, the one the eye
   * reads as the centre of the shape. Distance to the centre now only breaks
   * ties.
   */
  _centerCell(b) {
    const occupied = (x, y) => b.cells.some(([p, q]) => p === x && q === y);
    const cx = (b.width - 1) / 2, cy = (b.height - 1) / 2;
    let best = b.cells[0], score = -Infinity;
    for (const [dx, dy] of b.cells) {
      const neighbours = occupied(dx, dy - 1) + occupied(dx, dy + 1)
        + occupied(dx - 1, dy) + occupied(dx + 1, dy);
      const s = neighbours - ((dx - cx) ** 2 + (dy - cy) ** 2) / 1000;
      if (s > score) { score = s; best = [dx, dy]; }
    }
    return best;
  }

  // --- Event replay --------------------------------------------------------

  async apply(events) {
    for (const e of events) {
      if (e.type === 'move') {
        const node = this.nodes.get(e.id);
        if (node) this._place(node, e.x, e.y);
      } else if (e.type === 'exit') {
        await this._exit(e);
      } else if (e.type === 'unlock') {
        this._unlock(e.id);
      }
    }
  }

  /**
   * A block leaving, in two beats: it swells for a fraction of a second (the
   * gesture's acknowledgement), then shoots through the gate while a spray of
   * sparks bursts from the opening. This is the game's only moment of reward:
   * it has to be seen.
   */
  async _exit(e) {
    const node = this.nodes.get(e.id);
    if (!node) return;
    this.nodes.delete(e.id);
    const base = node.style.transform;

    // The block exits mid-grab: its transitions are given back, having been cut
    // by the "grabbed" class so it would stick to the finger.
    node.classList.remove('grabbed');
    node.classList.add('exiting');
    node.style.transition = 'transform 0ms ease-out, opacity 0ms linear';
    node.style.transitionDuration = `${TIMING.POP}ms`;
    node.style.transform = `${base} scale(1.09)`;
    await wait(TIMING.POP);

    this._flashGate(e.gate);
    this._burst(e.gate, node);

    node.style.transitionTimingFunction = 'cubic-bezier(.45,0,.85,.5)';
    node.style.transitionDuration = `${TIMING.EXIT}ms`;
    node.style.transform =
      `${base} translate3d(${e.dx * this.cell * 2.6}px, ${e.dy * this.cell * 2.6}px, 0) scale(0.45)`;
    node.style.opacity = '0';
    await wait(TIMING.EXIT);
    node.remove();
  }

  /** Centre of a gate, in board pixels. */
  _gateCenter(gate) {
    const middle = (gate.start + gate.length / 2) * this.cell;
    if (gate.side === 'top') return { x: middle, y: 0 };
    if (gate.side === 'bottom') return { x: middle, y: this.board.H * this.cell };
    if (gate.side === 'left') return { x: 0, y: middle };
    return { x: this.board.W * this.cell, y: middle };
  }

  /** Ring + sparks at the gate, in the colour of the block that left. */
  _burst(gate, source) {
    const { x, y } = this._gateCenter(gate);
    const tint = getComputedStyle(source).getPropertyValue('--tile') || 'currentColor';

    const ring = document.createElement('div');
    ring.className = 'ring';
    ring.style.setProperty('--tile', tint);
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    ring.style.width = ring.style.height = `${this.cell * 1.4}px`;
    this.fxLayer.appendChild(ring);
    setTimeout(() => ring.remove(), 560);

    const normal = Math.atan2(
      gate.side === 'bottom' ? 1 : gate.side === 'top' ? -1 : 0,
      gate.side === 'right' ? 1 : gate.side === 'left' ? -1 : 0,
    );
    for (let i = 0; i < 10; i++) {
      const angle = normal + (Math.random() - 0.5) * 2.1;
      const dist = this.cell * (0.7 + Math.random() * 1.5);
      const p = document.createElement('div');
      p.className = 'spark';
      p.style.setProperty('--tile', tint);
      p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      p.style.left = `${x}px`;
      p.style.top = `${y}px`;
      p.style.animationDelay = `${Math.random() * 70}ms`;
      const size = this.cell * (0.12 + Math.random() * 0.14);
      p.style.width = p.style.height = `${size}px`;
      this.fxLayer.appendChild(p);
      setTimeout(() => p.remove(), 700);
    }
  }

  _flashGate(gate) {
    const el = [...this.gateLayer.children].find((n) =>
      n.classList.contains(`gate-${gate.side}`) && n.classList.contains(`c${gate.color}`));
    if (!el) return;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 420);
  }

  _unlock(id) {
    const node = this.nodes.get(id);
    if (!node) return;
    node.classList.remove('k-locked');
    node.classList.add('k-normal', 'unlocking');
    // The block is ordinary again: its lock mark has nothing left to say.
    node.querySelector('.block-mark')?.remove();
    node.querySelector('.block-cond')?.remove();
    setTimeout(() => node.classList.remove('unlocking'), TIMING.UNLOCK);
  }

  /**
   * The "symbols" option has just changed: blocks and gates are rebuilt.
   * Adding them on the fly would duplicate, in a second branch, the logic that
   * decides their mark — rebuilding costs a few milliseconds and cannot drift.
   */
  refreshGlyphs() {
    if (!this.board) return;
    this.blockLayer.replaceChildren();
    this.nodes.clear();
    for (const b of this.board.blocks.values()) this._createBlock(b);
    this._drawGates();
  }

  /** Move refused: a small shake, so the failure is legible. */
  bump(id) {
    const node = this.nodes.get(id);
    if (!node || node.classList.contains('bumping')) return;
    node.classList.add('bumping');
    setTimeout(() => node.classList.remove('bumping'), TIMING.BUMP * 2);
  }

  /**
   * Refreshes the lock labels. The countdown must go down with every block
   * cleared: that is what makes the condition legible mid-game.
   */
  refreshLocks() {
    for (const [id, node] of this.nodes) {
      const b = this.board.blocks.get(id);
      if (b && b.kind === KIND.LOCKED) this._updateLock(node, b);
    }
  }

  _updateLock(node, b) {
    const counter = node.querySelector('.lock-count');
    if (!counter) return;
    // A colour seal has no countdown to show: it carries the glyph of the
    // colour it waits for, and the player counts what is left on screen.
    // A key lock shows the key it waits for, not a countdown.
    if (b.condition?.type === 'block') {
      const open = this.board.conditionMet(b);
      counter.innerHTML = open ? '' : PADLOCK_SVG;
      counter.classList.remove('lock-color');
      counter.classList.toggle('lock-padlock', !open);
      node.classList.toggle('lock-open', open);
      return;
    }
    if (b.condition?.type === 'color') {
      // A dot of the awaited colour rather than its glyph: families are now
      // read by colour alone, and the condition must read the same way.
      const open = this.board.conditionMet(b);
      counter.textContent = '';
      counter.classList.toggle('lock-color', !open);
      counter.style.setProperty('--expected', `var(--c${b.condition.color})`);
      node.classList.toggle('lock-open', open);
      return;
    }
    const left = this.board.remainingBeforeUnlock(b);
    counter.textContent = left > 0 ? left : '';
    node.classList.toggle('lock-open', left === 0);
  }

  /** Refreshes the remaining capacities shown on the gates. */
  refreshGates() {
    const gauges = this.gateLayer.querySelectorAll('.gate');
    this.board.gates.forEach((g, i) => {
      const gauge = gauges[i]?.querySelector('.gate-cap');
      if (!gauge) return;
      gauge.textContent = g.capacity;
      gauges[i].classList.toggle('gate-full', g.capacity <= 0);
    });
  }

  /** Removes a block from the board (hammer). */
  async removeBlock(id) {
    const node = this.nodes.get(id);
    if (!node) return;
    node.classList.add('smashed');
    this.nodes.delete(id);
    await wait(TIMING.EXIT);
    node.remove();
  }

  /** Rebuilds the display from the board's state (undo). */
  resync() {
    const board = this.board;
    for (const [id, node] of [...this.nodes]) {
      if (!board.blocks.has(id)) { node.remove(); this.nodes.delete(id); }
    }
    for (const b of board.blocks.values()) {
      if (!this.nodes.has(b.id)) this._createBlock(b);
      else this._place(this.nodes.get(b.id), b.x, b.y);
    }
    this.refreshLocks();
  }

  /** Highlights the block pointed at by a hint. */
  highlight(id) {
    const node = this.nodes.get(id);
    if (!node) return;
    node.classList.add('hinted');
    setTimeout(() => node.classList.remove('hinted'), 3400);
  }

  setGrabbed(id, on) {
    const node = this.nodes.get(id);
    if (!node) return;
    node.classList.toggle('grabbed', on);
    if (!on) {
      // End of the gesture: the overhang is cleared and the block gets its
      // transition back.
      const b = this.board.blocks.get(id);
      if (b) this._place(node, b.x, b.y);
    }
  }

  /**
   * Overhang of the block towards the finger, as a fraction of a cell.
   *
   * The block moves cell by cell, but the finger is continuous. Without this
   * offset the motion looks jerky; with it, the block follows the finger and
   * visibly bumps into whatever is blocking it.
   */
  setLean(id, lx, ly) {
    const node = this.nodes.get(id);
    const b = this.board.blocks.get(id);
    if (!node || !b) return;
    const max = 0.3;
    const cx = Math.max(-max, Math.min(max, lx)) * this.cell;
    const cy = Math.max(-max, Math.min(max, ly)) * this.cell;
    node.style.transform = `translate3d(${b.x * this.cell + cx}px, ${b.y * this.cell + cy}px, 0)`;
  }

  // --- Hit testing ---------------------------------------------------------

  /** Position in cells, as a continuous value — used to follow the finger. */
  cellFromPointFloat(clientX, clientY) {
    const r = this.root.getBoundingClientRect();
    return { x: (clientX - r.left) / this.cell, y: (clientY - r.top) / this.cell };
  }

  /** Grid cell under a screen point (may fall out of bounds). */
  cellFromPoint(clientX, clientY) {
    const r = this.root.getBoundingClientRect();
    return {
      x: Math.floor((clientX - r.left) / this.cell),
      y: Math.floor((clientY - r.top) / this.cell),
    };
  }

  /**
   * The cell under a point, with a catch-up: a finger that just misses a block
   * — empty cell, wall, gate — falls back on the neighbouring cell if it is
   * very close. The block itself does not grow, only its grab zone spills over.
   */
  blockIdFromPoint(clientX, clientY) {
    const at = (x, y) => (this.board.inside(x, y) ? this.board.blockAt(x, y)?.id : undefined);

    const f = this.cellFromPointFloat(clientX, clientY);
    const cx = Math.floor(f.x), cy = Math.floor(f.y);
    let id = at(cx, cy);
    if (id !== undefined) return id;

    const rx = f.x - cx, ry = f.y - cy;
    const dx = rx < GRAB_MARGIN ? -1 : rx > 1 - GRAB_MARGIN ? 1 : 0;
    const dy = ry < GRAB_MARGIN ? -1 : ry > 1 - GRAB_MARGIN ? 1 : 0;
    if (dx && (id = at(cx + dx, cy)) !== undefined) return id;
    if (dy && (id = at(cx, cy + dy)) !== undefined) return id;
    if (dx && dy && (id = at(cx + dx, cy + dy)) !== undefined) return id;
    return null;
  }
}

/**
 * Label for an unlock condition. Given a board, we show what is LEFT to do
 * rather than the raw condition: "2 to go" makes sense mid-game, "3 cleared"
 * asks the player to count.
 */
export function conditionLabel(condition, board = null) {
  if (!condition) return '';
  if (condition.type === 'exits') {
    if (!board) return t('lock.exits', { n: condition.count });
    const left = Math.max(0, condition.count - board.exited.length);
    return left === 0 ? t('lock.open') : t('lock.left', { n: left });
  }
  if (condition.type === 'block') return '◈';
  const name = colorName(condition.color);
  if (!board) return t('lock.color.done', { color: name });
  const left = [...board.blocks.values()].filter((b) => b.color === condition.color).length;
  return left === 0 ? t('lock.open') : t('lock.color.left', { n: left, color: name });
}
