/**
 * Level editor.
 *
 * Lets you draw a grid by hand: drop shapes, pick their colour and their kind,
 * open gates in the walls, then CHECK that the result is playable before giving
 * it to anyone. The check leans on the solver (src/core/solver.js), not on
 * intuition.
 *
 * Model: pick a shape from the palette, drop it on the grid. Tapping an
 * existing block removes it. Tapping a wall cycles the gate colour at that
 * spot; neighbouring cells of the same colour are merged into a single gate on
 * export.
 */

import { SHAPES, COLORS, KIND } from '../core/block.js';
import { Board } from '../core/board.js';
import { solve } from '../core/solver.js';
import { t } from './i18n.js';
import * as myLevels from '../meta/myLevels.js';

const SIDES = ['top', 'right', 'bottom', 'left'];
/**
 * An anchor needs its direction, hence the four entries: direction is what
 * defines it, just as the axis defines a rail.
 */
const KINDS = [
  { kind: KIND.NORMAL, key: 'editor.kind.normal' },
  { kind: KIND.RAIL, key: 'editor.kind.rail.h', axis: 'h' },
  { kind: KIND.RAIL, key: 'editor.kind.rail.v', axis: 'v' },
  { kind: KIND.JOKER, key: 'editor.kind.joker' },
  { kind: KIND.LOCKED, key: 'editor.kind.locked' },
  { kind: KIND.WALL, key: 'editor.kind.wall' },
  { kind: KIND.BULKY, key: 'editor.kind.bulky' },
  { kind: KIND.ANCHOR, key: 'editor.kind.anchor.top', dir: 'top' },
  { kind: KIND.ANCHOR, key: 'editor.kind.anchor.right', dir: 'right' },
  { kind: KIND.ANCHOR, key: 'editor.kind.anchor.bottom', dir: 'bottom' },
  { kind: KIND.ANCHOR, key: 'editor.kind.anchor.left', dir: 'left' },
];

/** Exit arrows, shared by the anchor kinds and the grid preview. */
const ARROWS = { top: '▲', right: '▶', bottom: '▼', left: '◀' };

const el = (id) => document.getElementById(id);

let state = null;
let choice = { shape: 0, color: 0, kind: 0, lockCount: 2 };
/**
 * The eraser is a TOOL, not a block kind: you do not place an eraser, you
 * choose to erase. Filing it among the kinds forced you to deselect it before
 * placing anything, and turned a mode into a brush.
 */
let eraserOn = false;
let onTest = null;
let onSubmit = null;
let draftId = null;

const empty = (W, H) => ({
  W, H,
  blocks: [],
  gates: {
    top: new Array(W).fill(null),
    bottom: new Array(W).fill(null),
    left: new Array(H).fill(null),
    right: new Array(H).fill(null),
  },
});

export function init({ onTest: test, onSubmit: submit, level = null, id = null }) {
  onTest = test;
  onSubmit = submit;
  // Resuming a draft: the editor reopens on the grid it is given, and remembers
  // its id so as not to create a duplicate on every test run.
  draftId = id;
  state = empty(6, 7);
  eraserOn = false;
  if (level) importInto(level);
  buildPalettes();
  wireButtons();
  draw();
}

// ---------------------------------------------------------------------------
// Conversion to the level format
// ---------------------------------------------------------------------------

/** The colours of an edge cell, always as a list. */
const gateColors = (v) => (v === null || v === undefined ? [] : (Array.isArray(v) ? v : [v]));
const sameGate = (a, b) => gateColors(a).join() === gateColors(b).join();

/** Merges neighbouring wall cells of the same colour into gates. */
function mergedGates() {
  const gates = [];
  for (const side of SIDES) {
    const cells = state.gates[side];
    let i = 0;
    while (i < cells.length) {
      const colors = gateColors(cells[i]);
      if (!colors.length) { i++; continue; }
      // Two neighbouring cells only form one gate if they accept exactly the
      // same colours — a two-colour gate does not merge into its single-colour
      // neighbour, they do not open onto the same blocks.
      let len = 1;
      while (i + len < cells.length && sameGate(cells[i + len], cells[i])) len++;
      const gate = { side, start: i, length: len, color: colors[0] };
      if (colors.length > 1) gate.colors = [...colors];
      gates.push(gate);
      i += len;
    }
  }
  return gates;
}

