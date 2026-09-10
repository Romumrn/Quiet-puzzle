/**
 * Player session handling, Supabase side.
 *
 * When the app opens we try to recover an existing session (stored by the SDK
 * in localStorage). If there is none, an anonymous session is created: the
 * player gets a persistent identity with no friction at all (no form). They can
 * link the account to an e-mail address later.
 *
 * Every call is best-effort: a network error does not block startup, the game
 * stays playable through localStorage.
 */

import { supabase } from './supabaseClient.js';

let _ready = false;

export async function initSession() {
  if (_ready) return;
  _ready = true;
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session) return;
    await supabase.auth.signInAnonymously();
  } catch {
    // Non-fatal: the game works offline.
  }
}

/** Returns the current user, or null when not authenticated. */
export async function getUser() {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user ?? null;
  } catch {
    return null;
  }
}
