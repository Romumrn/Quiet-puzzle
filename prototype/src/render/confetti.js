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

const PETAL_BURST = 7;

/**
 * A few petals lifted by a tap on the home screen, then floating down —
 * slowly, swaying in wide S-curves, visible all the way — in the realm's hue
 * (they inherit `--h`). A gust of wind was not the idea: the eye must be able
 * to follow each one down, and the screen stay calm (playtest, 2026-09-30).
 * Placed in `host` at (x, y), in its own pixels. Transform and opacity only,
 * self-cleaning, and nothing at all when the player asked for less motion.
 */
export function petalBurst(host, x, y) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < PETAL_BURST; i++) {
    const p = document.createElement('i');
    p.className = 'petal-pop';
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9; // upwards, fanned
    const lift = 18 + Math.random() * 26;
    const fall = 5 + Math.random() * 2.2;                                  // seconds
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.setProperty('--px', `${Math.round(Math.cos(angle) * lift * 1.4)}px`);
    p.style.setProperty('--py', `${Math.round(Math.sin(angle) * lift)}px`);
    p.style.setProperty('--sway', `${Math.round(18 + Math.random() * 18) * (Math.random() < 0.5 ? -1 : 1)}px`);
    p.style.setProperty('--drop', `${Math.round(220 + Math.random() * 140)}px`);
    p.style.setProperty('--spin', `${Math.round((Math.random() - 0.5) * 220)}deg`);
    p.style.setProperty('--size', `${Math.round(8 + Math.random() * 6)}px`);
    p.style.setProperty('--light', `${Math.round(74 + Math.random() * 12)}%`);
    p.style.animationDuration = `${fall.toFixed(2)}s`;
    p.style.animationDelay = `${Math.round(Math.random() * 180)}ms`;
    host.appendChild(p);
    setTimeout(() => p.remove(), fall * 1000 + 400);
  }
}