/** Level object in the `GET /api/level/{n}` format (doc §6.1). */
export function toLevel() {
  const playable = state.blocks.filter((b) => b.kind !== KIND.WALL).length;
  const base = Math.max(4, playable);
  return {
    levelId: 'custom',
    number: 0,
    realm: 'Editor',
    difficulty: 'custom',
    width: state.W,
    height: state.H,
    colorCount: COLORS.length,
    moveLimit: Math.round(base * 2.2) + 3,
    timeLimit: Math.max(45, base * 10),
    minDrags: base,
    objective: { type: 'clear_all', target: playable },
    starDrags: [Math.ceil(base * 1.3), Math.ceil(base * 1.8)],
    estimatedTime: Math.max(45, base * 10),
    gates: mergedGates(),
    blocks: state.blocks.map((b) => ({ ...b })),
    solution: [], // no reference solution: hints go through the solver
  };
}

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

/**
 * Undo. We keep the STACK of placed blocks rather than a snapshot of the grid:
 * it is the last gesture the player wants to take back, and a stack is enough —
 * all the more so as it survives erasures, a block removed with the eraser
 * having nothing left to undo.
 */
function undoLast() {
  if (!state.blocks.length) return false;
  state.blocks.pop();
  draw();
  return true;
}

/** Called by the phone's "back" button. */
export function goBack() {
  return undoLast();
}

/**
 * Drag and drop of a shape from the palette onto the grid.
 *
 * Picking a piece then aiming at a cell meant holding two ideas at once; now
 * you take the piece and drop it where you want it. A plain tap still works —
 * it selects the shape, for anyone who prefers tapping the grid.
 *
 * We go through Pointer Events rather than the HTML drag-and-drop API: the
 * latter does not work with a finger on mobile, which is where this game is
 * played.
 */
function wireDrag(thumb, index) {
  thumb.addEventListener('pointerdown', (start) => {
    if (eraserOn) return;
    choice.shape = index;
    updatePalettes();

    const ghost = thumb.cloneNode(true);
    ghost.className = 'ed-shape ed-ghost';
    document.body.appendChild(ghost);

    let target = null;
    const follow = (ev) => {
      ghost.style.left = `${ev.clientX}px`;
      ghost.style.top = `${ev.clientY}px`;
      // The cell under the finger, not under the ghost: the finger aims, and
      // the ghost trails it with a deliberate offset so it stays visible under
      // the hand.
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const aimed = under?.classList.contains('ed-cell') ? under : null;
      if (aimed !== target) {
        target?.classList.remove('aimed');
        target = aimed;
        target?.classList.add('aimed');
      }
    };

    const release = (ev) => {
      thumb.releasePointerCapture?.(start.pointerId);
      window.removeEventListener('pointermove', follow);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      ghost.remove();
      target?.classList.remove('aimed');
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      if (under?.classList.contains('ed-cell')) {
        place(Number(under.dataset.x), Number(under.dataset.y));
      }
    };

    thumb.setPointerCapture?.(start.pointerId);
    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    follow(start);
  });
}

