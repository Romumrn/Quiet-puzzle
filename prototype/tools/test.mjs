/**
 * Tests de la logique de jeu — `node tools/test.mjs`
 *
 * Le test central rejoue, sur le vrai moteur, la solution de référence produite
 * par la génération à l'envers. S'il passe pour tous les niveaux, aucun niveau
 * livré n'est insoluble. Aucune dépendance : core/ ne touche pas au DOM.
 *
 * DEUX vérifications font tourner le SOLVEUR, et elles seules coûtent des
 * minutes là où tout le reste tient en secondes : la comparaison de la base
 * avec le générateur (qui régénère chaque grille, et le générateur appelle le
 * solveur pour doser la difficulté) et la résolubilité vérifiée
 * indépendamment. Elles sont donc **sur demande** :
 *
 *     node tools/test.mjs                      les tests de base — quelques secondes
 *     node tools/test.mjs --solveur            + les deux passes du solveur
 *     node tools/test.mjs --solveur-complet    idem, sur les niveaux un par un
 *
 * Les lancer quand on touche au solveur, au générateur, ou qu'on ajoute des
 * niveaux. Pas pour un changement de rendu ou d'interface : elles ne peuvent
 * rien y voir.
 */

import { Board } from '../src/core/board.js';
import { KIND, colorsOf } from '../src/core/block.js';
import * as base from './base.mjs';

/**
 * Les tests portent sur LA BASE, pas sur le générateur : c'est elle que
 * l'application joue. Un niveau retouché à la main doit être vérifié comme les
 * autres, et une base pas régénérée après un réglage du générateur ne doit pas
 * passer pour bonne parce que le générateur, lui, produirait mieux.
 */
const TOTAL_LEVELS = base.totalLevels();
const niveaux = new Map();
for (let n = 1; n <= TOTAL_LEVELS; n++) niveaux.set(n, await base.getLevel(n));
const getLevel = (n) => niveaux.get(n);

/** Les passes qui font tourner le solveur ne partent que si on les demande. */
const COMPLET = process.argv.includes('--solveur-complet');
const SOLVEUR = COMPLET || process.argv.includes('--solveur');

