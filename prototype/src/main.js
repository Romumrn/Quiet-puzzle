/**
 * GameManager — équivalent de Scripts/Managers/GameManager.cs (doc §4)
 *
 * Point d'entrée et coordinateur : enchaîne les écrans, instancie le plateau,
 * relaie les gestes du joueur vers la logique puis les évènements vers le
 * rendu, et fait tourner le chrono. Toute la règle du jeu vit dans core/, tout
 * le DOM du plateau dans render/ : ce fichier ne fait que les brancher.
 */

import { Board } from './core/board.js';
import { GameState } from './core/gameState.js';
import * as levels from './data/levelStore.js';
import * as i18n from './ui/i18n.js';
const { t } = i18n;
import { KIND } from './core/block.js';
import { BoardView, setSpeed, conditionLabel } from './render/boardView.js';
import { InputHandler } from './input/input.js';
import * as api from './data/api.js';
import * as store from './data/save.js';
import * as screens from './ui/screens.js';
import * as mapScreen from './ui/mapScreen.js';
import * as theme from './ui/theme.js';
import * as editor from './ui/editor.js';
import { resoudre } from './core/solver.js';
import * as hud from './ui/gameplayUI.js';
import * as result from './ui/resultScreen.js';
import { AdManager, PLACEMENT } from './monetization/adManager.js';
import * as currency from './monetization/currency.js';
import * as failOffer from './monetization/failOffer.js';
import * as daily from './meta/daily.js';
import * as dailyPuzzle from './meta/dailyPuzzle.js';
import * as feedback from './meta/feedback.js';
import { track, recent, subscribe } from './data/events.js';
import { AudioManager } from './audio/audioManager.js';

const el = (id) => document.getElementById(id);

let view = null;
let input = null;
let board = null;
let level = null;
/** Proposition en cours quand on joue le puzzle du jour, sinon null. */
let puzzleDuJour = null;
/** Brouillon en cours quand on essaie une grille de l'éditeur, sinon null. */
let essaiEditeur = null;
let chrono = null;
let busy = false;
let offreUtilisee = false;   // l'offre de continuation ne vaut qu'une fois par tentative
let echecsDuNiveau = 0;      // sert à ne pas couper la toute première défaite par une pub
let debutNiveau = 0;

/**
 * Respiration entre le dernier bloc sorti et l'écran de réussite.
 *
 * Enchaîner immédiatement écrase le moment le plus gratifiant de la partie :
 * le joueur voit son dernier bloc franchir la porte, entend son carillon, et
 * l'écran lui tombe dessus avant qu'il ait pu en profiter. On laisse donc le
 * son et l'animation se poser, on ponctue par l'arpège de victoire, puis on
 * affiche.
 */
const PAUSE_AVANT_REUSSITE = 780;   // ms, après la sortie du dernier bloc
const PAUSE_APRES_ARPEGE = 420;     // ms, entre l'arpège et l'écran

