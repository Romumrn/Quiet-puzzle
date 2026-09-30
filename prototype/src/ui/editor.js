/**
 * Level editor — built for a phone.
 *
 * The grid is drawn by the game's own renderer (render/boardView.js): what you
 * edit is exactly what the player will see — blocks, gates, capacities, one-way
 * arrows. A transparent layer on top takes the touches.
 *
 * Four MODES, one at a time, always visible at the top — the old editor mixed
 * placing, erasing and opening gates on the same tap, and players could not
 * tell what a tap would do:
 *  - Blocks : pick a type, a colour and a shape below, press the grid — a ghost
 *             of the block follows the finger (green: it fits, red: it does not)
 *             and it is placed where the finger lifts.
 *  - Gates  : tap the edge of the grid to open a gate of the chosen colour
 *             (plain, with a capacity, or opening late). The same colour again
 *             closes it; another colour makes it a shared gate.
 *  - Arrows : tap a cell to make it one-way in the chosen direction.
 *  - Eraser : tap a block, a gate or an arrow to remove it.
 *
 * Every mechanic of the game is available: normal, rail, anchor, slider,
 * joker, two-colour, heavy, locks (countdown, colour seal, key), key, sealed
 * wall; plain, capacity, late and shared gates; one-way cells.
 *
 * Check runs the solver (src/core/solver.js); Test plays the grid; a grid the
 * solver has cleared can be proposed as the daily puzzle.
 */

import { SHAPES, KIND, colorsOf } from '../core/block.js';
import { Board } from '../core/board.js';
import { solve } from '../core/solver.js';
import { BoardView } from '../render/boardView.js';
import { t, colorName } from './i18n.js';
import * as myLevels from '../meta/myLevels.js';

const SIDES = ['top', 'right', 'bottom', 'left'];
const DIRS = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
const ARROWS = { top: '▲', right: '▶', bottom: '▼', left: '◀' };
const COLOR_COUNT = 6;

/**
 * Block types, in the order a player meets them in the game. `mark` is what the
 * chip shows, in the board's own vocabulary.
 */
const TYPES = [
  { id: 'normal', kind: KIND.NORMAL, mark: '' },
  { id: 'rail', kind: KIND.RAIL, mark: '↔' },
  { id: 'wall', kind: KIND.WALL, mark: '', noColor: true },
  { id: 'locked', kind: KIND.LOCKED, mark: '◔' },
  { id: 'joker', kind: KIND.JOKER, mark: '✳', noColor: true },
  { id: 'anchor', kind: KIND.ANCHOR, mark: '➜' },
  { id: 'bulky', kind: KIND.BULKY, mark: '×2' },
  { id: 'dual', kind: KIND.DUAL, mark: '' },
  { id: 'key', kind: KIND.NORMAL, mark: '◈', isKey: true },
  { id: 'slide', kind: KIND.SLIDE, mark: '≋' },
];
const W_MIN = 4, W_MAX = 8, H_MIN = 4, H_MAX = 9;
const UNDO_DEPTH = 60;

const el = (id) => document.getElementById(id);

let state = null;          // { W, H, blocks, gates: {side: [cell|null]}, oneWay: [] }
let history = [];          // snapshots for undo
let mode = 'blocks';
let panel = 'main';        // 'main' | 'size'
const choice = {
  type: 'normal', color: 0, color2: 1, shape: 1,
  axis: 'h', dir: 'right',
  lock: 'exits', lockCount: 2, lockColor: 1,
  gateType: 'plain', gateCount: 2,
  arrowDir: 'right',
};
let view = null;
let onTest = null;
let onSubmit = null;
let onCreated = null;      // a grid proven solvable: the "create a level" quest
let draftId = null;
let lastCheck = null;      // the grid the solver last cleared, as JSON

const empty = (W, H) => ({
  W, H,
  blocks: [],
  gates: {
    top: new Array(W).fill(null), bottom: new Array(W).fill(null),
    left: new Array(H).fill(null), right: new Array(H).fill(null),
  },
  oneWay: [],
});