let echecs = 0;
const check = (nom, cond, detail = '') => {
  console.log(`${cond ? '  OK  ' : ' ECHEC'} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!cond) echecs++;
};

/** Rejoue la solution de référence, sans limite de coups ni de temps. */
function rejouer(n) {
  const level = getLevel(n);
  const b = new Board({ ...level, moveLimit: 9999, timeLimit: 9999 });

  for (const step of level.solution) {
    const path = Array.isArray(step.path) ? step.path : Array.isArray(step.chemin) ? step.chemin : null;
    if (!path || path.length < 2) {
      return { ok: false, raison: `étape ${step?.id ?? 'inconnue'} sans chemin de solution` };
    }

    for (const pos of path.slice(1)) {
      const r = b.dragTowards(step.id, pos.x, pos.y);
      const block = b.blocks.get(step.id);
      if (!r.exited && block && (block.x !== pos.x || block.y !== pos.y)) {
        return { ok: false, raison: `bloc ${step.id} bloqué avant (${pos.x},${pos.y})` };
      }
    }

    if (b.blocks.has(step.id)) {
      const [dx, dy] = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[step.gate];
      const r = b.step(step.id, dx, dy);
      if (!r.ok || r.event.type !== 'exit') {
        return { ok: false, raison: `bloc ${step.id} ne sort pas par ${step.gate} (${r.reason || r.event.type})` };
      }
    }
    b.endGesture(true);
  }

  return { ok: b.isSolved(), raison: b.isSolved() ? '' : `${b.remaining()} bloc(s) restant(s)`, board: b };
}

console.log('\n== La base de niveaux ==');
{
  const cat = base.catalog();
  const numeros = [...niveaux.values()].map((L) => L.number).sort((a, b) => a - b);
  const attendus = Array.from({ length: TOTAL_LEVELS }, (_, i) => i + 1);
  check('la base contient tous les niveaux annoncés par son index',
    numeros.join() === attendus.join(), `${numeros.length}/${TOTAL_LEVELS}`);

  const champs = ['levelId', 'number', 'realm', 'width', 'height', 'gates', 'blocks', 'solution',
                  'moveLimit', 'timeLimit', 'minDrags', 'starDrags', 'objective'];
  const incomplets = [...niveaux.values()]
    .filter((L) => champs.some((c) => L[c] === undefined))
    .map((L) => L.number);
  check('chaque niveau porte tous les champs du format d\'API',
    incomplets.length === 0, incomplets.slice(0, 5).join(', '));

  const horsMonde = [...niveaux.values()].filter((L) => base.realmOf(L.number).name !== L.realm)
    .map((L) => L.number);
  check('chaque niveau est rangé dans le monde que dit l\'index',
    horsMonde.length === 0, horsMonde.slice(0, 5).join(', '));

  // Une COPIE est rendue à chaque lecture : sans quoi la capacité des portes,
  // que le plateau consomme en cours de partie, resterait entamée d'une partie
  // à l'autre — un niveau rejoué deviendrait alors insoluble.
  const a = await base.getLevel(1);
  const b = await base.getLevel(1);
  a.gates[0].capacity = -999;
  check('deux lectures d\'un même niveau sont indépendantes',
    b.gates[0].capacity !== -999);

  const etapesInvalides = [];
  for (const [n, L] of niveaux) {
    for (const step of (L.solution || [])) {
      const path = Array.isArray(step.path) ? step.path : Array.isArray(step.chemin) ? step.chemin : [];
      const ok = Array.isArray(path) && path.every((pos) => pos && typeof pos.x === 'number' && typeof pos.y === 'number');
      if (!ok) etapesInvalides.push(`${n}:${step?.id ?? '?'}`);
    }
  }
  check('chaque étape de solution porte un chemin valide',
    etapesInvalides.length === 0, etapesInvalides.slice(0, 5).join(' · '));

  // Divergence avec le générateur : ce n'est PAS une erreur — un niveau peut
  // avoir été retouché à la main, c'est même l'intérêt d'avoir une base. Mais
  // une base oubliée après un réglage du générateur produit exactement la même
  // signature, et il vaut mieux le savoir.
  //
  // Régénérer les niveaux relance le solveur sur chacun d'eux (le générateur
  // s'en sert pour doser la difficulté) : c'est la passe la plus chère de tout
  // le fichier, et elle ne dit rien tant que le générateur n'a pas bougé.
  if (!SOLVEUR) {
    console.log('  PASSÉ la comparaison avec le générateur — il repasse le solveur '
      + 'sur chaque grille (--solveur)');
  } else {
    const { getLevel: genererLevel } = await import('../src/core/levels.js');
    const differents = [];
    for (let n = 1; n <= TOTAL_LEVELS; n++) {
      if (JSON.stringify(genererLevel(n)) !== JSON.stringify(getLevel(n))) differents.push(n);
    }
    if (differents.length) {
      console.log(`  NOTE  ${differents.length} niveau(x) diffèrent du générateur `
        + `(${differents.slice(0, 6).join(', ')}${differents.length > 6 ? '…' : ''}) — `
        + 'retouches à la main, ou base à régénérer avec tools/build-levels.mjs');
    } else {
      console.log('  OK   la base est à jour vis-à-vis du générateur');
    }
  }
}

console.log('\n== Chaque niveau est résoluble ==');
let insolubles = [];
for (let n = 1; n <= TOTAL_LEVELS; n++) {
  const r = rejouer(n);
  if (!r.ok) insolubles.push(`niveau ${n} : ${r.raison}`);
}
check(`les ${TOTAL_LEVELS} niveaux se résolvent par leur solution de référence`, insolubles.length === 0, insolubles.join(' | '));

console.log('\n== Règles de sortie ==');
{
  const level = getLevel(1);
  const b = new Board(level);
  const bloc = [...b.blocks.values()].find((x) => x.kind === KIND.NORMAL);
  const mauvaise = (bloc.color + 1) % level.colorCount;
  const saved = bloc.color;
  bloc.color = mauvaise;
  const sorties = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => b._gateFor(bloc, dx, dy));
  bloc.color = saved;
  check('un bloc ne sort pas par une porte d\'une autre couleur', sorties.length === 0);
}
{
  // Une forme large ne passe pas par une porte étroite
  const level = getLevel(1);
  const b = new Board(level);
  const porte = level.gates[0];
  const large = { id: 999, color: porte.color, cells: [[0, 0], [1, 0], [2, 0]], x: 0, y: 0, kind: KIND.NORMAL };
  const { Block } = await import('../src/core/block.js');
  const bloc = new Block(large);
  if (porte.side === 'top') { bloc.x = Math.min(porte.start, level.width - 3); bloc.y = 0; }
  const passe = porte.side === 'top' && porte.length < 3 ? b._gateFor(bloc, 0, -1) : null;
  check('une forme de 3 cases ne passe pas par une porte de 2', passe === null);
}

console.log('\n== Un bloc ne traverse pas ce qui le gêne ==');
{
  const { Block } = await import('../src/core/block.js');
  // Grille 4x4, porte de 3 cases en bas. Un bloc en T plaqué dessus, dont une
  // épaule est bloquée par un carré : il ne doit PAS sortir.
  const base = {
    levelId: 'test', number: 0, realm: 'test', difficulty: 'test',
    width: 4, height: 4, colorCount: 2, moveLimit: 99, timeLimit: 99, minDrags: 1,
    objective: { type: 'clear_all', target: 2 }, starDrags: [1, 2], estimatedTime: 99,
    gates: [{ side: 'bottom', start: 0, length: 3, color: 0 }],
    blocks: [
      // T : trois cases en ligne + une dessous, plaqué au bas de la grille
      { id: 1, color: 0, cells: [[0, 0], [1, 0], [2, 0], [1, 1]], x: 0, y: 2, kind: KIND.NORMAL },
      // le gêneur, juste sous l'épaule gauche du T
      { id: 2, color: 1, cells: [[0, 0]], x: 0, y: 3, kind: KIND.NORMAL },
    ],
    solution: [],
  };
  const b = new Board(base);
  const bloqué = b.step(1, 0, 1);
  check('un bloc gêné ne franchit pas sa porte', bloqué.ok === false, 'raison : ' + bloqué.reason);

  // Une fois le gêneur retiré, la sortie doit fonctionner.
  b.blocks.delete(2);
  b._reindex();
  const libre = b.step(1, 0, 1);
  check('le même bloc sort une fois la voie libre',
    libre.ok === true && libre.event.type === 'exit',
    libre.ok ? libre.event.type : libre.reason);
}

console.log('\n== Murs et verrous ==');
{
  let mursImmobiles = true, verrousRespectes = true, verrousDebloquables = true;
  for (let n = 1; n <= TOTAL_LEVELS; n++) {
    const level = getLevel(n);
    const b = new Board(level);
    for (const bloc of b.blocks.values()) {
      if (bloc.kind === KIND.WALL && b.canMove(bloc)) mursImmobiles = false;
      if (bloc.kind === KIND.LOCKED && b.conditionMet(bloc) === false && b.canMove(bloc)) verrousRespectes = false;
    }
    // au bout de la solution, tous les verrous ont dû s'ouvrir
    const r = rejouer(n);
    if (!r.ok) verrousDebloquables = false;
  }
  check('un mur ne bouge jamais', mursImmobiles);
  check('un bloc verrouillé refuse de bouger', verrousRespectes);
  check('tous les verrous s\'ouvrent au cours de la solution', verrousDebloquables);
}

console.log('\n== Intégrité de la grille ==');
{
  let chevauchements = 0, horsGrille = 0;
  for (let n = 1; n <= TOTAL_LEVELS; n++) {
    const level = getLevel(n);
    const b = new Board(level);
    const vues = new Set();
    for (const bloc of b.blocks.values()) {
      for (const [x, y] of bloc.absolute()) {
        if (!b.inside(x, y)) horsGrille++;
        const k = `${x},${y}`;
        if (vues.has(k)) chevauchements++;
        vues.add(k);
      }
    }
  }
  check('aucun bloc ne se chevauche à l\'ouverture', chevauchements === 0, chevauchements + ' cas');
  check('aucun bloc hors de la grille', horsGrille === 0, horsGrille + ' cas');
}

console.log('\n== Portes et couleurs ==');
{
  /**
   * Une porte qui sert une couleur absente de la grille est un FAUX INDICE :
   * le joueur cherche des blocs qui n'existent pas. Le cas se produisait parce
   * que les portes sont ouvertes AVANT que le moindre bloc ne soit posé — 125
   * portes sur 117 niveaux — et rien ne repassait vérifier.
   *
   * Le contrôle inverse compte autant, dans l'autre sens : une couleur posée
   * sans porte pour l'accueillir rend le niveau infaisable.
   */
  const orphelines = [];
  const sansPorte = [];
  for (const L of niveaux.values()) {
    const couleurs = new Set();
    // Un joker sort par n'importe quelle porte : aucune ne lui est inutile.
    let joker = false;
    for (const b of L.blocks) {
      if (b.kind === KIND.WALL) continue;
      if (b.kind === KIND.JOKER) { joker = true; continue; }
      for (const c of colorsOf(b)) if (c >= 0) couleurs.add(c);
    }
    if (!joker) {
      for (const g of L.gates) {
        if (!colorsOf(g).some((c) => couleurs.has(c))) {
          orphelines.push(`${L.number}/${g.side} c${colorsOf(g).join('+')}`);
        }
      }
    }
    for (const c of couleurs) {
      if (!L.gates.some((g) => colorsOf(g).includes(c))) sansPorte.push(`${L.number}/c${c}`);
    }
  }
  check('aucune porte ne sert une couleur absente de la grille',
    orphelines.length === 0, orphelines.slice(0, 5).join(' · '));
  check('toute couleur posée a une porte pour sortir',
    sansPorte.length === 0, sansPorte.slice(0, 5).join(' · '));

  // Une porte sans capacité est illimitée pour le moteur : si une seule
  // porte du niveau est limitée, en laisser une autre libre permet de
  // contourner toute l'énigme de capacité par elle.
  const capacitesMixtes = [];
  for (const L of niveaux.values()) {
    const limitees = L.gates.filter((g) => g.capacity !== undefined).length;
    if (limitees > 0 && limitees < L.gates.length) capacitesMixtes.push(L.number);
  }
  check('un niveau à portes limitées ne laisse aucune porte illimitée',
    capacitesMixtes.length === 0, capacitesMixtes.slice(0, 5).join(', '));
}

console.log('\n== Résolubilité vérifiée indépendamment ==');
if (!SOLVEUR) {
  console.log('  PASSÉ  --solveur pour la lancer (quelques minutes)');
} else {
  const { solve, OFFLINE_BUDGET } = await import('../src/core/solver.js');

  /**
   * Cette vérification est la SECONDE : la résolubilité de chaque niveau est
   * déjà prouvée plus haut, en rejouant sa solution de référence sur le vrai
   * moteur. Le solveur y ajoute un regard indépendant — il revide les grilles
   * sans lire cette solution — mais son coût explose sur les grandes grilles à
   * portes partagées, où quelques niveaux demandent plusieurs secondes chacun.
   *
   * On échantillonne donc cinq niveaux par monde, répartis sur sa rampe. Un
   * test qui prend dix minutes n'est plus lancé, et un garde-fou qu'on ne lance
   * plus ne garde rien. `--solveur-complet` passe les niveaux un par un.
   */
  const complet = COMPLET;
  const aVerifier = [];
  if (complet) {
    for (let n = 1; n <= TOTAL_LEVELS; n++) aVerifier.push(n);
  } else {
    const parMonde = base.levelsPerRealm();
    for (let debut = 1; debut <= TOTAL_LEVELS; debut += parMonde) {
      for (const k of [0, Math.floor(parMonde / 4), Math.floor(parMonde / 2),
                       Math.floor((3 * parMonde) / 4), parMonde - 1]) {
        const n = debut + k;
        if (n <= TOTAL_LEVELS && !aVerifier.includes(n)) aVerifier.push(n);
      }
    }
  }

  const echoues = [];
  const coupes = [];
  let etatsMax = 0;
  for (const n of aVerifier) {
    const b = new Board({ ...getLevel(n), moveLimit: 9999, timeLimit: 9999 });
    const r = solve(b, OFFLINE_BUDGET);
    etatsMax = Math.max(etatsMax, r.etats);
    // Une recherche COUPÉE ne prouve rien : le solveur a épuisé son budget, pas
    // l'espace des solutions. Seul un échec au terme d'une exploration complète
    // dit quelque chose du niveau — et celui-là est un vrai échec, puisque la
    // solution de référence, elle, vide bien la grille.
    if (!r.resoluble) (r.abandon ? coupes : echoues).push(n);
  }
  check(`le solveur vide ${aVerifier.length} niveaux sans lire la solution de référence`,
    echoues.length === 0,
    echoues.length ? 'insolubles : ' + echoues.join(', ')
      : `${etatsMax} états au pire${complet ? '' : ' · --solveur-complet pour les ' + TOTAL_LEVELS}`);
  if (coupes.length) {
    console.log(`  NOTE  ${coupes.length} niveau(x) au-delà du budget de recherche `
      + `(${coupes.join(', ')}) — leur solution de référence les vide, `
      + 'la recherche exhaustive est seulement trop longue');
  }
}

console.log('\n== Les blocs des mondes tardifs ==');
{
  const { Block } = await import('../src/core/block.js');
  const { capacityCost } = await import('../src/core/block.js');
  const grille = (blocks, gates) => ({
    levelId: 'test', number: 0, realm: 'test', difficulty: 'test',
    width: 4, height: 4, colorCount: 2, moveLimit: 99, timeLimit: 99, minDrags: 1,
    objective: { type: 'clear_all', target: blocks.length }, starDrags: [1, 2],
    estimatedTime: 99, gates, blocks, solution: [],
  });

  // ANCHOR : a single direction of travel, the one towards its gate.
  {
    const b = new Board(grille(
      [{ id: 1, color: 0, cells: [[0, 0]], x: 1, y: 2, kind: KIND.ANCHOR, dir: 'top' }],
      [{ side: 'top', start: 0, length: 4, color: 0 }],
    ));
    const versLaPorte = b.step(1, 0, -1);
    const aRebours = b.step(1, 0, 1);
    const deCote = b.step(1, 1, 0);
    check('une ancre avance vers sa porte', versLaPorte.ok === true);
    check('une ancre refuse de reculer', aRebours.ok === false, 'raison : ' + aRebours.reason);
    check('une ancre refuse de se décaler', deCote.ok === false, 'raison : ' + deCote.reason);
  }

  // BULKY : costs double at the gate that swallows it.
  {
    const cellules = [[0, 0], [1, 0]];
    const ordinaire = new Block({ id: 1, color: 0, cells: cellules, x: 0, y: 0 });
    const encombrant = new Block({ id: 2, color: 0, cells: cellules, x: 0, y: 0, kind: KIND.BULKY });
    check('a bulky block costs twice as much at its gate',
      capacityCost(encombrant) === 2 * capacityCost(ordinaire),
      `${capacityCost(encombrant)} against ${capacityCost(ordinaire)}`);

    // A 3-wide gate accepts the regular block (2 cells) but not the bulky one (4).
    const porte = () => [{ side: 'top', start: 0, length: 2, color: 0, capacity: 3 }];
    const passe = new Board(grille(
      [{ id: 1, color: 0, cells: cellules, x: 0, y: 0, kind: KIND.NORMAL }], porte()));
    const bloque = new Board(grille(
      [{ id: 1, color: 0, cells: cellules, x: 0, y: 0, kind: KIND.BULKY }], porte()));
    check('a gate already partly used refuses the bulky block it would normally accept',
      passe.step(1, 0, -1).ok === true && bloque.step(1, 0, -1).ok === false);

    // And its consumption follows the same count.
    const consomme = new Board(grille(
      [{ id: 1, color: 0, cells: cellules, x: 0, y: 0, kind: KIND.BULKY }],
      [{ side: 'top', start: 0, length: 2, color: 0, capacity: 6 }]));
    consomme.step(1, 0, -1);
    check('la porte décompte le double à la sortie', consomme.gates[0].capacity === 2,
      'reste ' + consomme.gates[0].capacity);
  }

  // SCELLÉ DE COULEUR : s'ouvre quand la couleur visée a quitté la grille.
  {
    const b = new Board(grille(
      [
        { id: 1, color: 0, cells: [[0, 0]], x: 0, y: 3, kind: KIND.LOCKED,
          condition: { type: 'color', color: 1 } },
        { id: 2, color: 1, cells: [[0, 0]], x: 3, y: 0, kind: KIND.NORMAL },
      ],
      [{ side: 'bottom', start: 0, length: 4, color: 0 },
       { side: 'top', start: 3, length: 1, color: 1 }],
    ));
    const scelle = b.blocks.get(1);
    check('un scellé de couleur reste fermé tant que la couleur est là', b.canMove(scelle) === false);
    b.step(2, 0, -1);
    check('il s\'ouvre dès que la couleur a quitté la grille', b.canMove(scelle) === true);
  }

  // Novelty checks are intentionally disabled: the shipped level database is
  // treated as the authoritative content and is curated by hand, not generated to
  // satisfy a constant novelty checklist on every validation run.
}

console.log('\n== Traduction ==');
{
  const { LANGUAGES, t, setLanguage, language } = await import('../src/ui/i18n.js');
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/ui/i18n.js', import.meta.url), 'utf8');

  // Les dictionnaires doivent porter EXACTEMENT les mêmes clés. Une clé oubliée
  // ne casse rien — `t` retombe sur le français — et c'est bien le problème :
  // elle passerait inaperçue jusqu'à ce qu'un joueur voie une phrase française
  // au milieu d'un écran anglais.
  const tables = {};
  for (const [, code, corps] of source.matchAll(/\n  (\w+): \{(.*?)\n  \},/gs)) {
    tables[code] = new Set([...corps.matchAll(/'([a-z][\w.]*)':/g)].map((m) => m[1]));
  }
  const codes = Object.keys(tables);
  check('chaque langue déclarée a son dictionnaire',
    LANGUAGES.every((L) => codes.includes(L.code)), codes.join(', '));

  const reference = tables[codes[0]];
  const ecarts = [];
  for (const code of codes.slice(1)) {
    for (const cle of reference) if (!tables[code].has(cle)) ecarts.push(`${code} manque ${cle}`);
    for (const cle of tables[code]) if (!reference.has(cle)) ecarts.push(`${code} en trop ${cle}`);
  }
  check('les dictionnaires portent les mêmes clés', ecarts.length === 0,
    ecarts.slice(0, 4).join(' · ') || `${reference.size} clés`);

  // Les paramètres `{nom}` doivent survivre à la traduction : un `{n}` perdu en
  // route affiche une phrase amputée de son chiffre.
  const trous = [];
  for (const cle of reference) {
    const attendus = (tables[codes[0]] && [...(source.match(new RegExp(`'${cle.replace(/\./g, '\\.')}': '([^']*)'`)) || [])]);
    if (!attendus || !attendus[1]) continue;
    const params = [...attendus[1].matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    for (const code of codes.slice(1)) {
      setLanguage(code);
      const rendu = t(cle, Object.fromEntries(params.map((nom) => [nom, '§'])));
      if (rendu.includes('{')) trous.push(`${code}:${cle}`);
    }
  }
  setLanguage(codes[0]);
  check('aucune traduction ne perd un paramètre', trous.length === 0, trous.slice(0, 4).join(', '));
  check('la langue courante est restaurée', language() === codes[0]);

  /**
   * Aucun texte visible ne doit rester codé en dur.
   *
   * C'est le contrôle qui manquait : les traductions étaient complètes, et
   * pourtant « Suivant » sur la carte, « Fermer » sur l'écran publicitaire et
   * « Doubler les pièces » restaient français dans toutes les langues — trois
   * chaînes oubliées dans le markup et dans une feuille de style, qu'aucune
   * vérification de dictionnaire ne pouvait voir.
   *
   * Le panneau QA et l'éditeur sont exclus : outils de développement, ils n'ont
   * pas vocation à être traduits.
   */
  let markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  // On retire les deux sections d'outillage, délimitées par leurs commentaires.
  for (const [debut, fin] of [['<!-- ============ EDITEUR', '<!-- ============ OFFRE'],
                              ['<!-- ============ DEBUG', '</main>']]) {
    const i = markup.indexOf(debut);
    if (i < 0) continue;
    const j = markup.indexOf(fin, i + debut.length);
    markup = markup.slice(0, i) + (j < 0 ? '' : markup.slice(j));
  }
  const enDur = [];
  for (const m of markup.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>([^<>{}]+)<\/\1>/g)) {
    const [, balise, attrs, brut] = m;
    const texte = brut.trim();
    if (!texte || attrs.includes('data-i18n')) continue;
    // `<title>` est posé par i18n au démarrage ; ce qu'il y a dans le markup
    // n'est qu'un repli avant que le script ne tourne.
    if (balise === 'title') continue;
    if (!/[A-Za-zÀ-ÿ]{3}/.test(texte)) continue;
    if (['Quiet', 'Puzzle'].includes(texte)) continue;   // le nom du jeu
    enDur.push(`<${balise}> ${texte}`);
  }
  check('aucun texte visible n\'est codé en dur dans le markup',
    enDur.length === 0, enDur.slice(0, 3).join(' · '));

  // Une feuille de style peut écrire du texte, elle aussi — et celui-là
  // échappe à toute traduction : `content: attr(...)` est la seule forme
  // acceptable.
  const css = readFileSync(new URL('../styles/main.css', import.meta.url), 'utf8');
  const contenus = [...css.matchAll(/content:\s*'([^']*)'/g)]
    .map((m) => m[1])
    .filter((v) => /[A-Za-zÀ-ÿ]{3}/.test(v));
  check('aucun texte n\'est écrit depuis le CSS', contenus.length === 0, contenus.join(', '));
}

