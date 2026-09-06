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
  { code: 'es', nom: 'Español' },
  { code: 'it', nom: 'Italiano' },
  { code: 'zh', nom: '中文' },
];

const TEXTES = {
  fr: {
    'editor.trying': 'Essai',
    'result.time': 'en {temps}',
    'editor.mine': 'Mes niveaux', 'editor.mine.empty': 'Aucune grille enregistrée pour l’instant',
    'editor.untitled': 'Sans titre', 'editor.blocks': '{n} blocs',
    'editor.proposed': 'proposé', 'editor.loaded': 'Grille chargée',
    'editor.delete': 'Supprimer', 'editor.edit': 'Modifier',
    'editor.submit.short': 'Proposer',
    'shop.title': 'Pièces',
    'shop.ad': 'Regarder une pub · +{n} pièces',
    'shop.ad.left': 'Encore {n} sur {total} aujourd’hui',
    'shop.ad.none': 'Revenez demain pour d’autres pubs',
    'shop.ad.failed': 'Pub indisponible pour l’instant',
    'shop.earned': '+{n} pièces',
    'shop.pack.bonus': '+{n} % offert',
    'shop.buy': 'Acheter',
    'shop.simulated': 'Achats simulés — aucun système de paiement n’est branché.',
    'shop.bought': '+{n} pièces créditées (achat simulé)',
    'user.create': 'Créer', 'user.editor': 'Éditeur de niveaux',
    'user.editor.note': 'Dessinez une grille, vérifiez-la, proposez-la comme puzzle du jour.',
    'editor.submit': 'Proposer comme puzzle du jour',
    'editor.submit.ask': 'Un nom pour votre puzzle ?',
    'editor.submit.ok': 'Puzzle proposé — il peut sortir un de ces jours',
    'editor.submit.unsolved': 'Vérifiez d’abord que la grille se résout',
    'daily.title': 'Puzzle du jour', 'daily.by': 'par {auteur}',
    'daily.none': 'Aucun puzzle proposé — dessinez le premier',
    'daily.done': 'Déjà joué aujourd’hui · {score} pts',
    'daily.play': 'À vous de jouer',
    'daily.score': 'Score : {score}', 'daily.rank': 'Rang {rang} sur {total}',
    'daily.rank.title': 'Classement du jour',
    'daily.rank.note': 'Ce classement est local à cet appareil : le prototype n’a pas de serveur où envoyer les scores.',
    'daily.rank.empty': 'Personne n’a encore joué aujourd’hui',
    'daily.rank.me': 'vous',
    'app.title': 'Quiet Puzzle — un casse-tête pour décompresser',
    'map.next': 'Suivant',
    'result.drags': 'glissés', 'result.double': 'Doubler les pièces',

    'ad.tag': 'Emplacement publicitaire', 'ad.banner': 'Emplacement bannière 320×50',
    'ad.title': 'Publicité', 'ad.title.rewarded': 'Publicité récompensée',
    'ad.note': 'Emplacement simulé — aucun réseau publicitaire n’est branché',
    'ad.note.rewarded': 'Regardez jusqu’au bout pour recevoir la récompense',
    'ad.close': 'Fermer', 'ad.claim': 'Récupérer la récompense',
    'ad.skip': 'Passer (sans récompense)', 'ad.badge': 'Pub',
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
    'editor.trying': 'Test run',
    'result.time': 'in {temps}',
    'editor.mine': 'My levels', 'editor.mine.empty': 'No grid saved yet',
    'editor.untitled': 'Untitled', 'editor.blocks': '{n} blocks',
    'editor.proposed': 'submitted', 'editor.loaded': 'Grid loaded',
    'editor.delete': 'Delete', 'editor.edit': 'Edit',
    'editor.submit.short': 'Submit',
    'shop.title': 'Coins',
    'shop.ad': 'Watch an ad · +{n} coins',
    'shop.ad.left': '{n} of {total} left today',
    'shop.ad.none': 'Come back tomorrow for more ads',
    'shop.ad.failed': 'No ad available right now',
    'shop.earned': '+{n} coins',
    'shop.pack.bonus': '+{n}% free',
    'shop.buy': 'Buy',
    'shop.simulated': 'Simulated purchases — no payment system is wired in.',
    'shop.bought': '+{n} coins credited (simulated purchase)',
    'user.create': 'Create', 'user.editor': 'Level editor',
    'user.editor.note': 'Draw a grid, check it, submit it as the daily puzzle.',
    'editor.submit': 'Submit as daily puzzle',
    'editor.submit.ask': 'A name for your puzzle?',
    'editor.submit.ok': 'Puzzle submitted — it may come up one of these days',
    'editor.submit.unsolved': 'Check the grid solves first',
    'daily.title': 'Daily puzzle', 'daily.by': 'by {auteur}',
    'daily.none': 'No puzzle submitted yet — draw the first one',
    'daily.done': 'Already played today · {score} pts',
    'daily.play': 'Your turn',
    'daily.score': 'Score: {score}', 'daily.rank': 'Rank {rang} of {total}',
    'daily.rank.title': 'Today’s leaderboard',
    'daily.rank.note': 'This leaderboard is local to this device: the prototype has no server to send scores to.',
    'daily.rank.empty': 'Nobody has played yet today',
    'daily.rank.me': 'you',
    'app.title': 'Quiet Puzzle — a puzzle to unwind with',
    'map.next': 'Next',
    'result.drags': 'drags', 'result.double': 'Double the coins',

    'ad.tag': 'Ad placement', 'ad.banner': '320×50 banner placement',
    'ad.title': 'Advertisement', 'ad.title.rewarded': 'Rewarded ad',
    'ad.note': 'Simulated placement — no ad network is wired in',
    'ad.note.rewarded': 'Watch to the end to claim the reward',
    'ad.close': 'Close', 'ad.claim': 'Claim the reward',
    'ad.skip': 'Skip (no reward)', 'ad.badge': 'Ad',
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

  es: {
    'editor.trying': 'Prueba',
    'result.time': 'en {temps}',
    'editor.mine': 'Mis niveles', 'editor.mine.empty': 'Aún no hay cuadrículas guardadas',
    'editor.untitled': 'Sin título', 'editor.blocks': '{n} bloques',
    'editor.proposed': 'propuesto', 'editor.loaded': 'Cuadrícula cargada',
    'editor.delete': 'Eliminar', 'editor.edit': 'Modificar',
    'editor.submit.short': 'Proponer',
    'shop.title': 'Monedas',
    'shop.ad': 'Ver un anuncio · +{n} monedas',
    'shop.ad.left': 'Quedan {n} de {total} hoy',
    'shop.ad.none': 'Vuelve mañana para más anuncios',
    'shop.ad.failed': 'No hay anuncios disponibles ahora mismo',
    'shop.earned': '+{n} monedas',
    'shop.pack.bonus': '+{n} % de regalo',
    'shop.buy': 'Comprar',
    'shop.simulated': 'Compras simuladas — no hay ningún sistema de pago conectado.',
    'shop.bought': '+{n} monedas acreditadas (compra simulada)',
    'user.create': 'Crear', 'user.editor': 'Editor de niveles',
    'user.editor.note': 'Dibuja una cuadrícula, compruébala y propónla como puzle del día.',
    'editor.submit': 'Proponer como puzle del día',
    'editor.submit.ask': '¿Un nombre para tu puzle?',
    'editor.submit.ok': 'Puzle propuesto — puede salir cualquier día',
    'editor.submit.unsolved': 'Comprueba primero que la cuadrícula se resuelve',
    'daily.title': 'Puzle del día', 'daily.by': 'de {auteur}',
    'daily.none': 'Aún no hay puzles propuestos — dibuja el primero',
    'daily.done': 'Ya jugado hoy · {score} pts',
    'daily.play': 'Te toca',
    'daily.score': 'Puntuación: {score}', 'daily.rank': 'Puesto {rang} de {total}',
    'daily.rank.title': 'Clasificación de hoy',
    'daily.rank.note': 'Esta clasificación es local a este dispositivo: el prototipo no tiene servidor al que enviar las puntuaciones.',
    'daily.rank.empty': 'Nadie ha jugado todavía hoy',
    'daily.rank.me': 'tú',
    'app.title': 'Quiet Puzzle — un rompecabezas para desconectar',
    'map.next': 'Siguiente',
    'result.drags': 'arrastres', 'result.double': 'Duplicar las monedas',

    'ad.tag': 'Espacio publicitario', 'ad.banner': 'Espacio de banner 320×50',
    'ad.title': 'Publicidad', 'ad.title.rewarded': 'Anuncio recompensado',
    'ad.note': 'Espacio simulado — no hay ninguna red publicitaria conectada',
    'ad.note.rewarded': 'Míralo hasta el final para recibir la recompensa',
    'ad.close': 'Cerrar', 'ad.claim': 'Recoger la recompensa',
    'ad.skip': 'Saltar (sin recompensa)', 'ad.badge': 'Anuncio',
    'menu.baseline': 'Vacía la cuadrícula por las puertas de color',
    'menu.stars': 'estrellas', 'menu.coins': 'monedas', 'menu.level': 'niveles',
    'menu.play': 'Jugar', 'menu.daily': 'Regalo del día',
    'menu.streak': 'Racha de {n} día', 'menu.streak.plural': 'Racha de {n} días',

    'map.title': 'Mapa',

    'brief.objective': 'Saca los {n} bloques',
    'brief.moves': 'Movimientos', 'brief.difficulty': 'Dificultad', 'brief.record': 'Récord',
    'brief.new': 'Nuevo: {quoi}', 'brief.start': 'Jugar',

    'hud.time': 'Tiempo', 'hud.blocks': 'Bloques', 'hud.stars': 'Estrellas',
    'hud.moves': '{n} movimientos',

    'result.won': '¡Cuadrícula vacía!', 'result.timeout.title': 'Se acabó el tiempo',
    'result.nomoves.title': 'Sin movimientos',
    'result.reward': '+{n} monedas',
    'result.timeout.sub': 'El cronómetro llegó antes que tú',
    'result.nomoves.sub': 'No quedaban movimientos',
    'result.near.one': '¡Quedaba un solo bloque!',
    'result.near': '¡Solo quedaban {n} bloques!',
    'result.done': 'Nivel completado', 'result.next': 'Siguiente',
    'result.retry': 'Repetir', 'result.map': 'Mapa',
    'result.timeout': 'Se acabó el tiempo', 'result.nomoves': 'Solo ',
    'result.continue': 'Sigue con ',

    'user.title': 'Perfil y ajustes', 'user.close': 'Cerrar',
    'user.level': 'Nivel', 'user.stars': 'Estrellas', 'user.levels': 'Niveles',
    'user.coins': 'Monedas',
    'user.sound': 'Sonido', 'user.music': 'Música', 'user.sfx': 'Efectos de sonido',
    'user.display': 'Pantalla', 'user.glyphs': 'Símbolos en los bloques',
    'user.glyphs.note': 'Da un símbolo propio a cada color, para no depender del tono.',
    'user.language': 'Idioma',
    'user.ads': 'Publicidad', 'user.noads': 'Quitar anuncios',
    'user.ads.note': 'Compra simulada — no hay ninguna red publicitaria conectada.',
    'user.reset': 'Reiniciar el progreso',
    'user.reset.confirm': '¿Borrar todo el progreso?',

    'action.hint': 'Pista', 'action.hammer': 'Martillo',
    'action.time': 'Tiempo', 'action.undo': 'Deshacer', 'action.giveup': 'Abandonar',

    'toast.sealed': 'Este bloque está sellado',
    'toast.locked': 'Bloqueado: {quoi}',
    'toast.daily': '+{n} monedas — racha de {jours} días',
    'toast.hammer.pick': 'Toca el bloque que quieras quitar',
    'toast.hammer.bad': 'Elige un bloque que pueda moverse',
    'toast.time': '+30 segundos',
    'toast.undo': 'Movimiento deshecho',
    'toast.nohint': 'No se encontró ninguna jugada ganadora',
    'toast.coins': '{n} monedas',
    'toast.unlocked': 'Todos los niveles desbloqueados',
    'toast.ads.off': 'Anuncios quitados (compra simulada)',
    'toast.ads.on': 'Anuncios reactivados',

    'offer.timeout': 'Se acabó el tiempo', 'offer.nomoves': 'Sin movimientos',
    'offer.lead': 'Solo quedan', 'offer.lead.end': 'bloques por sacar.',
    'offer.continue': 'Sigue con', 'offer.bonus': '+{s} s y +{c} movimientos',

    'lock.open': 'Abierto', 'lock.remaining': 'Faltan {n}',
    'gate.exit': 'Salida {couleur}',

    'boot.missing': 'No se encuentra la base de niveles',
    'boot.hint': 'Ejecuta {cmd} y vuelve a cargar.',

    'color.0': 'Rubí', 'color.1': 'Zafiro', 'color.2': 'Esmeralda',
    'color.3': 'Ámbar', 'color.4': 'Amatista', 'color.5': 'Topacio',
  },

  it: {
    'editor.trying': 'Prova',
    'result.time': 'in {temps}',
    'editor.mine': 'I miei livelli', 'editor.mine.empty': 'Nessuna griglia salvata per ora',
    'editor.untitled': 'Senza titolo', 'editor.blocks': '{n} blocchi',
    'editor.proposed': 'proposto', 'editor.loaded': 'Griglia caricata',
    'editor.delete': 'Elimina', 'editor.edit': 'Modifica',
    'editor.submit.short': 'Proponi',
    'shop.title': 'Monete',
    'shop.ad': 'Guarda un annuncio · +{n} monete',
    'shop.ad.left': 'Ne restano {n} su {total} oggi',
    'shop.ad.none': 'Torna domani per altri annunci',
    'shop.ad.failed': 'Nessun annuncio disponibile al momento',
    'shop.earned': '+{n} monete',
    'shop.pack.bonus': '+{n}% in regalo',
    'shop.buy': 'Acquista',
    'shop.simulated': 'Acquisti simulati — nessun sistema di pagamento è collegato.',
    'shop.bought': '+{n} monete accreditate (acquisto simulato)',
    'user.create': 'Creare', 'user.editor': 'Editor di livelli',
    'user.editor.note': 'Disegna una griglia, verificala, proponila come rompicapo del giorno.',
    'editor.submit': 'Proponi come rompicapo del giorno',
    'editor.submit.ask': 'Un nome per il tuo rompicapo?',
    'editor.submit.ok': 'Rompicapo proposto — potrebbe uscire un giorno di questi',
    'editor.submit.unsolved': 'Verifica prima che la griglia si risolva',
    'daily.title': 'Rompicapo del giorno', 'daily.by': 'di {auteur}',
    'daily.none': 'Nessun rompicapo proposto — disegna il primo',
    'daily.done': 'Già giocato oggi · {score} pt',
    'daily.play': 'Tocca a te',
    'daily.score': 'Punteggio: {score}', 'daily.rank': 'Posizione {rang} su {total}',
    'daily.rank.title': 'Classifica di oggi',
    'daily.rank.note': 'Questa classifica è locale a questo dispositivo: il prototipo non ha un server a cui inviare i punteggi.',
    'daily.rank.empty': 'Oggi non ha ancora giocato nessuno',
    'daily.rank.me': 'tu',
    'app.title': 'Quiet Puzzle — un rompicapo per staccare',
    'map.next': 'Avanti',
    'result.drags': 'trascinamenti', 'result.double': 'Raddoppia le monete',

    'ad.tag': 'Spazio pubblicitario', 'ad.banner': 'Spazio banner 320×50',
    'ad.title': 'Pubblicità', 'ad.title.rewarded': 'Annuncio con premio',
    'ad.note': 'Spazio simulato — nessun circuito pubblicitario è collegato',
    'ad.note.rewarded': 'Guardalo fino in fondo per ricevere il premio',
    'ad.close': 'Chiudi', 'ad.claim': 'Ritira il premio',
    'ad.skip': 'Salta (senza premio)', 'ad.badge': 'Ann.',
    'menu.baseline': 'Svuota la griglia dalle porte colorate',
    'menu.stars': 'stelle', 'menu.coins': 'monete', 'menu.level': 'livelli',
    'menu.play': 'Gioca', 'menu.daily': 'Regalo del giorno',
    'menu.streak': 'Serie di {n} giorno', 'menu.streak.plural': 'Serie di {n} giorni',

    'map.title': 'Mappa',

    'brief.objective': 'Fai uscire i {n} blocchi',
    'brief.moves': 'Mosse', 'brief.difficulty': 'Difficoltà', 'brief.record': 'Record',
    'brief.new': 'Novità: {quoi}', 'brief.start': 'Gioca',

    'hud.time': 'Tempo', 'hud.blocks': 'Blocchi', 'hud.stars': 'Stelle',
    'hud.moves': '{n} mosse',

    'result.won': 'Griglia svuotata!', 'result.timeout.title': 'Tempo scaduto',
    'result.nomoves.title': 'Mosse finite',
    'result.reward': '+{n} monete',
    'result.timeout.sub': 'Il cronometro è arrivato prima',
    'result.nomoves.sub': 'Non restavano mosse',
    'result.near.one': 'Restava un solo blocco!',
    'result.near': 'Restavano solo {n} blocchi!',
    'result.done': 'Livello completato', 'result.next': 'Avanti',
    'result.retry': 'Rigioca', 'result.map': 'Mappa',
    'result.timeout': 'Tempo scaduto', 'result.nomoves': 'Solo ',
    'result.continue': 'Continua con ',

    'user.title': 'Profilo e impostazioni', 'user.close': 'Chiudi',
    'user.level': 'Livello', 'user.stars': 'Stelle', 'user.levels': 'Livelli',
    'user.coins': 'Monete',
    'user.sound': 'Audio', 'user.music': 'Musica', 'user.sfx': 'Effetti sonori',
    'user.display': 'Schermo', 'user.glyphs': 'Simboli sui blocchi',
    'user.glyphs.note': 'Dà a ogni colore il suo simbolo, per non doversi fidare della tinta.',
    'user.language': 'Lingua',
    'user.ads': 'Pubblicità', 'user.noads': 'Togli la pubblicità',
    'user.ads.note': 'Acquisto simulato — nessun circuito pubblicitario è collegato.',
    'user.reset': 'Azzera i progressi',
    'user.reset.confirm': 'Cancellare tutti i progressi?',

    'action.hint': 'Indizio', 'action.hammer': 'Martello',
    'action.time': 'Tempo', 'action.undo': 'Annulla', 'action.giveup': 'Abbandona',

    'toast.sealed': 'Questo blocco è sigillato',
    'toast.locked': 'Bloccato: {quoi}',
    'toast.daily': '+{n} monete — serie di {jours} giorni',
    'toast.hammer.pick': 'Tocca il blocco da togliere',
    'toast.hammer.bad': 'Scegli un blocco che possa muoversi',
    'toast.time': '+30 secondi',
    'toast.undo': 'Mossa annullata',
    'toast.nohint': 'Nessuna mossa vincente trovata',
    'toast.coins': '{n} monete',
    'toast.unlocked': 'Tutti i livelli sbloccati',
    'toast.ads.off': 'Pubblicità tolta (acquisto simulato)',
    'toast.ads.on': 'Pubblicità riattivata',

    'offer.timeout': 'Tempo scaduto', 'offer.nomoves': 'Mosse finite',
    'offer.lead': 'Restano solo', 'offer.lead.end': 'blocchi da far uscire.',
    'offer.continue': 'Continua con', 'offer.bonus': '+{s} s e +{c} mosse',

    'lock.open': 'Aperto', 'lock.remaining': 'Ancora {n}',
    'gate.exit': 'Uscita {couleur}',

    'boot.missing': 'Base dei livelli non trovata',
    'boot.hint': 'Esegui {cmd}, poi ricarica.',

    'color.0': 'Rubino', 'color.1': 'Zaffiro', 'color.2': 'Smeraldo',
    'color.3': 'Ambra', 'color.4': 'Ametista', 'color.5': 'Topazio',
  },

  zh: {
    'editor.trying': '试玩',
    'result.time': '用时 {temps}',
    'editor.mine': '我的关卡', 'editor.mine.empty': '还没有保存任何棋盘',
    'editor.untitled': '未命名', 'editor.blocks': '{n} 个方块',
    'editor.proposed': '已投稿', 'editor.loaded': '棋盘已载入',
    'editor.delete': '删除', 'editor.edit': '修改',
    'editor.submit.short': '投稿',
    'shop.title': '金币',
    'shop.ad': '观看广告 · +{n} 金币',
    'shop.ad.left': '今天还剩 {n}/{total} 次',
    'shop.ad.none': '明天再来看广告吧',
    'shop.ad.failed': '暂时没有可看的广告',
    'shop.earned': '+{n} 金币',
    'shop.pack.bonus': '额外赠送 {n}%',
    'shop.buy': '购买',
    'shop.simulated': '模拟购买 — 未接入任何支付系统。',
    'shop.bought': '已到账 +{n} 金币（模拟购买）',
    'user.create': '创作', 'user.editor': '关卡编辑器',
    'user.editor.note': '画一张棋盘，验证它，然后投稿为每日谜题。',
    'editor.submit': '投稿为每日谜题',
    'editor.submit.ask': '给你的谜题起个名字？',
    'editor.submit.ok': '已投稿 — 某天可能会被抽中',
    'editor.submit.unsolved': '请先验证棋盘可解',
    'daily.title': '每日谜题', 'daily.by': '作者 {auteur}',
    'daily.none': '还没有投稿 — 来画第一个',
    'daily.done': '今天已玩过 · {score} 分',
    'daily.play': '轮到你了',
    'daily.score': '得分：{score}', 'daily.rank': '第 {rang} 名，共 {total} 人',
    'daily.rank.title': '今日排行榜',
    'daily.rank.note': '此排行榜仅存于本设备：原型没有可上传成绩的服务器。',
    'daily.rank.empty': '今天还没有人游玩',
    'daily.rank.me': '你',
    'app.title': 'Quiet Puzzle — 放松心情的解谜游戏',
    'map.next': '下一关',
    'result.drags': '次拖动', 'result.double': '金币翻倍',

    'ad.tag': '广告位', 'ad.banner': '320×50 横幅广告位',
    'ad.title': '广告', 'ad.title.rewarded': '奖励广告',
    'ad.note': '模拟广告位 — 未接入任何广告平台',
    'ad.note.rewarded': '看完即可领取奖励',
    'ad.close': '关闭', 'ad.claim': '领取奖励',
    'ad.skip': '跳过（不领奖励）', 'ad.badge': '广告',
    'menu.baseline': '让方块从同色的门离开棋盘',
    'menu.stars': '星星', 'menu.coins': '金币', 'menu.level': '关卡',
    'menu.play': '开始', 'menu.daily': '每日礼物',
    'menu.streak': '连续 {n} 天', 'menu.streak.plural': '连续 {n} 天',

    'map.title': '地图',

    'brief.objective': '清空全部 {n} 个方块',
    'brief.moves': '步数', 'brief.difficulty': '难度', 'brief.record': '纪录',
    'brief.new': '新元素：{quoi}', 'brief.start': '开始',

    'hud.time': '时间', 'hud.blocks': '方块', 'hud.stars': '星星',
    'hud.moves': '{n} 步',

    'result.won': '棋盘已清空！', 'result.timeout.title': '时间到',
    'result.nomoves.title': '步数用尽',
    'result.reward': '+{n} 金币',
    'result.timeout.sub': '时间先一步走完了',
    'result.nomoves.sub': '没有步数了',
    'result.near.one': '只差一个方块！',
    'result.near': '只差 {n} 个方块！',
    'result.done': '通关', 'result.next': '下一关',
    'result.retry': '重玩', 'result.map': '地图',
    'result.timeout': '时间到', 'result.nomoves': '只剩 ',
    'result.continue': '继续，获得 ',

    'user.title': '个人资料与设置', 'user.close': '关闭',
    'user.level': '等级', 'user.stars': '星星', 'user.levels': '关卡',
    'user.coins': '金币',
    'user.sound': '声音', 'user.music': '音乐', 'user.sfx': '音效',
    'user.display': '显示', 'user.glyphs': '方块上显示符号',
    'user.glyphs.note': '为每种颜色配一个符号，不必只靠颜色分辨。',
    'user.language': '语言',
    'user.ads': '广告', 'user.noads': '去除广告',
    'user.ads.note': '模拟购买 — 未接入任何广告平台。',
    'user.reset': '重置进度',
    'user.reset.confirm': '要清除全部进度吗？',

    'action.hint': '提示', 'action.hammer': '锤子',
    'action.time': '时间', 'action.undo': '撤销', 'action.giveup': '放弃',

    'toast.sealed': '这个方块被封住了',
    'toast.locked': '已锁定：{quoi}',
    'toast.daily': '+{n} 金币 — 连续 {jours} 天',
    'toast.hammer.pick': '点击要移除的方块',
    'toast.hammer.bad': '请选择可以移动的方块',
    'toast.time': '+30 秒',
    'toast.undo': '已撤销一步',
    'toast.nohint': '没有找到可行的一步',
    'toast.coins': '{n} 金币',
    'toast.unlocked': '已解锁全部关卡',
    'toast.ads.off': '已去除广告（模拟购买）',
    'toast.ads.on': '已恢复广告',

    'offer.timeout': '时间到', 'offer.nomoves': '步数用尽',
    'offer.lead': '只剩', 'offer.lead.end': '个方块待清空。',
    'offer.continue': '继续，获得', 'offer.bonus': '+{s} 秒，+{c} 步',

    'lock.open': '已开启', 'lock.remaining': '还差 {n}',
    'gate.exit': '{couleur}出口',

    'boot.missing': '找不到关卡数据',
    'boot.hint': '请运行 {cmd}，然后重新加载。',

    'color.0': '红宝石', 'color.1': '蓝宝石', 'color.2': '祖母绿',
    'color.3': '琥珀', 'color.4': '紫水晶', 'color.5': '黄玉',
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
 * Texte d'un monde dans la langue courante.
 *
 * Le catalogue transporte chaque libellé sous forme de table `{ fr, en, … }`,
 * et l'on retombe sur le français quand une langue manque : un monde ajouté
 * sans traduction s'affiche alors dans une langue, plutôt que dans le vide.
 */
export function texteMonde(monde, champ) {
  const table = monde?.[champ];
  if (!table) return '';
  return typeof table === 'string' ? table : (table[courante] || table[DEFAUT] || '');
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
  if (typeof document !== 'undefined') {
    document.documentElement.lang = courante;
    // Le titre de l'onglet ne porte pas d'attribut : il se pose à la main.
    document.title = t('app.title');
  }
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
