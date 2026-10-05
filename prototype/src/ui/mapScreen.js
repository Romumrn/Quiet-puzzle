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
 * The longest run the map replays. Past it, the earlier wins of the run are
 * simply drawn as done: twenty levels already make a long, satisfying trail.
 */
const MAX_RUN = 20;

/**
 * @param onSelect called with a level number
 * @param reveal `{ run: [{ level, stars }], fx }` when the player comes back
 *   after winning levels for the first time since the map was last shown — one
 *   level or a whole run of "Next". The map is drawn as it stood BEFORE the
 *   run, then plays it: on each level the stars light up, the line of light
 *   runs on to the next one, which unlocks, and the dusk recedes a notch. The
 *   line STAYS lit along the whole run, so ten levels in a row leave ten
 *   levels of light. Null otherwise: reopening the map later replays nothing.
 */
export function render(onSelect, reveal = null) {
  const scroll = document.getElementById('map-scroll');
  const unlocked = store.load().unlockedLevel;
  const horizon = unlocked + LOOKAHEAD;
  if (reveal && reducedMotion()) reveal = null;
  const run = reveal ? [...reveal.run].sort((a, b) => a.level - b.level).slice(-MAX_RUN) : [];
  if (!run.length) reveal = null;
  const replayed = new Set(run.map((w) => w.level));
  // Where the map stood before the run: the frontier at its first level.
  const shown = run.length ? Math.min(unlocked, run[0].level) : unlocked;
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
      const replaying = replayed.has(n);
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
    if (reveal) setTimeout(() => playRun(scroll, dusk, run, reveal.fx || {}, unlocked), 450);
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
 * The run, replayed on the map. For each level won, in order: its stars one
 * by one, the line of light on to the next level, which unlocks — colour
 * floods back, a bounce, a chime a step higher than the last — and the dusk
 * recedes a notch. The pace quickens along a long run, and a tap on the map
 * hurries the rest. The line stays lit once drawn: the whole run shows as one
 * glowing path. The new "Next" then keeps pulsing (CSS, `.map-node.current`).
 */
async function playRun(scroll, dusk, run, fx, unlocked) {
  const node = (n) => scroll.querySelector(`.map-node[data-level="${n}"]`);
  const first = node(run[0].level);
  if (!first || !first.isConnected) return;

  // The whole path, drawn ahead of time and revealed a stretch at a time.
  const stops = run.map((w) => node(w.level));
  const tail = node(run[run.length - 1].level + 1);
  if (tail && run[run.length - 1].level + 1 <= unlocked) stops.push(tail);
  const line = stops.length > 1 ? glowLine(scroll, stops) : null;

  let speed = 1;
  const hurry = () => { speed = 0.3; };
  scroll.addEventListener('pointerdown', hurry, { once: true });
  const wait = (ms) => pause(ms * speed);

  for (let i = 0; i < run.length; i++) {
    if (!scroll.isConnected) return;
    const win = run[i];
    const here = stops[i];
    // Quicker as the run goes on: the first levels are savoured, a long run flows.
    const pace = Math.max(0.4, 1 - i * 0.09);
    if (i > 0) here.scrollIntoView({ block: 'center', behavior: 'smooth' });

    // 1. The stars, one by one.
    const stars = [...here.querySelectorAll('.stars i')];
    for (let k = 0; k < win.stars && k < stars.length; k++) {
      stars[k].classList.add('on');
      play(stars[k], [
        { transform: 'scale(0.2)', opacity: 0 }, { transform: 'scale(1.6)', opacity: 1, offset: 0.55 },
        { transform: 'scale(1)', opacity: 1 },
      ], { duration: 420 * pace, easing: 'cubic-bezier(.3,1.4,.5,1)' });
      fx.star?.(k);
      await wait(220 * pace);
    }
    here.classList.add('done');

    const next = stops[i + 1];
    if (!next || !line) continue;

    // 2. The line of light runs on to the next level — and stays.
    await wait(80 * pace);
    await line.drawTo(i + 1, Math.max(260, 520 * pace * speed));

    // 3. The next level unlocks.
    here.classList.remove('current');
    delete here.dataset.label;
    next.classList.remove('locked');
    next.style.removeProperty('--fog');
    // "Next" hops along with the light, and rests on the level to play.
    next.classList.add('current');
    next.dataset.label = t('map.next');
    fx.unlock?.(i, stops.length - 1);
    play(next, [
      { scale: '0.85', filter: 'brightness(1.4)' }, { scale: '1.14', offset: 0.45 },
      { scale: '0.97', offset: 0.75 }, { scale: '1', filter: 'brightness(1)' },
    ], { duration: 560 * pace, easing: 'ease-out' });
    const burst = document.createElement('i');
    burst.className = 'unlock-ring';
    next.appendChild(burst);
    setTimeout(() => burst.remove(), 800);

    // 4. The dusk recedes a notch: every locked level one step less in the dark.
    const frontier = Number(next.dataset.level);
    for (const locked of scroll.querySelectorAll('.map-node.locked')) {
      const n = Number(locked.dataset.level);
      locked.style.setProperty('--fog', Math.min(1, (n - frontier) / LOOKAHEAD).toFixed(2));
    }
    dusk.classList.add('moving');
    placeDusk(scroll, dusk, next);
    await wait(140 * pace);
  }
  scroll.removeEventListener('pointerdown', hurry);
  line?.settle();
}

/**
 * A glowing line through `stops` (map nodes), a gentle S between each pair
 * like the branch between them. Hidden at first; `drawTo(i)` extends it to the
 * i-th stop, `settle()` lets it breathe once the run is drawn.
 */
function glowLine(scroll, stops) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'map-trail');
  svg.setAttribute('width', scroll.scrollWidth);
  svg.setAttribute('height', scroll.scrollHeight);
  const points = stops.map((s) => offsetIn(scroll, s));
  let d = `M${points[0].cx},${points[0].cy}`;
  const lengths = [0];
  const probe = document.createElementNS(NS, 'path');
  svg.appendChild(probe);
  scroll.appendChild(svg);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const my = (a.cy + b.cy) / 2;
    d += ` C${a.cx},${my} ${b.cx},${my} ${b.cx},${b.cy}`;
    probe.setAttribute('d', d);
    lengths.push(probe.getTotalLength());
  }
  probe.remove();
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  const total = lengths[lengths.length - 1];
  path.style.strokeDasharray = `${total}`;
  path.style.strokeDashoffset = `${total}`;
  let drawn = 0;
  return {
    async drawTo(i, ms) {
      const from = total - drawn, to = total - lengths[i];
      drawn = lengths[i];
      await play(path, [{ strokeDashoffset: from }, { strokeDashoffset: to }],
        { duration: ms, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
      path.style.strokeDashoffset = `${to}`;
    },
    settle() { svg.classList.add('settled'); },
  };
}