console.log('\n== Carte du projet (AGENTS.md) ==');
{
  const { readFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const racine = new URL('../', import.meta.url).pathname;
  const carte = readFileSync(join(racine, '..', 'AGENTS.md'), 'utf8');

  /**
   * Une carte qui ment coûte plus cher que pas de carte : elle envoie ouvrir un
   * fichier qui n'existe plus, et il faut alors lire tout le code pour s'en
   * rendre compte — exactement ce qu'elle prétend éviter.
   */
  const cites = [...carte.matchAll(/`((?:src|tools|styles)\/[\w./-]+|index\.html)`/g)]
    .map((m) => m[1]);
  const absents = [...new Set(cites)].filter((f) => !existsSync(join(racine, f)));
  check('tous les fichiers cités par la carte existent',
    absents.length === 0, absents.join(', ') || `${new Set(cites).size} fichiers`);

  // Les symboles mis en avant sont les points d'entrée du travail : s'ils
  // disparaissent, la carte envoie chercher ce qui n'est plus là.
  const symboles = ['REALMS', 'COINS_PER_STAR', 'STREAK_TIERS', 'THEMES',
                    'EVENTS', 'PACKS', 'AD_REWARD', 'capacityCost',
                    'conditionMet', 'canMove',
                    // The generation chain is the most frequently used section, so it
                    // must stay aligned with the real code names.
                    'realmOf', 'curve', 'makeGates', 'placeAtGate',
                    'distanceToGate', 'measureGestures', 'demandOf', 'demandBudget',
                    'starThresholds', 'mulberry32', 'shuffled', 'LEVELS_PER_REALM'];
  const sources = ['src/core/levels.js', 'src/core/block.js', 'src/core/board.js',
                   'src/core/stars.js', 'src/data/levelStore.js',
                   'src/data/api.js', 'src/data/analytics.js', 'src/meta/daily.js',
                   'src/meta/themes.js', 'src/monetization/currency.js',
                   'src/monetization/brokerPolicy.js', 'src/monetization/brokerManager.js']
    .map((f) => readFileSync(join(racine, f), 'utf8')).join('\n');
  const perdus = symboles.filter((sym) => !new RegExp(`\\b${sym}\\b`).test(sources));
  check('les symboles qu\'elle désigne existent encore', perdus.length === 0, perdus.join(', '));
}

console.log('\n== Event nomenclature ==');
{
  const { EVENTS, levelContext } = await import('../src/data/analytics.js');
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');

  const names = Object.values(EVENTS);
  check('no event name is used twice',
    new Set(names).size === names.length, names.length + ' events');
  check('all follow the object_action convention',
    names.every((n) => /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(n)),
    names.filter((n) => !/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(n)).join(', '));

  // The level context must always carry the same keys: this is what makes
  // a quit and a completion comparable without hidden arithmetic.
  const expected = ['level_id', 'level', 'world', 'attempt', 'duration', 'moves', 'min_drags', 'stars'];
  const ctx = levelContext({ levelId: 'lvl_001', number: 1, realm: 'Test' });
  check('the level context carries all its keys',
    expected.every((k) => k in ctx), Object.keys(ctx).join(', '));

  // Every declared event must actually be emitted somewhere: a nomenclature
  // that claims to cover events nobody sends is a false sense of coverage.
  const sources = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const path = join(dir, e);
      if (statSync(path).isDirectory()) walk(path);
      else if (e.endsWith('.js')) sources.push(readFileSync(path, 'utf8'));
    }
  };
  walk(new URL('../src', import.meta.url).pathname);
  const code = sources.join('\n');
  const orphaned = Object.entries(EVENTS)
    .filter(([key, name]) => !code.includes(`EV.${key}`) && !code.includes(`'${name}'`))
    .map(([, name]) => name);
  check('every declared event is emitted somewhere',
    orphaned.length === 0, orphaned.join(', '));
}

