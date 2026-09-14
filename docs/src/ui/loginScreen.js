/**
 * Login screen.
 *
 * Shown when no Supabase session exists. It offers one sign-in route and,
 * just as prominently, a way to carry on without an account: this game is
 * playable offline and must stay so — an account only buys progress that
 * follows you from device to device.
 *
 * Google is the only provider: Meta was dropped, one fewer account to manage
 * and one fewer brand review to pass for the Play Store listing.
 *
 * Two sign-in paths, because a WebView cannot do a proper OAuth redirect:
 * - packaged app (`isNative()`) → the native Google Sign-In plugin returns an
 *   ID token, exchanged with `supabase.auth.signInWithIdToken`;
 * - published web site → the existing `signInWithOAuth` redirect flow.
 * Both end the same way: `onAuthStateChange` in main.js sees SIGNED_IN,
 * removes this screen and starts the game. Neither branch does that itself.
 *
 * The styles live here rather than in main.css because this screen is mounted
 * on `document.body`, outside `#app` and its theme variables, and it is the
 * only thing on screen when it appears.
 */

import { supabase } from '../data/supabaseClient.js';
import { t } from './i18n.js';
import { isNative } from '../native/capacitor.js';
import { GoogleAuth } from '../../vendor/capacitor-google-auth.esm.js';

const styles = `
  #login-container {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: var(--bg-gameplay, #f4f4f9);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    z-index: 9999; font-family: var(--font-ui, system-ui, sans-serif);
    color: #333;
  }
  .login-card {
    background: white; padding: 2rem; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.15);
    text-align: center; max-width: 90%; width: 320px;
    animation: fadeIn 0.3s ease-out;
  }
  .login-title {
    font-size: 1.8rem; margin-bottom: 0.5rem; color: #222; font-weight: bold;
  }
  .login-subtitle {
    color: #666; margin-bottom: 1.5rem; font-size: 0.95rem; line-height: 1.4;
  }

  /*
   * "Sign in with Google" button — follows Google's Identity branding
   * guidelines (white surface, Google "G" logo tile, Roboto-ish text, 40-48px
   * height): https://developers.google.com/identity/branding-guidelines
   */
  .btn-google {
    display: flex; align-items: center; width: 100%; height: 44px;
    margin-bottom: 14px; padding: 0; border: 1px solid #747775; border-radius: 8px;
    background: #fff; color: #1f1f1f; cursor: pointer;
    font: 500 14px/20px Roboto, var(--font-ui, system-ui, sans-serif);
    letter-spacing: 0.15px; transition: box-shadow 0.15s ease, background 0.15s ease;
  }
  .btn-google:hover:not(:disabled) { box-shadow: 0 1px 2px rgba(0,0,0,0.15); background: #f8f8f8; }
  .btn-google:active:not(:disabled) { background: #f1f1f1; }
  .btn-google:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-google-icon {
    width: 42px; height: 42px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .btn-google-label { flex: 1; text-align: center; padding-right: 42px; }

  .btn-offline {
    background-color: transparent; color: #666; border: none; padding: 10px;
    font-size: 0.9rem; text-decoration: underline; cursor: pointer;
  }
  .btn-offline:hover { color: #333; }

  .login-status {
    margin: 1rem 0; padding: 10px; border-radius: 8px; display: none;
    font-size: 0.9rem; text-align: center;
  }
  .login-status.loading {
    display: block; background-color: #e3f2fd; color: #1976d2;
  }
  .login-status.error {
    display: block; background-color: #ffebee; color: #c62828;
  }
  .login-status.success {
    display: block; background-color: #e8f5e9; color: #388e3c;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes spinner {
    to { transform: rotate(360deg); }
  }
  .spinner {
    display: inline-block; width: 16px; height: 16px;
    border: 2px solid #1976d2; border-top-color: transparent;
    border-radius: 50%; animation: spinner 0.8s linear infinite;
    margin-right: 8px;
  }

  @media (max-width: 480px) {
    .login-card { padding: 1.5rem; width: 90%; }
    .login-title { font-size: 1.5rem; }
  }
`;

// Official Google "G" mark (Google Identity branding assets), inline to avoid
// any external dependency or CDN fetch.
const GOOGLE_ICON = `<svg width="20" height="20" viewBox="0 0 48 48">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>`;

export function createLoginScreen(onOfflineContinue) {
  const container = document.createElement('div');
  container.id = 'login-container';

  container.innerHTML = `
    <style>${styles}</style>
    <div class="login-card">
      <h1 class="login-title">Quiet Puzzle</h1>
      <p class="login-subtitle">${t('login.subtitle')}</p>

      <div id="login-status" class="login-status"></div>

      <button id="btn-google" class="btn-google">
        <span class="btn-google-icon">${GOOGLE_ICON}</span>
        <span class="btn-google-label">${t('login.google')}</span>
      </button>

      <button id="btn-offline" class="btn-offline">${t('login.offline')}</button>
    </div>
  `;

  const googleBtn = container.querySelector('#btn-google');
  const offlineBtn = container.querySelector('#btn-offline');
  const statusEl = container.querySelector('#login-status');

  const setStatus = (type, message) => {
    statusEl.className = `login-status ${type}`;
    if (type === 'loading') {
      statusEl.innerHTML = `<span class="spinner"></span>${message}`;
    } else {
      statusEl.textContent = message;
    }
  };

  googleBtn?.addEventListener('click', () => {
    const buttons = [googleBtn, offlineBtn];
    if (isNative()) signInGoogleNative(buttons, setStatus);
    else signInGoogleWeb(buttons, setStatus);
  });

  offlineBtn?.addEventListener('click', () => {
    container.remove();
    onOfflineContinue?.();
  });

  return container;
}

/**
 * Packaged app: native Google Sign-In returns an ID token directly, no
 * redirect involved. `serverClientId` (mobile/capacitor.config.json) must be
 * the Google Cloud "Web application" client — that is the audience Supabase
 * expects, not the Android client (which is matched by package name + SHA-1,
 * not by client ID, and never appears in app code).
 */
async function signInGoogleNative(buttons, setStatus) {
  try {
    setStatus('loading', t('login.connecting'));
    buttons.forEach((btn) => { if (btn) btn.disabled = true; });

    const googleUser = await GoogleAuth.signIn();
    const idToken = googleUser?.authentication?.idToken;
    if (!idToken) throw new Error('Google did not return an ID token');

    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    if (error) throw error;
    // No navigation happens here: `onAuthStateChange` in main.js removes this
    // screen and starts the game once the SIGNED_IN event lands.
  } catch (err) {
    console.error('Native Google sign-in failed:', err?.message || err);
    setStatus('error', t('login.failed', { error: err?.message || '' }));
    buttons.forEach((btn) => { if (btn) btn.disabled = false; });
  }
}

/**
 * Published web site: the classic OAuth redirect. On success the browser
 * navigates away, so there is nothing to do afterwards; on failure the
 * buttons are re-enabled, since the player is still on this page.
 */
async function signInGoogleWeb(buttons, setStatus) {
  try {
    setStatus('loading', t('login.connecting'));
    buttons.forEach((btn) => { if (btn) btn.disabled = true; });

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;

    setStatus('success', t('login.redirecting'));
  } catch (err) {
    console.error('Web Google sign-in failed:', err.message);
    setStatus('error', t('login.failed', { error: err.message || '' }));
    buttons.forEach((btn) => { if (btn) btn.disabled = false; });
  }
}
