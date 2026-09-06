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

  // Le temps mis, en petit sous le nombre de glissés. Le chronomètre disparaît
  // au moment où la grille se vide, et c'est justement là qu'on veut savoir
  // combien on a mis — sans que ce chiffre vienne concurrencer les étoiles.
  const chrono = el('result-time');
  const duree = Number(r.duree);
  chrono.hidden = !r.won || !Number.isFinite(duree) || duree <= 0;
  if (!chrono.hidden) {
    const min = Math.floor(duree / 60);
    const sec = String(duree % 60).padStart(2, '0');
    chrono.textContent = t('result.time', { temps: min ? `${min}:${sec}` : `${duree} s` });
  }
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

  /**
   * Un niveau essayé depuis l'éditeur ne mène nulle part : « Suivant » n'a pas
   * de suite, et « Carte » renverrait le joueur loin de ce qu'il est en train
   * de faire. Les trois boutons gardent leur place et changent de rôle —
   * retoucher la grille, la rejouer, la proposer.
   */
  if (r.mode === 'editeur') {
    const [gauche, milieu, droite] = [el('btn-result-map'), el('btn-result-retry'), el('btn-result-next')];
    gauche.textContent = t('editor.edit');
    milieu.textContent = t('result.retry');
    droite.textContent = t('editor.submit.short');
    droite.hidden = false;
    gauche.onclick = () => { hide(); r.onEdit?.(); };
    milieu.onclick = () => { hide(); r.onRetry?.(); };
    droite.onclick = () => { hide(); r.onSubmit?.(); };
    el('overlay-result').hidden = false;
    return;
  }

  // Retour au libellé courant : l'écran est partagé avec le mode éditeur, qui
  // réécrit les trois boutons.
  el('btn-result-map').textContent = t('result.map');
  el('btn-result-retry').textContent = t('result.retry');
  el('btn-result-next').textContent = t('result.next');

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