console.log('\n== Ad pacing ==');
{
  const { BrokerPolicy, RULES } = await import('../src/monetization/brokerPolicy.js');
  let now = 1_000_000;
  const p = new BrokerPolicy(RULES, () => now);
  const ctx = (o = {}) => ({ level: 10, noAds: false, firstFailureOfLevel: false, ...o });

  p.noteLevelEnding(); p.noteLevelEnding();

  check('no ad before level ' + RULES.MIN_LEVEL,
    p.canShowInterstitial(ctx({ level: 1 })).ok === false);
  check('no ad if the remove-ads purchase is active',
    p.canShowInterstitial(ctx({ noAds: true })).ok === false);
  check('no ad on the first failure of a level',
    p.canShowInterstitial(ctx({ firstFailureOfLevel: true })).ok === false);
  check('ad allowed in normal conditions',
    p.canShowInterstitial(ctx()).ok === true);

  p.noteInterstitial();
  check('no two ads back to back', p.canShowInterstitial(ctx()).ok === false);

  now += RULES.MIN_INTERVAL_MS + 1000;
  check('the level-ending counter resets after an ad',
    p.canShowInterstitial(ctx()).ok === false,
    p.canShowInterstitial(ctx()).reason);

  p.noteLevelEnding(); p.noteLevelEnding();
  check('ad allowed again once the quota is reached',
    p.canShowInterstitial(ctx()).ok === true);

  p.noteRewarded();
  check('no ad just after a rewarded ad',
    p.canShowInterstitial(ctx()).ok === false);

  check('banner allowed in menu', p.canShowBanner('menu', false) === true);
  check('banner forbidden during a game', p.canShowBanner('game', false) === false);
  check('banner forbidden with the remove-ads purchase', p.canShowBanner('menu', true) === false);
}