function buildPalettes() {
  const tools = el('ed-tools');
  if (tools) {
    tools.replaceChildren();

    const eraser = document.createElement('button');
    eraser.className = 'ed-tool';
    eraser.id = 'ed-eraser';
    eraser.title = t('editor.eraser');
    eraser.setAttribute('aria-label', t('editor.eraser'));
    eraser.textContent = '🧽';
    eraser.onclick = () => { eraserOn = !eraserOn; updatePalettes(); };

    const undo = document.createElement('button');
    undo.className = 'ed-tool';
    undo.title = t('editor.undo');
    undo.setAttribute('aria-label', t('editor.undo'));
    undo.textContent = '↶';
    undo.onclick = () => undoLast();

    tools.append(eraser, undo);
  }

  const shapes = el('ed-shapes');
  shapes.replaceChildren(...SHAPES.map((sh, i) => {
    const b = document.createElement('button');
    b.className = 'ed-shape';
    wireDrag(b, i);
    b.title = sh.key;
    const g = document.createElement('span');
    g.style.gridTemplateColumns = `repeat(${sh.w}, 7px)`;
    g.style.gridTemplateRows = `repeat(${sh.h}, 7px)`;
    for (let y = 0; y < sh.h; y++) {
      for (let x = 0; x < sh.w; x++) {
        const c = document.createElement('i');
        if (sh.cells.some(([a, d]) => a === x && d === y)) c.className = 'on';
        g.appendChild(c);
      }
    }
    b.appendChild(g);
    b.onclick = () => { choice.shape = i; updatePalettes(); };
    return b;
  }));

  const colors = el('ed-colors');
  colors.replaceChildren(...COLORS.map((c, i) => {
    const b = document.createElement('button');
    b.className = `ed-color c${i}`;
    b.title = c.name;
    b.textContent = c.glyph;
    b.onclick = () => { choice.color = i; updatePalettes(); };
    return b;
  }));

  const kinds = el('ed-kinds');
  kinds.replaceChildren(...KINDS.map((n, i) => {
    const b = document.createElement('button');
    b.className = 'ed-kind';
    b.textContent = t(n.key);
    b.onclick = () => { choice.kind = i; updatePalettes(); };
    return b;
  }));

  updatePalettes();
}

