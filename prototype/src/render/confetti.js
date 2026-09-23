/**
 * Confetti — a screen-sized celebration burst, for moments bigger than a
 * single gate (see `_burst()` in `boardView.js`, the block-exit spark this is
 * modelled on, but scaled up and untied from any one block's colour).
 */

const PIECE_COUNT = 32;

/** Bursts confetti inside `container` (must be `position: relative`), tinted
 *  from `palette` (falls back to the block colours' CSS custom properties if
 *  omitted). Self-cleaning: nothing is left behind once the animation ends. */
export function burst(container, palette) {
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  container.appendChild(layer);

  const colors = palette?.length ? palette
    : ['--c0', '--c1', '--c2', '--c3', '--c4', '--c5'].map((v) => `var(${v})`);

  for (let i = 0; i < PIECE_COUNT; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.setProperty('--x', `${Math.random() * 100}%`);
    p.style.setProperty('--rot', `${Math.round(Math.random() * 520 - 260)}deg`);
    p.style.setProperty('--drift', `${Math.round(Math.random() * 120 - 60)}px`);
    p.style.setProperty('--fall', `${(1.1 + Math.random() * 0.7).toFixed(2)}s`);
    p.style.setProperty('--delay', `${Math.round(Math.random() * 350)}ms`);
    p.style.background = colors[i % colors.length];
    if (Math.random() < 0.35) p.style.borderRadius = '50%';
    layer.appendChild(p);
  }

  setTimeout(() => layer.remove(), 2200);
}

const SNOW_COUNT = 60;

/**
 * A long, screen-wide snowfall of one emoji — deliberately bigger and slower
 * than `burst()`. Fixed to the viewport rather than to one card: unlike the
 * realm-complete confetti, this can be triggered from anywhere (see the map's
 * ten-tap easter egg in ui/mapScreen.js), so it cannot rely on a
 * `position: relative` container being at hand. Self-cleaning, same as
 * `burst()`.
 */
export function snow(emoji) {
  const layer = document.createElement('div');
  layer.className = 'snow-layer';
  document.body.appendChild(layer);

  let maxEnd = 0;
  for (let i = 0; i < SNOW_COUNT; i++) {
    const p = document.createElement('div');
    p.className = 'snow-piece';
    p.textContent = emoji;
    const fall = 2.6 + Math.random() * 1.8;
    const delay = Math.random() * 2.2;
    p.style.setProperty('--x', `${Math.random() * 100}%`);
    p.style.setProperty('--drift', `${Math.round(Math.random() * 160 - 80)}px`);
    p.style.setProperty('--rot', `${Math.round(Math.random() * 300 - 150)}deg`);
    p.style.setProperty('--fall', `${fall.toFixed(2)}s`);
    p.style.setProperty('--delay', `${delay.toFixed(2)}s`);
    p.style.fontSize = `${18 + Math.round(Math.random() * 16)}px`;
    layer.appendChild(p);
    maxEnd = Math.max(maxEnd, fall + delay);
  }

  setTimeout(() => layer.remove(), (maxEnd + 0.4) * 1000);
}
