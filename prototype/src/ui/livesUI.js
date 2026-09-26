/**
 * Hearts on screen: the small pill (menu, map, level preview) and the lives
 * card behind it.
 *
 * Soft on purpose. The pill is the same size as the move counter, the timer
 * only appears while a heart is missing, and nothing turns red: running out
 * reads as a pause, not a punishment. The rules live in meta/lives.js.
 *
 * One card, two ways in:
 *  - tapping a pill (`mode: 'info'`): the five hearts, the time to the next
 *    one, and a heart for an ad or for coins. It stays open after a purchase —
 *    the player may want more than one;
 *  - starting a level with no heart left (`mode: 'pause'`): the same card
 *    titled "short break", which closes as soon as there is a heart to play
 *    with, and lets the level start.
 */

import * as lives from '../meta/lives.js';
import * as currency from '../monetization/currency.js';
import { PLACEMENT } from '../monetization/brokerManager.js';
import { t } from './i18n.js';
import { toast } from './screens.js';

/**
 * Ads do not work yet: the button grants the heart whether or not one played.
 * Switch to false once the rewarded unit fills, so the heart is earned by the
 * ad again.
 */
const GRANT_WITHOUT_AD = true;

const HEART = '<svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.2 0 3.7 1.3 5.3 3.2 1.6-1.9 3.1-3.2 5.3-3.2 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z"/></svg>';

const el = (id) => document.getElementById(id);
let ticking = null;
let onTick = null;
let ads = null;
let isOpen = false;

/** Builds every `[data-lives]` pill once, then keeps them current. */
export function init(options) {
  ads = options.ads;
  for (const pill of document.querySelectorAll('[data-lives]')) {
    pill.innerHTML = `${HEART}<b class="lives-n"></b><span class="lives-timer"></span>`;
    pill.onclick = () => { if (!isOpen) open('info'); };
  }
  // Five slots, each an outline heart with a full one on top, clipped to what
  // is left of it: whole, half, or nothing.
  el('lives-row').innerHTML = Array.from({ length: lives.MAX_LIVES },
    () => `<span class="lives-slot">${HEART}${HEART}</span>`).join('');
  refresh();
  // Once a second is plenty for a mm:ss timer, and it only rewrites text.
  ticking ??= setInterval(() => { refresh(); onTick?.(); }, 1000);
}

export function refresh() {
  const n = lives.count();
  const missing = n < lives.MAX_LIVES;
  const timer = missing ? lives.clock() : '';
  for (const pill of document.querySelectorAll('[data-lives]')) {
    pill.classList.toggle('empty', n === 0);
    pill.querySelector('.lives-n').textContent = lives.label(n);
    pill.querySelector('.lives-timer').textContent = timer;
    pill.setAttribute('aria-label', t('lives.aria', { n: lives.label(n) }));
  }
}

/**
 * The "short break" card, for a level started with no heart left. Resolves
 * true once there is a heart to play with — bought, or brought back by the
 * timer while the card was open — and false if the player would rather wait.
 */
export function pause() { return open('pause'); }

function open(mode) {
  const panel = el('overlay-lives');
  const pausing = mode === 'pause';
  el('lives-title').textContent = t(pausing ? 'lives.pause.title' : 'lives.title');
  el('btn-lives-close').textContent = t(pausing ? 'lives.pause.later' : 'user.close');
  el('lives-price').textContent = currency.PRICES.LIFE;

  const update = () => {
    const n = lives.count();
    const full = n >= lives.MAX_LIVES;
    el('lives-row').querySelectorAll('.lives-slot').forEach((slot, i) => {
      slot.dataset.fill = n >= i + 1 ? 'full' : n >= i + 0.5 ? 'half' : 'none';
    });
    el('lives-sub').textContent = full ? t('lives.full') : t(pausing ? 'lives.pause.sub' : 'lives.next');
    el('lives-clock').hidden = full;
    el('lives-clock').textContent = lives.clock();
    el('btn-lives-ad').hidden = full;
    // Same rule as the continue offer: a price the player cannot pay is not
    // shown greyed out, it is not shown.
    el('btn-lives-coins').hidden = full || !currency.canAfford(currency.PRICES.LIFE);
  };
  update();
  panel.hidden = false;
  isOpen = true;

  return new Promise((resolve) => {
    const close = (ok) => {
      panel.hidden = true;
      isOpen = false;
      onTick = null;
      el('btn-lives-ad').onclick = null;
      el('btn-lives-coins').onclick = null;
      el('btn-lives-close').onclick = null;
      refresh();
      resolve(ok);
    };
    // A heart gained: the pause has done its job; the info card just updates.
    const gained = () => {
      refresh();
      toast(t('lives.gained'));
      if (pausing) close(true); else update();
    };
    onTick = () => (pausing && lives.canPlay() ? close(true) : update());

    el('btn-lives-ad').onclick = async () => {
      panel.hidden = true;
      const watched = await ads.showRewarded(PLACEMENT.REWARDED_LIFE);
      panel.hidden = false;
      if (watched || GRANT_WITHOUT_AD) {
        lives.gain(1, 'ad');
        gained();
      } else {
        toast(t('shop.ad.failed'));
      }
    };
    el('btn-lives-coins').onclick = () => {
      if (!currency.debit(currency.PRICES.LIFE, 'life')) return;
      lives.gain(1, 'coins');
      // The menu shows the purse right behind the card.
      const purse = el('menu-coins');
      if (purse) purse.textContent = currency.balance();
      gained();
    };
    el('btn-lives-close').onclick = () => close(false);
  });
}
