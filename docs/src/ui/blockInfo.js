/**
 * What a special block does — shown when the player TAPS it (input.js tells a
 * tap from a drag). Every special kind is announced once, on its world's first
 * level; after that a player who has forgotten had nothing to ask. A tap is the
 * question "what is this?", so it gets the answer, in full.
 *
 * Plain blocks have nothing to explain and show nothing.
 */

import { KIND } from '../core/block.js';
import { t } from './i18n.js';

const ICONS = {
  rail: '↔', joker: '✳', wall: '▪', locked: '🔒', anchor: '⚓',
  bulky: '×2', dual: '◐', slide: '💨', key: '🔑',
};

/**
 * @returns {{ icon, title, text } | null} the explanation for this block, or
 *   null for a plain one
 */
export function describe(block, board) {
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
