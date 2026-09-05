/**
 * Traduction de l'interface.
 *
 * Un dictionnaire plat, une clé par phrase. Le markup porte des attributs
 * `data-i18n` que `appliquer()` remplit, et le code appelle `t()` pour tout ce
 * qui se construit à l'exécution.
 *
 * La langue par défaut est celle du navigateur quand elle est connue, et le
 * français sinon. Elle n'est ENREGISTRÉE qu'au moment où le joueur en choisit
 * une : sans cette distinction, le premier chargement figerait pour toujours la
 * langue de la machine sur laquelle le jeu a été ouvert.
 */

import * as store from '../data/save.js';

export const LANGUES = [
  { code: 'fr', nom: 'Français' },
  { code: 'en', nom: 'English' },
];

const TEXTES = {
  fr: {
    'menu.baseline': 'Videz la grille par les portes de couleur',
    'menu.stars': 'étoiles', 'menu.coins': 'pièces', 'menu.level': 'niveaux',
    'menu.play': 'Jouer', 'menu.daily': 'Cadeau du jour',
    'menu.streak': 'Série de {n} jour', 'menu.streak.plural': 'Série de {n} jours',

    'map.title': 'Carte',

    'brief.objective': 'Faire sortir les {n} blocs',
    'brief.moves': 'Coups', 'brief.difficulty': 'Difficulté', 'brief.record': 'Record',
    'brief.new': 'Nouveau : {quoi}', 'brief.start': 'Jouer',

    'hud.time': 'Temps', 'hud.blocks': 'Blocs', 'hud.stars': 'Étoiles',
    'hud.moves': '{n} coups',

    'result.won': 'Grille vidée !', 'result.timeout.title': 'Temps écoulé',
    'result.nomoves.title': 'Plus de coups',
    'result.reward': '+{n} pièces',
    'result.timeout.sub': 'Le chrono est tombé avant la fin',
    'result.nomoves.sub': 'Il ne restait plus de coups',
    'result.near.one': 'Il ne restait qu’un seul bloc !',
    'result.near': 'Il ne restait que {n} blocs !',
    'result.done': 'Niveau terminé', 'result.next': 'Suivant',
    'result.retry': 'Rejouer', 'result.map': 'Carte',
    'result.timeout': 'Le temps est écoulé', 'result.nomoves': 'Il ne reste que ',
    'result.continue': 'Continuez avec ',

    'user.title': 'Profil et réglages', 'user.close': 'Fermer',
    'user.level': 'Niveau', 'user.stars': 'Étoiles', 'user.levels': 'Niveaux',
    'user.coins': 'Pièces',
    'user.sound': 'Son', 'user.music': 'Musique', 'user.sfx': 'Effets sonores',
    'user.display': 'Affichage', 'user.glyphs': 'Symboles sur les blocs',
    'user.glyphs.note': 'Ajoute un symbole à chaque couleur, pour ne pas avoir à s’y fier.',
    'user.language': 'Langue',
    'user.ads': 'Publicité', 'user.noads': 'Supprimer les pubs',
    'user.ads.note': 'Achat simulé — aucune régie n’est branchée.',
    'user.reset': 'Réinitialiser la progression',
    'user.reset.confirm': 'Effacer toute la progression ?',

    'action.hint': 'Indice', 'action.hammer': 'Marteau',
    'action.time': 'Temps', 'action.undo': 'Annuler', 'action.giveup': 'Abandonner',

    'toast.sealed': 'Ce bloc est scellé',
    'toast.locked': 'Verrouillé : {quoi}',
    'toast.daily': '+{n} pièces — série de {jours} jours',
    'toast.hammer.pick': 'Touchez le bloc à retirer',
    'toast.hammer.bad': 'Choisissez un bloc déplaçable',
    'toast.time': '+30 secondes',
    'toast.undo': 'Geste annulé',
    'toast.nohint': 'Aucun coup gagnant trouvé',
    'toast.coins': '{n} pièces',
    'toast.unlocked': 'Tous les niveaux débloqués',
    'toast.ads.off': 'Pubs supprimées (achat simulé)',
    'toast.ads.on': 'Pubs réactivées',

    'offer.timeout': 'Le temps est écoulé', 'offer.nomoves': 'Plus aucun coup',
    'offer.lead': 'Il ne reste que', 'offer.lead.end': 'blocs à sortir.',
    'offer.continue': 'Continuez avec', 'offer.bonus': '+{s} s et +{c} coups',

    'lock.open': 'Ouvert', 'lock.remaining': 'Encore {n}',
    'gate.exit': 'Sortie {couleur}',

    'boot.missing': 'Base de niveaux introuvable',
    'boot.hint': 'Lancer {cmd}, puis recharger.',

    'color.0': 'Rubis', 'color.1': 'Saphir', 'color.2': 'Émeraude',
    'color.3': 'Ambre', 'color.4': 'Améthyste', 'color.5': 'Topaze',
  },

  en: {
    'menu.baseline': 'Clear the grid through the coloured gates',
    'menu.stars': 'stars', 'menu.coins': 'coins', 'menu.level': 'levels',
    'menu.play': 'Play', 'menu.daily': 'Daily gift',
    'menu.streak': '{n} day streak', 'menu.streak.plural': '{n} day streak',

    'map.title': 'Map',

    'brief.objective': 'Clear all {n} blocks',
    'brief.moves': 'Moves', 'brief.difficulty': 'Difficulty', 'brief.record': 'Best',
    'brief.new': 'New: {quoi}', 'brief.start': 'Play',

    'hud.time': 'Time', 'hud.blocks': 'Blocks', 'hud.stars': 'Stars',
    'hud.moves': '{n} moves',

    'result.won': 'Grid cleared!', 'result.timeout.title': 'Out of time',
    'result.nomoves.title': 'Out of moves',
    'result.reward': '+{n} coins',
    'result.timeout.sub': 'The clock ran out first',
    'result.nomoves.sub': 'No moves left',
    'result.near.one': 'Just one block left!',
    'result.near': 'Only {n} blocks left!',
    'result.done': 'Level complete', 'result.next': 'Next',
    'result.retry': 'Replay', 'result.map': 'Map',
    'result.timeout': 'Time is up', 'result.nomoves': 'Only ',
    'result.continue': 'Carry on with ',

    'user.title': 'Profile and settings', 'user.close': 'Close',
    'user.level': 'Level', 'user.stars': 'Stars', 'user.levels': 'Levels',
    'user.coins': 'Coins',
    'user.sound': 'Sound', 'user.music': 'Music', 'user.sfx': 'Sound effects',
    'user.display': 'Display', 'user.glyphs': 'Symbols on blocks',
    'user.glyphs.note': 'Gives every colour its own symbol, so you never have to rely on hue.',
    'user.language': 'Language',
    'user.ads': 'Advertising', 'user.noads': 'Remove ads',
    'user.ads.note': 'Simulated purchase — no ad network is wired in.',
    'user.reset': 'Reset progress',
    'user.reset.confirm': 'Erase all progress?',

    'action.hint': 'Hint', 'action.hammer': 'Hammer',
    'action.time': 'Time', 'action.undo': 'Undo', 'action.giveup': 'Give up',

    'toast.sealed': 'This block is sealed',
    'toast.locked': 'Locked: {quoi}',
    'toast.daily': '+{n} coins — {jours} day streak',
    'toast.hammer.pick': 'Tap the block to remove',
    'toast.hammer.bad': 'Pick a block that can move',
    'toast.time': '+30 seconds',
    'toast.undo': 'Move undone',
    'toast.nohint': 'No winning move found',
    'toast.coins': '{n} coins',
    'toast.unlocked': 'All levels unlocked',
    'toast.ads.off': 'Ads removed (simulated purchase)',
    'toast.ads.on': 'Ads back on',

    'offer.timeout': 'Time is up', 'offer.nomoves': 'No moves left',
    'offer.lead': 'Only', 'offer.lead.end': 'blocks left to clear.',
    'offer.continue': 'Carry on with', 'offer.bonus': '+{s}s and +{c} moves',

    'lock.open': 'Open', 'lock.remaining': '{n} to go',
    'gate.exit': '{couleur} exit',

    'boot.missing': 'Level database not found',
    'boot.hint': 'Run {cmd}, then reload.',

    'color.0': 'Ruby', 'color.1': 'Sapphire', 'color.2': 'Emerald',
    'color.3': 'Amber', 'color.4': 'Amethyst', 'color.5': 'Topaz',
  },
};

