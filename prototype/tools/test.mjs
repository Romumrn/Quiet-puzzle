/**
 * Tests de la logique de jeu — `node tools/test.mjs`
 *
 * Le test central rejoue, sur le vrai moteur, la solution de référence produite
 * par la génération à l'envers. S'il passe pour tous les niveaux, aucun niveau
 * livré n'est insoluble. Aucune dépendance : core/ ne touche pas au DOM.
 */

import { Board } from '../src/core/board.js';
import { KIND } from '../src/core/block.js';
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

let echecs = 0;
const check = (nom, cond, detail = '') => {
  console.log(`${cond ? '  OK  ' : ' ECHEC'} ${nom}${detail ? ' — ' + detail : ''}`);
  if (!cond) echecs++;
};

/** Rejoue la solution de référence, sans limite de coups ni de temps. */
function rejouer(n) {
  const level = getLevel(n);
  const b = new Board({ ...level, moveLimit: 9999, timeLimit: 9999 });
  for (const etape of level.solution) {
    for (const pos of etape.chemin.slice(1)) {
      const r = b.dragTowards(etape.id, pos.x, pos.y);
      const bloc = b.blocks.get(etape.id);
      if (!r.exited && bloc && (bloc.x !== pos.x || bloc.y !== pos.y)) {
        return { ok: false, raison: `bloc ${etape.id} bloqué avant (${pos.x},${pos.y})` };
      }
    }
    if (b.blocks.has(etape.id)) {
      const [dx, dy] = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[etape.gate];
      const r = b.step(etape.id, dx, dy);
      if (!r.ok || r.event.type !== 'exit') {
        return { ok: false, raison: `bloc ${etape.id} ne sort pas par ${etape.gate} (${r.reason || r.event.type})` };
      }
    }
    b.endGesture(true);
  }
  return { ok: b.isSolved(), raison: b.isSolved() ? '' : `${b.remaining()} bloc(s) restant(s)`, board: b };
}

