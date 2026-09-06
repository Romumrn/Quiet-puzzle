/**
 * Solveur — recherche d'un ordre de sortie qui vide la grille.
 *
 * Sert à deux choses :
 *  - l'éditeur, qui doit pouvoir dire si un niveau dessiné à la main tient
 *    debout AVANT qu'on le donne à un joueur ;
 *  - les tests, où il vérifie la résolubilité des niveaux générés SANS se
 *    servir de la solution de référence, donc de façon réellement indépendante.
 *
 * Portée de la recherche : on cherche dans quel ORDRE sortir les blocs, chaque
 * bloc rejoignant sa porte par un chemin trouvé en largeur. On n'explore pas
 * les déplacements d'appoint — pousser un bloc de côté sans le sortir pour
 * dégager un passage. Un « non résolu » signifie donc « aucune solution de
 * cette forme », pas « insoluble » : le message le dit.
 */

import { KIND } from './block.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Toutes les portes que ce bloc peut rejoindre, une option par porte.
 *
 * Il faut bien les énumérer TOUTES : un joker sort par n'importe quelle porte,
 * et avec des portes à capacité le choix de la sortie change tout. Ne retenir
 * que la première porte trouvée faisait déclarer insolubles des niveaux qui ne
 * l'étaient pas.
 *
 * @returns {Array<{x,y,dx,dy,gate}>}
 */
function sortiesPossibles(board, id) {
  const bloc = board.blocks.get(id);
  if (!bloc || !board.canMove(bloc)) return [];

  const depart = { x: bloc.x, y: bloc.y };
  const vus = new Set([`${bloc.x},${bloc.y}`]);
  const file = [[bloc.x, bloc.y]];
  const parPorte = new Map();

  while (file.length) {
    const [x, y] = file.shift();
    bloc.x = x; bloc.y = y;
    board._reindex();

    for (const [dx, dy] of DIRS) {
      if (!board.accepteDirection(bloc, dx, dy)) continue;

      const porte = board.sortiePossible(bloc, dx, dy);
      if (porte) {
        if (!parPorte.has(porte)) parPorte.set(porte, { x, y, dx, dy, gate: porte });
        continue;
      }

      const cible = bloc.absolute().map(([cx, cy]) => [cx + dx, cy + dy]);
      if (cible.some(([cx, cy]) => !board.inside(cx, cy))) continue;
      const libre = cible.every(([cx, cy]) => {
        const occ = board._occupancy.get(board._key(cx, cy));
        return occ === undefined || occ === id;
      });
      if (!libre) continue;

      const k = `${x + dx},${y + dy}`;
      if (!vus.has(k)) { vus.add(k); file.push([x + dx, y + dy]); }
    }
  }

  bloc.x = depart.x; bloc.y = depart.y;
  board._reindex();
  return [...parPorte.values()];
}

/**
 * @param {Board} board  plateau à résoudre (restitué intact)
 * @returns {{resoluble:boolean, ordre:number[], etats:number, abandon:boolean}}
 *          `abandon` signale que la recherche a été coupée par la limite.
 */
/**
 * Budget de recherche des outils hors ligne (tests, équilibrage). Bien plus
 * large que le défaut : l'éditeur doit répondre au clic, une vérification en
 * ligne de commande peut réfléchir quelques secondes. Les grilles du dernier
 * monde, dont les portes n'ont plus aucune marge de capacité, ouvrent un arbre
 * d'impasses où la recherche exhaustive dépasse largement le budget interactif
 * — sans que le niveau soit pour autant difficile à lire pour un joueur, qui
 * route ses blocs en lisant les capacités au lieu d'énumérer les ordres.
 */
export const BUDGET_HORS_LIGNE = 200000;

export function resoudre(board, maxEtats = 40000) {
  const depart = board.snapshot();
  const vus = new Set();
  let etats = 0;
  let abandon = false;

  // La clé doit inclure la capacité restante des portes : deux configurations
  // de blocs identiques mais avec des portes différemment entamées ne sont pas
  // le même état.
  const cle = () => [...board.blocks.values()]
    .map((b) => `${b.id}:${b.x},${b.y}`).sort().join('|')
    + '#' + board.gates.map((g) => g.capacity ?? '-').join(',');

  function explorer() {
    if (board.remaining() === 0) return [];
    if (etats++ > maxEtats) { abandon = true; return null; }
    const k = cle();
    if (vus.has(k)) return null;
    vus.add(k);

    /**
     * Les blocs LES PLUS CONTRAINTS d'abord.
     *
     * L'ordre d'insertion faisait explorer en premier des blocs qui ont cinq
     * portes possibles, alors qu'un bloc qui n'en a qu'une ne laisse aucun
     * choix : le sortir tôt ferme l'arbre au lieu de le démultiplier. Sur les
     * grilles à portes partagées, où chaque bloc vise plusieurs sorties, cette
     * seule heuristique fait la différence entre une seconde et un abandon.
     *
     * Un bloc SANS aucune sortie possible arrive en tête et coupe la branche
     * immédiatement — il ne sortira pas tant que la grille n'aura pas changé,
     * et rien ne changera si l'on ne sort personne.
     */
    const candidats = [];
    for (const bloc of [...board.blocks.values()]) {
      if (bloc.kind === KIND.WALL) continue;
      candidats.push({ bloc, sorties: sortiesPossibles(board, bloc.id) });
    }
    candidats.sort((a, b) => a.sorties.length - b.sorties.length);

    for (const { bloc, sorties } of candidats) {
      for (const sortie of sorties) {
        const snap = board.snapshot();
        bloc.x = sortie.x; bloc.y = sortie.y;
        board._reindex();
        const r = board.step(bloc.id, sortie.dx, sortie.dy);
        if (!r.ok || r.event.type !== 'exit') { board.restore(snap); continue; }

        const suite = explorer();
        if (suite) return [bloc.id, ...suite];
        board.restore(snap);
        if (abandon) return null;
      }
    }
    return null;
  }

  const ordre = explorer();
  board.restore(depart);
  return { resoluble: !!ordre, ordre: ordre || [], etats, abandon };
}
