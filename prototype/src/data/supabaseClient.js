/**
 * Shared Supabase client — instantiated once for the whole application.
 *
 * The `anon` key is public by design (RLS controls access to the data). Every
 * call going through here is best-effort: a network error must never break the
 * game, which stays playable offline via localStorage.
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const supabase = createClient(
  'https://vwriqaufkrihmxrvykec.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3cmlxYXVma3JpaG14cnZ5a2VjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NzE0MTEsImV4cCI6MjEwNDQ0NzQxMX0.0dG7_wuOv9i9OPEHpxVOuNymxSZ1DPeWcLKREycaUDQ'
);

// Cache level_code → bigint DB id, to avoid one query per level played.
const _levelDbIds = new Map();

/**
 * Resolves a level's Supabase bigint id from its code (e.g. 'lvl_042').
 * Returns null if the level is not in the database yet, or there is no network.
 */
export async function getLevelDbId(levelCode) {
  if (_levelDbIds.has(levelCode)) return _levelDbIds.get(levelCode);
  try {
    const { data, error } = await supabase
      .from('levels')
      .select('id')
      .eq('level_code', levelCode)
      .single();
    if (error || !data?.id) return null;
    _levelDbIds.set(levelCode, data.id);
    return data.id;
  } catch {
    return null;
  }
}
