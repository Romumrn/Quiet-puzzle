/**
 * Gestion de la session joueur côté Supabase.
 *
 * À l'ouverture de l'app, on tente de récupérer une session existante
 * (stockée par le SDK dans localStorage). Si aucune n'existe, on crée
 * une session anonyme : le joueur obtient un identifiant persistant sans
 * aucune friction (pas de formulaire). Il pourra lier son compte à une
 * adresse e-mail plus tard.
 *
 * Tous les appels sont best-effort : une erreur réseau ne bloque pas le
 * démarrage, le jeu reste jouable via localStorage.
 */

import { supabase } from './supabaseClient.js';

let _ready = false;

export async function initialiserSession() {
  if (_ready) return;
  _ready = true;
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session) return;
    await supabase.auth.signInAnonymously();
  } catch {
    // Non-fatal : le jeu fonctionne hors ligne.
  }
}

/** Retourne l'utilisateur courant, ou null si non authentifié. */
export async function getUser() {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user ?? null;
  } catch {
    return null;
  }
}
