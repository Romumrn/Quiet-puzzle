/**
 * LevelScreen — equivalent of Scripts/UI/LevelScreen.cs (tech doc §4)
 * Level map: winding path, stars earned, locking.
 */

import { totalLevels, levelsPerRealm, realms, tierOf } from '../data/levelStore.js';
import * as store from '../data/save.js';
import { renderStars, toast } from './screens.js';
import * as theme from './theme.js';
import { realmText, t } from './i18n.js';
import { play, reducedMotion } from '../render/motion.js';

/** Horizontal offset of the winding path, as a fraction of available width. */
const OFFSETS = [0, 0.62, 0.9, 0.62, 0, -0.62, -0.9, -0.62];

/**
 * Ten quick taps on a LOCKED node used to unlock it — a beta-tester shortcut.
 * It is gone (testers have the debug panel); the taps now get a wink instead,
 * for whoever finds the old trick.
 */
const WINK_TAPS = 10;
const WINK_WINDOW_MS = 700; // a pause this long between two taps resets the count
let tapLevel = null;
let tapCount = 0;
let tapTimer = null;

function registerLockedTap(n) {
  if (tapLevel !== n) { tapLevel = n; tapCount = 0; }
  tapCount++;
  clearTimeout(tapTimer);
  tapTimer = setTimeout(() => { tapLevel = null; tapCount = 0; }, WINK_WINDOW_MS);
  if (tapCount < WINK_TAPS) return;
  tapLevel = null;
  tapCount = 0;
  toast(t('toast.noCheat'));
}

/**
 * How far past the next level the map reaches. Beyond it, nothing: the game is
 * discovered a little at a time, and the ten locked levels that do show fade
 * into the dark the further they are — what comes next is felt, not listed.
 */
const LOOKAHEAD = 10;

/**
 * @param onSelect called with a level number
 * @param reveal `{ level, stars, fx }` when the player comes back right after
 *   winning `level` for the first time: the map is drawn as it was BEFORE that
 *   win, then plays it — the stars light up one by one, a line of light runs
 *   to the next level, which unlocks, and the dusk recedes a notch. Null
 *   otherwise: reopening the map later replays nothing.
 */
export function render(onSelect, reveal = null) {
  const scroll = document.getElementById('map-scroll');
  const unlocked = store.load().unlockedLevel;
  const horizon = unlocked + LOOKAHEAD;
  if (reveal && reducedMotion()) reveal = null;
  // Unlocking is only played when that win is what opened the next level.
  const unlocking = !!reveal && reveal.level + 1 === unlocked;
  // Where the map stood before the win: the frontier one level back.
  const shown = unlocking ? unlocked - 1 : unlocked;
  scroll.replaceChildren();

  for (const realm of realms()) {
    const from = realm.first;
    if (from > horizon) break;

    // Each realm takes the hue of its first level: scrolling the map shows the
    // chromatic gradation of the whole progression.
    const section = document.createElement('section');
    section.className = 'realm';
    theme.applyTo(section, from);

    const label = document.createElement('div');
    label.className = 'realm-label';
    label.textContent = realmText(realm, 'name');
    section.appendChild(label);

    const path = document.createElement('div');
    path.className = 'map-path';

    for (let n = from; n <= realm.last && n <= totalLevels() && n <= horizon; n++) {
      const rec = store.levelRecord(n);
      const locked = n > shown;

      const node = document.createElement('button');
      node.className = 'map-node';
      node.style.transform = `translateX(${OFFSETS[(n - 1) % OFFSETS.length] * 92}px)`;
      // The last level of a realm is markedly harder than the others: the
      // realm's full hue signals it before it is even opened.
      if (n === realm.last) node.classList.add('boss');
      // The sawtooth's other peaks: flagged too, so a hard level is an event
      // the player sees coming rather than a wall they hit (core/sawtooth.js).
      else if (tierOf(n) === 'hard') node.classList.add('hard');
      if (locked) {
        node.classList.add('locked');
        // 0 just past the next level, 1 at the horizon.
        node.style.setProperty('--fog', Math.min(1, (n - shown) / LOOKAHEAD).toFixed(2));
      }
      else if (n === shown) {
        node.classList.add('current');
        // The "Next" label used to be written in the CSS (`content: 'Suivant'`),
        // out of reach of translation. It now goes through an attribute, which
        // the stylesheet merely renders.
        node.dataset.label = t('map.next');
      }
      const replaying = reveal && n === reveal.level;
      if (rec.stars > 0 && !replaying) node.classList.add('done');
      node.dataset.level = n;

      const num = document.createElement('b');
      num.textContent = n;
      const stars = document.createElement('div');
      stars.className = 'stars';
      // The level being revealed starts empty: its stars light up in turn.
      renderStars(stars, replaying ? 0 : rec.stars);
      node.append(num, stars);

      node.addEventListener('click', () => {
        if (n > store.load().unlockedLevel) registerLockedTap(n);
        else onSelect(n);
      });
      path.appendChild(node);
    }
    section.appendChild(path);
    scroll.appendChild(section);
  }

  // Dusk over the whole map — scenery included — from the next level down to
  // the horizon: the part of the game still to discover is in the dark.
  const dusk = document.createElement('div');
  dusk.className = 'map-dusk';
  scroll.appendChild(dusk);

  document.getElementById('map-stars').textContent = `★ ${store.totalStars()}`;

  // Brings the current level in front of the player's eyes.
  requestAnimationFrame(() => {
    const current = scroll.querySelector('.map-node.current');
    placeDusk(scroll, dusk, current);
    current?.scrollIntoView({ block: 'center' });
    if (reveal) setTimeout(() => playReveal(scroll, dusk, reveal, unlocking, unlocked), 450);
  });
}

