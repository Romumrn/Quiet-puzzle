/**
 * GameplayUI — equivalent of Scripts/UI/GameplayUI.cs (tech doc §4)
 * In-game HUD: clock, moves left, blocks left, star preview.
 */

import { objectiveLabel } from '../data/levelStore.js';
import { t } from './i18n.js';
import { renderStars } from './screens.js';

const el = (id) => document.getElementById(id);

/** Objective label (reused by the briefing screen). */
export function labelFor(level) { return objectiveLabel(level); }

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

export function mount(level) {
  // The daily puzzle has no number: it carries its title instead. "Level 0"
  // read like a bug, and it very nearly was one.
  const daily = !level.number;
  el('hud-level-word').hidden = daily;
  el('hud-level').textContent = daily ? (level.realm || t('daily.title')) : level.number;
  lastRemaining = null;
}

let lastRemaining = null;

export function update(board) {
  const level = board.level;
  el('hud-moves').textContent = t('hud.moves', { n: board.movesRemaining });

  // The counter twitches as it goes down: a block leaving must be visible in
  // the HUD too, not only on the board.
  const remaining = board.remaining();
  const counter = el('hud-blocks');
  if (lastRemaining !== null && remaining < lastRemaining) {
    counter.classList.add('pop');
    setTimeout(() => counter.classList.remove('pop'), 200);
  }
  lastRemaining = remaining;
  counter.textContent = remaining;
  el('hud-time').textContent = mmss(board.timeRemaining);

  const share = board.timeRemaining / level.timeLimit;
  el('hud-time-fill').style.width = `${Math.max(0, Math.min(1, share)) * 100}%`;
  el('hud-time-fill').classList.toggle('urgent', board.timeRemaining <= 15);
  el('hud-time').classList.toggle('urgent', board.timeRemaining <= 15);

  // Preview: the stars still reachable with the drags already spent.
  const [for3, for2] = level.starDrags;
  const used = board.dragsUsed();
  renderStars(el('hud-stars'), used <= for3 ? 3 : used <= for2 ? 2 : 1);
}
