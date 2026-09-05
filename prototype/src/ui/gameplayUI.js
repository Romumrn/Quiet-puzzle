/**
 * GameplayUI — équivalent de Scripts/UI/GameplayUI.cs (doc §4)
 * HUD in-game : chrono, coups restants, blocs restants, aperçu des étoiles.
 */

import { objectiveLabel } from '../data/levelStore.js';
import { t } from './i18n.js';
import { renderStars } from './screens.js';

const el = (id) => document.getElementById(id);

/** Libellé de l'objectif (réutilisé par le pré-niveau). */
export function labelFor(level) { return objectiveLabel(level); }

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

export function mount(level) {
  el('hud-level').textContent = level.number;
  dernierRestant = null;
}

let dernierRestant = null;

export function update(board) {
  const level = board.level;
  el('hud-moves').textContent = t('hud.moves', { n: board.movesRemaining });

  // Le compteur tressaute quand il descend : la sortie d'un bloc doit se voir
  // aussi dans le HUD, pas seulement sur le plateau.
  const restants = board.remaining();
  const compteur = el('hud-blocks');
  if (dernierRestant !== null && restants < dernierRestant) {
    compteur.classList.add('pop');
    setTimeout(() => compteur.classList.remove('pop'), 200);
  }
  dernierRestant = restants;
  compteur.textContent = restants;
  el('hud-time').textContent = mmss(board.timeRemaining);

  const part = board.timeRemaining / level.timeLimit;
  el('hud-time-fill').style.width = `${Math.max(0, Math.min(1, part)) * 100}%`;
  el('hud-time-fill').classList.toggle('urgent', board.timeRemaining <= 15);
  el('hud-time').classList.toggle('urgent', board.timeRemaining <= 15);

  // Aperçu : les étoiles encore atteignables avec les glissés déjà consommés.
  const [pour3, pour2] = level.starDrags;
  const utilises = board.dragsUsed();
  renderStars(el('hud-stars'), utilises <= pour3 ? 3 : utilises <= pour2 ? 2 : 1);
}
