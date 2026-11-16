package com.romumrn.quietpuzzle;

import android.content.pm.ActivityInfo;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * Edge to edge, immersive, portrait on phones only.
 *
 * EdgeToEdge.enable() is the backward-compatible edge-to-edge Android 15+
 * imposes on apps targeting SDK 35: the app draws under the system bars on
 * every version, through the non-deprecated APIs (the Play Console flagged
 * the old ones). The insets themselves reach the page through Capacitor's
 * SystemBars plugin, as env(safe-area-inset-*) / --safe-area-inset-* in CSS.
 *
 * Immersive: system bars start hidden and reappear on a swipe from the edge,
 * matching what a mobile puzzle game's players expect. Re-applied on every
 * window focus change, because Android restores the bars whenever the
 * WebView regains focus (keyboard, dialog, app switcher).
 *
 * Orientation: locked to portrait on phones, left free on large screens
 * (smallest width 600dp and up: tablets, unfolded foldables, Chromebooks) —
 * Android 16 ignores a lock there anyway, and the Play Console asks for none
 * in the manifest. In landscape the page falls back to a 9:16 column
 * (`.native-app .device` in styles/main.css).
 */
public class MainActivity extends BridgeActivity {
  private static final int LARGE_SCREEN_DP = 600;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    EdgeToEdge.enable(this);
    if (getResources().getConfiguration().smallestScreenWidthDp < LARGE_SCREEN_DP) {
      setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
    }
    super.onCreate(savedInstanceState);
    hideSystemBars();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) hideSystemBars();
  }

  private void hideSystemBars() {
    WindowInsetsControllerCompat controller =
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    controller.setSystemBarsBehavior(
        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    controller.hide(WindowInsetsCompat.Type.systemBars());
  }
}