const DEFAUT = 'fr';

/** Langue du navigateur, si le jeu la parle. */
function langueDuNavigateur() {
  const codes = typeof navigator === 'undefined' ? [] : (navigator.languages || [navigator.language || '']);
  for (const brut of codes) {
    const code = String(brut).slice(0, 2).toLowerCase();
    if (TEXTES[code]) return code;
  }
  return DEFAUT;
}

let courante = DEFAUT;

export const langue = () => courante;

/**
 * Traduit une clé, en substituant `{nom}` par les valeurs passées.
 *
 * Une clé absente est rendue telle quelle plutôt que remplacée par du vide :
 * une phrase manquante doit se voir en jeu, pas disparaître silencieusement.
 */
export function t(cle, params = {}) {
  const brut = TEXTES[courante]?.[cle] ?? TEXTES[DEFAUT][cle] ?? cle;
  return brut.replace(/\{(\w+)\}/g, (_, nom) => (params[nom] ?? `{${nom}}`));
}

/** Nom d'une famille de couleur. */
export const nomCouleur = (id) => t(`color.${id}`);

/**
 * Texte d'un monde dans la langue courante. Le catalogue transporte les deux
 * versions ; l'anglais retombe sur le français si un monde n'a pas été traduit,
 * plutôt que d'afficher une case vide.
 */
export function texteMonde(monde, champ) {
  if (!monde) return '';
  if (courante === 'en') return monde[`${champ}En`] || monde[champ] || '';
  return monde[champ] || '';
}

/**
 * Remplit le markup. Trois attributs, selon l'endroit où le texte atterrit :
 * `data-i18n` pour le contenu, `data-i18n-title` pour l'infobulle,
 * `data-i18n-aria` pour le nom accessible.
 */
export function appliquer(racine = (typeof document === 'undefined' ? null : document)) {
  // Sans DOM — sous Node, dans les tests — il n'y a rien à remplir, et le
  // dictionnaire reste vérifiable pour autant.
  if (!racine) return;
  for (const el of racine.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of racine.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of racine.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
  if (typeof document !== 'undefined') document.documentElement.lang = courante;
}

/** Choix explicite du joueur : enregistré, et appliqué à tout le markup. */
export function definirLangue(code) {
  if (!TEXTES[code]) return;
  courante = code;
  const d = store.load();
  d.langue = code;
  store.save(d);
  appliquer();
}

/** Au démarrage : le choix enregistré, ou la langue du navigateur. */
export function initialiser() {
  courante = store.load().langue || langueDuNavigateur();
  appliquer();
  return courante;
}
