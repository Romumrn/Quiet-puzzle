/**
 * LevelScreen — équivalent de Scripts/UI/LevelScreen.cs (doc §4)
 * Carte des niveaux : chemin serpentin, étoiles obtenues, verrouillage.
 */

import { totalLevels, levelsPerRealm, realms } from '../data/levelStore.js';
import * as store from '../data/save.js';
import { renderStars } from './screens.js';
import * as theme from './theme.js';

/** Décalage horizontal du serpentin, en fraction de la largeur disponible. */
const OFFSETS = [0, 0.62, 0.9, 0.62, 0, -0.62, -0.9, -0.62];

export function render(onSelect) {
  const scroll = document.getElementById('map-scroll');
  const unlocked = store.load().unlockedLevel;
  scroll.replaceChildren();

  for (const monde of realms()) {
    const from = monde.premier;

    // Chaque monde adopte la teinte de son premier niveau : en faisant défiler
    // la carte, on voit la gradation chromatique de toute la progression.
    const section = document.createElement('section');
    section.className = 'realm';
    theme.appliquerA(section, from);

    const label = document.createElement('div');
    label.className = 'realm-label';
    label.textContent = monde.name;
    section.appendChild(label);

    const path = document.createElement('div');
    path.className = 'map-path';

    for (let n = from; n <= monde.dernier && n <= totalLevels(); n++) {
      const rec = store.levelRecord(n);
      const locked = n > unlocked;

      const node = document.createElement('button');
      node.className = 'map-node';
      node.style.transform = `translateX(${OFFSETS[(n - 1) % OFFSETS.length] * 92}px)`;
      if (locked) node.classList.add('locked');
      else if (n === unlocked) node.classList.add('current');
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

  // Amène le niveau courant sous les yeux du joueur.
  requestAnimationFrame(() => {
    scroll.querySelector('.map-node.current')?.scrollIntoView({ block: 'center' });
  });
}
