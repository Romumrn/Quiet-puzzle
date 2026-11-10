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
 * Two orders (migration 20261110140000): by stars, then level reached — the
 * default — or by level reached, then stars.
 *
 * Anonymous players are not listed (they have not chosen to appear before
 * others); they see the board and an invitation to sign in.
 */

import { supabase } from '../data/supabaseClient.js';

/**
 * @returns {Promise<{ rows: Array<{rank, username, stars, level, me}>, signedIn: boolean } | null>}
 *   null when the server cannot be reached
 */
export async function fetchBoard(limit = 50, by = 'stars') {
  try {
    const ask = (args) => supabase.rpc('leaderboard', args);
    const [first, { data: auth }] = await Promise.all([
      ask(by === 'level' ? { p_limit: limit, p_by: 'level' } : { p_limit: limit }),
      supabase.auth.getUser(),
    ]);
    let { data, error } = first;
    // A server without the migration knows no `p_by`: the stars' top, re-sorted
    // here — approximate (the top by stars), better than nothing.
    let resort = false;
    if (error && by === 'level') {
      ({ data, error } = await ask({ p_limit: limit }));
      resort = true;
    }
    if (error) throw error;
    const user = auth?.user;
    let rows = (data || []).map((r) => ({
      rank: Number(r.rank), username: r.username, stars: r.total_stars, level: r.highest_level, me: r.is_me,
    }));
    if (resort) {
      rows = rows.sort((a, b) => b.level - a.level || b.stars - a.stars);
      rows.forEach((r, i) => { r.rank = i && rows[i - 1].level === r.level && rows[i - 1].stars === r.stars ? rows[i - 1].rank : i + 1; });
    }
    return { rows, signedIn: !!user && !user.is_anonymous };
  } catch (e) {
    console.warn('leaderboard:', e?.message || e);
    return null;
  }
}