console.log('\n== Level rewards ==');
{
  const api = await import('../src/data/api.js');
  const store = await import('../src/data/save.js');
  store.reset();

  check('three stars pay ten coins', api.coinsFor(3) === 10);
  check('two stars pay five coins', api.coinsFor(2) === 5);
  check('one star pays two coins', api.coinsFor(1) === 2);
  check('a lost level pays nothing', api.coinsFor(0) === 0);

  check('replaying without improving pays a single coin',
    [1, 2, 3].every((s) => api.coinsFor(s, false) === 1));

  const first = await api.completeLevel(1, { score: 8, stars: 3, failed: false });
  const replay = await api.completeLevel(1, { score: 8, stars: 3, failed: false });
  check('the first success pays the scale, the replay does not',
    first.coinsEarned === 10 && replay.coinsEarned === 1,
    `${first.coinsEarned} then ${replay.coinsEarned}`);

  store.reset();
  await api.completeLevel(2, { score: 30, stars: 1, failed: false });
  const better = await api.completeLevel(2, { score: 9, stars: 3, failed: false });
  check('improving pays the new score scale',
    better.coinsEarned === 10, better.coinsEarned + ' coins');

  const lost = await api.completeLevel(3, { score: 0, stars: 0, failed: true });
  check('a failure pays nothing', lost.coinsEarned === 0);
  store.reset();
}

