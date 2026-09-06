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
  const complet = process.argv.includes('--solveur-complet');
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
    const r = resoudre(b, BUDGET_HORS_LIGNE);
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
      // Certains mondes n'introduisent pas un type de bloc mais une propriété
      // des portes ou des pièces : le test doit savoir où la chercher.
      const SIGNES = {
        'scelle-couleur': (L) => L.blocks.some((b) => b.condition?.type === 'color'),
        cle: (L) => L.blocks.some((b) => b.estCle),
        'porte-partagee': (L) => L.gates.some((g) => g.colors?.length > 1),
        'porte-etroite': (L) => L.gates.every((g) => g.length <= 2),
        'grosses-formes': (L) => L.blocks.every((b) => b.kind === 'wall' || b.cells.length >= 2),
      };
      const porte = SIGNES[attendu] || ((L) => L.blocks.some((b) => b.kind === attendu));
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

console.log('\n== Traduction ==');
{
  const { LANGUES, t, definirLangue, langue } = await import('../src/ui/i18n.js');
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
    LANGUES.every((L) => codes.includes(L.code)), codes.join(', '));

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
      definirLangue(code);
      const rendu = t(cle, Object.fromEntries(params.map((nom) => [nom, '§'])));
      if (rendu.includes('{')) trous.push(`${code}:${cle}`);
    }
  }
  definirLangue(codes[0]);
  check('aucune traduction ne perd un paramètre', trous.length === 0, trous.slice(0, 4).join(', '));
  check('la langue courante est restaurée', langue() === codes[0]);

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

console.log('\n== Boutique de pièces ==');
{
  const currency = await import('../src/monetization/currency.js');
  const store = await import('../src/data/save.js');
  store.reset();

  const depart = currency.solde();
  const gagne = currency.crediterPub();
  check('une pub récompensée verse le montant annoncé',
    gagne === currency.PUB_RECOMPENSE.PIECES && currency.solde() === depart + gagne,
    `${gagne} pièces`);
  check('elle entame le quota du jour',
    currency.pubsRestantes() === currency.PUB_RECOMPENSE.PAR_JOUR - 1,
    currency.pubsRestantes() + ' restantes');

  // Le quota protège l'économie : sans lui, une réserve infinie de pièces
  // gratuites rendrait tous les bonus indolores.
  while (currency.pubsRestantes() > 0) currency.crediterPub();
  const avant = currency.solde();
  const refuse = currency.crediterPub();
  check('le quota épuisé, elle ne verse plus rien',
    refuse === 0 && currency.solde() === avant);

  const pack = currency.PACKS[1];
  const soldeAvant = currency.solde();
  const verse = currency.acheterPack(pack.id);
  const attendu = Math.round(pack.pieces * (1 + pack.bonus / 100));
  check('un pack verse ses pièces, bonus compris',
    verse === attendu && currency.solde() === soldeAvant + attendu,
    `${verse} pour ${pack.pieces} +${pack.bonus} %`);

  const avantInconnu = currency.solde();
  check('un identifiant de pack inconnu ne verse rien',
    currency.acheterPack('com.puzzle.coins.inexistant') === 0
    && currency.solde() === avantInconnu);

  // Les paliers doivent rester intéressants dans l'ordre : payer plus cher
  // pour une pièce plus chère serait un piège, pas une offre.
  const parEuro = currency.PACKS.map((p) => {
    const total = p.pieces * (1 + p.bonus / 100);
    return total / Number(p.prix.replace(',', '.').replace(/[^\d.]/g, ''));
  });
  const croissant = parEuro.every((v, i) => i === 0 || v > parEuro[i - 1]);
  check('chaque pack offre plus de pièces par euro que le précédent',
    croissant, parEuro.map((v) => Math.round(v)).join(' < '));

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
