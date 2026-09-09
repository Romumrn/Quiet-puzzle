/**
 * Client Supabase partagé — instancié une seule fois pour l'application.
 *
 * La clé `anon` est publique par conception (RLS contrôle l'accès aux données).
 * Tous les appels qui transitent ici sont best-effort : une erreur réseau ne
 * doit jamais casser le jeu, qui reste jouable hors ligne via localStorage.
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const supabase = createClient(
  'https://vwriqaufkrihmxrvykec.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3cmlxYXVma3JpaG14cnZ5a2VjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NzE0MTEsImV4cCI6MjEwNDQ0NzQxMX0.0dG7_wuOv9i9OPEHpxVOuNymxSZ1DPeWcLKREycaUDQ'
);

// Cache level_code → bigint DB id, pour éviter une requête par niveau joué.
const _levelDbIds = new Map();

/**
 * Résout le bigint id Supabase d'un niveau à partir de son code (ex : 'lvl_042').
 * Retourne null si le niveau n'est pas encore en base ou si le réseau est absent.
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