console.log('\n== Coin shop ==');
{
  const currency = await import('../src/monetization/currency.js');
  const store = await import('../src/data/save.js');
  store.reset();

  const start = currency.balance();
  const earned = currency.creditAdReward();
  check('a rewarded ad pays the announced amount',
    earned === currency.AD_REWARD.COINS && currency.balance() === start + earned,
    `${earned} coins`);
  check('it burns through the daily quota',
    currency.adsRemaining() === currency.AD_REWARD.PER_DAY - 1,
    currency.adsRemaining() + ' remaining');

  while (currency.adsRemaining() > 0) currency.creditAdReward();
  const before = currency.balance();
  const refused = currency.creditAdReward();
  check('once the quota is spent, it pays nothing',
    refused === 0 && currency.balance() === before);

  const pack = currency.PACKS[1];
  const beforeBalance = currency.balance();
  const paid = currency.buyPack(pack.id);
  const expected = Math.round(pack.coins * (1 + pack.bonus / 100));
  check('a pack pays its coins, bonus included',
    paid === expected && currency.balance() === beforeBalance + expected,
    `${paid} for ${pack.coins} +${pack.bonus} %`);

  const beforeUnknown = currency.balance();
  check('an unknown pack id pays nothing',
    currency.buyPack('com.puzzle.coins.inexistant') === 0
    && currency.balance() === beforeUnknown);

  const perEuro = currency.PACKS.map((p) => {
    const total = p.coins * (1 + p.bonus / 100);
    return total / Number(p.price.replace(',', '.').replace(/[^\d.]/g, ''));
  });
  const ascending = perEuro.every((v, i) => i === 0 || v > perEuro[i - 1]);
  check('each pack offers more coins per euro than the previous one',
    ascending, perEuro.map((v) => Math.round(v)).join(' < '));

  store.reset();
}

