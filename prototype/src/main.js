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
import { TOTAL_LEVELS } from './core/levels.js';
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
import { track, recent, subscribe } from './data/events.js';
import { AudioManager } from './audio/audioManager.js';

const el = (id) => document.getElementById(id);

let view = null;
let input = null;
let board = null;
let level = null;
let chrono = null;
let busy = false;
let offreUtilisee = false;   // l'offre de continuation ne vaut qu'une fois par tentative
let echecsDuNiveau = 0;      // sert à ne pas couper la toute première défaite par une pub
let debutNiveau = 0;
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
  el('menu-progress').textContent = p.currentLevel;
  majCadeauDuJour();
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
  el('daily-title').textContent = 'Cadeau du jour';
  el('daily-sub').textContent = `Série de ${daily.serie()} jour${daily.serie() > 1 ? 's' : ''}`;
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
  el('brief-realm').textContent = level.realm;
  el('brief-number').textContent = n;
  screens.renderStars(el('brief-stars'), rec.stars);
  el('brief-objective').textContent = hud.labelFor(level);
  el('brief-moves').textContent = level.moveLimit;
  el('brief-difficulty').textContent = level.difficulty;
  el('brief-best').textContent = rec.bestScore ? `${rec.bestScore} coups` : '—';
  theme.appliquer(n);
  screens.show('brief');
  majBanniere('brief');
}

// ---------------------------------------------------------------------------
// Partie
// ---------------------------------------------------------------------------

function startLevel() {
  result.hide();
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
  if (b.kind === KIND.WALL) screens.toast('Ce bloc est scellé');
  else if (b.kind === KIND.LOCKED) screens.toast(`Verrouillé : ${conditionLabel(b.condition)}`);
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
  if (won) audio.victoire();
  const duree = Math.round((Date.now() - debutNiveau) / 1000);

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
  const res = await api.completeLevel(level.number, { score: board.dragsUsed(), stars, failed: !won });

  // Une interstitielle à la fin d'un niveau, si et seulement si la politique
  // de cadencement l'autorise (adPolicy.js).
  ads.policy.noterFinDeNiveau();
  await ads.montrerInterstitiel({
    niveau: level.number,
    noAds: currency.aSupprimeLesPubs(),
    premiereDefaiteDuNiveau: !won && echecsDuNiveau === 1,
  });

  result.show({
    won,
    stars,
    score: board.dragsUsed(),
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
      if (level.number < TOTAL_LEVELS) { await showBrief(level.number + 1); startLevel(); }
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
  screens.toast(`+${montant} pièces — série de ${daily.serie()} jours`);
  // Son : on restaure la préférence avant tout affichage.
audio.definirActif(store.load().son !== false);
majBoutonSon();

// Série quotidienne, puis menu.
daily.ouvrirSession();
window.addEventListener('pagehide', () => track('session_ended', {}));
showMenu();
};

el('btn-restart').onclick = () => { if (!busy) startLevel(); };

/** Marteau : le joueur DESIGNE le bloc à retirer, on n'en choisit pas un pour lui. */
el('btn-hammer').onclick = async () => {
  if (!board || busy || board.gameState !== GameState.PLAYING || modeMarteau) return;
  if (!await bonusParPub(PLACEMENT.RECOMPENSE_MARTEAU)) return;
  modeMarteau = true;
  input.locked = true;
  el('app').classList.add('hammer');
  screens.toast('Touchez le bloc à retirer');

  const viser = async (ev) => {
    const id = view.blockIdFromPoint(ev.clientX, ev.clientY);
    const cible = id !== null ? board.blocks.get(id) : null;
    if (!cible || cible.kind === 'wall') { screens.toast('Choisissez un bloc déplaçable'); return; }
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
  screens.toast('+30 secondes');
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
  screens.toast('Geste annulé');
};

/**
 * Indice : on désigne le prochain bloc jouable, on ne le joue pas. Payant en
 * pièces, ou par pub récompensée quand le joueur est fauché.
 */
el('btn-hint').onclick = async () => {
  if (!board || busy || board.gameState !== GameState.PLAYING) return;
  const conseil = board.hint();
  if (!conseil) { screens.toast('Aucun coup gagnant trouvé'); return; }

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
el('btn-sound').onclick = () => {
  const actif = !audio.sonActif;
  audio.definirActif(actif);
  const d = store.load();
  d.son = actif;
  store.save(d);
  majBoutonSon();
  if (actif) audio.lancerMusique();
  track('sound_toggled', { actif });
};

function majBoutonSon() {
  const b = el('btn-sound');
  b.textContent = audio.sonActif ? '🔊 Son' : '🔇 Son';
  b.classList.toggle('muet', !audio.sonActif);
}

el('btn-reset').onclick = () => {
  if (!confirm('Effacer toute la progression ?')) return;
  store.reset();
  // Son : on restaure la préférence avant tout affichage.
audio.definirActif(store.load().son !== false);
majBoutonSon();

// Série quotidienne, puis menu.
daily.ouvrirSession();
window.addEventListener('pagehide', () => track('session_ended', {}));
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
  const n = Math.min(TOTAL_LEVELS, Math.max(1, Number(el('debug-level').value) || 1));
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
  screens.toast(actif ? 'Pubs supprimées (achat simulé)' : 'Pubs réactivées');
  majBanniere(screens.current());
};

el('debug-coins').onclick = () => {
  currency.crediter(500, 'debug');
  screens.toast(`${currency.solde()} pièces`);
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

el('debug-editor').onclick = () => {
  el('debug-panel').hidden = true;
  editor.init({
    onTest: (niveau) => { level = niveau; startLevel(); },
  });
  screens.show('editor');
  majBanniere('editor');
};

el('debug-unlock').onclick = () => {
  const d = store.load();
  d.unlockedLevel = TOTAL_LEVELS;
  store.save(d);
  screens.toast('Tous les niveaux débloqués');
  refreshDebug();
};

/** Crochet de debug : accès au plateau depuis la console. Prototype seulement. */
window.__game = {
  get board() { return board; },
  get view() { return view; },
  get input() { return input; },
  get audio() { return audio; },
  get level() { return level; },
  get busy() { return busy; },
};

function refreshDebug() {
  const d = store.load();
  el('debug-info').textContent =
    `débloqué : ${d.unlockedLevel}/${TOTAL_LEVELS} · ★ ${store.totalStars()} · ${d.coins} pièces`
    + (board ? `\nplateau ${board.W}×${board.H} · ${board.remaining()} blocs · réf. ${level.minDrags} glissés` : '');
}

// Son : on restaure la préférence avant tout affichage.
audio.definirActif(store.load().son !== false);
majBoutonSon();

// Série quotidienne, puis menu.
daily.ouvrirSession();
window.addEventListener('pagehide', () => track('session_ended', {}));
showMenu();