console.log('\n== La base de niveaux ==');
{
  const cat = base.catalogue();
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

  const horsMonde = [...niveaux.values()].filter((L) => base.realmDe(L.number).name !== L.realm)
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

  // Divergence avec le générateur : ce n'est PAS une erreur — un niveau peut
  // avoir été retouché à la main, c'est même l'intérêt d'avoir une base. Mais
  // une base oubliée après un réglage du générateur produit exactement la même
  // signature, et il vaut mieux le savoir.
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

console.log('\n== Résolubilité vérifiée indépendamment ==');
{
  const { resoudre, BUDGET_HORS_LIGNE } = await import('../src/core/solver.js');
  const echoues = [];
  let etatsMax = 0;
  for (let n = 1; n <= TOTAL_LEVELS; n++) {
    const b = new Board({ ...getLevel(n), moveLimit: 9999, timeLimit: 9999 });
    const r = resoudre(b, BUDGET_HORS_LIGNE);
    etatsMax = Math.max(etatsMax, r.etats);
    if (!r.resoluble) echoues.push(`niveau ${n}${r.abandon ? ' (recherche coupée)' : ''}`);
  }
  check(`le solveur vide les ${TOTAL_LEVELS} niveaux sans lire la solution de référence`,
    echoues.length === 0, echoues.join(', ') || `${etatsMax} états explorés au pire`);
}

console.log('\n== Les blocs des mondes tardifs ==');
{
  const { Block } = await import('../src/core/block.js');
  const { coutCapacite } = await import('../src/core/block.js');
  const grille = (blocks, gates) => ({
    levelId: 'test', number: 0, realm: 'test', difficulty: 'test',
    width: 4, height: 4, colorCount: 2, moveLimit: 99, timeLimit: 99, minDrags: 1,
    objective: { type: 'clear_all', target: blocks.length }, starDrags: [1, 2],
    estimatedTime: 99, gates, blocks, solution: [],
  });

  // ANCRE : un seul sens de marche, celui de sa porte.
  {
    const b = new Board(grille(
      [{ id: 1, color: 0, cells: [[0, 0]], x: 1, y: 2, kind: KIND.ANCRE, dir: 'top' }],
      [{ side: 'top', start: 0, length: 4, color: 0 }],
    ));
    const versLaPorte = b.step(1, 0, -1);
    const aRebours = b.step(1, 0, 1);
    const deCote = b.step(1, 1, 0);
    check('une ancre avance vers sa porte', versLaPorte.ok === true);
    check('une ancre refuse de reculer', aRebours.ok === false, 'raison : ' + aRebours.reason);
    check('une ancre refuse de se décaler', deCote.ok === false, 'raison : ' + deCote.reason);
  }

  // ENCOMBRANT : coûte le double à la porte qui l'avale.
  {
    const cellules = [[0, 0], [1, 0]];
    const ordinaire = new Block({ id: 1, color: 0, cells: cellules, x: 0, y: 0 });
    const encombrant = new Block({ id: 2, color: 0, cells: cellules, x: 0, y: 0, kind: KIND.ENCOMBRANT });
    check('un encombrant coûte le double à sa porte',
      coutCapacite(encombrant) === 2 * coutCapacite(ordinaire),
      `${coutCapacite(encombrant)} contre ${coutCapacite(ordinaire)}`);

    // Une porte de 3 accepte le bloc ordinaire (2 cases) mais pas l'encombrant (4).
    const porte = () => [{ side: 'top', start: 0, length: 2, color: 0, capacity: 3 }];
    const passe = new Board(grille(
      [{ id: 1, color: 0, cells: cellules, x: 0, y: 0, kind: KIND.NORMAL }], porte()));
    const bloque = new Board(grille(
      [{ id: 1, color: 0, cells: cellules, x: 0, y: 0, kind: KIND.ENCOMBRANT }], porte()));
    check('une porte trop entamée refuse l\'encombrant qu\'elle accepterait ordinaire',
      passe.step(1, 0, -1).ok === true && bloque.step(1, 0, -1).ok === false);

    // Et ce qu'elle consomme suit le même compte.
    const consomme = new Board(grille(
      [{ id: 1, color: 0, cells: cellules, x: 0, y: 0, kind: KIND.ENCOMBRANT }],
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

  // Sur les niveaux livrés : chaque monde tardif porte bien sa nouveauté.
  {
    const { REALMS: SOURCE } = await import('../src/core/levels.js');
    const NOUVEAUTES = Object.fromEntries(SOURCE.map((R) => [R.id, R.nouveaute]));
    const REALMS = base.realms();
    const LEVELS_PER_REALM = base.levelsPerRealm();
    const manquants = [];
    for (const [i, R] of REALMS.entries()) {
      if (!R.apporte) continue;
      // L'index ne stocke pas le type introduit — il n'a pas à connaître les
      // constantes du moteur. On déduit donc la nouveauté du monde de ce que
      // ses niveaux contiennent, en la cherchant là où elle a été déclarée.
      const attendu = NOUVEAUTES[R.id];
      if (!attendu) continue;
      const porte = (L) => attendu === 'scelle-couleur'
        ? L.blocks.some((b) => b.condition?.type === 'color')
        : L.blocks.some((b) => b.kind === attendu);
      let avec = 0;
      for (let k = 0; k < LEVELS_PER_REALM; k++) {
        if (porte(getLevel(i * LEVELS_PER_REALM + k + 1))) avec++;
      }
      // Les trois quarts suffisent : le générateur ne force jamais une pose qui
      // rendrait la grille infaisable, et une nouveauté omniprésente lasse.
      if (avec < LEVELS_PER_REALM * 0.75) manquants.push(`${R.name} ${avec}/${LEVELS_PER_REALM}`);
    }
    check('chaque monde porte réellement la nouveauté qu\'il annonce',
      manquants.length === 0, manquants.join(', '));
  }
}

console.log('\n== Cadencement publicitaire ==');
{
  const { AdPolicy, REGLES } = await import('../src/monetization/adPolicy.js');
  let t = 1_000_000;
  const p = new AdPolicy(REGLES, () => t);
  const ctx = (o = {}) => ({ niveau: 10, noAds: false, premiereDefaiteDuNiveau: false, ...o });

  // Assez de fins de niveau pour être éligible
  p.noterFinDeNiveau(); p.noterFinDeNiveau();

  check('pas de pub avant le niveau ' + REGLES.NIVEAU_MIN,
    p.peutAfficherInterstitiel(ctx({ niveau: 1 })).ok === false);
  check('pas de pub si l\'achat sans-pub est actif',
    p.peutAfficherInterstitiel(ctx({ noAds: true })).ok === false);
  check('pas de pub sur la première défaite d\'un niveau',
    p.peutAfficherInterstitiel(ctx({ premiereDefaiteDuNiveau: true })).ok === false);
  check('pub autorisée dans les conditions normales',
    p.peutAfficherInterstitiel(ctx()).ok === true);

  p.noterInterstitiel();
  check('pas deux pubs coup sur coup', p.peutAfficherInterstitiel(ctx()).ok === false);

  t += REGLES.INTERVALLE_MIN_MS + 1000;
  check('le compteur de fins de niveau repart à zéro après une pub',
    p.peutAfficherInterstitiel(ctx()).ok === false,
    p.peutAfficherInterstitiel(ctx()).raison);

  p.noterFinDeNiveau(); p.noterFinDeNiveau();
  check('pub à nouveau autorisée une fois le quota de fins atteint',
    p.peutAfficherInterstitiel(ctx()).ok === true);

  p.noterRecompensee();
  check('pas de pub juste après une pub récompensée',
    p.peutAfficherInterstitiel(ctx()).ok === false);

  check('bannière autorisée au menu', p.peutAfficherBanniere('menu', false) === true);
  check('bannière interdite pendant une partie', p.peutAfficherBanniere('game', false) === false);
  check('bannière interdite avec l\'achat sans-pub', p.peutAfficherBanniere('menu', true) === false);
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
    for (const pos of conseil.chemin.slice(1)) b.dragTowards(conseil.id, pos.x, pos.y);
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