function updatePalettes() {
  [...el('ed-shapes').children].forEach((b, i) => b.classList.toggle('sel', i === choice.shape));
  [...el('ed-colors').children].forEach((b, i) => b.classList.toggle('sel', i === choice.color));
  [...el('ed-kinds').children].forEach((b, i) => b.classList.toggle('sel', i === choice.kind));
  // The eraser lights up on its own: it is a mode, and a mode must be visible
  // from a distance.
  el('ed-eraser')?.classList.toggle('sel', eraserOn);
  el('ed-grid')?.classList.toggle('erasing', eraserOn);
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

function occupant(x, y) {
  return state.blocks.find((b) => b.cells.some(([dx, dy]) => b.x + dx === x && b.y + dy === y));
}

function draw() {
  const grid = el('ed-grid');
  grid.style.setProperty('--ew', state.W);
  grid.style.setProperty('--eh', state.H);
  grid.replaceChildren();

  // Wall cells: a tap cycles the gate colour.
  for (const side of SIDES) {
    state.gates[side].forEach((color, i) => {
      const colors = gateColors(color);
      const m = document.createElement('button');
      m.className = `ed-wall ed-wall-${side}`
        + (colors.length ? ` c${colors[0]} open` : '')
        + (colors.length > 1 ? ' dual' : '');
      m.style.setProperty('--i', i);
      if (colors.length > 1) m.style.setProperty('--c-alt', `var(--c${colors[1]})`);
      m.textContent = colors.map((c) => COLORS[c].glyph).join('');
      m.onclick = () => {
        if (eraserOn) { state.gates[side][i] = null; draw(); return; }
        // A tap ADDS the chosen colour; the same tap on a colour already there
        // removes it. A gate accepts two at most — beyond that, it could no
        // longer be read at a glance on the board.
        const next = colors.includes(choice.color)
          ? colors.filter((c) => c !== choice.color)
          : [...colors, choice.color].slice(-2);
        state.gates[side][i] = next.length ? next : null;
        draw();
      };
      grid.appendChild(m);
    });
  }

  for (let y = 0; y < state.H; y++) {
    for (let x = 0; x < state.W; x++) {
      const block = occupant(x, y);
      const c = document.createElement('button');
      c.className = 'ed-cell';
      c.style.setProperty('--x', x);
      c.style.setProperty('--y', y);
      c.dataset.x = x;
      c.dataset.y = y;
      if (block) {
        c.classList.add('filled', `k-${block.kind}`);
        if (block.color >= 0 && block.kind !== KIND.JOKER) c.classList.add(`c${block.color}`);
        c.textContent = block.kind === KIND.WALL ? '' : block.kind === KIND.JOKER ? '✳'
          : block.kind === KIND.LOCKED ? '🔒'
          : block.kind === KIND.ANCHOR ? ARROWS[block.dir]
          : COLORS[block.color].glyph;
      }
      c.onclick = () => {
        if (eraserOn) { if (block) remove(block); return; }
        if (block) remove(block); else place(x, y);
      };
      grid.appendChild(c);
    }
  }
  setStatus('');
}

function place(x, y) {
  const shape = SHAPES[choice.shape];
  const kind = KINDS[choice.kind];
  if (eraserOn) return;
  if (x + shape.w > state.W || y + shape.h > state.H) { setStatus(t('editor.status.overflow')); return; }
  if (shape.cells.some(([dx, dy]) => occupant(x + dx, y + dy))) { setStatus(t('editor.status.occupied')); return; }

  state.blocks.push({
    id: (state.blocks.at(-1)?.id ?? 0) + 1,
    color: kind.kind === KIND.WALL ? -1 : choice.color,
    cells: shape.cells.map(([a, b]) => [a, b]),
    x, y,
    kind: kind.kind,
    axis: kind.axis || null,
    dir: kind.dir || null,
    condition: kind.kind === KIND.LOCKED ? { type: 'exits', count: choice.lockCount } : null,
  });
  draw();
}

/** Loads a grid in the `GET /api/level/{n}` format into the editor's state. */
function importInto(n) {
  state = empty(n.width, n.height);
  state.blocks = n.blocks.map((b) => ({ ...b }));
  for (const g of n.gates) {
    const colors = g.colors?.length ? [...g.colors] : [g.color];
    for (let k = 0; k < g.length; k++) state.gates[g.side][g.start + k] = colors;
  }
  const w = el('ed-w'), h = el('ed-h');
  if (w) w.value = n.width;
  if (h) h.value = n.height;
}

/**
 * Stores the current state in the history. Called when testing and when
 * submitting: those are the two moments the player shows they care about their
 * grid, and the only ones where losing it would sting.
 */
function keep(level, { title = '', submitted = false } = {}) {
  draftId = myLevels.record(level, { id: draftId, title, submitted });
  return draftId;
}

function openMyLevels() {
  const host = el('mine-list');
  const entries = myLevels.list();
  host.replaceChildren(...entries.map((e) => {
    const li = document.createElement('li');

    const info = document.createElement('button');
    info.className = 'mine-open';
    const title = document.createElement('b');
    title.textContent = e.title || t('editor.untitled');
    const detail = document.createElement('small');
    detail.textContent = `${e.width}×${e.height} · ${t('editor.blocks', { n: e.blocks })}`
      + `${e.submitted ? ' · ' + t('editor.proposed') : ''}`;
    info.append(title, detail);
    info.onclick = () => {
      importInto(e.level);
      draftId = e.id;
      draw();
      el('overlay-mine').hidden = true;
      setStatus(t('editor.loaded'), 'ok');
    };

    const discard = document.createElement('button');
    discard.className = 'mine-del';
    discard.setAttribute('aria-label', t('editor.delete'));
    discard.textContent = '×';
    discard.onclick = () => { myLevels.remove(e.id); openMyLevels(); };

    li.append(info, discard);
    return li;
  }));
  if (!entries.length) host.textContent = t('editor.mine.empty');
  el('overlay-mine').hidden = false;
}

function remove(block) {
  state.blocks = state.blocks.filter((b) => b !== block);
  draw();
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

function setStatus(message, tone = '') {
  const z = el('ed-status');
  z.textContent = message;
  z.className = 'ed-status' + (tone ? ` ${tone}` : '');
}

function wireButtons() {
  el('ed-w').onchange = () => resize(Number(el('ed-w').value), state.H);
  el('ed-h').onchange = () => resize(state.W, Number(el('ed-h').value));

  el('ed-clear').onclick = () => { state = empty(state.W, state.H); draw(); };

  el('ed-check').onclick = () => {
    const level = toLevel();
    if (!level.gates.length) { setStatus(t('editor.status.nogate'), 'ko'); return; }
    if (!level.objective.target) { setStatus(t('editor.status.noblock'), 'ko'); return; }
    const r = solve(new Board({ ...level, moveLimit: 9999, timeLimit: 9999 }));
    if (r.solvable) {
      setStatus(t('editor.status.solvable', { n: r.order.length, states: r.states }), 'ok');
    } else if (r.gaveUp) {
      setStatus(t('editor.status.aborted'), 'ko');
    } else {
      setStatus(t('editor.status.unsolved'), 'ko');
    }
  };

  el('ed-test').onclick = () => {
    const level = toLevel();
    if (!level.gates.length || !level.objective.target) {
      setStatus(t('editor.status.needboth'), 'ko');
      return;
    }
    keep(level);
    onTest?.(level, draftId);
  };

  /**
   * Submit the grid as the daily puzzle.
   *
   * The solver is run again HERE rather than trusting the "Check" button:
   * nothing forces the player to have clicked it, and an unsolvable grid sent
   * to everybody is the one flaw this queue must never let through. An aborted
   * search counts as a refusal — when in doubt, we do not submit.
   */
  el('ed-submit').onclick = () => {
    const level = toLevel();
    if (!level.gates.length || !level.objective.target) {
      setStatus(t('editor.submit.unsolved'), 'ko');
      return;
    }
    const r = solve(new Board({ ...level, moveLimit: 9999, timeLimit: 9999 }));
    if (!r.solvable) { setStatus(t('editor.submit.unsolved'), 'ko'); return; }

    const title = prompt(t('editor.submit.ask'), '');
    if (title === null) return;
    // The number of exits in the solution found stands in as a gesture
    // reference: with no reference solution, it is the only honest measure we
    // have.
    const full = { ...level, minDrags: Math.max(1, r.order.length) };
    keep(full, { title: title.trim(), submitted: true });
    onSubmit?.(full, title.trim());
    setStatus(t('editor.submit.ok'), 'ok');
  };

  el('ed-export').onclick = async () => {
    const json = JSON.stringify(toLevel(), null, 2);
    el('ed-json').value = json;
    el('ed-json').hidden = false;
    try {
      await navigator.clipboard.writeText(json);
      setStatus(t('editor.status.copied'), 'ok');
    } catch {
      setStatus(t('editor.status.shown'), 'ok');
    }
  };

  el('ed-mine').onclick = () => openMyLevels();

  el('ed-import').onclick = () => {
    const zone = el('ed-json');
    zone.hidden = false;
    if (!zone.value.trim()) { setStatus(t('editor.status.paste')); return; }
    try {
      const n = JSON.parse(zone.value);
      state = empty(n.width, n.height);
      state.blocks = n.blocks.map((b) => ({ ...b }));
      for (const g of n.gates) {
        for (let k = 0; k < g.length; k++) state.gates[g.side][g.start + k] = g.color;
      }
      el('ed-w').value = n.width;
      el('ed-h').value = n.height;
      draw();
      setStatus(t('editor.status.imported'), 'ok');
    } catch (e) {
      setStatus(t('editor.status.badjson', { error: e.message }), 'ko');
    }
  };
}

function resize(W, H) {
  W = Math.max(4, Math.min(8, W));
  H = Math.max(4, Math.min(9, H));
  const previous = state;
  state = empty(W, H);
  // We keep whatever still fits in the new grid.
  state.blocks = previous.blocks.filter((b) => {
    const maxX = Math.max(...b.cells.map((c) => c[0])) + b.x;
    const maxY = Math.max(...b.cells.map((c) => c[1])) + b.y;
    return maxX < W && maxY < H;
  });
  for (const side of SIDES) {
    previous.gates[side].forEach((c, i) => { if (i < state.gates[side].length) state.gates[side][i] = c; });
  }
  el('ed-w').value = W;
  el('ed-h').value = H;
  draw();
}
