/**
 * New versions — Google's in-app updates, and a minimum version we can raise.
 *
 * A newer build on the Play Store: a small note on the menu, "New version",
 * with "Update". Google then downloads it while the player keeps playing
 * (a "flexible" update), and the note turns into "Restart" once it is in.
 * "Later" hides it until the next build.
 *
 * Below `min_version_code` (table `app_config`, migration 20261123120000):
 * a screen that does not go away, and Google's full-screen update. Raise it
 * only for a build that is truly broken — every older player is stopped.
 *
 * Only an install from the Play Store knows of updates: a side-loaded APK
 * reports none, and so does the web build (never called there).
 */

import { AppUpdate, AppUpdateAvailability, FlexibleUpdateInstallStatus } from '../../vendor/capacitor-app-update.esm.js';
import { isNative } from './capacitor.js';
import { supabase } from '../data/supabaseClient.js';
import { t } from '../ui/i18n.js';

const DISMISSED_KEY = 'quietpuzzle.updateDismissed';
/** Coming back to the app checks again, but not more often than this. */
const CHECK_EVERY_MS = 6 * 3600e3;

let lastCheck = 0;
let listening = false;

const el = (id) => document.getElementById(id);

async function minVersionCode() {
  try {
    const { data } = await supabase.from('app_config').select('value').eq('key', 'min_version_code').maybeSingle();
    return Number(data?.value) || 0;
  } catch {
    return 0;
  }
}

/** At startup and on resume. Never throws: an update must not stop the game. */
export async function checkForUpdate() {
  if (!isNative() || Date.now() - lastCheck < CHECK_EVERY_MS) return;
  lastCheck = Date.now();
  try {
    const info = await AppUpdate.getAppUpdateInfo();
    if (info.installStatus === FlexibleUpdateInstallStatus.DOWNLOADED) { showReady(); return; }
    if (info.updateAvailability !== AppUpdateAvailability.UPDATE_AVAILABLE) return;
    if (Number(info.currentVersionCode) < await minVersionCode()) { showRequired(info); return; }
    let dismissed = null;
    try { dismissed = localStorage.getItem(DISMISSED_KEY); } catch { /* storage blocked: show it */ }
    if (dismissed === info.availableVersionCode) return;
    showAvailable(info);
  } catch { /* no Play Store, offline: nothing to say */ }
}

function showAvailable(info) {
  const note = el('update-note');
  el('update-note-text').textContent = t('update.available');
  el('btn-update-later').hidden = false;
  el('btn-update-go').textContent = t('update.go');
  el('btn-update-go').onclick = () => startFlexible(info);
  el('btn-update-later').onclick = () => {
    try { localStorage.setItem(DISMISSED_KEY, info.availableVersionCode); } catch { /* shown again next time */ }
    note.hidden = true;
  };
  note.hidden = false;
}

async function startFlexible(info) {
  el('update-note').hidden = true;
  if (!info.flexibleUpdateAllowed) { AppUpdate.openAppStore().catch(() => {}); return; }
  if (!listening) {
    listening = true;
    AppUpdate.addListener('onFlexibleUpdateStateChange', (s) => {
      if (s.installStatus === FlexibleUpdateInstallStatus.DOWNLOADED) showReady();
    });
  }
  try { await AppUpdate.startFlexibleUpdate(); } catch { AppUpdate.openAppStore().catch(() => {}); }
}

function showReady() {
  el('update-note-text').textContent = t('update.ready');
  el('btn-update-later').hidden = true;
  el('btn-update-go').textContent = t('update.restart');
  el('btn-update-go').onclick = () => AppUpdate.completeFlexibleUpdate().catch(() => {});
  el('update-note').hidden = false;
}

function showRequired(info) {
  const go = () => (info.immediateUpdateAllowed
    ? AppUpdate.performImmediateUpdate()
    : AppUpdate.openAppStore()).catch(() => AppUpdate.openAppStore().catch(() => {}));
  el('btn-update-required').onclick = go;
  el('overlay-update').hidden = false;
  go();
}
