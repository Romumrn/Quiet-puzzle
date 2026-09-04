/**
 * ScreenManager — équivalent de Scripts/UI/ScreenManager.cs (doc §4)
 * Navigation entre écrans : un seul `.screen.active` à la fois.
 */

const screens = () => document.querySelectorAll('.screen');
let currentId = 'menu';

export function show(name) {
  currentId = name;
  screens().forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
}

export const current = () => currentId;

export function toast(message, ms = 1400) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, ms);
}

/** Rend un bloc d'étoiles (0 à 3 allumées). */
export function renderStars(el, count) {
  el.replaceChildren(...[0, 1, 2].map((k) => {
    const i = document.createElement('i');
    i.textContent = '★';
    if (k < count) i.className = 'on';
    return i;
  }));
}