/** En arrière-plan on n'attend pas : les minuteurs y sont bridés à une seconde. */
const pause = (ms) => (document.hidden ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
let gesteMemorise = false;   // un seul instantané par geste, pour l'annulation
let modeMarteau = false;

const audio = new AudioManager();

const ads = new AdManager({
  overlay: el('overlay-ad'),
  banner: el('banner'),
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

async function showMenu() {
  stopChrono();
  const p = await api.getProfile();
  el('menu-stars').textContent = p.totalStars;
  el('menu-coins').textContent = p.coins;
  // « 121 / 160 » plutôt que « 121 » : seul, le chiffre ne dit pas où l'on en
  // est — il se lisait comme un score, alors qu'il mesure un avancement.
  el('menu-progress').textContent = `${p.currentLevel}/${levels.totalLevels()}`;
  await majMenuPuzzleDuJour();
  majCadeauDuJour();
  majPastilleSon();
  theme.appliquer(p.currentLevel); // le menu prend la couleur d'où en est le joueur
  screens.show('menu');
  audio.lancerMusique();
  majBanniere('menu');
}

/** Cadeau du jour : visible seulement s'il est réclamable. */
function majCadeauDuJour() {
  const dispo = daily.peutReclamer();
  el('btn-daily').hidden = !dispo;
  if (!dispo) return;
  el('daily-title').textContent = t('menu.daily');
  el('daily-sub').textContent = t(daily.serie() > 1 ? 'menu.streak.plural' : 'menu.streak', { n: daily.serie() });
  el('daily-amount').textContent = `+${daily.recompenseDuJour()}`;
}

/** La bannière ne vit que hors partie — la politique tranche, pas l'appelant. */
function majBanniere(ecran) {
  ads.majBanniere(ecran);
  el('app').classList.toggle('with-banner', !el('banner').hidden);
}

function showMap() {
  stopChrono();
  result.hide();
  mapScreen.render(showBrief);
  screens.show('map');
  majBanniere('map');
}

async function showBrief(n) {
  stopChrono();
  level = await api.getLevel(n);
  const rec = store.levelRecord(n);
  // Le nom du monde vient du CATALOGUE, pas du niveau : la base le stocke
  // dans les deux langues, alors que `level.realm` est figé à la génération.
  el('brief-realm').textContent = i18n.texteMonde(levels.realmDe(n), 'nom');
  el('brief-number').textContent = n;
  screens.renderStars(el('brief-stars'), rec.stars);
  el('brief-objective').textContent = hud.labelFor(level);
  el('brief-moves').textContent = level.moveLimit;
  el('brief-difficulty').textContent = i18n.texteMonde(levels.realmDe(n), 'difficulte');
  // Nouveauté du monde, annoncée à son premier niveau seulement. Un type de
  // bloc jamais vu doit être nommé une fois ; le répéter aux dix-neuf niveaux
  // suivants transformerait l'encart en décor que plus personne ne lit.
  const nouveaute = el('brief-nouveaute');
  const entreeDeMonde = (n - 1) % levels.levelsPerRealm() === 0 && levels.realmDe(n).apporte;
  nouveaute.hidden = !entreeDeMonde;
  if (entreeDeMonde) nouveaute.textContent = t('brief.new', { quoi: i18n.texteMonde(levels.realmDe(n), 'apporte') });
  el('brief-best').textContent = rec.bestScore ? `${rec.bestScore} coups` : '—';
  theme.appliquer(n);
  screens.show('brief');
  majBanniere('brief');
}

// ---------------------------------------------------------------------------
// Partie
// ---------------------------------------------------------------------------

/**
 * Interstitielle à l'OUVERTURE d'un niveau, et non plus à sa fin.
 *
 * Une pub qui tombe sur l'écran de réussite arrive au moment exact où le joueur
 * peut décider qu'il a fini sa session : on lui coupe sa récompense, et il
 * quitte. Placée avant la grille suivante, elle attrape quelqu'un qui a déjà
 * décidé de continuer — le même inventaire vendu au moment où il coûte le moins.
 *
 * Deux niveaux n'en montrent jamais : ceux de l'éditeur et le puzzle du jour.
 * Ils ne font pas partie de la progression, et une pub devant une grille qu'on
 * vient de dessiner soi-même serait absurde. Un simple rejeu après échec en est
 * exempt aussi : on ne fait pas payer une reprise.
 */
async function pubAvantNiveau() {
  if (!level?.number || essaiEditeur || puzzleDuJour) return;
  if (echecsDuNiveau > 0) return;
  await ads.montrerInterstitiel({
    niveau: level.number,
    noAds: currency.aSupprimeLesPubs(),
    premiereDefaiteDuNiveau: false,
  });
}

async function startLevel() {
  ouvrirPanneau(false);
  result.hide();
  await pubAvantNiveau();
  theme.appliquer(level.number);
  audio.reinitialiserSerie();
  offreUtilisee = false;
  debutNiveau = Date.now();
  track('level_started', { level: level.number, essai: echecsDuNiveau + 1 });
  board = new Board(level);
  board._solveur = { resoudre }; // niveaux de l'éditeur : pas de solution de référence
  hud.mount(level);
  hud.update(board);
  screens.show('game');

  // Montage synchrone : surtout pas dans un requestAnimationFrame, qui ne se
  // déclenche pas si l'onglet est en arrière-plan — le plateau resterait vide.
  if (!view) {
    view = new BoardView(el('board'));
    input = new InputHandler(view, { onDrag, onEnd, canGrab, onRefus });
  }
  view.mount(board);
  hud.update(board);
  majBonus();
  busy = false;
  input.locked = false;
  majBanniere('game');
  startChrono();
}

/**
 * Etat de la barre de bonus. L'indice se paie en pièces tant qu'il y en a, et
 * bascule sur une pub récompensée quand le joueur est fauché — mieux vaut une
 * pub qu'un joueur bloqué qui désinstalle. Les trois autres bonus s'obtiennent
 * uniquement contre une pub récompensée.
 */
function majBonus() {
  const gratuit = !currency.peutPayer(currency.PRIX.INDICE);
  const cout = el('hint-cost');
  cout.textContent = gratuit ? 'Pub' : currency.PRIX.INDICE;
  cout.classList.toggle('ad', gratuit);
  el('btn-undo').disabled = !board || !board.peutAnnuler();
}

/** Regarde une pub récompensée pour un bonus. Le chrono est suspendu pendant. */
async function bonusParPub(placement) {
  stopChrono();
  const vue = await ads.montrerRecompensee(placement);
  if (board?.gameState === GameState.PLAYING) startChrono();
  return vue;
}

function canGrab(id) {
  const b = board.blocks.get(id);
  return !!b && board.canMove(b);
}

/** Refus de saisie : on explique pourquoi plutôt que de ne rien faire. */
function onRefus(id) {
  const b = board.blocks.get(id);
  if (!b) return;
  view.bump(id);
  if (b.kind === KIND.WALL) screens.toast(t('toast.sealed'));
  else if (b.kind === KIND.LOCKED) screens.toast(t('toast.locked', { quoi: conditionLabel(b.condition, board) }));
}

/** Un mouvement de doigt : renvoie vrai si le bloc a effectivement avancé. */
function onDrag(id, x, y) {
  if (busy || board.gameState !== GameState.PLAYING) return false;
  const avant = gesteMemorise ? null : board.snapshot();
  const { events } = board.dragTowards(id, x, y);
  if (!events.length) return false;
  for (const e of events) if (e.type === 'exit') audio.sortie();
  if (!gesteMemorise) { board.memoriser(avant); gesteMemorise = true; }
  view.apply(events);
  hud.update(board);
  return true;
}

/** Fin de geste : c'est là qu'un coup est décompté. */
async function onEnd(id, aBouge) {
  gesteMemorise = false;
  majBonus();
  if (!aBouge || board.gameState !== GameState.PLAYING) return;
  const events = board.endGesture(true);
  await view.apply(events);
  view.refreshLocks();
  view.refreshGates();
  hud.update(board);
  majBonus();
  if (board.gameState !== GameState.PLAYING) await finishLevel();
}

// ---------------------------------------------------------------------------
// Chrono
// ---------------------------------------------------------------------------

function startChrono() {
  stopChrono();
  chrono = setInterval(async () => {
    if (!board || board.gameState !== GameState.PLAYING) return;
    board.tick(1);
    hud.update(board);
    if (board.gameState !== GameState.PLAYING) await finishLevel();
  }, 1000);
}

function stopChrono() {
  if (chrono) { clearInterval(chrono); chrono = null; }
}

async function finishLevel() {
  stopChrono();
  busy = true;
  input.locked = true;

  const won = board.gameState === GameState.WON;
  const duree = Math.round((Date.now() - debutNiveau) / 1000);

  // On laisse respirer avant d'annoncer la réussite.
  if (won) {
    await pause(PAUSE_AVANT_REUSSITE);
    audio.victoire();
    await pause(PAUSE_APRES_ARPEGE);
  }

  // Défaite : on propose de continuer AVANT d'acter l'échec.
  if (!won && !offreUtilisee) {
    offreUtilisee = true;
    const choix = await failOffer.proposer({ board, ads });
    if (choix) {
      failOffer.appliquer(board);
      hud.update(board);
      busy = false;
      input.locked = false;
      startChrono();
      return;
    }
  }

  if (won) {
    echecsDuNiveau = 0;
    track('level_completed', { level: level.number, glisses: board.dragsUsed(), etoiles: board.stars(), duree });
  } else {
    echecsDuNiveau++;
    track('level_failed', { level: level.number, raison: board.failReason, restants: board.remaining(), duree });
  }

  const stars = board.stars();

  /**
   * Le puzzle du jour ne suit pas le circuit de la progression : il ne débloque
   * rien, ne verse pas de pièces, et se solde par un score et un rang. Le
   * mélanger au reste ferait avancer la carte au gré de grilles que le joueur
   * a dessinées lui-même.
   */
  /**
   * Une grille essayée depuis l'éditeur ne compte pas comme un niveau : elle
   * n'a pas de numéro, ne débloque rien et ne rapporte rien. Elle en rapportait
   * pourtant — `completeLevel(0)` créditait vingt-trois pièces et inscrivait un
   * « niveau 0 » dans la sauvegarde, ce qui faisait de l'éditeur la façon la
   * plus rapide de s'enrichir.
   */
  if (essaiEditeur) {
    const essai = essaiEditeur;
    essaiEditeur = null;
    result.show({
      won, stars, score: board.dragsUsed(), level: 0, duree,
      coinsEarned: 0, raison: board.failReason, restants: board.remaining(),
      mode: 'editeur',
      onEdit: () => ouvrirEditeur(essai),
      onRetry: () => { essaiEditeur = essai; startLevel(); },
      onSubmit: () => ouvrirEditeur(essai),
    });
    busy = false;
    input.locked = false;
    return;
  }

  if (puzzleDuJour) {
    const propose = puzzleDuJour;
    puzzleDuJour = null;
    if (won) {
      const { score } = await api.submitDailyScore({
        drags: board.dragsUsed(),
        minDrags: level.minDrags || board.dragsUsed(),
        secondes: duree,
      });
      track('daily_puzzle_completed', { id: propose.id, score, duree });
      await majMenuPuzzleDuJour();
      showMenu();
      montrerClassement(score);
    } else {
      showMenu();
    }
    busy = false;
    input.locked = false;
    return;
  }

  const res = await api.completeLevel(level.number, { score: board.dragsUsed(), stars, failed: !won });

  // L'interstitielle ne se joue plus ICI mais à l'ouverture du niveau suivant
  // (voir `startLevel`). On se contente d'avancer le compteur de la politique :
  // c'est bien une fin de niveau qui rend une pub éligible.
  ads.policy.noterFinDeNiveau();

  result.show({
    won,
    stars,
    score: board.dragsUsed(),
    duree,
    level: level.number,
    coinsEarned: res.coinsEarned,
    raison: board.failReason,
    restants: board.remaining(),
    onDouble: async () => {
      const vue = await ads.montrerRecompensee(PLACEMENT.RECOMPENSE_DOUBLER);
      if (!vue) return false;
      currency.crediter(res.coinsEarned, 'double_reward');
      return true;
    },
    onMap: showMap,
    onRetry: startLevel,
    onNext: async () => {
      if (level.number < levels.totalLevels()) { await showBrief(level.number + 1); startLevel(); }
      else showMap();
    },
  });
}

// ---------------------------------------------------------------------------
// Câblage
// ---------------------------------------------------------------------------

el('btn-play').onclick = showMap;

el('btn-daily').onclick = () => {
  const montant = daily.reclamer();
  if (!montant) return;
  screens.toast(t('toast.daily', { n: montant, jours: daily.serie() }));
};

el('btn-restart').onclick = () => { if (!busy) startLevel(); };

/** Marteau : le joueur DESIGNE le bloc à retirer, on n'en choisit pas un pour lui. */
el('btn-hammer').onclick = async () => {
  if (!board || busy || board.gameState !== GameState.PLAYING || modeMarteau) return;
  if (!await bonusParPub(PLACEMENT.RECOMPENSE_MARTEAU)) return;
  modeMarteau = true;
  input.locked = true;
  el('app').classList.add('hammer');
  screens.toast(t('toast.hammer.pick'));

  const viser = async (ev) => {
    const id = view.blockIdFromPoint(ev.clientX, ev.clientY);
    const cible = id !== null ? board.blocks.get(id) : null;
    if (!cible || cible.kind === 'wall') { screens.toast(t('toast.hammer.bad')); return; }
    ev.preventDefault();
    ev.stopPropagation();
    fin();
    const res = board.briser(id);
    audio.sortie();
    track('powerup_used', { type: 'hammer', level: level.number, blocId: id });
    await view.removeBlock(id);
    await view.apply(res.evts);
    view.refreshLocks();
    view.refreshGates();
    hud.update(board);
    majBonus();
    if (board.gameState !== GameState.PLAYING) await finishLevel();
  };
  const fin = () => {
    modeMarteau = false;
    input.locked = false;
    el('app').classList.remove('hammer');
    el('board').removeEventListener('pointerdown', viser, true);
  };
  el('board').addEventListener('pointerdown', viser, true);
};

el('btn-time').onclick = async () => {
  if (!board || busy || board.gameState !== GameState.PLAYING) return;
  if (!await bonusParPub(PLACEMENT.RECOMPENSE_TEMPS)) return;
  board.ajouterTemps(30);
  track('powerup_used', { type: 'time', level: level.number });
  hud.update(board);
  screens.toast(t('toast.time'));
};

el('btn-undo').onclick = async () => {
  if (!board || busy || board.gameState !== GameState.PLAYING || !board.peutAnnuler()) return;
  if (!await bonusParPub(PLACEMENT.RECOMPENSE_ANNULER)) return;
  board.annuler();
  track('powerup_used', { type: 'undo', level: level.number });
  view.resync();
  view.refreshGates();
  hud.update(board);
  majBonus();
  screens.toast(t('toast.undo'));
};

/**
 * Indice : on désigne le prochain bloc jouable, on ne le joue pas. Payant en
 * pièces, ou par pub récompensée quand le joueur est fauché.
 */
el('btn-hint').onclick = async () => {
  if (!board || busy || board.gameState !== GameState.PLAYING) return;
  const conseil = board.hint();
  if (!conseil) { screens.toast(t('toast.nohint')); return; }

  if (currency.peutPayer(currency.PRIX.INDICE)) {
    if (!currency.debiter(currency.PRIX.INDICE, 'hint')) return;
  } else {
    stopChrono();
    const vue = await ads.montrerRecompensee(PLACEMENT.RECOMPENSE_INDICE);
    startChrono();
    if (!vue) return;
  }

  track('hint_used', { level: level.number, blocId: conseil.id });
  view.highlight(conseil.id);
  majBonus();
};
el('btn-start').onclick = startLevel;
// ---------------------------------------------------------------------------
// Menu utilisateur — profil et réglages, accessibles depuis TOUS les écrans, y
// compris en pleine partie : couper le son ne doit pas obliger à abandonner.
// ---------------------------------------------------------------------------

function ouvrirPanneau(ouvert) {
  el('user-panel').hidden = !ouvert;
  el('user-btn').classList.toggle('ouvert', ouvert);
  el('user-btn').setAttribute('aria-expanded', String(ouvert));
  if (ouvert) majPanneau();
}

el('user-btn').onclick = () => ouvrirPanneau(el('user-panel').hidden);
el('user-close').onclick = () => ouvrirPanneau(false);

// Un clic hors du panneau le referme, comme tout menu de ce genre.
document.addEventListener('pointerdown', (ev) => {
  if (el('user-panel').hidden) return;
  if (el('user-panel').contains(ev.target) || el('user-btn').contains(ev.target)) return;
  ouvrirPanneau(false);
}, true);

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !el('user-panel').hidden) ouvrirPanneau(false);
});

