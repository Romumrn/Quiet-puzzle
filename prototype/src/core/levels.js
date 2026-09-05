/**
 * LevelManager — équivalent de Scripts/Gameplay/LevelManager.cs (doc §4)
 *
 * Les niveaux sont générés A L'ENVERS, et c'est le point important : au lieu de
 * poser des blocs au hasard en espérant que ce soit jouable, on fait ENTRER
 * chaque bloc par sa porte puis on le fait reculer dans la grille. Un niveau
 * ainsi construit est résoluble par construction, et la marche arrière fournit
 * gratuitement une solution de référence — utilisée par les tests, par
 * l'équilibrage, et disponible pour un futur système d'indices.
 *
 * L'ordre de résolution est l'inverse de l'ordre de pose : le dernier bloc posé
 * sort en premier, et son chemin est libre puisqu'il a été creusé alors que
 * seuls les blocs précédents étaient là.
 *
 * Le RNG est seedé : le niveau n produit toujours la même grille.
 * Chaque objet respecte la forme de `GET /api/level/{levelNumber}` (doc §6.1).
 */

import { SHAPES, KIND, coutCapacite } from './block.js';
import { Board, SIDES as VECTEURS_SORTIE } from './board.js';

/**
 * Un monde tient sur vingt niveaux et se définit par une seule ligne de la
 * table ci-dessous. Il apporte trois choses au joueur, toujours les trois
 * ensemble :
 *
 *  1. UNE NOUVEAUTÉ — un type de bloc, ou une règle, qu'il n'a jamais vu.
 *  2. UNE PALETTE — les six familles gardent leurs glyphes (●◆▲★■⬢), qui
 *     portent la règle, mais changent de teintes : le monde se reconnaît au
 *     premier coup d'œil sans que l'appariement bloc/porte soit à réapprendre.
 *  3. UN CRAN DE DIFFICULTÉ — grille plus grande, une couleur ou une porte de
 *     plus, et surtout une marge de capacité qui se resserre.
 *
 * Vingt niveaux par monde plutôt que cinq : une mécanique nouvelle a besoin
 * d'être pratiquée avant d'être combinée à la suivante. La difficulté monte
 * DANS le monde (les quantités notées `[début, fin]` sont interpolées sur ses
 * vingt niveaux) et fait un palier ENTRE les mondes.
 */
export const LEVELS_PER_REALM = 20;