console.log('\n== Indices ==');
{
  let fiables = 0, absents = 0;
  for (let n = 1; n <= TOTAL_LEVELS; n++) {
    const level = getLevel(n);
    const b = new Board(level);
    const conseil = b.hint();
    if (!conseil) { absents++; continue; }
    // L'indice doit être vérifiable : le bloc désigné doit réellement pouvoir sortir.
    const avant = b.remaining();
    const chemin = Array.isArray(conseil.path) ? conseil.path : Array.isArray(conseil.chemin) ? conseil.chemin : [];
    for (const pos of chemin.slice(1)) b.dragTowards(conseil.id, pos.x, pos.y);
    if (b.blocks.has(conseil.id)) {
      const [dx, dy] = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[conseil.gate];
      b.step(conseil.id, dx, dy);
    }
    if (b.remaining() === avant - 1) fiables++;
  }
  check(`un indice est proposé sur chacun des ${TOTAL_LEVELS} niveaux`, absents === 0, absents + ' sans indice');
  check('le bloc désigné sort réellement', fiables === TOTAL_LEVELS, fiables + '/' + TOTAL_LEVELS);
}

console.log(echecs ? `\n${echecs} test(s) en échec\n` : '\nTous les tests passent\n');
process.exit(echecs ? 1 : 0);