async function majPanneau() {
  const p = await api.getProfile();
  el('user-avatar').textContent = p.playerLevel;
  el('user-level').textContent = p.playerLevel;
  el('user-next').textContent = `${p.xpDansNiveau} / ${p.xpRequis} XP`;
  el('user-xp-fill').style.width = `${(p.xpDansNiveau / p.xpRequis) * 100}%`;
  el('user-stars').textContent = `${p.totalStars}/${p.maxStars}`;
  el('user-levels').textContent = p.levelsCompleted;
  el('user-coins').textContent = p.coins;

  const d = store.load();
  el('opt-music').checked = d.musique !== false;
  el('opt-sfx').checked = d.effets !== false;
  el('opt-glyphs').checked = d.glyphes === true;
  el('opt-noads').checked = currency.aSupprimeLesPubs();
  construireChoixLangue();
  majPastilleSon();
}

/** L'état « son coupé » se lit sur le bouton fermé, sinon il est invisible. */
function majPastilleSon() {
  const d = store.load();
  const muet = d.musique === false && d.effets === false;
  el('user-btn').classList.toggle('muet', muet);
}

el('opt-music').onchange = (ev) => {
  const actif = ev.target.checked;
  audio.definirMusique(actif);
  const d = store.load(); d.musique = actif; store.save(d);
  if (actif) audio.lancerMusique();
  majPastilleSon();
  track('sound_toggled', { canal: 'musique', actif });
};

