/**
 * AdMob ad unit IDs, for the packaged Android app only (see admob.js).
 *
 * Google's public TEST unit IDs by default: they work out of the box, on any
 * device, with no AdMob account — but they only ever serve Google's own
 * sample ads. Replace both with the real IDs from the AdMob console (once an
 * app is registered there) before a release build; the App ID itself lives in
 * mobile/android/app/src/main/AndroidManifest.xml, next to the same warning.
 */
export const AD_UNITS = {
  REWARDED: 'ca-app-pub-3940256099942544/5224354917',
  INTERSTITIAL: 'ca-app-pub-3940256099942544/1033173712',
};