export function init({ onTest: test, onSubmit: submit, onCreated: created = null, level = null, id = null }) {
  onTest = test;
  onCreated = created;
  onSubmit = submit;
  // Resuming a draft: the editor reopens on the grid it is given, and remembers
  // its id so as not to create a duplicate on every test run.
  draftId = id;
  state = empty(6, 7);
  history = [];
  mode = 'blocks';
  panel = 'main';
  lastCheck = null;
  if (level) importInto(level);
  if (!view) {
    view = new BoardView(el('ed-board'));
    buildOverlay();
  }
  wireButtons();
  render();
}

/** The phone's "back" button: undo first, leave when there is nothing left. */
export function goBack() {
  return undo();
}

// ---------------------------------------------------------------------------
// Conversion to the level format
// ---------------------------------------------------------------------------

const sameGate = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Merges neighbouring edge cells with the very same settings into gates. */
function mergedGates() {
  const gates = [];
  for (const side of SIDES) {
    const cells = state.gates[side];
    let i = 0;
    while (i < cells.length) {
      const g = cells[i];
      if (!g) { i++; continue; }
      let len = 1;
      while (i + len < cells.length && sameGate(cells[i + len], g)) len++;
      const gate = { side, start: i, length: len, color: g.colors[0] };
      if (g.colors.length > 1) gate.colors = [...g.colors];
      if (g.capacity) gate.capacity = g.capacity;
      if (g.opensAfter) gate.opensAfter = g.opensAfter;
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
  const key = state.blocks.find((b) => b.isKey);
  return {
    levelId: 'custom',
    number: 0,
    realm: 'Editor',
    difficulty: 'custom',
    width: state.W,
    height: state.H,
    colorCount: COLOR_COUNT,
    moveLimit: Math.round(base * 2.2) + 3,
    timeLimit: Math.max(60, base * 10), // never under a minute (MIN_TIME_S in main.js)
    minDrags: base,
    objective: { type: 'clear_all', target: playable },
    starDrags: [Math.ceil(base * 1.3), Math.ceil(base * 1.8)],
    estimatedTime: Math.max(45, base * 10),
    gates: mergedGates(),
    // A key lock points at THE key's id, whatever order the blocks were drawn in.
    blocks: state.blocks.map((b) => (b.condition?.type === 'block'
      ? { ...b, condition: { type: 'block', id: key ? key.id : -1 } } : { ...b })),
    oneWay: state.oneWay.map((a) => ({ ...a })),
    solution: [], // no reference solution: hints go through the solver
  };
}

/** Loads a grid in the level format into the editor's state. */
function importInto(n) {
  state = empty(n.width, n.height);
  state.blocks = n.blocks.map((b) => ({ ...b }));
  for (const g of n.gates || []) {
    const cell = { colors: g.colors?.length ? [...g.colors] : [g.color] };
    if (g.capacity) cell.capacity = g.capacity;
    if (g.opensAfter) cell.opensAfter = g.opensAfter;
    for (let k = 0; k < g.length; k++) state.gates[g.side][g.start + k] = { ...cell, colors: [...cell.colors] };
  }
  state.oneWay = (n.oneWay || []).map((a) => ({ ...a }));
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/** Call BEFORE every change: the grid as it was is what "undo" brings back. */
function remember() {
  history.push(JSON.stringify(state));
  if (history.length > UNDO_DEPTH) history.shift();
}

function undo() {
  if (!history.length) return false;
  state = JSON.parse(history.pop());
  render();
  setStatus(t('editor.undone'));
  return true;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  lastCheck = null;
  const board = new Board(toLevel());
  view.mount(board);
  drawSlots();
  renderModes();
  renderPanel();
  el('ed-undo').disabled = !history.length;
  el('ed-size').textContent = `${state.W} × ${state.H}`;
  setStatus(t(`editor.help.${mode}`));
}

function renderModes() {
  for (const b of el('ed-modes').children) b.classList.toggle('sel', b.dataset.mode === mode);
  el('ed-board').dataset.mode = mode;
}

/** The small square each chip shows: the block as it will look, in its colour. */
function swatch(type, color, color2) {
  const s = document.createElement('span');
  s.className = `ed-swatch t-${type.id}`;
  if (!type.noColor) s.style.setProperty('--tile', `var(--c${color})`);
  if (type.id === 'dual') s.style.setProperty('--c-alt', `var(--c${color2})`);
  s.textContent = type.id === 'rail' ? (choice.axis === 'h' ? '↔' : '↕')
    : type.id === 'anchor' ? ARROWS[choice.dir] : type.mark;
  return s;
}

function chip(label, selected, onclick, extraClass = '') {
  const b = document.createElement('button');
  b.className = `ed-chip ${extraClass}`.trim();
  b.classList.toggle('sel', selected);
  if (typeof label === 'string') b.textContent = label; else b.append(...label);
  b.onclick = onclick;
  return b;
}

function row(titleKey, children, extraClass = '') {
  const wrap = document.createElement('div');
  wrap.className = `ed-row ${extraClass}`.trim();
  if (titleKey) {
    const title = document.createElement('span');
    title.className = 'ed-legend';
    title.textContent = t(titleKey);
    wrap.appendChild(title);
  }
  const line = document.createElement('div');
  line.className = 'ed-line';
  line.append(...children);
  wrap.appendChild(line);
  return wrap;
}

function colorRow(titleKey, current, pick, exclude = -1) {
  const dots = [];
  for (let c = 0; c < COLOR_COUNT; c++) {
    const b = document.createElement('button');
    b.className = `ed-color c${c}`;
    b.classList.toggle('sel', c === current);
    b.disabled = c === exclude;
    b.setAttribute('aria-label', colorName(c));
    b.onclick = () => pick(c);
    dots.push(b);
  }
  return row(titleKey, dots, 'ed-colors');
}

function stepper(value, min, max, set) {
  const box = document.createElement('span');
  box.className = 'ed-stepper';
  const minus = document.createElement('button');
  minus.className = 'ed-step'; minus.textContent = '−'; minus.disabled = value <= min;
  minus.onclick = () => set(value - 1);
  const v = document.createElement('b');
  v.textContent = value;
  const plus = document.createElement('button');
  plus.className = 'ed-step'; plus.textContent = '+'; plus.disabled = value >= max;
  plus.onclick = () => set(value + 1);
  box.append(minus, v, plus);
  return box;
}

const reRender = () => renderPanel();

function renderPanel() {
  const host = el('ed-panel');
  host.replaceChildren();

  if (panel === 'size') {
    host.append(
      row('editor.width', [stepper(state.W, W_MIN, W_MAX, (w) => resize(w, state.H))]),
      row('editor.height', [stepper(state.H, H_MIN, H_MAX, (h) => resize(state.W, h))]),
    );
    return;
  }

  const type = TYPES.find((x) => x.id === choice.type);

  if (mode === 'blocks') {
    // 1. What kind of block.
    host.appendChild(row('editor.type', TYPES.map((x) => chip(
      [swatch(x, choice.color, choice.color2), Object.assign(document.createElement('small'), { textContent: t(`editor.t.${x.id}`) })],
      x.id === choice.type,
      () => { choice.type = x.id; reRender(); },
      'ed-type',
    )), 'ed-scroll-row'));

    // 2. Its settings, only those it has.
    const opts = [];
    if (type.id === 'rail') {
      opts.push(chip('↔', choice.axis === 'h', () => { choice.axis = 'h'; reRender(); }),
        chip('↕', choice.axis === 'v', () => { choice.axis = 'v'; reRender(); }));
    }
    if (type.id === 'anchor') {
      for (const d of SIDES) opts.push(chip(ARROWS[d], choice.dir === d, () => { choice.dir = d; reRender(); }));
    }
    if (type.id === 'locked') {
      opts.push(chip(t('editor.lock.exits'), choice.lock === 'exits', () => { choice.lock = 'exits'; reRender(); }),
        chip(t('editor.lock.color'), choice.lock === 'color', () => { choice.lock = 'color'; reRender(); }),
        chip(t('editor.lock.key'), choice.lock === 'block', () => { choice.lock = 'block'; reRender(); }));
    }
    // The countdown's number sits on the same line as the lock's options.
    if (type.id === 'locked' && choice.lock === 'exits') {
      opts.push(stepper(choice.lockCount, 1, 12, (n) => { choice.lockCount = n; reRender(); }));
    }
    if (opts.length) host.appendChild(row(type.id === 'locked' ? 'editor.opens' : 'editor.direction', opts));
    if (type.id === 'locked' && choice.lock === 'color') {
      host.appendChild(colorRow('editor.lock.waits', choice.lockColor, (c) => { choice.lockColor = c; reRender(); }));
    }

    // 3. Its colour(s).
    if (!type.noColor) {
      host.appendChild(colorRow('editor.color', choice.color, (c) => {
        choice.color = c;
        if (choice.color2 === c) choice.color2 = (c + 1) % COLOR_COUNT;
        reRender();
      }));
    }
    if (type.id === 'dual') {
      host.appendChild(colorRow('editor.color2', choice.color2, (c) => { choice.color2 = c; reRender(); }, choice.color));
    }

    // 4. Its shape, drawn in its colour.
    host.appendChild(row('editor.shape', SHAPES.map((sh, i) => {
      const g = document.createElement('span');
      g.className = 'ed-shape-cells';
      g.style.gridTemplateColumns = `repeat(${sh.w}, 8px)`;
      g.style.gridTemplateRows = `repeat(${sh.h}, 8px)`;
      if (!type.noColor) g.style.setProperty('--tile', `var(--c${choice.color})`);
      for (let y = 0; y < sh.h; y++) {
        for (let x = 0; x < sh.w; x++) {
          const c = document.createElement('i');
          if (sh.cells.some(([a, d]) => a === x && d === y)) c.className = 'on';
          g.appendChild(c);
        }
      }
      return chip([g], i === choice.shape, () => {
        choice.shape = i;
        // A rail follows its shape's long side unless it is square.
        if (sh.w > sh.h) choice.axis = 'h'; else if (sh.h > sh.w) choice.axis = 'v';
        reRender();
      }, `ed-shape t-${type.id}`);
    }), 'ed-scroll-row'));
    return;
  }

  if (mode === 'gates') {
    host.appendChild(colorRow('editor.color', choice.color, (c) => { choice.color = c; reRender(); }));
    host.appendChild(row('editor.gate', [
      chip(t('editor.gate.plain'), choice.gateType === 'plain', () => { choice.gateType = 'plain'; reRender(); }),
      chip(t('editor.gate.capacity'), choice.gateType === 'capacity', () => { choice.gateType = 'capacity'; reRender(); }),
      chip(t('editor.gate.late'), choice.gateType === 'late', () => { choice.gateType = 'late'; reRender(); }),
    ]));
    if (choice.gateType !== 'plain') {
      host.appendChild(row(choice.gateType === 'capacity' ? 'editor.gate.cells' : 'editor.gate.after',
        [stepper(choice.gateCount, 1, 12, (n) => { choice.gateCount = n; reRender(); })]));
    }
    return;
  }

  if (mode === 'arrows') {
    host.appendChild(row('editor.direction', SIDES.map((d) =>
      chip(ARROWS[d], choice.arrowDir === d, () => { choice.arrowDir = d; reRender(); }))));
    return;
  }

  const note = document.createElement('p');
  note.className = 'ed-note';
  note.textContent = t('editor.help.erase.more');
  host.appendChild(note);
}

// ---------------------------------------------------------------------------
// Touch layer: cells and edge slots
// ---------------------------------------------------------------------------

function buildOverlay() {
  const root = el('ed-board');
  const hit = document.createElement('div');
  hit.className = 'ed-hit';
  hit.id = 'ed-hit';
  const ghost = document.createElement('div');
  ghost.className = 'ed-ghost';
  ghost.id = 'ed-ghost';
  ghost.hidden = true;
  const slots = document.createElement('div');
  slots.className = 'ed-slots';
  slots.id = 'ed-slots';
  root.append(ghost, hit, slots);

  let pressing = false;
  const cellAt = (ev) => view.cellFromPoint(ev.clientX, ev.clientY);
  hit.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    hit.setPointerCapture?.(ev.pointerId);
    const p = cellAt(ev);
    if (mode === 'blocks') {
      if (occupant(p.x, p.y)) { setStatus(t('editor.occupied'), 'ko'); flashMode('erase'); return; }
      pressing = true;
      showGhost(p);
    } else if (mode === 'arrows') {
      toggleArrow(p.x, p.y);
    } else if (mode === 'erase') {
      eraseAt(p.x, p.y);
    } else if (mode === 'gates') {
      setStatus(t('editor.help.gates'), 'ko');
    }
  });
  hit.addEventListener('pointermove', (ev) => { if (pressing) showGhost(cellAt(ev)); });
  const end = (ev, cancel) => {
    if (!pressing) return;
    pressing = false;
    el('ed-ghost').hidden = true;
    if (!cancel) place(ghostOrigin(cellAt(ev)));
  };
  hit.addEventListener('pointerup', (ev) => end(ev, false));
  hit.addEventListener('pointercancel', (ev) => end(ev, true));
}

/** Where the shape lands when the finger is on cell p: the finger holds its first cell. */
function ghostOrigin(p) {
  const [cx, cy] = SHAPES[choice.shape].cells[0];
  return { x: p.x - cx, y: p.y - cy };
}

function fits(o) {
  const sh = SHAPES[choice.shape];
  return sh.cells.every(([dx, dy]) => {
    const x = o.x + dx, y = o.y + dy;
    return x >= 0 && y >= 0 && x < state.W && y < state.H && !occupant(x, y);
  });
}

function showGhost(p) {
  const ghost = el('ed-ghost');
  const o = ghostOrigin(p);
  const sh = SHAPES[choice.shape];
  const ok = fits(o);
  ghost.hidden = false;
  ghost.className = `ed-ghost ${ok ? 'ok' : 'ko'}`;
  const type = TYPES.find((x) => x.id === choice.type);
  ghost.style.setProperty('--tile', type.kind === KIND.WALL ? 'hsl(var(--h) 10% 78%)' : `var(--c${choice.color})`);
  ghost.replaceChildren(...sh.cells.map(([dx, dy]) => {
    const c = document.createElement('i');
    c.style.left = `${(o.x + dx) * view.cell}px`;
    c.style.top = `${(o.y + dy) * view.cell}px`;
    return c;
  }));
  setStatus(ok ? t('editor.release') : t('editor.status.overflow'), ok ? '' : 'ko');
}

/** One tap target per edge cell, just over the wall. */
function drawSlots() {
  const host = el('ed-slots');
  host.replaceChildren();
  for (const side of SIDES) {
    state.gates[side].forEach((g, i) => {
      const s = document.createElement('button');
      s.className = `ed-slot ed-slot-${side}` + (g ? ' open' : '');
      s.style.setProperty('--i', i);
      s.setAttribute('aria-label', t('editor.gate.here'));
      s.onclick = () => {
        if (mode === 'gates') toggleGate(side, i);
        else if (mode === 'erase' && g) { remember(); state.gates[side][i] = null; render(); }
      };
      host.appendChild(s);
    });
  }
}

/** Points at the mode a player should switch to: its tab pulses once. */
function flashMode(m) {
  const tab = [...el('ed-modes').children].find((b) => b.dataset.mode === m);
  if (!tab) return;
  tab.classList.remove('flash');
  void tab.offsetWidth;
  tab.classList.add('flash');
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

function occupant(x, y) {
  return state.blocks.find((b) => b.cells.some(([dx, dy]) => b.x + dx === x && b.y + dy === y));
}

function place(o) {
  if (!fits(o)) { setStatus(t('editor.status.overflow'), 'ko'); return; }
  const type = TYPES.find((x) => x.id === choice.type);
  const sh = SHAPES[choice.shape];
  if (type.isKey && state.blocks.some((b) => b.isKey)) { setStatus(t('editor.onekey'), 'ko'); return; }
  remember();
  const block = {
    id: Math.max(0, ...state.blocks.map((b) => b.id)) + 1,
    color: type.noColor ? (type.kind === KIND.WALL ? -1 : choice.color) : choice.color,
    cells: sh.cells.map(([a, b]) => [a, b]),
    x: o.x, y: o.y,
    kind: type.kind,
    axis: type.kind === KIND.RAIL ? choice.axis : null,
    dir: type.kind === KIND.ANCHOR ? choice.dir : null,
    condition: null,
  };
  if (type.id === 'dual') block.colors = [choice.color, choice.color2];
  if (type.isKey) block.isKey = true;
  if (type.kind === KIND.LOCKED) {
    block.condition = choice.lock === 'exits' ? { type: 'exits', count: choice.lockCount }
      : choice.lock === 'color' ? { type: 'color', color: choice.lockColor }
      : { type: 'block' };
  }
  state.blocks.push(block);
  render();
  setStatus(t('editor.placed'), 'ok');
}

function eraseAt(x, y) {
  const b = occupant(x, y);
  if (b) {
    remember();
    state.blocks = state.blocks.filter((o) => o !== b);
    render();
    return;
  }
  const i = state.oneWay.findIndex((a) => a.x === x && a.y === y);
  if (i >= 0) { remember(); state.oneWay.splice(i, 1); render(); }
}

function toggleArrow(x, y) {
  if (x < 0 || y < 0 || x >= state.W || y >= state.H) return;
  const [dx, dy] = DIRS[choice.arrowDir];
  remember();
  const i = state.oneWay.findIndex((a) => a.x === x && a.y === y);
  const same = i >= 0 && state.oneWay[i].dx === dx && state.oneWay[i].dy === dy;
  if (i >= 0) state.oneWay.splice(i, 1);
  if (!same) state.oneWay.push({ x, y, dx, dy });
  render();
}

/**
 * A tap on an edge cell with the chosen colour and gate type:
 *  - nothing there → a gate opens;
 *  - that colour already there, same settings → it closes (or leaves a shared
 *    gate with its other colour);
 *  - that colour there, other settings → the settings change;
 *  - another colour there → the gate becomes shared (two colours at most).
 */
function toggleGate(side, i) {
  const settings = {};
  if (choice.gateType === 'capacity') settings.capacity = choice.gateCount;
  if (choice.gateType === 'late') settings.opensAfter = choice.gateCount;
  const cur = state.gates[side][i];
  remember();
  let next;
  if (!cur) {
    next = { colors: [choice.color], ...settings };
  } else if (cur.colors.includes(choice.color)) {
    const same = (cur.capacity || 0) === (settings.capacity || 0) && (cur.opensAfter || 0) === (settings.opensAfter || 0);
    if (same) {
      const left = cur.colors.filter((c) => c !== choice.color);
      next = left.length ? { ...cur, colors: left } : null;
    } else {
      next = { colors: cur.colors, ...settings };
    }
  } else {
    next = { ...cur, colors: [...cur.colors, choice.color].slice(-2) };
  }
  state.gates[side][i] = next;
  render();
}

function resize(W, H) {
  W = Math.max(W_MIN, Math.min(W_MAX, W));
  H = Math.max(H_MIN, Math.min(H_MAX, H));
  if (W === state.W && H === state.H) return;
  remember();
  const previous = state;
  state = empty(W, H);
  // We keep whatever still fits in the new grid.
  state.blocks = previous.blocks.filter((b) => b.cells.every(([dx, dy]) => b.x + dx < W && b.y + dy < H));
  for (const side of SIDES) {
    previous.gates[side].forEach((c, i) => { if (i < state.gates[side].length) state.gates[side][i] = c; });
  }
  state.oneWay = previous.oneWay.filter((a) => a.x < W && a.y < H);
  render();
}

// ---------------------------------------------------------------------------
// Checking, testing, proposing
// ---------------------------------------------------------------------------

/** What is obviously missing, before bothering the solver. Null when nothing. */
function problem(level) {
  if (!level.gates.length) return t('editor.status.nogate');
  if (!level.objective.target) return t('editor.status.noblock');
  if (level.blocks.some((b) => b.condition?.type === 'block' && b.condition.id < 0)) return t('editor.status.nokey');
  for (const b of level.blocks) {
    if (b.kind === KIND.WALL || b.kind === KIND.JOKER) continue;
    const reachable = level.gates.some((g) => colorsOf(g).some((c) => colorsOf(b).includes(c)));
    if (!reachable) return t('editor.status.nocolorgate', { color: colorName(b.color) });
  }
  return null;
}

function check() {
  const level = toLevel();
  const issue = problem(level);
  if (issue) { setStatus(issue, 'ko'); return null; }
  setStatus(t('editor.checking'));
  const r = solve(new Board({ ...level, moveLimit: 9999, timeLimit: 9999 }));
  if (r.solvable) {
    lastCheck = { json: JSON.stringify(level), exits: r.order.length };
    onCreated?.();
    setStatus(t('editor.solvable', { n: r.order.length }), 'ok',
      { label: t('editor.submit.short'), run: propose });
  } else {
    setStatus(t(r.gaveUp ? 'editor.status.aborted' : 'editor.status.unsolved'), 'ko');
  }
  return r;
}

function propose() {
  const level = toLevel();
  // The grid must be the very one the solver just cleared: an unsolvable grid
  // sent to everybody is the one flaw this queue must never let through.
  if (!lastCheck || lastCheck.json !== JSON.stringify(level)) {
    setStatus(t('editor.submit.unsolved'), 'ko');
    return;
  }
  const title = prompt(t('editor.submit.ask'), '');
  if (title === null) return;
  // The number of exits in the solution found stands in as a gesture
  // reference: with no reference solution, it is the only honest measure.
  const full = { ...level, minDrags: Math.max(1, lastCheck.exits) };
  keep(full, { title: title.trim(), submitted: true });
  onSubmit?.(full, title.trim());
  setStatus(t('editor.submit.ok'), 'ok');
}

/**
 * Stores the current grid in "My levels". Called when testing and when
 * proposing: the two moments the player shows they care about their grid.
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
      remember();
      importInto(e.level);
      draftId = e.id;
      el('overlay-mine').hidden = true;
      render();
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

// ---------------------------------------------------------------------------
// Buttons and status
// ---------------------------------------------------------------------------

function setStatus(message, tone = '', action = null) {
  const z = el('ed-status');
  z.className = 'ed-status' + (tone ? ` ${tone}` : '');
  const text = document.createElement('span');
  text.textContent = message;
  z.replaceChildren(text);
  if (action) {
    const b = document.createElement('button');
    b.className = 'btn btn-primary btn-sm';
    b.textContent = action.label;
    b.onclick = action.run;
    z.appendChild(b);
  }
}

function wireButtons() {
  for (const b of el('ed-modes').children) {
    b.onclick = () => { mode = b.dataset.mode; panel = 'main'; render(); };
  }
  el('ed-undo').onclick = () => undo();
  el('ed-size').onclick = () => { panel = panel === 'size' ? 'main' : 'size'; renderPanel(); };
  el('ed-check').onclick = () => check();
  el('ed-test').onclick = () => {
    const level = toLevel();
    const issue = problem(level);
    if (issue) { setStatus(issue, 'ko'); return; }
    keep(level);
    onTest?.(level, draftId);
  };
  el('ed-mine').onclick = () => openMyLevels();
}