el('opt-sfx').onchange = (ev) => {
  const actif = ev.target.checked;
  audio.definirEffets(actif);
  const d = store.load(); d.effets = actif; store.save(d);
  if (actif) audio.sortie();          // retour immédiat : on entend ce qu'on active
  majPastilleSon();
  track('sound_toggled', { canal: 'effets', actif });
};

/**
 * Symboles de famille sur les blocs et les portes.
 *
 * Les six couleurs se distinguent normalement à la teinte seule. Cette option
 * leur rend leur glyphe (●◆▲★■⬢) : sans lui, un joueur daltonien n'a aucun
 * moyen de savoir par quelle porte sort quel bloc. La classe posée sur `#app`
 * suffit — le rendu du plateau la lit, et le CSS fait le reste.
 */
function appliquerGlyphes(actif) {
  document.getElementById('app').classList.toggle('avec-glyphes', actif);
  view?.rafraichirGlyphes?.();
}

el('opt-glyphs').onchange = (ev) => {
  const actif = ev.target.checked;
  const d = store.load(); d.glyphes = actif; store.save(d);
  appliquerGlyphes(actif);
  track('glyphs_toggled', { actif });
};

/**
 * Choix de la langue, en liste déroulante.
 *
 * Un bouton par langue tenait à deux ; à cinq, la rangée débordait du panneau
 * et rien ne dit qu'on s'arrêtera là. Le `select` natif s'ouvre aussi dans le
 * sélecteur du téléphone, qui est fait pour ça.
 */
