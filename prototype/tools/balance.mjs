/**
 * Outil d'équilibrage — `node tools/balance.mjs`
 *
 * S'appuie sur la solution de référence de chaque niveau (produite par la
 * génération à l'envers) pour situer les limites de coups et de temps.
 *
 * `minDrags` est le nombre de glissés de la solution de référence : un plancher,
 * pas une prédiction. Un joueur tâtonne — les colonnes "marge" indiquent
 * combien de glissés en trop il peut se permettre avant de perdre, et les
 * étoiles qu'il décroche selon qu'il joue parfaitement ou avec 30 % de gestes
 * superflus. A relancer après toute modification de la courbe de difficulté.
 */

import * as base from './base.mjs';

// Comme les tests : on mesure la base livrée, pas ce que le générateur
// produirait s'il tournait de nouveau.
const TOTAL_LEVELS = base.totalLevels();
const LEVELS_PER_REALM = base.levelsPerRealm();
const REALMS = base.realms();
const realmDe = base.realmDe;
const niveaux = new Map();
for (let n = 1; n <= TOTAL_LEVELS; n++) niveaux.set(n, await base.getLevel(n));
const getLevel = (n) => niveaux.get(n);
import { KIND } from '../src/core/block.js';
import { Board } from '../src/core/board.js';
import { resoudre, BUDGET_HORS_LIGNE } from '../src/core/solver.js';

const etoilesPour = (level, drags) => {
  if (drags > level.moveLimit) return 0;
  if (drags <= level.starDrags[0]) return 3;
  if (drags <= level.starDrags[1]) return 2;
  return 1;
};

// Un monde compte vingt niveaux : les détailler tous produit un mur de chiffres
// que personne ne lit. On échantillonne le premier, le milieu et le dernier —
// les trois points où se juge la rampe interne — et l'on mesure TOUS les
// niveaux pour les alertes et les moyennes de monde.
const DETAILLE = new Set();
for (let m = 0; m < REALMS.length; m++) {
  const base = m * LEVELS_PER_REALM;
  for (const k of [1, Math.ceil(LEVELS_PER_REALM / 2), LEVELS_PER_REALM]) DETAILLE.add(base + k);
}
if (process.argv.includes('--tout')) for (let n = 1; n <= TOTAL_LEVELS; n++) DETAILLE.add(n);

console.log('niv  monde              blocs murs verr rail ancr enc joker  rempli  éloign  gestes  ★3  ★2  coups  temps  états');
let alertes = [];
const parMonde = REALMS.map(() => ({ cases: 0, effets: 0, gestes: 0, n: 0 }));

