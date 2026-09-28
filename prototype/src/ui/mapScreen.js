/**
 * LevelScreen — equivalent of Scripts/UI/LevelScreen.cs (tech doc §4)
 * Level map: winding path, stars earned, locking.
 */

import { totalLevels, levelsPerRealm, realms, tierOf } from '../data/levelStore.js';
import * as store from '../data/save.js';
import { renderStars, toast } from './screens.js';
import * as theme from './theme.js';
import { realmText, t } from './i18n.js';

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

export function render(onSelect) {
  const scroll = document.getElementById('map-scroll');
  const unlocked = store.load().unlockedLevel;
  const horizon = unlocked + LOOKAHEAD;
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
      const locked = n > unlocked;

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
        node.style.setProperty('--fog', ((n - unlocked) / LOOKAHEAD).toFixed(2));
      }
      else if (n === unlocked) {
        node.classList.add('current');
        // The "Next" label used to be written in the CSS (`content: 'Suivant'`),
        // out of reach of translation. It now goes through an attribute, which
        // the stylesheet merely renders.
        node.dataset.label = t('map.next');
      }
      if (rec.stars > 0) node.classList.add('done');

      const num = document.createElement('b');
      num.textContent = n;
      const stars = document.createElement('div');
      stars.className = 'stars';
      renderStars(stars, rec.stars);
      node.append(num, stars);

      node.addEventListener('click', () => {
        if (locked) registerLockedTap(n);
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
    if (current) {
      const top = current.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
      dusk.style.top = `${Math.max(0, top - 40)}px`;
      dusk.style.height = `${scroll.scrollHeight - Math.max(0, top - 40)}px`;
    } else {
      dusk.hidden = true;
    }
    current?.scrollIntoView({ block: 'center' });
  });
}