function construireChoixLangue() {
  const hote = el('opt-langue');
  if (hote.firstElementChild) {
    hote.firstElementChild.value = i18n.langue();
    return;
  }
  const select = document.createElement('select');
  select.className = 'langue-select';
  select.setAttribute('aria-label', i18n.t('user.language'));
  select.append(...i18n.LANGUES.map((L) => {
    const o = document.createElement('option');
    o.value = L.code;
    // Chaque langue est écrite DANS cette langue : c'est le seul libellé qu'un
    // joueur perdu dans une langue qu'il ne lit pas saura reconnaître.
    o.textContent = L.nom;
    return o;
  }));
  select.value = i18n.langue();
  select.onchange = () => {
    i18n.definirLangue(select.value);
    select.setAttribute('aria-label', i18n.t('user.language'));
    // Les écrans déjà construits portent du texte fabriqué en JS : on les
    // redessine, sans quoi la carte et le pré-niveau resteraient dans
    // l'ancienne langue jusqu'à la prochaine navigation.
    majPanneau();
    if (screens.current() === 'menu') showMenu();
    else if (screens.current() === 'map') mapScreen.render(showBrief);
    track('language_changed', { langue: select.value });
  };
  hote.replaceChildren(select);
}

/**
 * L'éditeur. Il vivait dans le panneau QA, avec les boutons « Gagner » et
 * « Perdre » : un joueur ne l'y trouvait jamais. Il est maintenant dans le menu
 * utilisateur, à côté des réglages, où l'on va quand on cherche à faire quelque
 * chose plutôt qu'à jouer.
 */
function ouvrirEditeur(reprise = null) {
  ouvrirPanneau(false);
  editor.init({
    niveau: reprise?.niveau || null,
    id: reprise?.id || null,
    onTest: (niveau, brouillonId) => {
      essaiEditeur = { niveau, id: brouillonId };
      // On quitte l'éditeur pour jouer : l'ancre n'a plus lieu d'être.
      if (ancreEditeur) { ancreEditeur = false; history.back(); }
      level = { ...niveau, number: 0, realm: t('editor.trying'), difficulty: '' };
      startLevel();
    },
    onSubmit: async (niveau, titre) => {
      const { id } = await api.submitDailyPuzzle(niveau, titre);
      track('daily_puzzle_submitted_ui', { id });
      majMenuPuzzleDuJour();
    },
  });
  screens.show('editor');
  majBanniere('editor');
  poserAncre();   // le cran d'arrêt du bouton « précédent »
}

el('btn-editor').onclick = () => ouvrirEditeur();

/**
 * Bouton « précédent » du téléphone, dans l'éditeur.
 *
 * Sur Android il ferme l'application quand rien ne l'intercepte — geste
 * malheureux au milieu d'une grille. On pose donc UNE ancre d'historique à
 * l'ouverture de l'éditeur, et chaque retour y défait le dernier bloc.
 *
 * L'ancre doit être UNIQUE et RETIRÉE en sortant. Empilée à chaque ouverture
 * sans jamais l'être, elle laissait derrière elle autant d'entrées mortes que
 * d'allers-retours : un « précédent » depuis la carte en consommait une et ne
 * faisait rien, ce qui donnait l'impression d'un bouton cassé.
 */
let ancreEditeur = false;

function poserAncre() {
  if (ancreEditeur) return;
  history.pushState({ ecran: 'editor' }, '');
  ancreEditeur = true;
}

/** Quitte l'éditeur en rendant au navigateur l'entrée qu'on lui avait prise. */
function quitterEditeur() {
  showMenu();                       // l'écran change AVANT le retour d'histoire,
  if (ancreEditeur) {               // sinon popstate croirait devoir défaire.
    ancreEditeur = false;
    history.back();
  }
}

window.addEventListener('popstate', () => {
  if (screens.current() !== 'editor') { ancreEditeur = false; return; }
  if (editor.retourArriere()) {
    // Réempilée aussitôt : sans cela, le premier retour serait le seul capté.
    ancreEditeur = false;
    poserAncre();
    screens.toast(t('editor.undone'));
    return;
  }
  ancreEditeur = false;
  showMenu();
});

// La flèche de l'éditeur passe par la même sortie que le bouton du téléphone.
document.querySelector('#screen-editor [data-nav="menu"]')
  ?.addEventListener('click', (ev) => { ev.stopImmediatePropagation(); quitterEditeur(); }, true);
