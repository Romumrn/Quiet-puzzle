/**
 * AdMob ad unit IDs, for the packaged Android app only (see admob.js). The
 * App ID itself lives in mobile/android/app/src/main/AndroidManifest.xml.
 *
 * REWARDED is the real ad unit (AdMob console → Quiet Puzzle → Ad units).
 * INTERSTITIAL and BANNER are still Google's public TEST units — replace
 * each the same way once its real ad unit is created there; until then they
 * only ever serve Google's own sample ad.
 */
export const AD_UNITS = {
  REWARDED: 'ca-app-pub-7234951269462523/9192078780',
  INTERSTITIAL: 'ca-app-pub-3940256099942544/1033173712',
  BANNER: 'ca-app-pub-3940256099942544/6300978111',
};
