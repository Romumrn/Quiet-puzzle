/**
 * Admin mode — reading and writing what only an administrator may touch.
 *
 * THE CLIENT-SIDE CHECK IS COSMETIC. `isAdmin()` decides whether the admin
 * button and panel are *displayed*; it decides nothing about what the database
 * will accept. Every action here goes through Supabase, where the real gate is
 * Row Level Security and the `public.is_admin()` SQL function (see
 * supabase/migrations/…_init_schema.sql, §17 and §18). A player who forces the
 * panel open in their browser console gets a UI that answers "permission
 * denied" to everything — which is exactly the intent.
 *
 * The role itself is NOT grantable from here, and that is deliberate:
 * `public.user_roles` has a read policy for admins and no write policy at all,
 * so nobody can promote themselves. Granting a role is done once, from the
 * Supabase SQL editor:
 *
 *   insert into public.user_roles (user_id, role)
 *   values ('<uuid of the account>', 'admin');
 *
 * Everything is best-effort: no network, no session, or a plain refusal all
 * resolve to "not an admin" / an empty result rather than throwing. The game
 * stays playable offline, which is its normal mode.
 */

import { supabase } from './supabaseClient.js';

/**
 * Cached answer for this page load. The role does not change mid-session, and
 * asking on every screen would add a round trip to every navigation.
 * `null` means "not asked yet".
 */
let cached = null;

/** Forget the cached answer — on sign-in and on sign-out. */
export function forget() { cached = null; }

/** @returns {Promise<boolean>} true when the signed-in account holds the admin role. */
export async function isAdmin() {
  if (cached !== null) return cached;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return (cached = false);
    const { data, error } = await supabase.rpc('is_admin');
    cached = !error && data === true;
  } catch {
    cached = false;
  }
  return cached;
}

/** The signed-in account, or null — shown in the panel's header. */
export async function currentUser() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user ?? null;
  } catch {
    return null;
  }
}

/**
 * Counts, for the panel's header line.
 *
 * `head: true` with `count: 'exact'` asks Postgres for the count without
 * shipping a single row: a level table of six hundred rows has no business
 * travelling to a phone just to be counted.
 */
export async function stats() {
  const count = async (table, filter = (q) => q) => {
    try {
      const { count: n, error } = await filter(
        supabase.from(table).select('*', { count: 'exact', head: true }),
      );
      return error ? null : n;
    } catch {
      return null;
    }
  };
  const [levels, players, submitted, flagged] = await Promise.all([
    count('levels', (q) => q.eq('status', 'published')),
    count('profiles'),
    count('community_levels', (q) => q.eq('status', 'submitted')),
    count('level_attempts', (q) => q.eq('is_flagged', true)),
  ]);
  return { levels, players, submitted, flagged };
}

// ---------------------------------------------------------------------------
// Community level moderation
// ---------------------------------------------------------------------------

/**
 * Levels awaiting a decision, oldest first.
 *
 * We read the table rather than the `moderation_queue` view because the panel
 * shows the title AND the grid size, and the view deliberately only carries
 * what a queue needs. Both are filtered by the same RLS policy.
 */
export async function moderationQueue(limit = 25) {
  try {
    const { data, error } = await supabase
      .from('community_levels')
      .select('id, title, description, created_at, creator_id, grid')
      .eq('status', 'submitted')
      .order('created_at', { ascending: true })
      .limit(limit);
    return error ? [] : (data ?? []);
  } catch {
    return [];
  }
}

/**
 * Decides on a submission.
 *
 * `approved` puts it back in the pool the daily draw can pick from; `rejected`
 * takes it out without deleting it — the creator keeps their grid and the
 * decision stays auditable. Nothing is ever destroyed from here.
 *
 * @param {string} id  community level uuid
 * @param {'approved'|'rejected'|'published'} status
 * @param {string} notes  reason, stored alongside the decision
 */
export async function moderate(id, status, notes = '') {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase
      .from('community_levels')
      .update({
        status,
        moderation_notes: notes || null,
        moderated_by: session?.user?.id ?? null,
        moderated_at: new Date().toISOString(),
      })
      .eq('id', id);
    return { ok: !error, error: error?.message ?? null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Daily puzzle
// ---------------------------------------------------------------------------

/** The game modes, needed to address a daily puzzle (date + mode is its key). */
export async function gameModes() {
  try {
    const { data, error } = await supabase
      .from('game_modes')
      .select('id, code, name')
      .order('sort_order');
    return error ? [] : (data ?? []);
  } catch {
    return [];
  }
}

/** The daily puzzles picked around today — thirty days either side. */
export async function dailyCalendar() {
  try {
    const { data, error } = await supabase
      .from('daily_puzzle_calendar')
      .select('*');
    return error ? [] : (data ?? []);
  } catch {
    return [];
  }
}

/**
 * Forces the daily puzzle for a date, or lets the automatic draw decide.
 *
 * The server does the checking: `select_daily_puzzle` raises when a non-admin
 * passes a level id, and when the level is not published. Passing neither id
 * runs the ordinary automatic selection — useful for filling a hole in the
 * calendar without choosing the grid oneself.
 *
 * @param {string} date  'YYYY-MM-DD'
 * @param {number} modeId
 * @param {{levelId?:number, communityLevelId?:string}} source
 */
export async function setDailyPuzzle(date, modeId, source = {}) {
  try {
    const { error } = await supabase.rpc('select_daily_puzzle', {
      p_date: date,
      p_mode_id: modeId,
      p_level_id: source.levelId ?? null,
      p_community_level_id: source.communityLevelId ?? null,
    });
    return { ok: !error, error: error?.message ?? null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Anti-cheat
// ---------------------------------------------------------------------------

/**
 * Attempts the server flagged as implausible (see `complete_level`: fewer than
 * 120 ms per gesture). It is a very permissive heuristic — its purpose is to
 * give something to look at, not to sanction anybody automatically.
 */
export async function flaggedAttempts(limit = 25) {
  try {
    const { data, error } = await supabase
      .from('flagged_attempts')
      .select('*')
      .limit(limit);
    return error ? [] : (data ?? []);
  } catch {
    return [];
  }
}
