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

import { SHAPES, KIND } from './block.js';
import { Board, SIDES as VECTEURS } from './board.js';

export const TOTAL_LEVELS = 20;
export const LEVELS_PER_REALM = 5;

export const REALMS = [
  { id: 0, name: 'Atelier de Verre', difficulty: 'facile' },
  { id: 1, name: 'Fonderie', difficulty: 'moyen' },
  { id: 2, name: 'Chambre Froide', difficulty: 'difficile' },
  { id: 3, name: 'Tour de Contrôle', difficulty: 'expert' },
];

const SIDES = ['top', 'right', 'bottom', 'left'];

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

/** Courbe de difficulté. Constantes de tuning, à ajuster après playtest. */
function curve(n) {
  // La DENSITE fait la difficulté, pas la longueur des chemins : un bloc isolé
  // rejoint toujours sa porte d'un seul glissé. Ce qui fait réfléchir, c'est
  // que les blocs se gênent et imposent un ordre de sortie. On vise donc une
  // grille bien remplie (55 à 70 % des cases occupées).
  const palier =
    n <= 4 ? { W: 5, H: 6, colorCount: 3, gateCount: 3, murs: 0, verrous: 0, rails: 1, jokers: 0 } :
    n <= 10 ? { W: 6, H: 7, colorCount: 4, gateCount: 4, murs: 1, verrous: 1, rails: 4, jokers: 1 } :
    n <= 15 ? { W: 6, H: 7, colorCount: 5, gateCount: 5, murs: 2, verrous: 1, rails: 6, jokers: 1 } :
              { W: 6, H: 8, colorCount: 5, gateCount: 5, murs: 3, verrous: 2, rails: 8, jokers: 1 };

  // Le nombre de blocs monte en rampe continue plutôt que par paliers : sinon
  // le premier niveau d'un nouveau monde double brutalement de charge.
  //
  // `marge` est le nombre de cases de rab accordé aux portes à capacité. Sans
  // capacité, aucun ordre de sortie ne peut être mauvais — sortir un bloc ne
  // fait que libérer de la place — et le niveau se résout au premier essai
  // quelle que soit la méthode. La capacité est le seul levier qui crée un
  // vrai casse-tête ; la marge décroissante en règle la sévérité.
  return {
    ...palier,
    blockCount: Math.round(7 + (n - 1) * 0.5),
    recul: [6, n <= 10 ? 11 : 14],
    capacite: n >= 8,
    marge: n >= 16 ? 1 : 2,
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
      const [dx, dy] = VECTEURS[etape.gate];
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
    let railsPoses = 0;

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

        // Bloc sur glissière : il n'ira que sur l'axe de sa porte. On contraint
        // donc aussi sa marche arrière, sinon le chemin retour serait injouable.
        const axeDeLaPorte = gate.side === 'left' || gate.side === 'right' ? 'h' : 'v';
        const surGlissiere = railsPoses < p.rails && rng() < 0.55;
        const axe = surGlissiere ? axeDeLaPorte : null;

        // Marche arrière ORIENTEE : à chaque pas on privilégie la direction qui
        // ELOIGNE le bloc de sa porte. Une marche purement aléatoire le laissait
        // à une ou deux cases de sa sortie, et le niveau se jouait tout seul.
        const reculs = p.recul[0] + Math.floor(rng() * (p.recul[1] - p.recul[0] + 1));
        for (let r = 0; r < reculs; r++) {
          const toutes = axe === 'h' ? [[1, 0], [-1, 0]]
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
        const candidat = { id, gate, chemin, pose, x, y, axe, eloignement, surGlissiere };

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

      const { id, gate, chemin, pose, x, y, axe, surGlissiere } = meilleurEssai;
      if (surGlissiere) railsPoses++;
      blocks.push({
        id, color: gate.color, cells: pose.shape.cells, x, y,
        kind: axe ? KIND.RAIL : KIND.NORMAL,
        axis: axe,
      });
      poses.push({ id, gate, chemin });
    }

    if (poses.length < Math.max(5, p.blockCount - 6)) continue;

    // Solution de référence : dernier posé sorti en premier.
    const solution = [...poses].reverse().map(({ id, gate, chemin }) => ({
      id, gate: gate.side, chemin: [...chemin].reverse(),
    }));

    // Verrous : un bloc ne peut être verrouillé que par une condition déjà
    // remplie au moment où la solution lui demande de bouger.
    const parId = new Map(blocks.map((b) => [b.id, b]));
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
        if (b.kind === KIND.JOKER) { quotaJokers += b.cells.length; continue; }
        demande.set(pose.gate, demande.get(pose.gate) + b.cells.length);
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

    // On note une grille sur sa densité ET sur l'éloignement des blocs à leur
    // porte : une grille pleine mais dont chaque bloc touche déjà sa sortie
    // n'est pas un niveau.
    const note = occupees / (W * H) + eloignementMoyen / 8;
    if (!meilleure || note > meilleure.note) {
      meilleure = { W, H, gates, blocks, solution, occupees, note, eloignementMoyen, colorCount: p.colorCount };
    }
    if (occupees / (W * H) >= 0.6 && eloignementMoyen >= 3.2) break;
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

  const realm = REALMS[Math.min(REALMS.length - 1, Math.floor((n - 1) / LEVELS_PER_REALM))];
  const serre = 1 - Math.min(0.3, 0.016 * (n - 1)); // les marges se resserrent
  const moveLimit = Math.max(g.minDrags + 5, Math.ceil(g.minDrags * 1.7 * serre) + 1);
  // Le temps se joue sur la réflexion, pas sur le nombre de gestes : on le cale
  // sur le nombre de blocs à sortir. Registre casual : une à deux minutes.
  const jouables = g.blocks.filter((b) => b.kind !== KIND.WALL).length;
  const timeLimit = Math.min(120, Math.max(40, Math.round((jouables * 7 + 15) * serre / 5) * 5));

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
    /**
     * Nombre maximal de glissés pour décrocher 3★ puis 2★, indexé sur la
     * solution de référence. Une fraction de `moveLimit` ne marchait pas : la
     * limite de coups se resserrant avec la progression, un joueur parfait
     * plafonnait à 2★ passé le niveau 7. Ici, bien jouer paie à tout niveau.
     */
    starDrags: [Math.ceil(g.minDrags * 1.3), Math.ceil(g.minDrags * 1.8)],
    estimatedTime: timeLimit,
    gates: g.gates,
    blocks: g.blocks,
    solution: g.solution, // sert aux tests, à l'équilibrage et aux futurs indices
  };
  cache.set(n, level);
  return level;
}

/** Libellé de l'objectif, pour le pré-niveau et le HUD. */
export function objectiveLabel(level) {
  const n = level.objective.target;
  return `Faire sortir les ${n} blocs`;
}
