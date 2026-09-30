/**
 * Motion helpers shared by the reward moments (result sequence, last block,
 * map unlock, block feel).
 *
 * The stylesheet's global `prefers-reduced-motion` rule shortens CSS
 * animations and transitions, but it has no hold on the Web Animations API:
 * every `el.animate()` in the game goes through `play()` here, which skips
 * straight to the end state when the player asked for less motion.
 */

const query = typeof window !== 'undefined'
  ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : null;

export const reducedMotion = () => !!query?.matches;

/**
 * `el.animate()` returning a promise that settles when it ends — or at once
 * under reduced motion, or when the page is hidden (a background tab would
 * otherwise crawl through it at one frame a second).
 */
export function play(el, keyframes, options) {
  if (!el || reducedMotion() || document.hidden) return Promise.resolve();
  const a = el.animate(keyframes, options);
  return a.finished.then(() => a, () => a);
}

/**
 * A wait that can be cut short: `skip()` resolves every pending wait at once.
 * The result sequence uses it so that a tap jumps to the end.
 */
export function skippable() {
  let skipped = false;
  const pending = new Set();
  return {
    get skipped() { return skipped; },
    wait(ms) {
      if (skipped || reducedMotion() || document.hidden) return Promise.resolve();
      return new Promise((resolve) => {
        const entry = { resolve, timer: setTimeout(() => { pending.delete(entry); resolve(); }, ms) };
        pending.add(entry);
      });
    },
    skip() {
      skipped = true;
      for (const e of pending) { clearTimeout(e.timer); e.resolve(); }
      pending.clear();
    },
  };
}

/** A flame drawn once, shared by the map's hard levels, the streak badge and the HUD. */
export const FLAME_PATH = 'M12 1C13 7 20 10.5 20 20.5C20 26.5 16.5 31 12 31C7.5 31 4 26.5 4 21C4 16.5 6.5 13.5 8.5 10.5C8.8 13.8 10.2 16 12 17C10.8 12 10.6 6 12 1ZM12 29.5C9.9 29.5 8.6 27.7 8.6 25.4C8.6 22.6 10.6 21 12 18.8C13.4 21 15.4 22.6 15.4 25.4C15.4 27.7 14.1 29.5 12 29.5Z';

export function flameSvg(className) {
  return `<svg class="${className}" viewBox="0 0 24 32" aria-hidden="true"><path fill-rule="evenodd" d="${FLAME_PATH}"/></svg>`;
}