export const REALMS = [
  {
    id: 0, name: 'Atelier de Verre', difficulty: 'apprentissage',
    teinte: 345,
    palette: ['#eb9aad', '#93bde4', '#97cfb6', '#e9cd8c', '#bdaadd', '#f0b18b'],
    nouveaute: null,
    apporte: 'Les blocs et leurs portes',
    W: 5, H: 6, colorCount: 3, gateCount: 3,
    murs: [0, 0], verrous: [0, 0], rails: [0, 0], ancres: [0, 0], encombrants: [0, 0],
    jokers: 0, marge: null, scelleCouleur: false,
  },
  {
    id: 1, name: 'Fonderie', difficulty: 'facile',
    teinte: 22,
    palette: ['#e8907b', '#7fb0c9', '#a9c48b', '#edc073', '#c39fc0', '#d9a06b'],
    nouveaute: KIND.RAIL,
    apporte: 'Blocs sur glissière, portes à capacité',
    W: 6, H: 6, colorCount: 4, gateCount: 4,
    murs: [0, 1], verrous: [0, 0], rails: [1, 5], ancres: [0, 0], encombrants: [0, 0],
    jokers: 0, marge: 3, scelleCouleur: false,
  },
  {
    id: 2, name: 'Chambre Froide', difficulty: 'moyen',
    teinte: 196,
    palette: ['#d99aa8', '#8cc6e0', '#8fd3c4', '#d7d295', '#aeb3e0', '#e2b3a6'],
    nouveaute: KIND.WALL,
    apporte: 'Blocs scellés, immobiles',
    W: 6, H: 7, colorCount: 4, gateCount: 4,
    murs: [1, 4], verrous: [0, 0], rails: [2, 6], ancres: [0, 0], encombrants: [0, 0],
    jokers: 0, marge: 3, scelleCouleur: false,
  },
  {
    id: 3, name: 'Tour de Contrôle', difficulty: 'soutenu',
    teinte: 262,
    palette: ['#e493b4', '#8fa8e2', '#86cbb0', '#e3c886', '#b49ae0', '#7fc4d4'],
    nouveaute: KIND.LOCKED,
    apporte: 'Verrous à décompte',
    W: 6, H: 8, colorCount: 5, gateCount: 5,
    murs: [1, 4], verrous: [1, 3], rails: [3, 7], ancres: [0, 0], encombrants: [0, 0],
    jokers: 0, marge: 2, scelleCouleur: false,
  },
  {
    id: 4, name: 'Salle des Machines', difficulty: 'exigeant',
    teinte: 30,
    palette: ['#dd9b95', '#96b6cc', '#9fc9a4', '#d9bd7f', '#b2a6c9', '#e0a97f'],
    nouveaute: KIND.JOKER,
    apporte: 'Le joker, qui sort par où il veut',
    W: 7, H: 8, colorCount: 5, gateCount: 5,
    murs: [2, 4], verrous: [1, 3], rails: [4, 9], ancres: [0, 0], encombrants: [0, 0],
    jokers: 1, marge: 2, scelleCouleur: false,
  },
  {
    id: 5, name: 'Serre Suspendue', difficulty: 'redoutable',
    teinte: 128,
    palette: ['#ec9cc0', '#8ec7d9', '#93cf8e', '#dfd083', '#c1a3dc', '#efb28f'],
    nouveaute: KIND.ANCRE,
    apporte: 'Ancres, qui n\'avancent que vers leur porte',
    W: 7, H: 9, colorCount: 6, gateCount: 6,
    murs: [2, 5], verrous: [1, 3], rails: [4, 9], ancres: [1, 4], encombrants: [0, 0],
    jokers: 1, marge: 1, scelleCouleur: false,
  },
  {
    id: 6, name: 'Observatoire', difficulty: 'implacable',
    teinte: 288,
    palette: ['#d792bb', '#8bacdf', '#8ecdc0', '#e6cd90', '#a99ae0', '#e5a3a0'],
    nouveaute: KIND.ENCOMBRANT,
    apporte: 'Encombrants, qui coûtent double à leur porte',
    W: 8, H: 9, colorCount: 6, gateCount: 6,
    murs: [3, 5], verrous: [2, 3], rails: [5, 10], ancres: [2, 5], encombrants: [1, 4],
    jokers: 1, marge: 1, scelleCouleur: false,
  },
  {
    id: 7, name: 'Dernière Verrière', difficulty: 'sans marge',
    teinte: 165,
    palette: ['#ef8fa6', '#85b8e8', '#8ad4b1', '#f0cd7e', '#b99ae6', '#f4ab84'],
    nouveaute: 'scelle-couleur',
    apporte: 'Scellés de couleur, et des portes sans un pouce de marge',
    W: 8, H: 10, colorCount: 6, gateCount: 7,
    murs: [3, 6], verrous: [2, 4], rails: [6, 12], ancres: [3, 6], encombrants: [2, 5],
    jokers: 0, marge: 0, scelleCouleur: true,
  },
];

export const TOTAL_LEVELS = REALMS.length * LEVELS_PER_REALM;

/** Le monde auquel appartient le niveau `n` (1-indexé). */
export function realmDe(n) {
  return REALMS[Math.min(REALMS.length - 1, Math.floor((n - 1) / LEVELS_PER_REALM))];
}

const SIDES = ['top', 'right', 'bottom', 'left'];

/**
 * Un bloc posé dans l'ouverture d'une porte peut-il vraiment en sortir ?
 *
 * Une forme non rectangulaire (T, L) déborde de part et d'autre de la porte :
 * ses épaules doivent aussi pouvoir avancer. Sans cette vérification, la
 * génération produisait des niveaux dont la solution ne tenait que parce que
 * le moteur laissait alors un bloc traverser ses voisins.
 */
