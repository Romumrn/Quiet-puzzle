/**
 * ResultScreen — equivalent of Scripts/UI/ResultScreen.cs (tech doc §4)
 * End-of-level overlay: win (stars, score, reward) or failure.
 *
 * A WIN is played as a sequence rather than shown in one go (~2.5 s): the card
 * lands, the stars drop one by one, the score and the shards count up, the
 * streak pops, the "next novelty" bar fills — and only then the buttons, "Next"
 * first, the ad-driven ones a second later so they do not break the moment. A
 * tap anywhere jumps to the end; reduced motion shows the end at once. The
 * defeat screen and the editor's trial screen are shown as before.
 */

import { totalLevels, nextNovelty } from '../data/levelStore.js';
import { t, realmText } from './i18n.js';
import { renderStars } from './screens.js';
import { play, skippable, reducedMotion, flameSvg } from '../render/motion.js';

const el = (id) => document.getElementById(id);

/** The sequence running, if any — a new `show()` or a tap ends it. */
let run = null;

/**
 * @param {{won:boolean, stars:number, score:number, level:number,
 *          coinsEarned:number, onRetry:Function, onMap:Function, onNext:Function,
 *          fx?:{star:Function, tick:Function, pop:Function}}} r
 */
export function show(r) {
  run?.skip();
  run = null;
  const card = el('overlay-result').querySelector('.result-card');
  const sequence = r.won && r.mode !== 'editor';
  card.classList.toggle('seq', sequence);
  for (const n of card.querySelectorAll('.pending')) n.classList.remove('pending');
  el('btn-result-next').classList.remove('pulse');

  el('result-title').textContent = t(r.won ? 'result.won'
    : r.reason === 'time' ? 'result.timeout.title' : 'result.nomoves.title');
  renderStars(el('result-stars'), r.won ? r.stars : 0);
  // The third star is the prize: drawn a size up.
  if (r.won && r.stars === 3) el('result-stars').children[2].classList.add('big');
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

  // A streak of at least 2 wins in a row: a single win is just... a win, not
  // yet a "streak" worth calling out. The tier (1/2/3) drives the CSS — the
  // flame grows and brightens with each — rather than an inline size computed
  // in JS, to keep the escalation as a look defined once in CSS.
  const streak = el('result-streak');
  const n = r.won ? (r.levelStreak || 0) : 0;
  streak.hidden = n < 2;
  if (n >= 2) {
    streak.className = 'result-streak streak-' + (n >= 10 ? 3 : n >= 5 ? 2 : 1);
    // The count sits in a little window where N-1 rolls up and out as N comes
    // in; the sentence around it comes from the translation, split at {n}.
    const [before, after = ''] = t('result.streak', { n: '\u0001' }).split('\u0001');
    streak.innerHTML = `${flameSvg('streak-flame')}<span></span>`
      + `<span class="streak-num"><i class="old">${n - 1}</i><i class="new">${n}</i></span><span></span>`;
    streak.children[1].textContent = before;
    streak.children[3].textContent = after;
  }

  const novelty = fillNovelty(r);

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
    el('result-novelty').hidden = true;
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
  el('btn-result-retry').hidden = false;

  el('btn-result-map').onclick = r.onMap;
  el('btn-result-retry').onclick = r.onRetry;
  next.onclick = r.onNext;

  const banner = el('result-banner');
  const showBanner = r.won && !r.noAds;
  banner.hidden = !showBanner;
  if (showBanner) r.onBannerShown?.();

  el('overlay-result').hidden = false;
  if (sequence) playSequence(r, card, novelty);
}

export function hide() {
  run?.skip();
  run = null;
  el('overlay-result').hidden = true;
}

// ---------------------------------------------------------------------------
// "Next novelty in N levels"
// ---------------------------------------------------------------------------

/**
 * A mark for what a realm brings, in the board's own vocabulary (the marks the
 * blocks and gates carry), keyed on the English label of `introduces`. A
 * combination realm shows its first ingredient.
 */
