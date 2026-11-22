/**
 * Ad log — one row per ad requested, in `public.ad_events`, so the admin
 * dashboard can say how many ads players actually watch. Fire-and-forget: a
 * missing network or session must never touch the game.
 */

import { supabase } from './supabaseClient.js';

export function logAd(kind, placement, shown) {
  try {
    Promise.resolve(supabase.rpc('log_ad_event', {
      p_kind: kind, p_placement: placement ?? null, p_shown: !!shown,
    })).catch(() => {});
  } catch {
    // Offline or signed out: this ad simply goes unrecorded.
  }
}