function peutSortirDeSaPorte(grille, gate, shape, x, y, id) {
  const [dx, dy] = VECTEURS_SORTIE[gate.side];
  return shape.cells.every(([cx, cy]) => {
    const nx = x + cx + dx, ny = y + cy + dy;
    if (!grille.inside(nx, ny)) return true;
    const occ = grille.occ.get(grille.key(nx, ny));
    return occ === undefined || occ === id;
  });
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const shuffled = (rng, arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/**
 * Courbe de difficulté : ce que le générateur doit produire pour le niveau `n`.
 *
 * Tout vient de la table REALMS. Le monde fixe le décor et les plafonds, la
 * position DANS le monde fixe les quantités : `t` vaut 0 au premier niveau du
 * monde, 1 au vingtième, et chaque intervalle `[début, fin]` est lu à ce point.
 * Une mécanique arrive donc au compte-gouttes — une ancre au niveau 101, six au
 * niveau 120 — au lieu de tomber d'un bloc au changement de monde.
 */
function curve(n) {
  const R = realmDe(n);
  const rang = (n - 1) % LEVELS_PER_REALM;                 // 0 … 19
  const t = LEVELS_PER_REALM > 1 ? rang / (LEVELS_PER_REALM - 1) : 0;
  const rampe = ([a, b]) => Math.round(a + (b - a) * t);

  // La DENSITE fait la difficulté, pas la longueur des chemins : un bloc isolé
  // rejoint toujours sa porte d'un seul glissé. Ce qui fait réfléchir, c'est
  // que les blocs se gênent et imposent un ordre de sortie. On vise donc une
  // grille bien remplie (55 à 70 % des cases occupées).
  //
  // Le nombre de blocs se déduit de la SURFACE et non d'une rampe absolue :
  // c'est la seule façon d'avoir une grille aussi remplie au premier niveau
  // d'un monde qu'au dernier du précédent, alors que la grille vient de
  // grandir. Une forme fait 2,3 cases en moyenne, d'où les coefficients.
  const blockCount = Math.round(R.W * R.H * (0.24 + 0.09 * t));

  // Avancement sur l'ensemble du jeu — ce qui ne dépend pas du monde s'y indexe.
  const global = (n - 1) / (TOTAL_LEVELS - 1);

  return {
    W: R.W, H: R.H, colorCount: R.colorCount, gateCount: R.gateCount,
    murs: rampe(R.murs),
    verrous: rampe(R.verrous),
    rails: rampe(R.rails),
    ancres: rampe(R.ancres),
    encombrants: rampe(R.encombrants),
    jokers: R.jokers,
    blockCount,
    recul: [6, Math.round(11 + 5 * global)],
    // `marge` est le rab accordé aux portes à capacité, au-delà de ce que la
    // solution de référence leur destine. Sans capacité, aucun ordre de sortie
    // ne peut être mauvais — sortir un bloc ne fait que libérer de la place — et
    // le niveau se résout au premier essai quelle que soit la méthode. La
    // capacité est le seul levier qui crée un vrai casse-tête ; la marge
    // décroissante en règle la sévérité, jusqu'à zéro au dernier monde.
    capacite: R.marge !== null,
    marge: R.marge ?? 0,
    scelleCouleur: R.scelleCouleur,
  };
}

// ---------------------------------------------------------------------------
// Grille de travail
// ---------------------------------------------------------------------------

class Grille {
  constructor(W, H) { this.W = W; this.H = H; this.occ = new Map(); }
  key(x, y) { return y * this.W + x; }
  inside(x, y) { return x >= 0 && x < this.W && y >= 0 && y < this.H; }
  libre(cells, sauf) {
    return cells.every(([x, y]) => {
      if (!this.inside(x, y)) return false;
      const o = this.occ.get(this.key(x, y));
      return o === undefined || o === sauf;
    });
  }
  poser(id, cells) { for (const [x, y] of cells) this.occ.set(this.key(x, y), id); }
  retirer(cells) { for (const [x, y] of cells) this.occ.delete(this.key(x, y)); }
}

const absolute = (shape, x, y) => shape.cells.map(([dx, dy]) => [x + dx, y + dy]);

/** Portes : réparties sur les côtés, sans chevauchement, chaque couleur servie. */
function makeGates({ W, H, colorCount, gateCount }, rng) {
  const gates = [];
  const parSide = { top: [], right: [], bottom: [], left: [] };
  const longueurDe = (side) => (side === 'top' || side === 'bottom' ? W : H);

  const couleurs = shuffled(rng, [...Array(colorCount).keys()]);
  for (let i = 0; i < gateCount; i++) {
    const color = couleurs[i % colorCount];
    for (let essai = 0; essai < 40; essai++) {
      const side = pick(rng, SIDES);
      const max = longueurDe(side);
      const length = Math.min(max, rng() < 0.35 ? 3 : 2);
      const start = Math.floor(rng() * (max - length + 1));
      const chevauche = parSide[side].some((g) => start < g.start + g.length && g.start < start + length);
      if (chevauche) continue;
      const gate = { side, start, length, color };
      parSide[side].push(gate);
      gates.push(gate);
      break;
    }
  }
  return gates;
}

/**
 * Distance d'une forme à sa porte, en cases. C'est la mesure que la marche
 * arrière cherche à maximiser : un bloc posé juste devant sa porte ne pose
 * aucune question au joueur.
 */
function distanceALaPorte(gate, shape, x, y, W, H) {
  if (gate.side === 'right') return W - (x + shape.w);
  if (gate.side === 'left') return x;
  if (gate.side === 'bottom') return H - (y + shape.h);
  return y;
}

/** Position de pose d'une forme, plaquée dans l'ouverture d'une porte. */
function poseAuPorte(gate, shape, W, H, rng) {
  if (shape.w > (gate.side === 'top' || gate.side === 'bottom' ? gate.length : W)) return null;
  if (shape.h > (gate.side === 'left' || gate.side === 'right' ? gate.length : H)) return null;

  if (gate.side === 'right') {
    if (shape.h > gate.length) return null;
    return { x: W - shape.w, y: gate.start + Math.floor(rng() * (gate.length - shape.h + 1)) };
  }
  if (gate.side === 'left') {
    if (shape.h > gate.length) return null;
    return { x: 0, y: gate.start + Math.floor(rng() * (gate.length - shape.h + 1)) };
  }
  if (gate.side === 'bottom') {
    if (shape.w > gate.length) return null;
    return { x: gate.start + Math.floor(rng() * (gate.length - shape.w + 1)), y: H - shape.h };
  }
  if (shape.w > gate.length) return null;
  return { x: gate.start + Math.floor(rng() * (gate.length - shape.w + 1)), y: 0 };
}

/**
 * Nombre de GESTES réellement nécessaires pour résoudre le niveau.
 *
 * On ne peut pas le déduire des virages du chemin : un doigt qui suit un tracé
 * en L fait tourner le bloc en un seul glissé, le moteur avançant case par case
 * vers la position visée. Compter les changements de direction surestimait donc
 * le coût de 60 %, et les seuils d'étoiles devenaient inatteignables à l'envers
 * — tout le monde décrochait 3★.
 *
 * On mesure : pour chaque bloc, on cherche le point le plus lointain de son
 * chemin atteignable d'un seul geste, on le joue, et on recommence.
 */
function mesureGestes(base) {
  const b = new Board({ ...base, moveLimit: 9999, timeLimit: 9999, starDrags: [0, 0] });
  let gestes = 0;

  for (const etape of base.solution) {
    const chemin = etape.chemin;
    const dernier = chemin.length - 1;
    let pos = 0;
    let garde = 0;

    while (pos < dernier && garde++ < 40) {
      let atteint = pos;
      for (let j = dernier; j > pos; j--) {
        const snap = b.snapshot();
        b.dragTowards(etape.id, chemin[j].x, chemin[j].y);
        const bloc = b.blocks.get(etape.id);
        const ok = bloc && bloc.x === chemin[j].x && bloc.y === chemin[j].y;
        b.restore(snap);
        if (ok) { atteint = j; break; }
      }
      if (atteint === pos) atteint = pos + 1; // sécurité : on avance d'un cran
      b.dragTowards(etape.id, chemin[atteint].x, chemin[atteint].y);
      gestes++;
      pos = atteint;
    }

    // La sortie prolonge le dernier glissé : le doigt ne se relève pas.
    if (b.blocks.has(etape.id)) {
      const [dx, dy] = VECTEURS_SORTIE[etape.gate];
      if (b.step(etape.id, dx, dy).ok && pos === 0) gestes++;
    }
    b.endGesture(true);
  }
  return Math.max(base.solution.length, gestes);
}

// ---------------------------------------------------------------------------

function build(n) {
  const rng = mulberry32(0x5eed * n + 1013904223);
  const p = curve(n);
  const { W, H } = p;

  // On explore plusieurs grilles et on garde la PLUS DENSE : la difficulté de
  // ce genre vient de l'encombrement, et se contenter de la première grille
  // acceptable donnait des niveaux à moitié vides.
  let meilleure = null;
  for (let tentative = 0; tentative < 220; tentative++) {
    const grille = new Grille(W, H);
    const gates = makeGates(p, rng);
    if (gates.length === 0) continue;
    const blocks = [];
    let idSuivant = 1;

    // Murs d'abord : les chemins des blocs seront creusés en les évitant.
    for (let i = 0; i < p.murs; i++) {
      const x = 1 + Math.floor(rng() * (W - 2));
      const y = 1 + Math.floor(rng() * (H - 2));
      if (!grille.libre([[x, y]])) continue;
      const b = { id: idSuivant++, color: -1, cells: [[0, 0]], x, y, kind: KIND.WALL };
      grille.poser(b.id, [[x, y]]);
      blocks.push(b);
    }

    // Pose à l'envers : entrée par la porte, puis recul dans la grille.
    const poses = [];
    const parPorte = new Map(gates.map((g) => [g, 0]));
    const poses_par_type = { [KIND.RAIL]: 0, [KIND.ANCRE]: 0, [KIND.ENCOMBRANT]: 0 };
    const plafond = { [KIND.RAIL]: p.rails, [KIND.ANCRE]: p.ancres, [KIND.ENCOMBRANT]: p.encombrants };

    for (let i = 0; i < p.blockCount; i++) {
      // Plusieurs tentatives par bloc : on garde la première qui éloigne
      // suffisamment le bloc de sa porte, sinon la meilleure obtenue. Rejeter
      // sèchement une pose trop proche faisait perdre des blocs et rendait la
      // génération impossible sur les grilles denses.
      let meilleurEssai = null;

      for (let essai = 0; essai < 8 && (!meilleurEssai || meilleurEssai.eloignement < 3); essai++) {
        const ordre = [gates[(i + essai) % gates.length], ...shuffled(rng, gates)];
        let pose = null;
        let gate = null;

        for (const candidate of ordre) {
          for (const shape of shuffled(rng, SHAPES)) {
            const at = poseAuPorte(candidate, shape, W, H, rng);
            if (!at) continue;
            if (!grille.libre(absolute(shape, at.x, at.y))) continue;
            // Poser à la porte ne suffit pas : il faut pouvoir en ressortir.
            grille.poser(-1, absolute(shape, at.x, at.y));
            const sortable = peutSortirDeSaPorte(grille, candidate, shape, at.x, at.y, -1);
            grille.retirer(absolute(shape, at.x, at.y));
            if (!sortable) continue;
            pose = { shape, x: at.x, y: at.y };
            gate = candidate;
            break;
          }
          if (pose) break;
        }
        if (!pose) break; // plus de place du tout : inutile d'insister

        const id = idSuivant++;
        let { x, y } = pose;
        grille.poser(id, absolute(pose.shape, x, y));
        const chemin = [{ x, y }];

        // Type spécial de ce bloc. Il se décide AVANT la marche arrière, parce
        // qu'un bloc bridé en déplacement doit reculer sous la même bride :
        // sinon le chemin retour, qui est la solution lue à l'envers, serait
        // injouable. L'ancre passe en premier — c'est la contrainte la plus
        // forte, et la laisser en second la rendrait introuvable.
        const axeDeLaPorte = gate.side === 'left' || gate.side === 'right' ? 'h' : 'v';
        const dispo = (k) => poses_par_type[k] < plafond[k];
        const special =
          dispo(KIND.ANCRE) && rng() < 0.4 ? KIND.ANCRE :
          dispo(KIND.RAIL) && rng() < 0.55 ? KIND.RAIL :
          dispo(KIND.ENCOMBRANT) && rng() < 0.5 ? KIND.ENCOMBRANT :
          null;
        const axe = special === KIND.RAIL ? axeDeLaPorte : null;

        // Marche arrière ORIENTEE : à chaque pas on privilégie la direction qui
        // ELOIGNE le bloc de sa porte. Une marche purement aléatoire le laissait
        // à une ou deux cases de sa sortie, et le niveau se jouait tout seul.
        const reculs = p.recul[0] + Math.floor(rng() * (p.recul[1] - p.recul[0] + 1));
        // Une ancre ne connaît qu'un sens de marche : reculer, pour elle, c'est
        // s'éloigner en ligne droite à l'exact opposé de sa porte.
        const [sx, sy] = VECTEURS_SORTIE[gate.side];
        for (let r = 0; r < reculs; r++) {
          const toutes = special === KIND.ANCRE ? [[-sx, -sy]]
            : axe === 'h' ? [[1, 0], [-1, 0]]
            : axe === 'v' ? [[0, 1], [0, -1]]
            : [[1, 0], [-1, 0], [0, 1], [0, -1]];

          const legales = toutes.filter(([dx, dy]) =>
            grille.libre(absolute(pose.shape, x + dx, y + dy), id));
          if (!legales.length) break;

          // 80 % du temps on s'éloigne, sinon au hasard : sans ce grain d'aléa
          // tous les blocs filent en ligne droite vers le fond de la grille.
          const choisi = rng() < 0.8
            ? legales.reduce((meilleur, d) =>
                distanceALaPorte(gate, pose.shape, x + d[0], y + d[1], W, H) >
                distanceALaPorte(gate, pose.shape, x + meilleur[0], y + meilleur[1], W, H) ? d : meilleur)
            : pick(rng, legales);

          grille.retirer(absolute(pose.shape, x, y));
          x += choisi[0]; y += choisi[1];
          grille.poser(id, absolute(pose.shape, x, y));
          chemin.push({ x, y });
        }

        const eloignement = distanceALaPorte(gate, pose.shape, x, y, W, H);
        const candidat = { id, gate, chemin, pose, x, y, axe, eloignement, special };

        if (!meilleurEssai || eloignement > meilleurEssai.eloignement) {
          if (meilleurEssai) grille.retirer(absolute(meilleurEssai.pose.shape, meilleurEssai.x, meilleurEssai.y));
          meilleurEssai = candidat;
        } else {
          grille.retirer(absolute(pose.shape, x, y));
        }
      }

      // Un bloc qui touche encore sa porte n'apporte rien au casse-tête.
      if (!meilleurEssai || meilleurEssai.eloignement < 1 || meilleurEssai.chemin.length < 2) {
        if (meilleurEssai) grille.retirer(absolute(meilleurEssai.pose.shape, meilleurEssai.x, meilleurEssai.y));
        continue;
      }

      const { id, gate, chemin, pose, x, y, axe, special } = meilleurEssai;
      if (special) poses_par_type[special]++;
      blocks.push({
        id, color: gate.color, cells: pose.shape.cells, x, y,
        kind: special || KIND.NORMAL,
        axis: special === KIND.RAIL ? axe : null,
        dir: special === KIND.ANCRE ? gate.side : null,
      });
      parPorte.set(gate, (parPorte.get(gate) || 0) + 1);
      poses.push({ id, gate, chemin });
    }

    if (poses.length < Math.max(5, p.blockCount - 6)) continue;

    // Solution de référence : dernier posé sorti en premier.
    const solution = [...poses].reverse().map(({ id, gate, chemin }) => ({
      id, gate: gate.side, chemin: [...chemin].reverse(),
    }));

    const parId = new Map(blocks.map((b) => [b.id, b]));

    // Scellés de couleur : « je m'ouvre quand tous les ▲ ont quitté la grille ».
    // La condition n'est posée que si la solution de référence la remplit déjà
    // au moment voulu — donc si toute la couleur visée sort AVANT ce bloc. Le
    // joueur, lui, la lit sur le bloc et compte les ▲ restants à l'écran.
    // Il passe AVANT les verrous à décompte : sa condition est bien plus
    // exigeante — il lui faut une couleur entièrement évacuée — et laisser le
    // décompte se servir d'abord ne lui laissait un candidat que dans un
    // niveau sur quatre, la nouveauté du monde manquant aux trois autres.
    if (p.scelleCouleur) {
      const rangDe = new Map(solution.map((etape, i) => [etape.id, i]));
      const dernierRang = new Map();
      for (const b of blocks) {
        if (b.kind === KIND.WALL) continue;
        const r = rangDe.get(b.id);
        if (r === undefined) continue;
        dernierRang.set(b.color, Math.max(dernierRang.get(b.color) ?? -1, r));
      }
      for (let rang = solution.length - 1; rang >= 0; rang--) {
        const b = parId.get(solution[rang].id);
        if (!b || b.kind !== KIND.NORMAL) continue;
        // Une couleur entièrement évacuée avant ce bloc, et qui n'est pas la
        // sienne : sans quoi le bloc s'attendrait lui-même et ne s'ouvrirait
        // jamais.
        const couleurs = [...dernierRang.entries()]
          .filter(([c, dernier]) => c !== b.color && dernier < rang);
        if (!couleurs.length) continue;
        b.kind = KIND.LOCKED;
        b.axis = null;
        b.dir = null;
        b.condition = { type: 'color', color: pick(rng, couleurs)[0] };
        break; // un seul par grille : deux attentes de couleur sont illisibles
      }
    }

    // Verrous : un bloc ne peut être verrouillé que par une condition déjà
    // remplie au moment où la solution lui demande de bouger.
    let poses_verrouillees = 0;
    for (let rang = solution.length - 1; rang >= 0 && poses_verrouillees < p.verrous; rang--) {
      const sortisAvant = rang; // nombre de blocs qui sortent avant celui-ci
      if (sortisAvant < 2) continue;
      const b = parId.get(solution[rang].id);
      if (!b || b.kind !== KIND.NORMAL) continue;

      // Uniquement un décompte : le joueur doit pouvoir LIRE ce qui ouvrira le
      // bloc. Une condition du type "toute la couleur ▲ sortie" est indevinable
      // en cours de partie et se lit comme un bug.
      b.kind = KIND.LOCKED;
      b.axis = null;
      b.condition = { type: 'exits', count: Math.min(sortisAvant, 2 + Math.floor(rng() * 3)) };
      poses_verrouillees++;
    }

    // Jokers : un bloc normal devient multicolore. Toujours sûr pour la
    // résolubilité — un joker accepte sa porte d'origine comme toutes les autres.
    let jokersPoses = 0;
    for (const s of shuffled(rng, solution)) {
      if (jokersPoses >= p.jokers) break;
      const b = parId.get(s.id);
      if (!b || b.kind !== KIND.NORMAL) continue;
      b.kind = KIND.JOKER;
      jokersPoses++;
    }

    // Capacité des portes : chaque porte n'accepte que le nombre de cases que
    // la solution de référence lui destine, plus une petite marge. Router un
    // bloc vers la mauvaise porte de la bonne couleur devient alors une erreur
    // — c'est ce qui transforme la grille en énigme.
    if (p.capacite) {
      const demande = new Map(gates.map((g) => [g, 0]));
      let quotaJokers = 0;
      for (const pose of poses) {
        const b = parId.get(pose.id);
        // `coutCapacite` et non `cells.length` : un encombrant consomme le
        // double, et provisionner moins que ce que le moteur retire rendrait le
        // niveau infaisable sans que le joueur puisse le prévoir.
        const cout = coutCapacite(b);
        if (b.kind === KIND.JOKER) { quotaJokers += cout; continue; }
        demande.set(pose.gate, demande.get(pose.gate) + cout);
      }
      // Le joker sort par la porte qu'il veut : si son quota n'était compté que
      // sur sa porte d'origine, l'envoyer ailleurs affamerait cette autre porte
      // et rendrait le niveau infaisable — sans que le joueur puisse le prévoir.
      // On provisionne donc sa taille sur TOUTES les portes.
      for (const g of gates) {
        const besoin = demande.get(g) || 0;
        if (besoin > 0) g.capacity = besoin + quotaJokers + p.marge;
      }
    }

    const occupees = blocks.reduce((sum, b) => sum + b.cells.length, 0);
    const eloignementMoyen = poses.reduce((sum, pose) => {
      const b = parId.get(pose.id);
      const forme = { w: Math.max(...b.cells.map((c) => c[0])) + 1, h: Math.max(...b.cells.map((c) => c[1])) + 1 };
      return sum + distanceALaPorte(pose.gate, forme, b.x, b.y, W, H);
    }, 0) / Math.max(1, poses.length);

    // Part de la couleur la plus représentée. Une grille peut être dense et
    // bien étalée tout en étant aux trois quarts d'une seule couleur : les
    // portes se bouchent au fil des poses, et les blocs suivants se rabattent
    // tous sur la dernière encore dégagée. Le résultat se joue moins bien et se
    // regarde mal, il faut donc le pénaliser explicitement.
    const parCouleur = new Map();
    for (const pose of poses) {
      const c = parId.get(pose.id).color;
      parCouleur.set(c, (parCouleur.get(c) || 0) + 1);
    }
    const dominante = Math.max(...parCouleur.values()) / Math.max(1, poses.length);

    const densite = occupees / (W * H);

    // Le NOMBRE de blocs compte dans la note, pas seulement les cases occupées :
    // à densité égale, une grille de quinze gros blocs demande moins de sorties
    // qu'une de vingt petits. Sans ce terme, la charge d'un niveau à l'autre
    // faisait des creux de quatre blocs à l'intérieur d'un même monde, et la
    // progression se sentait reculer.
    const charge = poses.length / p.blockCount;
    const note = densite + eloignementMoyen / 8 + charge / 3
      - 1.6 * Math.max(0, dominante - 0.4);
    if (!meilleure || note > meilleure.note) {
      meilleure = { W, H, gates, blocks, solution, occupees, note, eloignementMoyen, dominante, colorCount: p.colorCount };
    }
    if (densite >= 0.6 && eloignementMoyen >= 3.2 && dominante <= 0.4 && charge >= 0.9) break;
  }

  if (!meilleure) return null;
  meilleure.minDrags = mesureGestes({
    width: meilleure.W, height: meilleure.H, gates: meilleure.gates,
    blocks: meilleure.blocks, solution: meilleure.solution,
  });
  return meilleure;
}

const cache = new Map();

/** Retourne la data du niveau `n` (1-indexé). */
export function getLevel(n) {
  if (cache.has(n)) return cache.get(n);
  const g = build(n);
  if (!g) throw new Error(`Génération impossible pour le niveau ${n}`);

  const realm = realmDe(n);
  // Les marges se resserrent sur TOUTE la progression, pas sur ses vingt
  // premiers niveaux : indexé sur un nombre absolu, ce facteur touchait le fond
  // avant la fin du premier monde et n'avait plus rien à donner ensuite.
  const serre = 1 - 0.3 * ((n - 1) / (TOTAL_LEVELS - 1));

  /**
   * Barème des étoiles, indexé sur la solution de référence. Une fraction de
   * `moveLimit` ne marchait pas : la limite de coups se resserrant avec la
   * progression, un joueur parfait plafonnait à 2★ passé le niveau 7. Ici,
   * bien jouer paie à tout niveau.
   */
  const starDrags = [Math.ceil(g.minDrags * 1.3), Math.ceil(g.minDrags * 1.8)];

  /**
   * La limite de coups est un FILET, pas un barème — c'est le chrono qui porte
   * la tension. Elle se cale donc au-dessus du seuil 1★ : sous ce seuil, un
   * joueur laborieux perdait au lieu de décrocher une étoile, et l'écran de
   * résultat promettait une note qu'aucune partie ne pouvait obtenir. Le
   * précédent plancher fixe (`minDrags + 5`) le garantissait tant que la
   * solution tenait en quinze glissés ; au-delà il passait sous le seuil 3★, et
   * toute victoire valait alors trois étoiles. La marge est désormais
   * proportionnelle, `serre` la resserrant au fil de la progression.
   */
  const moveLimit = starDrags[1] + Math.max(2, Math.round(g.minDrags * 0.4 * serre));
  // Le temps se joue sur la réflexion, pas sur le nombre de gestes : on le cale
  // sur le nombre de blocs à sortir. Registre casual : une à deux minutes.
  const jouables = g.blocks.filter((b) => b.kind !== KIND.WALL).length;
  // Le plafond suit la taille des grilles : à 120 s, les vingt-six blocs du
  // dernier monde laissaient moins de cinq secondes par sortie, geste compris.
  const timeLimit = Math.min(180, Math.max(40, Math.round((jouables * 7 + 15) * serre / 5) * 5));

  const level = {
    levelId: `lvl_${String(n).padStart(3, '0')}`,
    number: n,
    realm: realm.name,
    difficulty: realm.difficulty,
    width: g.W,
    height: g.H,
    colorCount: g.colorCount,
    moveLimit,
    timeLimit,
    minDrags: g.minDrags,
    objective: { type: 'clear_all', target: g.blocks.filter((b) => b.kind !== KIND.WALL).length },
    starDrags,
    estimatedTime: timeLimit,
    gates: g.gates,
    blocks: g.blocks,
    solution: g.solution, // sert aux tests, à l'équilibrage et aux futurs indices
  };
  cache.set(n, level);
  return level;
}