for (let n = 1; n <= TOTAL_LEVELS; n++) {
  const L = getLevel(n);
  const murs = L.blocks.filter((b) => b.kind === KIND.WALL).length;
  const verrous = L.blocks.filter((b) => b.kind === KIND.LOCKED).length;
  const rails = L.blocks.filter((b) => b.kind === KIND.RAIL).length;
  const ancres = L.blocks.filter((b) => b.kind === KIND.ANCRE).length;
  const encombrants = L.blocks.filter((b) => b.kind === KIND.ENCOMBRANT).length;
  const jokers = L.blocks.filter((b) => b.kind === KIND.JOKER).length;
  const jouables = L.blocks.length - murs;
  const cases = L.blocks.reduce((n, b) => n + b.cells.length, 0);
  const rempli = ((cases / (L.width * L.height)) * 100).toFixed(0);
  const relache = Math.ceil(L.minDrags * 1.3);

  // Le solveur ne tourne que sur les niveaux DÉTAILLÉS. Sur trois cent soixante
  // grilles, dont quelques-unes demandent plusieurs secondes, il ferait de cet
  // outil de lecture rapide une commande qu'on lance et qu'on abandonne.
  const sol = DETAILLE.has(n)
    ? resoudre(new Board({ ...L, moveLimit: 9999, timeLimit: 9999 }), BUDGET_HORS_LIGNE)
    : null;

  // Distance moyenne d'un bloc à sa porte au départ : la mesure directe du
  // reproche « les blocs sont déjà à côté de leur sortie ».
  const dist = (g, bl) => {
    const w = Math.max(...bl.cells.map((c) => c[0])) + 1;
    const h = Math.max(...bl.cells.map((c) => c[1])) + 1;
    if (g.side === 'right') return L.width - (bl.x + w);
    if (g.side === 'left') return bl.x;
    if (g.side === 'bottom') return L.height - (bl.y + h);
    return bl.y;
  };
  const parId = new Map(L.blocks.map((x) => [x.id, x]));
  const distances = L.solution.map((e) => {
    const bl = parId.get(e.id);
    const g = L.gates.find((x) => x.side === e.gate) || L.gates[0];
    return dist(g, bl);
  });
  const eloign = distances.length
    ? (distances.reduce((a, c) => a + c, 0) / distances.length).toFixed(1) : '0';

  if (DETAILLE.has(n)) console.log(
    String(n).padStart(3),
    L.realm.padEnd(18),
    String(jouables).padStart(5),
    String(murs).padStart(4),
    String(verrous).padStart(4),
    String(rails).padStart(4),
    String(ancres).padStart(4),
    String(encombrants).padStart(3),
    String(jokers).padStart(5),
    `${rempli}%`.padStart(7),
    String(eloign).padStart(7),
    String(L.minDrags).padStart(7),
    String(L.starDrags[0]).padStart(4),
    String(L.starDrags[1]).padStart(4),
    String(L.moveLimit).padStart(6),
    `${L.timeLimit}s`.padStart(6),
    String(sol ? sol.etats : '—').padStart(6),
  );
  // Un abandon ne dit rien du niveau : le budget est épuisé, pas l'espace des
  // solutions. Seul un échec au terme d'une recherche complète est un défaut.
  if (sol && !sol.resoluble && !sol.abandon) alertes.push(`niveau ${n} : NON RESOLU par le solveur`);

  if (L.minDrags > L.moveLimit) alertes.push(`niveau ${n} : insoluble dans la limite de coups`);
  if (etoilesPour(L, relache) === 0) alertes.push(`niveau ${n} : 30 % de gestes en trop = défaite`);
  // Les trois notes doivent exister. Une limite de coups tombée sous le seuil
  // 3★ rend toute victoire parfaite, et sous le seuil 2★ rend la 1★
  // inatteignable : l'écran de résultat promet alors une note que personne ne
  // peut obtenir.
  if (L.moveLimit <= L.starDrags[0]) alertes.push(`niveau ${n} : toute victoire donne 3★ (coups ${L.moveLimit} ≤ seuil ${L.starDrags[0]})`);
  else if (L.moveLimit <= L.starDrags[1]) alertes.push(`niveau ${n} : la 1★ est inatteignable (coups ${L.moveLimit} ≤ seuil ${L.starDrags[1]})`);
  if (jouables < 5) alertes.push(`niveau ${n} : seulement ${jouables} blocs`);
  // Les cinq premiers niveaux servent d'apprentissage : une grille aérée y est voulue.
  if (n > 5 && cases / (L.width * L.height) < 0.45) alertes.push(`niveau ${n} : grille trop vide (${rempli}%)`);
  if (Number(eloign) < 2) alertes.push(`niveau ${n} : blocs trop près de leur porte (${eloign} cases)`);
  if (L.timeLimit / L.minDrags < 3) alertes.push(`niveau ${n} : moins de 3 s par glissé`);

  const monde = parMonde[realmDe(n).id];
  // On mesure les CASES occupées, et non le nombre de blocs : un monde qui
  // interdit les petites pièces en compte forcément moins, alors qu'il encombre
  // autant la grille. Compter les blocs le faisait passer pour un recul.
  monde.cases += cases;
  monde.effets += murs + verrous + rails + ancres + encombrants;
  monde.gestes += L.minDrags;
  monde.n++;
}

/**
 * La difficulté doit monter d'un monde au suivant. On la mesure par monde et
 * non niveau par niveau : le générateur produit du grain — deux blocs d'écart
 * entre voisins ne veulent rien dire — mais une moyenne de monde qui recule
 * signale un palier de `curve()` mal réglé, et c'est le seul défaut que le
 * joueur ressent vraiment.
 */
console.log('\nPROGRESSION PAR MONDE');
console.log('monde                cases  effets  gestes');
let precedent = null;
for (const [i, m] of parMonde.entries()) {
  if (!m.n) continue;
  const moy = { cases: m.cases / m.n, effets: m.effets / m.n, gestes: m.gestes / m.n };
  console.log(
    REALMS[i].name.padEnd(20),
    moy.cases.toFixed(1).padStart(5),
    moy.effets.toFixed(1).padStart(7),
    moy.gestes.toFixed(1).padStart(7),
  );
  if (precedent) {
    const recule = ['cases', 'effets', 'gestes'].filter((k) => moy[k] < precedent.moy[k] - 0.05);
    // Un monde peut échanger un levier contre un autre — moins de blocs, plus
    // d'effets. Ce n'est un vrai recul que si TOUT redescend à la fois.
    if (recule.length === 3) alertes.push(`monde « ${REALMS[i].name} » : plus facile que « ${REALMS[i - 1].name} »`);
  }
  precedent = { moy };
}

console.log(alertes.length ? '\nALERTES\n  ' + alertes.join('\n  ') : '\nAucune alerte.');