const NOVELTY_MARKS = [
  [/rail/, '↔'], [/sealed|wall/, '■'], [/colour seal|seals that wait/, '●'], [/\blocks?\b/, '◔'],
  [/joker/, '✳'], [/anchor/, '➜'], [/capacity/, '③'], [/heavy/, '×2'],
  [/two-colour/, '◐'], [/narrow|two cells wide/, '▯'], [/large|one-cell/, '▦'],
  [/shared|two colours at once/, '⇄'], [/key/, '◈'], [/one-way/, '›'],
  [/late/, '◷'], [/slide/, '≋'],
];

function noveltyMark(realm) {
  const label = String(realm.introduces?.en ?? realm.introduces ?? '').toLowerCase();
  // First ingredient: the earliest match in the label, not the first rule.
  let best = null;
  for (const [re, mark] of NOVELTY_MARKS) {
    const m = label.match(re);
    if (m && (!best || m.index < best.index)) best = { index: m.index, mark };
  }
  return best?.mark ?? '✦';
}

/** Fills the bar's text and icon; returns the fill fractions, or null when hidden. */
function fillNovelty(r) {
  const box = el('result-novelty');
  const ahead = r.won && r.level ? nextNovelty(r.level) : null;
  box.hidden = !ahead;
  box.classList.remove('reached');
  if (!ahead) return null;
  const left = ahead.at - r.level;              // levels to play; 1 = the next one
  const span = Math.max(1, ahead.at - ahead.from);
  const after = Math.min(1, (r.level - ahead.from + 1) / span);
  const before = Math.max(0, (r.level - ahead.from) / span);
  el('novelty-icon').textContent = noveltyMark(ahead.realm);
  el('novelty-text').textContent = left <= 1 ? t('result.novelty.next') : t('result.novelty', { n: left });
  el('novelty-name').textContent = realmText(ahead.realm, 'introduces');
  el('novelty-fill').style.width = `${after * 100}%`;
  return { before, after, reached: left <= 1 };
}

// ---------------------------------------------------------------------------
// The win sequence
// ---------------------------------------------------------------------------

