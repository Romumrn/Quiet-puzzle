/**
 * Vibration feedback — mirrors the sound cues in audioManager.js at the same
 * call sites (block exit, victory, refused move), so a player who mutes the
 * sound but keeps vibration still feels the game respond.
 *
 * Capacitor's Haptics plugin already falls back to `navigator.vibrate` on a
 * plain browser, so this is not gated on native — only on the player's own
 * `vibration` setting (save.js) and a try/catch for devices or browsers that
 * support neither.
 */

import { Haptics, ImpactStyle, NotificationType } from '../../vendor/capacitor-haptics.esm.js';
import * as store from '../data/save.js';

const enabled = () => store.load().vibration !== false;

async function safe(fn) {
  if (!enabled()) return;
  try { await fn(); } catch { /* no vibration motor, or permission denied — silent */ }
}

/** A block sliding out through a gate. */
export const tick = () => safe(() => Haptics.impact({ style: ImpactStyle.Light }));

/** Level won. */
export const success = () => safe(() => Haptics.notification({ type: NotificationType.Success }));

/** Level lost, or a move refused (sealed wall, locked block). */
export const refused = () => safe(() => Haptics.notification({ type: NotificationType.Warning }));
