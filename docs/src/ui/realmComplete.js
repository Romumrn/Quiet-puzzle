/**
 * RealmComplete — the celebration overlay shown instead of the normal result
 * screen when a level's win is also the last level of its realm: confetti,
 * the realm just cleared, and a preview of what the next one introduces.
 */

import { t, realmText } from './i18n.js';
import { renderStars } from './screens.js';
import { burst } from '../render/confetti.js';

const el = (id) => document.getElementById(id);

/**
 * @param {{realm:object, next:object|null, stars:number, coinsEarned:number,
 *          onContinue:Function}} r
 *   `realm` is the realm just finished, `next` the one that follows (or
 *   `null` if `realm` was the last one in the game). `stars`/`coinsEarned`
 *   are the FINAL level's own reward — the celebration replaces its result
 *   screen rather than stacking on top of it, so that reward still has to be
 *   shown somewhere.
 */
export function show({ realm, next, stars, coinsEarned, onContinue }) {
  el('realm-done-name').textContent = realmText(realm, 'name');
  renderStars(el('realm-stars'), stars);
  el('realm-reward').textContent = t('result.reward', { n: coinsEarned });

  el('realm-next').hidden = !next;
  if (next) {
    el('realm-next-name').textContent = realmText(next, 'name');
    const intro = realmText(next, 'introduces');
    el('realm-next-intro').hidden = !intro;
    el('realm-next-intro').textContent = intro ? t('brief.new', { what: intro }) : '';
  }

  const btn = el('btn-realm-continue');
  btn.textContent = next ? t('realm.continue') : t('result.map');
  btn.onclick = () => { hide(); onContinue?.(); };

  el('overlay-realm').hidden = false;
  burst(el('realm-confetti'), realm.palette);
}

export function hide() {
  el('overlay-realm').hidden = true;
}
