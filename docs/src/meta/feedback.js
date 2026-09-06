/**
 * Signalements : bugs, suggestions, remarques.
 *
 * Le joueur écrit, joint des captures s'il veut, et repart avec un rapport
 * complet. Ce que ce module NE fait pas, et c'est le point à comprendre : il
 * n'envoie rien. Le prototype n'a pas de serveur, et rien ne part d'un
 * navigateur sans destinataire.
 *
 * Il prépare donc le rapport et laisse le joueur choisir sa route : le copier,
 * le télécharger, ou ouvrir son courrielleur avec le texte déjà écrit. Les
 * captures ne peuvent voyager que par le fichier téléchargé — aucun `mailto:`
 * ne sait joindre une pièce.
 *
 * Le CONTEXTE TECHNIQUE est joint automatiquement : version, langue, écran,
 * niveau en cours, taille de fenêtre, navigateur. C'est ce qui manque toujours
 * dans un rapport de bug, et ce que personne ne pense à donner.
 */

import * as store from '../data/save.js';
import { track } from '../data/events.js';

const CLE = 'puzzlequest.feedback.v1';
const MAX = 20;

/** Catégories proposées. L'identifiant part dans le rapport, pas le libellé. */
export const CATEGORIES = ['bug', 'idea', 'other'];

/**
 * Les captures ne sont PAS conservées dans le stockage local : quelques images
 * de téléphone en base64 dépassent à elles seules le quota d'un navigateur, et
 * l'historique deviendrait la raison pour laquelle le jeu ne sauvegarde plus.
 * Elles vivent le temps de la rédaction, et voyagent dans le fichier exporté.
 */
const lire = () => {
  try {
    const brut = localStorage.getItem(CLE);
    const l = brut ? JSON.parse(brut) : [];
    return Array.isArray(l) ? l : [];
  } catch {
    return [];
  }
};

const ecrire = (l) => {
  try { localStorage.setItem(CLE, JSON.stringify(l.slice(0, MAX))); } catch { /* quota */ }
};

/** Ce que le développeur voudra savoir et que le joueur ne pensera pas à dire. */
export function contexte(extra = {}) {
  const d = store.load();
  return {
    version: 'prototype',
    date: new Date().toISOString(),
    langue: d.langue || 'auto',
    niveauDebloque: d.unlockedLevel,
    pieces: d.coins,
    glyphes: d.glyphes === true,
    ecran: typeof window === 'undefined' ? null
      : `${window.innerWidth}×${window.innerHeight}`,
    navigateur: typeof navigator === 'undefined' ? null : navigator.userAgent,
    ...extra,
  };
}

/**
 * Compose le rapport. `captures` est une liste de { nom, type, taille, data },
 * `data` étant une URI `data:` — c'est sous cette forme qu'elles peuvent être
 * relues par qui reçoit le fichier.
 */
export function composer({ categorie, message, captures = [], extra = {} }) {
  return {
    categorie: CATEGORIES.includes(categorie) ? categorie : 'other',
    message: String(message || '').slice(0, 4000),
    contexte: contexte(extra),
    captures,
  };
}

/** Enregistre le rapport, sans ses captures. @returns {string} identifiant */
export function enregistrer(rapport) {
  const l = lire();
  const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  l.unshift({
    id,
    categorie: rapport.categorie,
    message: rapport.message,
    contexte: rapport.contexte,
    captures: rapport.captures.length,   // le compte, pas les images
  });
  ecrire(l);
  track('feedback_submitted', { id, categorie: rapport.categorie, captures: rapport.captures.length });
  return id;
}

export const liste = () => lire();
export const vider = () => ecrire([]);

/** Le rapport en texte lisible — c'est ce qui part dans un courriel. */
export function enTexte(rapport) {
  const lignes = [
    `[${rapport.categorie}] Quiet Puzzle`,
    '',
    rapport.message,
    '',
    '--- contexte ---',
    ...Object.entries(rapport.contexte).map(([k, v]) => `${k}: ${v}`),
  ];
  if (rapport.captures.length) {
    lignes.push('', `${rapport.captures.length} capture(s) dans le fichier joint.`);
  }
  return lignes.join('\n');
}
