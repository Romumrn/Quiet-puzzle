/**
 * Android hardware back button, and app pause/resume.
 *
 * No-op on the published web site (`isNative()` false): there is no hardware
 * back button there, and the browser already handles its own tab lifecycle.
 *
 * The game has no generic screen back-stack (see main.js — navigation is
 * forward-only via `screens.show()`, with the level editor as the one
 * existing exception, intercepting `popstate` directly). Rather than build a
 * second, parallel stack, `registerBackHandler` takes a single resolver
 * function that inspects current UI state and decides what "back" means right
 * now — closing a panel, leaving a screen, or exiting the app.
 */

import { isNative } from './capacitor.js';
import { App } from '../../vendor/capacitor-app.esm.js';

/**
 * @param {() => boolean} resolveBack - performs the appropriate "back" action
 *   for whatever is on screen and returns true if it handled it, false if the
 *   app should exit (nothing left to go back to).
 */
export function registerBackHandler(resolveBack) {
  if (!isNative()) return;
  App.addListener('backButton', () => {
    const handled = resolveBack();
    if (!handled) App.exitApp();
  });
}

/**
 * @param {{ onPause?: () => void, onResume?: () => void }} handlers
 */
export function registerLifecycle({ onPause, onResume } = {}) {
  if (!isNative()) return;
  if (onPause) App.addListener('pause', onPause);
  if (onResume) App.addListener('resume', onResume);
}