/** The dusk starts just above the current level and runs to the bottom. */
function placeDusk(scroll, dusk, current) {
  if (!current) { dusk.hidden = true; return; }
  const top = Math.max(0, offsetIn(scroll, current).y - 40);
  dusk.style.top = `${top}px`;
  dusk.style.height = `${scroll.scrollHeight - top}px`;
}

/** An element's top-left and centre within the scrolling map, in its content's coordinates. */
function offsetIn(scroll, el) {
  const r = el.getBoundingClientRect(), s = scroll.getBoundingClientRect();
  const x = r.left - s.left + scroll.scrollLeft, y = r.top - s.top + scroll.scrollTop;
  return { x, y, cx: x + r.width / 2, cy: y + r.height / 2 };
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The win, replayed on the map: stars one by one on the level just won, a
 * line of light along the branch to the next level, which unlocks — colour
 * floods back, a bounce, a chime — and the dusk recedes a notch. The new
 * "Next" then keeps pulsing (CSS, `.map-node.current`).
 */
async function playReveal(scroll, dusk, reveal, unlocking, unlocked) {
  const won = scroll.querySelector(`.map-node[data-level="${reveal.level}"]`);
  if (!won || !won.isConnected) return;
  const fx = reveal.fx || {};

  // 1. The stars, one by one.
  const stars = [...won.querySelectorAll('.stars i')];
  for (let i = 0; i < reveal.stars && i < stars.length; i++) {
    stars[i].classList.add('on');
    play(stars[i], [
      { transform: 'scale(0.2)', opacity: 0 }, { transform: 'scale(1.6)', opacity: 1, offset: 0.55 },
      { transform: 'scale(1)', opacity: 1 },
    ], { duration: 420, easing: 'cubic-bezier(.3,1.4,.5,1)' });
    fx.star?.(i);
    await pause(260);
  }
  won.classList.add('done');
  if (!unlocking) return;

  const next = scroll.querySelector(`.map-node[data-level="${reveal.level + 1}"]`);
  if (!next) return;

  // 2. A line of light runs along the branch to the next level.
  await pause(120);
  await trail(scroll, won, next);

  // 3. The next level unlocks: colour floods back, a bounce, a chime.
  won.classList.remove('current');
  delete won.dataset.label;
  next.classList.remove('locked');
  next.style.removeProperty('--fog');
  next.classList.add('current');
  next.dataset.label = t('map.next');
  fx.unlock?.();
  play(next, [
    { scale: '0.85', filter: 'brightness(1.4)' }, { scale: '1.14', offset: 0.45 },
    { scale: '0.97', offset: 0.75 }, { scale: '1', filter: 'brightness(1)' },
  ], { duration: 560, easing: 'ease-out' });
  const burst = document.createElement('i');
  burst.className = 'unlock-ring';
  next.appendChild(burst);
  setTimeout(() => burst.remove(), 800);

  // 4. The dusk recedes a notch: every locked level one step less in the dark.
  for (const node of scroll.querySelectorAll('.map-node.locked')) {
    const n = Number(node.dataset.level);
    node.style.setProperty('--fog', Math.min(1, (n - unlocked) / LOOKAHEAD).toFixed(2));
  }
  dusk.classList.add('moving');
  placeDusk(scroll, dusk, next);
}

/** A glowing stroke drawn from one node to the next, then faded. */
async function trail(scroll, from, to) {
  const a = offsetIn(scroll, from), b = offsetIn(scroll, to);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'map-trail');
  svg.setAttribute('width', scroll.scrollWidth);
  svg.setAttribute('height', scroll.scrollHeight);
  const path = document.createElementNS(NS, 'path');
  // A gentle S between the two nodes, like the branch between them.
  const my = (a.cy + b.cy) / 2;
  path.setAttribute('d', `M${a.cx},${a.cy} C${a.cx},${my} ${b.cx},${my} ${b.cx},${b.cy}`);
  svg.appendChild(path);
  scroll.appendChild(svg);
  const len = path.getTotalLength();
  path.style.strokeDasharray = `${len}`;
  path.style.strokeDashoffset = `${len}`;
  await play(path, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
    { duration: 520, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
  play(svg, [{ opacity: 1 }, { opacity: 0 }], { duration: 500, delay: 250, fill: 'forwards' })
    .then(() => svg.remove());
}
