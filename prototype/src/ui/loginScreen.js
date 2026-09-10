/**
 * Login screen.
 *
 * Shown when no Supabase session exists. It offers two OAuth providers and,
 * just as prominently, a way to carry on without an account: this game is
 * playable offline and must stay so — an account only buys progress that
 * follows you from device to device.
 *
 * The styles live here rather than in main.css because this screen is mounted
 * on `document.body`, outside `#app` and its theme variables, and it is the
 * only thing on screen when it appears.
 */

import { supabase } from '../data/supabaseClient.js';
import { t } from './i18n.js';

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
  .btn-connect {
    display: flex; align-items: center; justify-content: center; width: 100%;
    padding: 12px 20px; margin-bottom: 12px; border: none; border-radius: 8px;
    font-weight: bold; cursor: pointer; transition: transform 0.1s, opacity 0.2s, background-color 0.2s;
    font-size: 1rem; text-transform: uppercase; letter-spacing: 0.5px;
    min-height: 48px;
  }
  .btn-connect:active { transform: scale(0.98); }
  .btn-connect:disabled { opacity: 0.6; cursor: not-allowed; }

  .btn-google {
    background-color: #fff; color: #333; border: 1px solid #ddd;
  }
  .btn-google:hover:not(:disabled) { background-color: #f5f5f5; border-color: #ccc; }

  .btn-meta {
    background-color: #0866FF; color: #fff; border: 1px solid #0866FF;
  }
  .btn-meta:hover:not(:disabled) { background-color: #0654e0; border-color: #0654e0; }

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

  /* SVG icons */
  .icon { width: 22px; height: 22px; margin-right: 12px; fill: currentColor; flex-shrink: 0; }

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

// Inline SVG icons, to avoid any external dependency.
const GOOGLE_ICON = `<svg class="icon" viewBox="0 0 24 24"><path d="M12.545,10.239v3.821h5.445l-0.712,2.238c-0.612,0.859-2.196,1.817-4.052,1.817 c-3.572,0-6.165-2.998-6.165-7.17s2.593-7.17,6.165-7.17c1.914,0,3.402,0.726,4.247,1.864l2.43-2.43C17.921,1.625,15.281,0,12.545,0 C7.266,0,2.667,5.046,2.667,12.667S7.266,25.333,12.545,25.333c5.988,0,9.316-3.496,10.35-6.759l-0.168-0.609H12.545z"/></svg>`;
const META_ICON = `<svg class="icon" viewBox="0 0 24 24"><path d="M13,22c5.523,0,10-4.477,10-10S18.523,2,13,2S3,6.477,3,12s4.477,10,10,10z"/></svg>`;

export function createLoginScreen(onOfflineContinue) {
  const container = document.createElement('div');
  container.id = 'login-container';

  container.innerHTML = `
    <style>${styles}</style>
    <div class="login-card">
      <h1 class="login-title">Quiet Puzzle</h1>
      <p class="login-subtitle">${t('login.subtitle')}</p>

      <div id="login-status" class="login-status"></div>

      <button id="btn-google" class="btn-connect btn-google">
        ${GOOGLE_ICON} ${t('login.google')}
      </button>

      <button id="btn-meta" class="btn-connect btn-meta">
        ${META_ICON} ${t('login.meta')}
      </button>

      <button id="btn-offline" class="btn-offline">${t('login.offline')}</button>
    </div>
  `;

  const googleBtn = container.querySelector('#btn-google');
  const metaBtn = container.querySelector('#btn-meta');
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
    signInWith('google', [googleBtn, metaBtn, offlineBtn], setStatus);
  });

  metaBtn?.addEventListener('click', () => {
    signInWith('facebook', [googleBtn, metaBtn, offlineBtn], setStatus);
  });

  offlineBtn?.addEventListener('click', () => {
    container.remove();
    onOfflineContinue?.();
  });

  return container;
}

/**
 * Starts an OAuth round trip. On success the browser navigates away, so there
 * is nothing to do afterwards; on failure the buttons are re-enabled, since the
 * player is still on this page and deserves a second try.
 */
async function signInWith(provider, buttons, setStatus) {
  try {
    setStatus('loading', t('login.connecting'));
    buttons.forEach((btn) => { if (btn) btn.disabled = true; });

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;

    setStatus('success', t('login.redirecting'));
  } catch (err) {
    console.error(`Sign-in with ${provider} failed:`, err.message);
    setStatus('error', t('login.failed', { error: err.message || '' }));
    buttons.forEach((btn) => { if (btn) btn.disabled = false; });
  }
}
