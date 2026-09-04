/**
 * ResultScreen — équivalent de Scripts/UI/ResultScreen.cs (doc §4)
 * Overlay de fin de niveau : victoire (étoiles, score, récompense) ou échec.
 */

import { TOTAL_LEVELS } from '../core/levels.js';
import { renderStars } from './screens.js';

const el = (id) => document.getElementById(id);

/**
 * @param {{won:boolean, stars:number, score:number, level:number,
 *          coinsEarned:number, onRetry:Function, onMap:Function, onNext:Function}} r
 */
export function show(r) {
  el('result-title').textContent = r.won ? 'Grille vidée !'
    : r.raison === 'temps' ? 'Temps écoulé' : 'Plus de coups';
  renderStars(el('result-stars'), r.won ? r.stars : 0);
  el('result-score').textContent = r.score;
  el('result-reward').textContent = r.won
    ? `+${r.coinsEarned} pièces`
    : r.raison === 'temps' ? 'Le chrono est tombé avant la fin' : 'Il ne restait plus de coups';

  // Défaite de peu : le dire est motivant et honnête — c'est l'écart réel.
  const proche = el('result-near');
  if (!r.won && r.restants > 0 && r.restants <= 2) {
    proche.textContent = r.restants === 1
      ? 'Il ne restait qu’un seul bloc !'
      : `Il ne restait que ${r.restants} blocs !`;
    proche.hidden = false;
  } else {
    proche.hidden = true;
  }

  // Doubler les pièces contre une pub récompensée : proposé une seule fois.
  const doubler = el('btn-double');
  doubler.hidden = !r.won || !r.coinsEarned;
  doubler.disabled = false;
  doubler.onclick = async () => {
    doubler.disabled = true;
    const ok = await r.onDouble?.();
    if (ok) {
      el('result-reward').textContent = `+${r.coinsEarned * 2} pièces`;
      doubler.hidden = true;
    } else {
      doubler.disabled = false;
    }
  };

  const isLast = r.level >= TOTAL_LEVELS;
  const next = el('btn-result-next');
  next.hidden = !r.won || isLast;
  el('btn-result-retry').hidden = r.won && !isLast;

  el('btn-result-map').onclick = r.onMap;
  el('btn-result-retry').onclick = r.onRetry;
  next.onclick = r.onNext;
  el('overlay-result').hidden = false;
}

export function hide() {
  el('overlay-result').hidden = true;
}
