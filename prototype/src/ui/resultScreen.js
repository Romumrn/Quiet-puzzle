/**
 * ResultScreen — equivalent of Scripts/UI/ResultScreen.cs (tech doc §4)
 * End-of-level overlay: win (stars, score, reward) or failure.
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
    : r.reason === 'time' ? 'result.timeout.title' : 'result.nomoves.title');
  renderStars(el('result-stars'), r.won ? r.stars : 0);
  el('result-score').textContent = r.score;

  // The time taken, small, under the drag count. The clock disappears the
  // moment the grid empties, and that is precisely when you want to know how
  // long it took — without that figure competing with the stars.
  const clock = el('result-time');
  const duration = Number(r.duration);
  clock.hidden = !r.won || !Number.isFinite(duration) || duration <= 0;
  if (!clock.hidden) {
    const min = Math.floor(duration / 60);
    const sec = String(duration % 60).padStart(2, '0');
    clock.textContent = t('result.time', { time: min ? `${min}:${sec}` : `${duration} s` });
  }
  el('result-reward').textContent = r.won
    ? t('result.reward', { n: r.coinsEarned })
    : t(r.reason === 'time' ? 'result.timeout.sub' : 'result.nomoves.sub');

  // A near miss: saying so is motivating and honest — it is the real gap.
  const near = el('result-near');
  if (!r.won && r.remaining > 0 && r.remaining <= 2) {
    near.textContent = r.remaining === 1
      ? t('result.near.one') : t('result.near', { n: r.remaining });
    near.hidden = false;
  } else {
    near.hidden = true;
  }

  // Double the coins for a rewarded ad: offered only once.
  const double = el('btn-double');
  double.hidden = !r.won || !r.coinsEarned;
  double.disabled = false;
  double.onclick = async () => {
    double.disabled = true;
    const ok = await r.onDouble?.();
    if (ok) {
      el('result-reward').textContent = t('result.reward', { n: r.coinsEarned * 2 });
      double.hidden = true;
    } else {
      double.disabled = false;
    }
  };

  /**
   * A level tried out from the editor leads nowhere: "Next" has no next, and
   * "Map" would send the player far from what they are doing. The three buttons
   * keep their place and change role — tweak the grid, replay it, submit it.
   */
  if (r.mode === 'editor') {
    const [left, middle, right] = [el('btn-result-map'), el('btn-result-retry'), el('btn-result-next')];
    left.textContent = t('editor.edit');
    middle.textContent = t('result.retry');
    right.textContent = t('editor.submit.short');
    right.hidden = false;
    left.onclick = () => { hide(); r.onEdit?.(); };
    middle.onclick = () => { hide(); r.onRetry?.(); };
    right.onclick = () => { hide(); r.onSubmit?.(); };
    el('overlay-result').hidden = false;
    return;
  }

  // Back to the normal labels: the screen is shared with the editor mode, which
  // rewrites all three buttons.
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

  const banner = el('result-banner');
  const showBanner = r.won && !r.noAds;
  banner.hidden = !showBanner;
  if (showBanner) r.onBannerShown?.();

  el('overlay-result').hidden = false;
}

export function hide() {
  el('overlay-result').hidden = true;
}
