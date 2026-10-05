/**
 * GameplayUI — equivalent of Scripts/UI/GameplayUI.cs (tech doc §4)
 * In-game HUD: clock, moves made, star preview.
 */

import { objectiveLabel } from '../data/levelStore.js';
import { t } from './i18n.js';
import { renderStars } from './screens.js';
import { flameSvg } from '../render/motion.js';

const el = (id) => document.getElementById(id);

/** Objective label (reused by the briefing screen). */
export function labelFor(level) { return objectiveLabel(level); }

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

/**
 * @param level the level being played
 * @param streak levels won in a row coming into it — from 3, a small flame
 *   and the count sit next to the level number, discreet: a reason not to lose.
 */
export function mount(level, streak = 0) {
  const chip = el('hud-streak');
  chip.hidden = streak < 3;
  if (streak >= 3) {
    chip.innerHTML = `${flameSvg('hud-flame')}<b></b>`;
    chip.lastChild.textContent = streak;
    chip.title = t('result.streak', { n: streak });
  }
  // The daily puzzle has no number: it carries its title instead. "Level 0"
  // read like a bug, and it very nearly was one.
  const daily = !level.number;
  el('hud-level-word').hidden = daily;
  el('hud-level').textContent = daily ? (level.realm || t('daily.title')) : level.number;
  lastDrags = null;
}

let lastDrags = null;

export function update(board) {
  const level = board.level;
  // Moves made so far — what the stars are counted on. The counter twitches
  // with each one, so the gesture registers in the HUD too.
  const drags = board.dragsUsed();
  const counter = el('hud-drags');
  if (lastDrags !== null && drags !== lastDrags) {
    counter.classList.add('pop');
    setTimeout(() => counter.classList.remove('pop'), 200);
  }
  lastDrags = drags;
  counter.textContent = drags;
  el('hud-time').textContent = mmss(board.timeRemaining);

  const share = board.timeRemaining / level.timeLimit;
  el('hud-time-fill').style.width = `${Math.max(0, Math.min(1, share)) * 100}%`;
  // No red, no alarm as it runs low: the clock only holds the third star, and
  // once stopped it simply fades — the level goes on, at the player's pace.
  el('hud-time').classList.toggle('over', !board.inTime());

  // Preview: the stars still reachable with the drags spent and the clock.
  const reachable = board.dragStars();
  renderStars(el('hud-stars'), board.inTime() ? reachable : Math.min(2, reachable));
}