el('btn-mine-close').onclick = () => { el('overlay-mine').hidden = true; };

// ---------------------------------------------------------------------------
// Signalement — bug, idée, remarque
// ---------------------------------------------------------------------------

/** Captures jointes à la rédaction en cours. Jamais stockées : voir feedback.js. */
let captures = [];
let categorie = 'bug';
const CAPTURE_MAX_MO = 4;

function majCategories() {
  el('fb-cats').replaceChildren(...feedback.CATEGORIES.map((c) => {
    const b = document.createElement('button');
    b.className = 'fb-cat' + (c === categorie ? ' sel' : '');
    b.textContent = t(`feedback.cat.${c}`);
    b.onclick = () => { categorie = c; majCategories(); };
    return b;
  }));
}

function majCaptures() {
  el('fb-shots').replaceChildren(...captures.map((c, i) => {
    const vignette = document.createElement('button');
    vignette.className = 'fb-shot';
    vignette.setAttribute('aria-label', t('editor.delete'));
    const img = document.createElement('img');
    img.src = c.data;
    img.alt = c.nom;
    vignette.append(img);
    vignette.onclick = () => { captures.splice(i, 1); majCaptures(); };
    return vignette;
  }));
}

el('fb-files').onchange = async (ev) => {
  for (const fichier of [...ev.target.files]) {
    if (fichier.size > CAPTURE_MAX_MO * 1024 * 1024) {
      screens.toast(t('feedback.toobig', { n: CAPTURE_MAX_MO }));
      continue;
    }
    const data = await new Promise((resolve) => {
      const lecteur = new FileReader();
      lecteur.onload = () => resolve(lecteur.result);
      lecteur.readAsDataURL(fichier);
    });
    captures.push({ nom: fichier.name, type: fichier.type, taille: fichier.size, data });
  }
  ev.target.value = '';
  majCaptures();
};

/** Rédaction en cours, mise en forme et enregistrée pour l'historique local. */
function rapportCourant() {
  const message = el('fb-message').value.trim();
  if (!message) { screens.toast(t('feedback.empty')); return null; }
  const rapport = feedback.composer({
    categorie,
    message,
    captures,
    extra: { ecranCourant: screens.current(), niveauEnCours: level?.number ?? null },
  });
  feedback.enregistrer(rapport);
  return rapport;
}

el('btn-feedback').onclick = () => {
  ouvrirPanneau(false);
  captures = [];
  categorie = 'bug';
  el('fb-message').value = '';
  majCategories();
  majCaptures();
  el('overlay-feedback').hidden = false;
};

el('btn-feedback-close').onclick = () => { el('overlay-feedback').hidden = true; };

el('fb-copy').onclick = async () => {
  const rapport = rapportCourant();
  if (!rapport) return;
  try {
    await navigator.clipboard.writeText(feedback.enTexte(rapport));
    screens.toast(t('feedback.copied'));
  } catch {
    // Presse-papiers refusé (contexte non sécurisé, permission) : le
    // téléchargement reste ouvert, et il emporte les captures en prime.
    el('fb-download').click();
  }
};

/**
 * Téléchargement du rapport complet, captures comprises. C'est la SEULE route
 * par laquelle une image peut voyager : aucun `mailto:` ne sait joindre une
 * pièce, et il n'y a pas de serveur à qui la confier.
 */
