/**
 * Thèmes : les habillages que le joueur débloque et choisit.
 *
 * Jusqu'ici, la teinte de l'interface était imposée par le monde en cours, et
 * changeait sous les pieds du joueur au fil de la progression. Un thème est
 * l'inverse : un choix qui reste. Les deux coexistent — sans thème choisi, on
 * garde la teinte du monde, qui reste le comportement d'origine.
 *
 * Chaque thème pose une teinte d'interface et une palette de blocs, exactement
 * comme un monde : c'est le même mécanisme, appliqué à la demande du joueur
 * plutôt qu'à l'avancement.
 *
 * Les conditions de déblocage sont de natures DIFFÉRENTES à dessein — niveaux,
 * étoiles, série, achat. Un thème qui ne dépendrait que de la progression
 * n'apprendrait rien sur le joueur qui le porte.
 */

import * as store from '../data/save.js';
import { track } from '../data/events.js';

export const THEMES = Object.freeze([
  {
    id: 'sakura', emoji: '🌸', teinte: 345,
    palette: ['#eb9aad', '#93bde4', '#97cfb6', '#e9cd8c', '#bdaadd', '#f0b18b'],
    // Le thème d'origine : acquis d'emblée, il sert de repli et de repère.
    condition: { type: 'toujours' },
  },
  {
    id: 'ocean', emoji: '🌊', teinte: 202,
    palette: ['#e0919f', '#7fb6dd', '#7fc9c4', '#dcc98a', '#a3aade', '#e2a487'],
    condition: { type: 'niveaux', valeur: 20 },
  },
  {
    id: 'forest', emoji: '🌲', teinte: 138,
    palette: ['#d99aa0', '#8bb6c4', '#84c48f', '#d3c586', '#aaa1cf', '#dba983'],
    condition: { type: 'niveaux', valeur: 60 },
  },
  {
    id: 'sunset', emoji: '🌅', teinte: 22,
    palette: ['#ef9a86', '#8fb0cf', '#a6c894', '#f0c579', '#c2a0cc', '#eda775'],
    condition: { type: 'etoiles', valeur: 150 },
  },
  {
    id: 'night', emoji: '🌙', teinte: 258,
    palette: ['#cf90b4', '#8ea3dd', '#84c3b4', '#d9c184', '#ab97dc', '#cf9a92'],
    condition: { type: 'etoiles', valeur: 400 },
  },
  {
    id: 'zen', emoji: '🍵', teinte: 96,
    palette: ['#d29aa2', '#95b8c8', '#a8c894', '#d8c98d', '#b3a6cd', '#d9a98d'],
    condition: { type: 'serie', valeur: 7 },
  },
  {
    id: 'snow', emoji: '❄️', teinte: 210,
    palette: ['#dda3ae', '#9cc3e2', '#96cfcc', '#dfd39b', '#b3b6e0', '#d9b8a6'],
    condition: { type: 'premium' },
  },
]);

export const parId = (id) => THEMES.find((t) => t.id === id) || null;

/**
 * Ce thème est-il acquis ? Les conditions sont évaluées CHAQUE FOIS plutôt que
 * notées une bonne fois : un joueur qui remet sa progression à zéro doit
 * reperdre ce qu'elle lui avait ouvert, et un thème offert par une série reste
 * acquis parce qu'il est, lui, enregistré.
 */
export function estDebloque(theme, profil = null) {
  const d = store.load();
  if ((d.themes || []).includes(theme.id)) return true;
  const c = theme.condition;
  if (c.type === 'toujours') return true;
  if (c.type === 'premium') return d.noAds === true;
  if (c.type === 'niveaux') return (d.unlockedLevel - 1) >= c.valeur;
  if (c.type === 'serie') return (d.streak || 0) >= c.valeur;
  if (c.type === 'etoiles') return (profil?.totalStars ?? etoilesTotales(d)) >= c.valeur;
  return false;
}

const etoilesTotales = (d) =>
  Object.values(d.levels || {}).reduce((somme, l) => somme + (l.stars || 0), 0);

/** Ouvre un thème sans condition — récompense de série, achat. */
export function debloquer(id, source) {
  const d = store.load();
  if ((d.themes || []).includes(id)) return false;
  d.themes = [...(d.themes || []), id];
  store.save(d);
  track('theme_unlocked', { theme: id, source });
  return true;
}

/** Le thème choisi, ou null quand le joueur suit la teinte des mondes. */
export const choisi = () => store.load().theme || null;

export function choisir(id) {
  const d = store.load();
  d.theme = id;
  store.save(d);
  track('theme_selected', { theme: id || 'mondes' });
}

/** Ce qu'il manque pour ouvrir ce thème, en clair. */
export function conditionLisible(theme, t) {
  const c = theme.condition;
  if (c.type === 'toujours') return '';
  if (c.type === 'premium') return t('theme.cond.premium');
  return t(`theme.cond.${c.type}`, { n: c.valeur });
}
