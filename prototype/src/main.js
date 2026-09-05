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

function startLevel() {
  ouvrirPanneau(false);
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