el('fb-download').onclick = () => {
  const rapport = rapportCourant();
  if (!rapport) return;
  const blob = new Blob([JSON.stringify(rapport, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = `quiet-puzzle-${rapport.categorie}-${Date.now()}.json`;
  lien.click();
  URL.revokeObjectURL(url);
  screens.toast(t('feedback.downloaded'));
};

el('fb-mail').onclick = () => {
  const rapport = rapportCourant();
  if (!rapport) return;
  const sujet = `Quiet Puzzle — ${t(`feedback.cat.${rapport.categorie}`)}`;
  // Pas de destinataire codé en dur : le courrielleur s'ouvre sur un brouillon
  // que le joueur adresse à qui il veut. Inventer une adresse ici la rendrait
  // fausse le jour où elle change, et il n'y en a pas encore.
  window.location.href = `mailto:?subject=${encodeURIComponent(sujet)}`
    + `&body=${encodeURIComponent(feedback.enTexte(rapport))}`;
};

// ---------------------------------------------------------------------------
// Puzzle du jour
// ---------------------------------------------------------------------------

/**
 * Le bouton du menu. Il ne s'affiche QUE si une grille a été proposée : une
 * entrée qui mène à « rien pour l'instant » se lit comme une panne, alors que
 * son absence ne se remarque pas.
 */
async function majMenuPuzzleDuJour() {
  const bouton = el('btn-daily-puzzle');
  const propose = await api.getDailyPuzzle();
  bouton.hidden = !propose;
  if (!propose) return;
  const mien = dailyPuzzle.classement().find((e) => e.moi);
  el('daily-puzzle-sub').textContent = mien
    ? t('daily.done', { score: mien.score })
    : (propose.titre || t('daily.play'));
}

el('btn-daily-puzzle').onclick = async () => {
  const propose = await api.getDailyPuzzle();
  if (!propose) return;
  puzzleDuJour = propose;
  // Le puzzle du jour se joue au chrono : les limites du niveau proposé sont
  // celles que l'éditeur lui a données, on ne les resserre pas.
  level = { ...propose.niveau, levelId: `daily_${propose.id}`, number: 0,
            realm: propose.titre || t('daily.title'), difficulty: '' };
  startLevel();
  track('daily_puzzle_started', { id: propose.id });
};

el('btn-rank-close').onclick = () => { el('overlay-rank').hidden = true; };

// ---------------------------------------------------------------------------
// Boutique de pièces
// ---------------------------------------------------------------------------

/**
 * Deux façons d'obtenir des pièces, et il faut les présenter dans cet ordre :
 * la gratuite d'abord. Mettre les packs en tête ferait passer la pub
 * récompensée pour un lot de consolation, alors que c'est elle qui dépanne le
 * joueur au moment où il en a besoin.
 */
function majBoutique() {
  el('shop-solde').textContent = currency.solde();

  const restantes = currency.pubsRestantes();
  const bouton = el('btn-shop-ad');
  bouton.disabled = restantes <= 0;
  el('shop-ad-label').textContent = t('shop.ad', { n: currency.PUB_RECOMPENSE.PIECES });
  el('shop-ad-note').textContent = restantes > 0
    ? t('shop.ad.left', { n: restantes, total: currency.PUB_RECOMPENSE.PAR_JOUR })
    : t('shop.ad.none');

  el('shop-packs').replaceChildren(...currency.PACKS.map((pack) => {
    const carte = document.createElement('button');
    carte.className = 'shop-pack';
    const total = Math.round(pack.pieces * (1 + pack.bonus / 100));

    const montant = document.createElement('b');
    montant.textContent = total;
    const bonus = document.createElement('small');
    bonus.className = 'shop-pack-bonus';
    bonus.textContent = pack.bonus ? t('shop.pack.bonus', { n: pack.bonus }) : '';
    const prix = document.createElement('span');
    prix.className = 'shop-pack-prix';
    prix.textContent = pack.prix;

    carte.append(montant, bonus, prix);
    carte.onclick = () => {
      const verse = currency.acheterPack(pack.id);
      majBoutique();
      majMenu();
      screens.toast(t('shop.bought', { n: verse }));
    };
    return carte;
  }));
}

/** Rafraîchit les compteurs du menu sans le reconstruire entièrement. */
function majMenu() {
  el('menu-coins').textContent = currency.solde();
}

el('btn-shop').onclick = () => {
  majBoutique();
  el('overlay-shop').hidden = false;
  track('shop_opened', { solde: currency.solde() });
};

el('btn-shop-close').onclick = () => { el('overlay-shop').hidden = true; };

el('btn-shop-ad').onclick = async () => {
  if (currency.pubsRestantes() <= 0) return;
  const vue = await ads.montrerRecompensee(PLACEMENT.RECOMPENSE_PIECES);
  if (!vue) { screens.toast(t('shop.ad.failed')); return; }
  // Le crédit passe par `currency` : c'est lui qui tient le compteur du jour,
  // et le verser ici le contournerait.
  const gagne = currency.crediterPub();
  majBoutique();
  majMenu();
  screens.toast(t('shop.earned', { n: gagne }));
};

/** Affiche le classement du jour, avec sa place mise en avant. */
function montrerClassement(monScore) {
  const liste = dailyPuzzle.classement();
  const moi = liste.find((e) => e.moi);
  el('rank-mine').textContent = moi
    ? `${t('daily.score', { score: monScore ?? moi.score })} · ${t('daily.rank', { rang: moi.rang, total: liste.length })}`
    : '';
  el('rank-list').replaceChildren(...liste.slice(0, 10).map((e) => {
    const li = document.createElement('li');
    if (e.moi) li.className = 'moi';
    const qui = document.createElement('span');
    qui.textContent = e.moi ? t('daily.rank.me') : e.auteur;
    const pts = document.createElement('b');
    pts.textContent = e.score;
    li.append(qui, pts);
    return li;
  }));
  if (!liste.length) el('rank-list').textContent = t('daily.rank.empty');
  el('overlay-rank').hidden = false;
}

el('opt-noads').onchange = (ev) => {
  currency.definirSuppressionPubs(ev.target.checked);
  majBanniere(screens.current());
  screens.toast(t(ev.target.checked ? 'toast.ads.off' : 'toast.ads.on'));
};

el('btn-reset').onclick = () => {
  if (!confirm(t('user.reset.confirm'))) return;
  store.reset();
  // Réappliquer les préférences remises à zéro, puis revenir au menu. On ne
  // relance PAS la séquence de démarrage : elle réenregistrait un écouteur
  // `pagehide` de plus à chaque effacement, et chacun émettait ensuite son
  // propre évènement de fin de session.
  const remis = store.load();
  audio.definirMusique(remis.musique !== false);
  audio.definirEffets(remis.effets !== false);
  daily.ouvrirSession();
  showMenu();
};
document.querySelectorAll('[data-nav]').forEach((b) => {
  b.onclick = () => (b.dataset.nav === 'menu' ? showMenu() : showMap());
});

// Le chrono ne doit pas continuer de tourner pendant que l'app est en fond.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopChrono();
  else if (board && board.gameState === GameState.PLAYING && screens.current() === 'game') startChrono();
});

// ---------------------------------------------------------------------------
// Panneau QA
// ---------------------------------------------------------------------------

el('debug-toggle').onclick = () => {
  const p = el('debug-panel');
  p.hidden = !p.hidden;
  if (!p.hidden) refreshDebug();
};

el('debug-go').onclick = async () => {
  const n = Math.min(levels.totalLevels(), Math.max(1, Number(el('debug-level').value) || 1));
  await showBrief(n);
  startLevel();
};

el('debug-win').onclick = async () => {
  if (!board || board.gameState !== GameState.PLAYING) return;
  for (const b of [...board.blocks.values()]) if (b.kind !== KIND.WALL) board.blocks.delete(b.id);
  board._reindex();
  board.gameState = GameState.WON;
  hud.update(board);
  await finishLevel();
};

el('debug-lose').onclick = async () => {
  if (!board || board.gameState !== GameState.PLAYING) return;
  board.timeRemaining = 0;
  board.gameState = GameState.FAILED;
  board.failReason = 'temps';
  hud.update(board);
  await finishLevel();
};

/** Rejoue la solution de référence du niveau — contrôle visuel du générateur. */
el('debug-solve').onclick = async () => {
  if (!board || busy) return;
  busy = true;
  input.locked = true;
  for (const etape of level.solution) {
    for (const pos of etape.chemin.slice(1)) {
      const { events } = board.dragTowards(etape.id, pos.x, pos.y);
      await view.apply(events);
      await new Promise((r) => setTimeout(r, 90));
    }
    if (board.blocks.has(etape.id)) {
      const [dx, dy] = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[etape.gate];
      const r = board.step(etape.id, dx, dy);
      if (r.ok) await view.apply([r.event]);
    }
    await view.apply(board.endGesture(true));
    hud.update(board);
  }
  busy = false;
  input.locked = false;
  if (board.gameState !== GameState.PLAYING) await finishLevel();
};

let rapide = false;
el('debug-speed').onclick = () => {
  rapide = !rapide;
  setSpeed(rapide ? 0.2 : 1);
  el('debug-speed').textContent = rapide ? 'Animations ×1' : 'Animations ×5';
};

el('debug-noads').onclick = () => {
  const actif = !currency.aSupprimeLesPubs();
  currency.definirSuppressionPubs(actif);
  el('debug-noads').textContent = actif ? 'Désactiver sans-pub' : 'Activer sans-pub';
  screens.toast(t(actif ? 'toast.ads.off' : 'toast.ads.on'));
  majBanniere(screens.current());
  if (!el('user-panel').hidden) majPanneau();
};

el('debug-coins').onclick = () => {
  currency.crediter(500, 'debug');
  screens.toast(t('toast.coins', { n: currency.solde() }));
  majBonus();
  refreshDebug();
};

el('debug-events').onclick = () => {
  const liste = el('debug-events-list');
  liste.hidden = !liste.hidden;
  if (!liste.hidden) majJournal();
};

function majJournal() {
  const liste = el('debug-events-list');
  if (liste.hidden) return;
  liste.replaceChildren(...recent(25).map((e) => {
    const li = document.createElement('li');
    const nom = document.createElement('b');
    nom.textContent = e.eventName;
    li.append(nom, ' ', JSON.stringify(e.eventData));
    return li;
  }));
}
subscribe(() => majJournal());

el('debug-unlock').onclick = () => {
  const d = store.load();
  d.unlockedLevel = levels.totalLevels();
  store.save(d);
  screens.toast(t('toast.unlocked'));
  refreshDebug();
};

/** Crochet de debug : accès au plateau depuis la console. Prototype seulement. */
window.__game = {
  get board() { return board; },
  get view() { return view; },
  get input() { return input; },
  get audio() { return audio; },
  finirPourCapture: () => (board?.gameState !== GameState.PLAYING ? finishLevel() : null),
  get level() { return level; },
  get busy() { return busy; },
};

function refreshDebug() {
  const d = store.load();
  el('debug-info').textContent =
    `débloqué : ${d.unlockedLevel}/${levels.totalLevels()} · ★ ${store.totalStars()} · ${d.coins} pièces`
    + (board ? `\nplateau ${board.W}×${board.H} · ${board.remaining()} blocs · réf. ${level.minDrags} glissés` : '');
}

// Son : on restaure les préférences avant tout affichage.
{
  const d = store.load();
  audio.definirMusique(d.musique !== false);
  audio.definirEffets(d.effets !== false);
}

/**
 * Démarrage : la BASE DE NIVEAUX D'ABORD.
 *
 * Rien ne peut s'afficher avant elle — le menu compte les niveaux, la carte
 * dessine les mondes, le thème lit leur palette. Tout cela se lit ensuite de
 * façon synchrone ; cet `await` est le seul endroit du jeu qui attend la base.
 */
(async () => {
  // La langue d'abord : tout ce qui suit écrit du texte à l'écran.
  i18n.initialiser();
  appliquerGlyphes(store.load().glyphes === true);
  try {
    await levels.ouvrir();
    // Le champ « aller au niveau » suit le total de la base. Codé en dur dans
    // le markup, il plafonnait la saisie et rendait les niveaux ajoutés
    // inatteignables depuis le panneau — et il ne peut être réglé qu'ICI, la
    // base seule sachant combien de niveaux elle contient.
    el('debug-level').max = levels.totalLevels();
  } catch (e) {
    // Sans base, il n'y a pas de jeu : mieux vaut le dire que d'afficher un
    // menu vide dont aucun bouton ne répondrait.
    document.getElementById('app').innerHTML =
      `<div class="boot-error"><h1>${t('boot.missing')}</h1>`
      + `<p>${t('boot.hint', { cmd: '<code>node tools/build-levels.mjs</code>' })}</p></div>`;
    console.error(e);
    return;
  }

  // Série quotidienne, puis menu.
  daily.ouvrirSession();
  window.addEventListener('pagehide', () => track('session_ended', {}));
  showMenu();
})();
