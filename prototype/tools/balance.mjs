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

import { getLevel, TOTAL_LEVELS } from '../src/core/levels.js';
import { KIND } from '../src/core/block.js';
import { Board } from '../src/core/board.js';
import { resoudre } from '../src/core/solver.js';

const etoilesPour = (level, drags) => {
  if (drags > level.moveLimit) return 0;
  if (drags <= level.starDrags[0]) return 3;
  if (drags <= level.starDrags[1]) return 2;
  return 1;
};

console.log('niv  monde              blocs murs verr rail joker  rempli  éloign  coups  temps  états');
let alertes = [];

for (let n = 1; n <= TOTAL_LEVELS; n++) {
  const L = getLevel(n);
  const murs = L.blocks.filter((b) => b.kind === KIND.WALL).length;
  const verrous = L.blocks.filter((b) => b.kind === KIND.LOCKED).length;
  const rails = L.blocks.filter((b) => b.kind === KIND.RAIL).length;
  const jokers = L.blocks.filter((b) => b.kind === KIND.JOKER).length;
  const jouables = L.blocks.length - murs;
  const cases = L.blocks.reduce((n, b) => n + b.cells.length, 0);
  const rempli = ((cases / (L.width * L.height)) * 100).toFixed(0);
  const relache = Math.ceil(L.minDrags * 1.3);

  const b = new Board({ ...L, moveLimit: 9999, timeLimit: 9999 });
  const sol = resoudre(b);

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

  console.log(
    String(n).padStart(3),
    L.realm.padEnd(18),
    String(jouables).padStart(5),
    String(murs).padStart(4),
    String(verrous).padStart(4),
    String(rails).padStart(4),
    String(jokers).padStart(5),
    `${rempli}%`.padStart(7),
    String(eloign).padStart(7),
    String(L.moveLimit).padStart(6),
    `${L.timeLimit}s`.padStart(6),
    String(sol.etats).padStart(6),
  );
  if (!sol.resoluble) alertes.push(`niveau ${n} : NON RESOLU par le solveur`);

  if (L.minDrags > L.moveLimit) alertes.push(`niveau ${n} : insoluble dans la limite de coups`);
  if (etoilesPour(L, relache) === 0) alertes.push(`niveau ${n} : 30 % de gestes en trop = défaite`);
  if (jouables < 5) alertes.push(`niveau ${n} : seulement ${jouables} blocs`);
  // Les cinq premiers niveaux servent d'apprentissage : une grille aérée y est voulue.
  if (n > 5 && cases / (L.width * L.height) < 0.45) alertes.push(`niveau ${n} : grille trop vide (${rempli}%)`);
  if (Number(eloign) < 2) alertes.push(`niveau ${n} : blocs trop près de leur porte (${eloign} cases)`);
  if (L.timeLimit / L.minDrags < 3) alertes.push(`niveau ${n} : moins de 3 s par glissé`);
}

console.log(alertes.length ? '\nALERTES\n  ' + alertes.join('\n  ') : '\nAucune alerte.');
