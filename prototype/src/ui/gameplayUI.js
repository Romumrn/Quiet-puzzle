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
  // No red, no alarm as it runs low: the clock only holds the stars, and
  // once stopped it simply fades — the level goes on, at the player's pace.
  el('hud-time').classList.toggle('over', !board.inTime());

  // Preview: the stars still reachable with the drags spent and the clock.
  renderStars(el('hud-stars'), board.inTime() ? board.dragStars() : 0);
}

/**
 * What the stars ask, for the card a tap on the HUD's stars opens: the moves
 * for 3★, 2★ and 1★ (`starDrags`, `moveLimit`), and the clock that holds them
 * all — the thresholds were only ever shown for 3★, on the brief.
 */
export function starInfo(board) {
  const { starDrags, moveLimit, timeLimit } = board.level;
  if (!starDrags) return null;
  const lines = [
    t('info.stars.line', { stars: '★★★', n: starDrags[0] }),
    t('info.stars.line', { stars: '★★', n: starDrags[1] }),
  ];
  if (moveLimit > starDrags[1]) lines.push(t('info.stars.line', { stars: '★', n: moveLimit }));
  lines.push(t('info.stars.over', { n: Math.max(moveLimit || 0, starDrags[1]) }));
  return {
    title: t('hud.stars'),
    text: `${lines.join('\n')}\n\n${t('info.stars.time', { time: mmss(timeLimit) })}\n${t('info.stars.now', { n: board.dragsUsed() })}`,
  };
}
