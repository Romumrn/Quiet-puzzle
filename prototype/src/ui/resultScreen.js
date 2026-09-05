/**
 * ResultScreen — équivalent de Scripts/UI/ResultScreen.cs (doc §4)
 * Overlay de fin de niveau : victoire (étoiles, score, récompense) ou échec.
 */

import { totalLevels } from '../data/levelStore.js';
import { t } from './i18n.js';
import { renderStars } from './screens.js';

const el = (id) => document.getElementById(id);

/**
 * @param {{won:boolean, stars:number, score:number, level:number,
 *          coinsEarned:number, onRetry:Function, onMap:Function, onNext:Function}} r
 */
export function show(r) {
  el('result-title').textContent = t(r.won ? 'result.won'
    : r.raison === 'temps' ? 'result.timeout.title' : 'result.nomoves.title');
  renderStars(el('result-stars'), r.won ? r.stars : 0);
  el('result-score').textContent = r.score;
  el('result-reward').textContent = r.won
    ? t('result.reward', { n: r.coinsEarned })
    : t(r.raison === 'temps' ? 'result.timeout.sub' : 'result.nomoves.sub');

  // Défaite de peu : le dire est motivant et honnête — c'est l'écart réel.
  const proche = el('result-near');
  if (!r.won && r.restants > 0 && r.restants <= 2) {
    proche.textContent = r.restants === 1
      ? t('result.near.one') : t('result.near', { n: r.restants });
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
      el('result-reward').textContent = t('result.reward', { n: r.coinsEarned * 2 });
      doubler.hidden = true;
    } else {
      doubler.disabled = false;
    }
  };

  const isLast = r.level >= totalLevels();
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
