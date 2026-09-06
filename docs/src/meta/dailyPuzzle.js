/**
 * Puzzle du jour : les grilles dessinées par les joueurs.
 *
 * Un niveau proposé dans l'éditeur entre dans une file d'attente. Chaque jour,
 * une grille en est tirée — la même pour tout le monde — et chacun la joue une
 * fois, pour un score qui mêle rapidité et économie de gestes. Les scores du
 * jour forment un classement.
 *
 * TOUT EST LOCAL. Ce module joue le rôle qu'un backend tiendra : la file, le
 * tirage et le classement vivent dans `localStorage`, derrière les mêmes
 * signatures qu'auront les routes REST. Deux conséquences à connaître :
 *
 *  - le classement ne montre que les scores de CE navigateur. Il n'y a pas de
 *    serveur à qui les envoyer, et le prototype ne fait semblant de rien ;
 *  - l'AUTEUR d'une proposition et d'un score est identifié par un jeton tiré
 *    au sort au premier lancement, et non par son adresse IP. Une page web ne
 *    connaît pas sa propre IP : seul le serveur qui reçoit la requête la voit.
 *    Le champ `auteur` est donc là, à la bonne place, prêt à recevoir l'IP côté
 *    serveur ; le remplir côté client demanderait d'interroger un service tiers
 *    à chaque partie, ce qui enverrait les joueurs se faire pister ailleurs pour
 *    rien.
 */

import * as store from './../data/save.js';
import { track } from '../data/events.js';

const CLE_FILE = 'puzzlequest.dailypuzzle.v1';

const jour = () => new Date().toISOString().slice(0, 10);

/** Petit RNG seedé, pour que le tirage du jour soit le même pour tous. */
function graineDe(texte) {
  let h = 2166136261;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- Dépôt local -----------------------------------------------------------

const vide = () => ({ version: 1, propositions: [], scores: {} });

function lire() {
  try {
    const brut = localStorage.getItem(CLE_FILE);
    return brut ? { ...vide(), ...JSON.parse(brut) } : vide();
  } catch {
    return vide();
  }
}

function ecrire(data) {
  try {
    localStorage.setItem(CLE_FILE, JSON.stringify(data));
  } catch { /* stockage plein ou bloqué : le jeu continue sans */ }
}

/**
 * Jeton d'auteur, tiré au premier usage et gardé avec la sauvegarde.
 *
 * Il tient la place de l'identifiant que le backend attribuera. Voir l'en-tête
 * du module sur la question de l'adresse IP.
 */
export function auteur() {
  const d = store.load();
  if (!d.auteurId) {
    d.auteurId = 'j' + Math.random().toString(36).slice(2, 8);
    store.save(d);
  }
  return d.auteurId;
}

// --- Propositions ----------------------------------------------------------

/**
 * Dépose un niveau dans la file. Le niveau est supposé VÉRIFIÉ : c'est
 * l'éditeur qui passe le solveur avant d'appeler ici, et lui seul sait si la
 * grille tient debout.
 *
 * @returns {{id:string, rang:number}} l'identifiant attribué et le rang dans la file
 */
export function proposer(niveau, titre) {
  const data = lire();
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  data.propositions.push({
    id,
    titre: (titre || '').slice(0, 40),
    auteur: auteur(),
    deposeLe: jour(),
    niveau,
  });
  ecrire(data);
  track('daily_puzzle_submitted', { id, blocs: niveau.blocks.length });
  return { id, rang: data.propositions.length };
}

export const propositions = () => lire().propositions;

// --- Le puzzle du jour -----------------------------------------------------

/**
 * La proposition du jour, ou null si la file est vide.
 *
 * Le tirage est seedé sur la DATE : tout le monde joue la même grille le même
 * jour, et le résultat ne dépend pas de l'ordre dans lequel on a ouvert le jeu.
 * Une file d'une seule proposition la ressert chaque jour, ce qui est le
 * comportement juste : mieux vaut la même grille qu'aucune.
 */
export function duJour(date = jour()) {
  const liste = lire().propositions;
  if (!liste.length) return null;
  return liste[graineDe(date) % liste.length];
}

// --- Score et classement ---------------------------------------------------

/**
 * Score d'une partie du puzzle du jour.
 *
 * Deux termes, et l'ordre compte : on part d'un socle, on retire ce que coûtent
 * les gestes superflus, puis ce que coûte le temps. Un joueur qui réfléchit
 * longtemps mais joue juste finit donc devant un joueur rapide et brouillon —
 * c'est la hiérarchie qu'un jeu de réflexion doit récompenser.
 *
 * Le score ne descend jamais sous 100 : une grille finie vaut toujours mieux
 * qu'une grille abandonnée, et un barème qui rendrait zéro pour une victoire
 * lente serait vexant sans être informatif.
 */
export const BAREME = Object.freeze({
  SOCLE: 1000,
  PAR_GESTE_SUPERFLU: 25,
  PAR_SECONDE: 2,
  PLANCHER: 100,
});

export function calculerScore({ drags, minDrags, secondes }) {
  const superflus = Math.max(0, drags - minDrags);
  const brut = BAREME.SOCLE
    - superflus * BAREME.PAR_GESTE_SUPERFLU
    - Math.round(secondes) * BAREME.PAR_SECONDE;
  return Math.max(BAREME.PLANCHER, brut);
}

/**
 * Enregistre un score. Un joueur ne garde que son MEILLEUR score du jour :
 * rejouer doit pouvoir améliorer, jamais dégrader.
 */
export function enregistrerScore({ score, drags, secondes, date = jour() }) {
  const data = lire();
  const table = (data.scores[date] ||= []);
  const moi = auteur();
  const existant = table.find((e) => e.auteur === moi);
  if (existant) {
    if (score <= existant.score) return { ameliore: false, entree: existant };
    Object.assign(existant, { score, drags, secondes, a: Date.now() });
  } else {
    table.push({ auteur: moi, score, drags, secondes, a: Date.now() });
  }
  ecrire(data);
  track('daily_puzzle_scored', { score, drags, secondes });
  return { ameliore: true, entree: table.find((e) => e.auteur === moi) };
}

/**
 * Classement du jour, du meilleur au moins bon. À score égal, celui qui a joué
 * en premier passe devant : deux joueurs qui font la même partie ne peuvent pas
 * être départagés autrement sans inventer un critère.
 */
export function classement(date = jour()) {
  const table = [...(lire().scores[date] || [])];
  table.sort((a, b) => b.score - a.score || a.a - b.a);
  return table.map((e, i) => ({ ...e, rang: i + 1, moi: e.auteur === auteur() }));
}

/** A-t-on déjà joué le puzzle d'aujourd'hui ? */
export function dejaJoue(date = jour()) {
  return classement(date).some((e) => e.moi);
}

/** Remet la file et les scores à zéro — panneau QA. */
export function reinitialiser() {
  ecrire(vide());
}
