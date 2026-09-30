/**
 * The players' leaderboard — signed-in accounts only, ranked by stars, then by
 * how far they got.
 *
 * The ranking is computed server-side (`public.leaderboard`, migration
 * 20260927120000_leaderboard.sql, names from 20260930180000): `profiles` and
 * `auth.users` are not readable by clients, and the function returns just the
 * public columns — the player's FIRST name from their Google account (never the
 * surname), or their pseudonym when there is none. It sends the top of the
 * board AND the caller's own row, wherever it sits.
 *
 * Anonymous players are not listed (they have not chosen to appear before
 * others); they see the board and an invitation to sign in.
 */

import { supabase } from '../data/supabaseClient.js';

/**
 * @returns {Promise<{ rows: Array<{rank, username, stars, level, me}>, signedIn: boolean } | null>}
 *   null when the server cannot be reached
 */
export async function fetchBoard(limit = 50) {
  try {
    const [{ data, error }, { data: auth }] = await Promise.all([
      supabase.rpc('leaderboard', { p_limit: limit }),
      supabase.auth.getUser(),
    ]);
    if (error) throw error;
    const user = auth?.user;
    return {
      rows: (data || []).map((r) => ({
        rank: Number(r.rank), username: r.username, stars: r.total_stars, level: r.highest_level, me: r.is_me,
      })),
      signedIn: !!user && !user.is_anonymous,
    };
  } catch (e) {
    console.warn('leaderboard:', e?.message || e);
    return null;
  }
}
