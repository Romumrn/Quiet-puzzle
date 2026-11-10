/**
 * What a special block does — shown when the player TAPS it (input.js tells a
 * tap from a drag). Every special kind is announced once, on its world's first
 * level; after that a player who has forgotten had nothing to ask. A tap is the
 * question "what is this?", so it gets the answer, in full.
 *
 * Plain blocks have nothing to explain and show nothing — unless they stand on
 * a one-way cell: the block then hides the arrow that holds it, and the tap is
 * the only way left to read it.
 */

import { KIND, colorsOf } from '../core/block.js';
import { t, colorName } from './i18n.js';

const ICONS = {
  rail: '↔', joker: '✳', wall: '▪', locked: '🔒', anchor: '⚓',
  bulky: '×2', dual: '◐', slide: '💨', key: '🔑', oneway: '➜',
};

const DIRS = { '1,0': 'right', '-1,0': 'left', '0,1': 'down', '0,-1': 'up' };

/**
 * The directions of the one-way cells a block covers, without repeats — empty
 * when it stands on none. A bar lying across two arrows that disagree is held
 * by both, and can no longer move at all.
 */
export function oneWayUnder(block, board) {
  const dirs = new Set();
  if (!board?.arrows?.size) return [];
  for (const [x, y] of block.absolute()) {
    const a = board.arrows.get(board._key(x, y));
    if (a) dirs.add(DIRS[`${a[0]},${a[1]}`]);
  }
  return [...dirs];
}

function oneWayRule(dirs) {
  return dirs.length === 1
    ? t('info.oneway.one', { dir: t(`info.dir.${dirs[0]}`) })
    : t('info.oneway.stuck');
}

/**
 * @returns {{ icon, title, text } | null} the explanation for this block, or
 *   null for a plain one
 */
export function describe(block, board) {
  const info = describeKind(block, board);
  const dirs = oneWayUnder(block, board);
  if (!dirs.length) return info;
  if (!info) return { icon: ICONS.oneway, title: t('info.oneway.title'), text: oneWayRule(dirs) };
  return { ...info, text: `${info.text}\n\n${oneWayRule(dirs)}` };
}

/**
 * What a capacity gate or a shuttered gate means — the numbers drawn on it —
 * or null for a gate that shows none.
 */
export function describeGate(gate, board) {
  const parts = [];
  if (gate.opensAfter) {
    const left = gate.opensAfter - board.exited.length;
    if (left > 0) parts.push(t('info.gate.shut', { n: gate.opensAfter, left }));
  }
  if (gate.capacity !== undefined) {
    parts.push(gate.capacity > 0 ? t('info.gate.cap', { n: gate.capacity }) : t('info.gate.full'));
  }
  if (!parts.length) return null;
  return { title: t('gate.exit', { color: colorsOf(gate).map(colorName).join(' / ') }), text: parts.join('\n\n') };
}

function describeKind(block, board) {
  if (block.isKey) return entry('key');
  switch (block.kind) {
    case KIND.RAIL: return entry('rail', { axis: t(block.axis === 'h' ? 'info.axis.h' : 'info.axis.v') });
    case KIND.JOKER: return entry('joker');
    case KIND.WALL: return entry('wall');
    case KIND.ANCHOR: return entry('anchor');
    case KIND.BULKY: return entry('bulky');
    case KIND.DUAL: return entry('dual');
    case KIND.SLIDE: return entry('slide');
    case KIND.LOCKED: {
      const c = block.condition || {};
      if (c.type === 'color') return entry('locked', { rule: t('info.locked.color') });
      if (c.type === 'block') return entry('locked', { rule: t('info.locked.key') });
      const left = Math.max(0, (c.count || 0) - board.exited.length);
      return entry('locked', { rule: t('info.locked.exits', { n: c.count || 0, left }) });
    }
    default: return null;
  }
}

function entry(kind, params = {}) {
  return { icon: ICONS[kind], title: t(`info.${kind}.title`), text: t(`info.${kind}.text`, params) };
}
