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
 * Shards the opened flower holds until the player taps it. Already in the
 * save (meta/bloom.js pays on the win); the purse shows them only once taken.
 */
let bloomHeld = 0;

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
  // The third star is the prize: it lands with more weight (see the sequence).
  // Same size as the others once landed — drawn a size up, it sat off the line.
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

  const goal = el('result-goal');
  const goalParts = [];
  if (r.won && r.newBest) goalParts.push(t('result.best'));
  if (r.won && r.starGoal) goalParts.push(t('result.goal', { n: r.starGoal }));
  if (r.won && r.timeGoal) goalParts.push(t('result.goal.time'));
  goal.hidden = !goalParts.length;
  goal.textContent = goalParts.join(' · ');
  goal.classList.toggle('best', !!(r.won && r.newBest));

  const bloom = fillBloom(r);
  bloomFx = r.fx || {};
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

  // The purse, shown for a win that pays: it starts at what the player had
  // BEFORE this level, and the shards fly into it.
  bloomHeld = r.won && r.bloom?.gift?.kind === 'coins' ? r.bloom.gift.amount : 0;
  const paying = r.won && r.mode !== 'editor' && (r.coinsEarned > 0 || bloomHeld > 0) && Number.isFinite(r.balance);
  el('result-gain').hidden = !paying;
  if (paying) el('result-purse-n').textContent = r.balance - r.coinsEarned - bloomHeld;

  // Double the coins for a rewarded ad: offered only once.
  const double = el('btn-double');
  double.hidden = !r.won || !r.coinsEarned;
  double.disabled = false;
  double.onclick = async () => {
    double.disabled = true;
    const balance = await r.onDouble?.();
    if (balance) {
      el('result-reward').textContent = t('result.reward', { n: r.coinsEarned * 2 });
      double.hidden = true;
      if (paying) flyShards(r.coinsEarned, balance - bloomHeld, r.fx);
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
    el('result-bloom').hidden = true;
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
  if (sequence) playSequence(r, card, novelty, bloom);
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

/** The novelty is announced from this many levels away, not before. */
const NOVELTY_WINDOW = 6;

/** Fills the bar's text and icon; returns the fill fractions, or null when hidden. */
function fillNovelty(r) {
  const box = el('result-novelty');
  const ahead = r.won && r.level ? nextNovelty(r.level) : null;
  const left = ahead ? ahead.at - r.level : Infinity; // levels to play; 1 = the next one
  // Only once it is close: "in 20 levels" on every win was noise (playtest).
  box.hidden = left > NOVELTY_WINDOW;
  box.classList.remove('reached');
  if (box.hidden) return null;
  // The bar counts down the last NOVELTY_WINDOW levels, one notch per win.
  const after = Math.min(1, (NOVELTY_WINDOW - left + 1) / NOVELTY_WINDOW);
  const before = Math.max(0, (NOVELTY_WINDOW - left) / NOVELTY_WINDOW);
  el('novelty-icon').textContent = noveltyMark(ahead.realm);
  el('novelty-text').textContent = left <= 1 ? t('result.novelty.next') : t('result.novelty', { n: left });
  el('novelty-name').textContent = realmText(ahead.realm, 'introduces');
  el('novelty-fill').style.width = `${after * 100}%`;
  return { before, after, reached: left <= 1 };
}

// ---------------------------------------------------------------------------
// The flower (meta/bloom.js)
// ---------------------------------------------------------------------------

/** A petal, base at the flower's heart (20, 20), tip at the top. */
const PETAL = 'M20 20C12.6 15.2 13.2 6.4 20 2.8C26.8 6.4 27.4 15.2 20 20Z';
/** Its sheen: a thin light stroke along one flank. */
const GLOSS = 'M18.6 15.5C16.3 12.6 16.6 8.4 19 6.2C18 9.2 18 12.4 18.6 15.5Z';

/**
 * Five petals around a heart, `lit` of them coloured. Each petal is an empty
 * bed with its coloured self over it — a gradient from a pale base to the
 * realm's hue at the tip, and a sheen — so lighting one is a fade and a
 * growth, not a flat swap of colour.
 */
function flowerSvg(total, lit) {
  const petals = Array.from({ length: total }, (_, i) =>
    `<g class="petal${i < lit ? ' on' : ''}" style="transform: rotate(${(360 / total) * i}deg)">`
    + `<path class="bed" d="${PETAL}"/><path class="lit" d="${PETAL}"/><path class="gloss" d="${GLOSS}"/>`
    + `<circle class="spark" cx="20" cy="3.2" r="1.6"/></g>`).join('');
  return `<svg viewBox="0 0 40 40"><defs>`
    + `<linearGradient id="bloom-petal" x1="0" y1="1" x2="0" y2="0">`
    + `<stop offset="0" class="stop-base"/><stop offset="0.55" class="stop-mid"/><stop offset="1" class="stop-tip"/>`
    + `</linearGradient>`
    + `<radialGradient id="bloom-heart" cx="0.4" cy="0.35" r="0.7">`
    + `<stop offset="0" stop-color="#fff3c9"/><stop offset="1" stop-color="#d9a441"/></radialGradient>`
    + `</defs>${petals}<circle class="heart" cx="20" cy="20" r="4"/></svg>`;
}

/** Lights the petal `g` with a bloom of colour: it grows out of the heart, flashes, settles. */
function lightPetal(g, fx) {
  g.classList.add('on');
  play(g.querySelector('.lit'), [
    { transform: 'scale(0.25)', opacity: 0, filter: 'brightness(1.7) saturate(1.4)' },
    { transform: 'scale(1.14)', opacity: 1, filter: 'brightness(1.35) saturate(1.2)', offset: 0.6 },
    { transform: 'scale(1)', opacity: 1, filter: 'brightness(1) saturate(1)' },
  ], { duration: 620, easing: 'cubic-bezier(.2,1.1,.35,1)' });
  play(g.querySelector('.gloss'), [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 0.55 }],
    { duration: 700, easing: 'ease-out' });
  play(g.querySelector('.spark'), [
    { transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.6)', opacity: 1, offset: 0.45 },
    { transform: 'scale(0.4)', opacity: 0 },
  ], { duration: 640, delay: 220, easing: 'ease-out' });
  fx?.star?.();
}

/** Fills the flower's row in its BEFORE state; returns what the sequence plays, or null. */
function fillBloom(r) {
  const box = el('result-bloom');
  const b = r.won ? r.bloom : null;
  box.hidden = !b;
  box.classList.remove('open', 'ready');
  delete box.dataset.collected;
  el('bloom-gift').hidden = true;
  if (!b) return null;
  // A tap explains the flower while it grows. Opened, the tap is the gift's:
  // the player picks it, then the flower closes (see `collectBloom`).
  explainBloom = () => r.onBloomInfo?.();
  box.classList.toggle('explains', !b.gift);
  box.onclick = b.gift ? () => collectBloom(b) : explainBloom;
  el('bloom-flower').innerHTML = flowerSvg(b.total, b.before);
  el('bloom-text').textContent = bloomText(b);
  el('bloom-gift').textContent = b.giftText || '';
  return b;
}

function bloomText(b) {
  if (b.gift) return t('bloom.tap');
  const left = b.total - b.after;
  return left === 1 ? t('bloom.one') : t('bloom.left', { n: left });
}

/** The flower in its AFTER state: the new petal in, and opened — waiting for a tap — if it was the last. */
function settleBloom(b) {
  const box = el('result-bloom');
  if (b.gift && box.dataset.collected) return;
  const petals = el('bloom-flower').querySelectorAll('.petal');
  for (let i = 0; i < b.after; i++) petals[i]?.classList.add('on');
  if (b.gift) box.classList.add('open', 'ready');
}

let explainBloom = null;
let bloomFx = {};

/**
 * The opened flower, tapped: its gift comes out — shards into the purse, a
 * hint or a hammer rising out of it — then the petals fold back one by one
 * and a new flower starts, empty, explained on a tap like any growing one.
 */
async function collectBloom(b) {
  const box = el('result-bloom');
  if (!b.gift || box.dataset.collected) return;
  box.dataset.collected = '1';
  box.onclick = null;
  settleBloom({ ...b, gift: null });
  box.classList.remove('ready');
  bloomFx.pop?.();
  el('bloom-text').textContent = t('bloom.open');
  el('bloom-gift').hidden = false;
  play(el('bloom-gift'), [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
    { duration: 380, easing: 'ease-out' });
  play(el('bloom-flower'), [
    { transform: 'rotate(0) scale(1)' }, { transform: 'rotate(36deg) scale(1.3)', offset: 0.5 },
    { transform: 'rotate(72deg) scale(1)' },
  ], { duration: 700, easing: 'cubic-bezier(.3,.8,.3,1)' });
  if (b.gift.kind === 'coins' && !el('result-gain').hidden) {
    const shown = Number(el('result-purse-n').textContent) || 0;
    const held = bloomHeld;
    bloomHeld = 0;
    flyShards(held, shown + held, bloomFx);
  } else if (b.gift.kind !== 'coins') {
    givePresent(b.gift);
  }
  await pause(1500);
  if (!box.isConnected || box.hidden) return;

  // The flower closes: the petals fold back, the last first.
  const petals = [...el('bloom-flower').querySelectorAll('.petal')];
  for (let i = petals.length - 1; i >= 0; i--) {
    play(petals[i].querySelector('.lit'), [
      { transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.3)', opacity: 0 },
    ], { duration: 300, easing: 'ease-in' }).then(() => petals[i].classList.remove('on'));
    await pause(80);
  }
  await pause(220);
  box.classList.remove('open');
  el('bloom-gift').hidden = true;
  el('bloom-text').textContent = t('bloom.left', { n: b.total });
  box.classList.add('explains');
  box.onclick = explainBloom;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A hint or a hammer out of the flower: its icon (the booster bar's own) rises
 * from the flower with "+1", lingers a beat and floats up out of sight — the
 * present is seen leaving the flower for the player's stock.
 */
function givePresent(gift) {
  const source = document.querySelector(gift.kind === 'hammer' ? '#btn-hammer svg' : '#btn-hint svg');
  const overlay = el('overlay-result');
  const flower = el('bloom-flower');
  if (!source || !flower) return;
  const box = overlay.getBoundingClientRect(), f = flower.getBoundingClientRect();
  const chip = document.createElement('span');
  chip.className = 'bloom-present';
  chip.append(source.cloneNode(true), `+${gift.amount}`);
  chip.style.left = `${f.left + f.width / 2 - box.left}px`;
  chip.style.top = `${f.top + f.height / 2 - box.top}px`;
  overlay.appendChild(chip);
  chip.animate([
    { transform: 'translate(-50%, -50%) scale(0.3)', opacity: 0 },
    { transform: 'translate(-50%, calc(-50% - 46px)) scale(1.18)', opacity: 1, offset: 0.25 },
    { transform: 'translate(-50%, calc(-50% - 54px)) scale(1)', opacity: 1, offset: 0.7 },
    { transform: 'translate(-50%, calc(-50% - 120px)) scale(0.8)', opacity: 0 },
  ], { duration: 1700, easing: 'cubic-bezier(.25,.8,.35,1)' }).finished.then(() => chip.remove(), () => chip.remove());
}

// ---------------------------------------------------------------------------
// The win sequence
// ---------------------------------------------------------------------------

function playSequence(r, card, novelty, bloom) {
  const seq = skippable();
  const paying = !el('result-gain').hidden;
  run = seq;
  const fx = r.fx || {};
  const earned = [...el('result-stars').children].slice(0, r.stars);
  const streak = el('result-streak');
  const next = el('btn-result-next');
  const late = [el('btn-double'), el('result-banner')];

  // Everything that arrives later starts invisible, keeping its place: the
  // card does not change size as the sequence fills it.
  const staged = [...earned, el('result-score').parentElement, el('result-time'),
    el('result-goal'), el('result-reward'), el('result-gain'), streak, el('result-bloom'), el('result-novelty'),
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
    if (bloom) settleBloom(bloom);
    // Shards still in the air: gone, the purse shows its final count at once.
    for (const s of el('overlay-result').querySelectorAll('.shard-flying')) s.remove();
    if (paying) el('result-purse-n').textContent = r.balance - bloomHeld;
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
        { transform: `translateY(-34px) scale(${big ? 2.4 : 1.9})`, opacity: 0, filter: 'brightness(1.8) blur(1px)' },
        { transform: 'translateY(0) scale(0.92)', opacity: 1, filter: 'brightness(1.5) blur(0)', offset: 0.6 },
        { transform: `translateY(0) scale(${big ? 1.25 : 1.06})`, filter: 'brightness(1.15)', offset: 0.8 },
        { transform: 'translateY(0) scale(1)', opacity: 1, filter: 'brightness(1)' },
      ], { duration: big ? 520 : 380, easing: 'cubic-bezier(.3,.7,.4,1)' });
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
      for (const n of [score.parentElement, el('result-time'), el('result-goal'), reward, el('result-gain')]) reveal(n);
      await countUp(seq, 550, (k) => {
        score.textContent = Math.round(r.score * k);
        reward.textContent = t('result.reward', { n: Math.round(r.coinsEarned * k) });
      }, () => fx.tick?.());
      score.textContent = r.score;
      reward.textContent = finalReward;
      // The shards leave the line and fly into the purse.
      if (paying && !seq.skipped) {
        await flyShards(r.coinsEarned, r.balance - bloomHeld, fx);
      }
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

    // The flower: the new petal unfurls; the fifth opens it on its gift.
    if (!seq.skipped && bloom) {
      const row = el('result-bloom');
      reveal(row);
      play(row, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
        { duration: 300, easing: 'ease-out' });
      await seq.wait(220);
      const petal = el('bloom-flower').querySelectorAll('.petal')[bloom.after - 1];
      if (petal && !seq.skipped) lightPetal(petal, fx);
      await seq.wait(bloom.gift ? 420 : 260);
      // Complete: the flower opens and waits, breathing, for the player's tap.
      if (bloom.gift && !seq.skipped) {
        settleBloom(bloom);
        fx.pop?.();
        play(el('bloom-flower'), [
          { transform: 'scale(1)' }, { transform: 'scale(1.3)', offset: 0.55 }, { transform: 'scale(1)' },
        ], { duration: 700, easing: 'cubic-bezier(.3,.8,.3,1)' });
        await seq.wait(500);
      }
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

// ---------------------------------------------------------------------------
// Shards flying into the purse
// ---------------------------------------------------------------------------

/** Never more than this many flying: a big reward flies denser, not longer. */
const MAX_SHARDS = 12;

/**
 * `amount` shards slip out from behind the card, then curve back in over it
 * and land in the purse one after another; each landing bumps the purse,
 * ticks its count up a share and buzzes. The count ends on `balance`.
 * Resolves once the last has landed.
 */
function flyShards(amount, balance, fx = {}) {
  const overlay = el('overlay-result');
  const card = overlay.querySelector('.result-card');
  const purse = el('result-purse');
  const count = el('result-purse-n');
  const target = purse.querySelector('.shard');
  const start = balance - amount;
  if (reducedMotion() || document.hidden) { count.textContent = balance; return Promise.resolve(); }

  const box = overlay.getBoundingClientRect();
  const c = card.getBoundingClientRect(), b = target.getBoundingClientRect();
  const bx = b.left + b.width / 2 - box.left, by = b.top + b.height / 2 - box.top;
  const n = Math.max(3, Math.min(MAX_SHARDS, Math.round(amount / 3)));
  let landed = 0;

  const flights = Array.from({ length: n }, (_, i) => new Promise((resolve) => {
    const shard = document.createElement('i');
    shard.className = 'shard shard-flying';
    // Hidden behind one side of the card, at the purse's height or so…
    const side = i % 2 ? 1 : -1;
    const edge = side < 0 ? c.left - box.left : c.right - box.left;
    const sy = by + (Math.random() - 0.5) * c.height * 0.5;
    const hx = edge - side * 26;                       // behind the card
    const ox = edge + side * (22 + Math.random() * 26); // …peeking out
    const oy = sy + (Math.random() - 0.5) * 40;
    shard.style.left = `${hx}px`;
    shard.style.top = `${sy}px`;
    overlay.appendChild(shard);
    const spin = side * (180 + Math.random() * 180);
    const delay = i * 60;
    // 1. Out from behind the card (under it: the card hides the start).
    const out = shard.animate([
      { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 0 },
      { transform: `translate(calc(-50% + ${ox - hx}px), calc(-50% + ${oy - sy}px)) scale(1.15)`, opacity: 1 },
    ], { duration: 300, delay, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' });
    const land = () => {
      // Swept away by a tap that ended the sequence: the count is already final.
      if (!shard.isConnected) { resolve(); return; }
      shard.remove();
      landed++;
      count.textContent = Math.round(start + (amount * landed) / n);
      purse.classList.remove('bump');
      void purse.offsetWidth;
      purse.classList.add('bump');
      if (landed % 3 === 1) fx.star?.();
      resolve();
    };
    out.finished.then(() => {
      if (!shard.isConnected) { resolve(); return; }
      // 2. Over the card now, a curve back in to the purse.
      shard.classList.add('over');
      const mx = (ox + bx) / 2, my = Math.min(oy, by) - 30 - Math.random() * 40;
      const fly = shard.animate([
        { transform: `translate(calc(-50% + ${ox - hx}px), calc(-50% + ${oy - sy}px)) scale(1.15) rotate(0deg)` },
        { transform: `translate(calc(-50% + ${mx - hx}px), calc(-50% + ${my - sy}px)) scale(1) rotate(${spin / 2}deg)`, offset: 0.5 },
        { transform: `translate(calc(-50% + ${bx - hx}px), calc(-50% + ${by - sy}px)) scale(0.6) rotate(${spin}deg)` },
      ], { duration: 520 + Math.random() * 120, easing: 'cubic-bezier(.45,.05,.4,1)', fill: 'forwards' });
      fly.finished.then(land, land);
    }, land);
  }));
  return Promise.all(flights).then(() => { if (landed) count.textContent = balance; });
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
