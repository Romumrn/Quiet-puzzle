/**
 * LevelScreen — equivalent of Scripts/UI/LevelScreen.cs (tech doc §4)
 * Level map: winding path, stars earned, locking.
 */

import { totalLevels, levelsPerRealm, realms } from '../data/levelStore.js';
import * as store from '../data/save.js';
import { renderStars } from './screens.js';
import * as theme from './theme.js';
import { realmText, t } from './i18n.js';

/** Horizontal offset of the winding path, as a fraction of available width. */
const OFFSETS = [0, 0.62, 0.9, 0.62, 0, -0.62, -0.9, -0.62];

export function render(onSelect) {
  const scroll = document.getElementById('map-scroll');
  const unlocked = store.load().unlockedLevel;
  scroll.replaceChildren();

  for (const realm of realms()) {
    const from = realm.first;

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

    for (let n = from; n <= realm.last && n <= totalLevels(); n++) {
      const rec = store.levelRecord(n);
      const locked = n > unlocked;

      const node = document.createElement('button');
      node.className = 'map-node';
      node.style.transform = `translateX(${OFFSETS[(n - 1) % OFFSETS.length] * 92}px)`;
      // The last level of a realm is markedly harder than the others: the
      // realm's full hue signals it before it is even opened.
      if (n === realm.last) node.classList.add('boss');
      if (locked) node.classList.add('locked');
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

      if (!locked) node.addEventListener('click', () => onSelect(n));
      path.appendChild(node);
    }
    section.appendChild(path);
    scroll.appendChild(section);
  }

  document.getElementById('map-stars').textContent = `★ ${store.totalStars()}`;

  // Brings the current level in front of the player's eyes.
  requestAnimationFrame(() => {
    scroll.querySelector('.map-node.current')?.scrollIntoView({ block: 'center' });
  });
}