function playSequence(r, card, novelty) {
  const seq = skippable();
  run = seq;
  const fx = r.fx || {};
  const earned = [...el('result-stars').children].slice(0, r.stars);
  const streak = el('result-streak');
  const next = el('btn-result-next');
  const late = [el('btn-double'), el('result-banner')];

  // Everything that arrives later starts invisible, keeping its place: the
  // card does not change size as the sequence fills it.
  const staged = [...earned, el('result-score').parentElement, el('result-time'),
    el('result-reward'), streak, el('result-novelty'),
    card.querySelector('.result-actions'), ...late];
  for (const n of staged) n.classList.add('pending');
  const reveal = (n) => n.classList.remove('pending');
  // The bar starts where the last win left it, without animating back there.
  const fill = el('novelty-fill');
  if (novelty) {
    fill.style.transition = 'none';
    fill.style.width = `${novelty.before * 100}%`;
    void fill.offsetWidth;
    fill.style.transition = '';
  }

  const reward = el('result-reward');
  const score = el('result-score');
  const finalReward = reward.textContent;

  /** Everything in its final state, now. */
  const finish = () => {
    for (const a of card.getAnimations({ subtree: true })) {
      if (!(a instanceof CSSAnimation) && !(a instanceof CSSTransition)) a.finish();
    }
    for (const n of staged) reveal(n);
    score.textContent = r.score;
    reward.textContent = finalReward;
    streak.classList.add('rolled');
    if (novelty) el('novelty-fill').style.width = `${novelty.after * 100}%`;
    if (novelty?.reached) el('result-novelty').classList.add('reached');
    if (!next.hidden) next.classList.add('pulse');
  };

  if (reducedMotion()) { finish(); run = null; return; }

  // A tap during the sequence ends it — and only ends it: the click that
  // follows must not land on a button that has just appeared under the finger.
  const overlay = el('overlay-result');
  const onTap = () => {
    if (seq.skipped) return;
    seq.skip();
    finish();
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    overlay.addEventListener('click', swallow, true);
    setTimeout(() => overlay.removeEventListener('click', swallow, true), 400);
  };
  overlay.addEventListener('pointerdown', onTap, true);

  (async () => {
    // 1. The card lands with a slight bounce.
    play(card, [
      { transform: 'scale(0.9)', opacity: 0 },
      { transform: 'scale(1.025)', opacity: 1, offset: 0.65 },
      { transform: 'scale(1)', opacity: 1 },
    ], { duration: 420, easing: 'cubic-bezier(.25,.8,.35,1)' });
    await seq.wait(260);

    // 2. The stars drop one by one: a soft flash, a chime a step higher each
    //    time, a light buzz. The third lands heavier and makes the card shiver.
    for (let i = 0; i < earned.length && !seq.skipped; i++) {
      const star = earned[i];
      const big = star.classList.contains('big');
      reveal(star);
      play(star, [
        { transform: 'translateY(-34px) scale(1.9)', opacity: 0, filter: 'brightness(1.8) blur(1px)' },
        { transform: 'translateY(0) scale(0.92)', opacity: 1, filter: 'brightness(1.5) blur(0)', offset: 0.6 },
        { transform: 'translateY(0) scale(1.06)', filter: 'brightness(1.15)', offset: 0.8 },
        { transform: 'translateY(0) scale(1)', opacity: 1, filter: 'brightness(1)' },
      ], { duration: big ? 460 : 380, easing: 'cubic-bezier(.3,.7,.4,1)' });
      await seq.wait(big ? 230 : 190);
      fx.star?.(i, big);
      if (big) {
        play(card, [
          { transform: 'rotate(0) scale(1)' }, { transform: 'rotate(-0.7deg) scale(1.012)' },
          { transform: 'rotate(0.5deg) scale(1.006)' }, { transform: 'rotate(0) scale(1)' },
        ], { duration: 300, easing: 'ease-out' });
      }
      await seq.wait(big ? 150 : 70);
    }

    // 3. The score and the shards count up from zero.
    if (!seq.skipped) {
      for (const n of [score.parentElement, el('result-time'), reward]) reveal(n);
      await countUp(seq, 550, (k) => {
        score.textContent = Math.round(r.score * k);
        reward.textContent = t('result.reward', { n: Math.round(r.coinsEarned * k) });
      }, () => fx.tick?.());
      score.textContent = r.score;
      reward.textContent = finalReward;
    }

    // 4. The streak, last of the rewards, with a pop — and its count rolls.
    if (!seq.skipped && !streak.hidden) {
      reveal(streak);
      fx.pop?.();
      play(streak, [
        { transform: 'scale(0.6)', opacity: 0 },
        { transform: 'scale(1.12)', opacity: 1, offset: 0.6 },
        { transform: 'scale(1)', opacity: 1 },
      ], { duration: 420, easing: 'cubic-bezier(.2,1.2,.4,1)' });
      await seq.wait(180);
      streak.classList.add('rolled');
    }

    // The next novelty: the bar fills its notch; reached, it lights up.
    if (!seq.skipped && novelty) {
      reveal(el('result-novelty'));
      play(el('result-novelty'), [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
        { duration: 300, easing: 'ease-out' });
      await seq.wait(60);
      fill.style.width = `${novelty.after * 100}%`;
      await seq.wait(novelty.reached ? 480 : 300);
      if (novelty.reached && !seq.skipped) {
        el('result-novelty').classList.add('reached');
        fx.pop?.();
      }
    }

    // 5. The buttons, "Next" first and gently pulsing; the ad-driven ones a
    //    second later, once the moment has landed.
    if (!seq.skipped) {
      const actions = card.querySelector('.result-actions');
      reveal(actions);
      play(actions, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
        { duration: 320, easing: 'ease-out' });
      if (!next.hidden) next.classList.add('pulse');
      await seq.wait(1000);
    }
    if (!seq.skipped) {
      for (const n of late) {
        reveal(n);
        play(n, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' });
      }
    }
    overlay.removeEventListener('pointerdown', onTap, true);
    if (run === seq) run = null;
  })();
}

/** Drives `step(k)` from 0 to 1 over `ms`, calling `tick()` every few frames. */
function countUp(seq, ms, step, tick) {
  return new Promise((resolve) => {
    // No frames while the page is hidden: jump to the end rather than hang.
    if (document.hidden) { step(1); resolve(); return; }
    const start = performance.now();
    let lastTick = 0;
    const frame = (now) => {
      if (seq.skipped) { resolve(); return; }
      const k = Math.min(1, (now - start) / ms);
      step(1 - (1 - k) ** 2);
      if (now - lastTick > 75 && k < 1) { lastTick = now; tick(); }
      if (k < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}
