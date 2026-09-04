/**
 * BoardManager — équivalent de Scripts/Gameplay/BoardManager.cs (doc §5.1)
 *
 * Puzzle de blocs à faire sortir par des portes de couleur. Le document
 * technique appelait déjà cette condition de victoire `AreAllDoorsComplete()` :
 * ici elle est réellement implémentée — la grille est résolue quand tous les
 * blocs déplaçables sont sortis par une porte de leur couleur.
 *
 * REGLE D'OR : aucun accès au DOM. Chaque geste produit des évènements
 * ({type:'move'|'exit'|'unlock'|'blocked'}) que render/boardView.js rejoue en
 * animation. C'est ce qui rend cette logique testable sous Node et son portage
 * en C# mécanique.
 */

import { Block, KIND, DEPLACABLES } from './block.js';
import { GameState } from './gameState.js';

/** Les quatre côtés, avec leur vecteur de sortie. */
export const SIDES = Object.freeze({
  top: [0, -1],
  right: [1, 0],
  bottom: [0, 1],
  left: [-1, 0],
});

export class Board {
  /** @param {object} level  objet niveau au format `GET /api/level/{n}` */
  constructor(level) {
    this.level = level;
    this.W = level.width;
    this.H = level.height;
    this.gates = level.gates.map((g) => ({ ...g }));

    this.blocks = new Map();
    for (const data of level.blocks) this.blocks.set(data.id, new Block(data));

    this.movesRemaining = level.moveLimit;
    this.timeRemaining = level.timeLimit;
    this.exited = [];          // ids sortis, dans l'ordre
    this.gameState = GameState.PLAYING;

    this._occupancy = new Map();
    this._reindex();
  }

  // --- Occupation de la grille --------------------------------------------

  _key(x, y) { return y * this.W + x; }

  _reindex() {
    this._occupancy.clear();
    for (const b of this.blocks.values()) {
      for (const [x, y] of b.absolute()) this._occupancy.set(this._key(x, y), b.id);
    }
  }

  blockAt(x, y) {
    const id = this._occupancy.get(this._key(x, y));
    return id === undefined ? null : this.blocks.get(id);
  }

  inside(x, y) { return x >= 0 && x < this.W && y >= 0 && y < this.H; }

  // --- Verrouillage --------------------------------------------------------

  /** Un bloc verrouillé le reste tant que sa condition n'est pas remplie. */
  conditionMet(block) {
    const c = block.condition;
    if (!c) return true;
    if (c.type === 'exits') return this.exited.length >= c.count;
    if (c.type === 'color') {
      for (const b of this.blocks.values()) if (b.color === c.color) return false;
      return true;
    }
    return true;
  }

  canMove(block) {
    if (!block || !DEPLACABLES.has(block.kind)) return false;
    if (block.kind === KIND.LOCKED) return this.conditionMet(block);
    return true;
  }

  /** Ce bloc accepte-t-il un déplacement dans cette direction ? */
  accepteDirection(block, dx, dy) {
    if (block.kind !== KIND.RAIL) return true;
    return block.axis === 'h' ? dy === 0 : dx === 0;
  }

  /** Combien de blocs restent à sortir avant l'ouverture d'un verrou. */
  restantAvantOuverture(block) {
    const c = block.condition;
    if (!c || c.type !== 'exits') return 0;
    return Math.max(0, c.count - this.exited.length);
  }

  /** Blocs qui viennent de se déverrouiller — pour l'animation et le HUD. */
  _collectUnlocks() {
    const out = [];
    for (const b of this.blocks.values()) {
      if (b.kind !== KIND.LOCKED) continue;
      const met = this.conditionMet(b);
      if (met && !b._wasUnlocked) { b._wasUnlocked = true; out.push({ type: 'unlock', id: b.id }); }
      else if (!met) b._wasUnlocked = false;
    }
    return out;
  }

  // --- Déplacement ---------------------------------------------------------

  /**
   * Déplace un bloc d'une case. Si le pas sort de la grille, tente la sortie
   * par une porte.
   * @returns {{ok:boolean, event?:object, reason?:string}}
   */
  step(id, dx, dy) {
    const block = this.blocks.get(id);
    if (!block) return { ok: false, reason: 'inconnu' };
    if (this.gameState !== GameState.PLAYING) return { ok: false, reason: 'terminé' };
    if (!this.canMove(block)) return { ok: false, reason: 'verrouillé' };
    if (!this.accepteDirection(block, dx, dy)) return { ok: false, reason: 'glissière' };

    const cible = block.absolute().map(([x, y]) => [x + dx, y + dy]);
    const sort = cible.some(([x, y]) => !this.inside(x, y));

    if (sort) {
      const porte = this._gateFor(block, dx, dy);
      if (!porte) return { ok: false, reason: 'mur' };
      return { ok: true, event: this._exit(block, porte, dx, dy) };
    }

    for (const [x, y] of cible) {
      const occupant = this._occupancy.get(this._key(x, y));
      if (occupant !== undefined && occupant !== id) return { ok: false, reason: 'occupé' };
    }

    block.x += dx;
    block.y += dy;
    this._reindex();
    return { ok: true, event: { type: 'move', id, x: block.x, y: block.y } };
  }

  /**
   * La porte qui laisserait sortir ce bloc dans cette direction, ou null.
   * Le bloc doit être plaqué contre le mur ET tenir entièrement dans la porte :
   * une forme de 2 cases de large ne passe pas par une porte de 1.
   */
  _gateFor(block, dx, dy) {
    const side = dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'bottom' : 'top';

    const cells = block.absolute();
    const plaque =
      side === 'right' ? Math.max(...cells.map((c) => c[0])) === this.W - 1 :
      side === 'left' ? Math.min(...cells.map((c) => c[0])) === 0 :
      side === 'bottom' ? Math.max(...cells.map((c) => c[1])) === this.H - 1 :
      Math.min(...cells.map((c) => c[1])) === 0;
    if (!plaque) return null;

    const travers = side === 'left' || side === 'right' ? block.rows() : block.cols();
    for (const gate of this.gates) {
      // Un JOKER sort par n'importe quelle porte : c'est tout son intérêt.
      const couleurOk = block.kind === KIND.JOKER || gate.color === block.color;
      if (gate.side !== side || !couleurOk) continue;
      // Porte saturée : elle n'accepte plus ce bloc.
      if (gate.capacity !== undefined && gate.capacity < block.cells.length) continue;
      const couvre = travers.every((v) => v >= gate.start && v < gate.start + gate.length);
      if (couvre) return gate;
    }
    return null;
  }

  _exit(block, gate, dx, dy) {
    this.blocks.delete(block.id);
    this.exited.push(block.id);
    if (gate.capacity !== undefined) gate.capacity -= block.cells.length;
    this._reindex();
    return { type: 'exit', id: block.id, gate, dx, dy, restants: this.remaining() };
  }

  // --- Geste complet -------------------------------------------------------

  /**
   * Fait avancer un bloc vers une position visée, case par case, en préférant
   * l'axe où il reste le plus de chemin. C'est le comportement attendu d'un
   * glissé au doigt : le bloc suit, contourne si besoin, s'arrête sur obstacle.
   * @returns {{events:Array, exited:boolean}}
   */
  dragTowards(id, targetX, targetY, maxPas = 24) {
    const events = [];
    for (let i = 0; i < maxPas; i++) {
      const block = this.blocks.get(id);
      if (!block) break;
      const ex = targetX - block.x;
      const ey = targetY - block.y;
      if (ex === 0 && ey === 0) break;

      const essais = Math.abs(ex) >= Math.abs(ey)
        ? [[Math.sign(ex), 0], [0, Math.sign(ey)]]
        : [[0, Math.sign(ey)], [Math.sign(ex), 0]];

      let avance = false;
      for (const [dx, dy] of essais) {
        if (dx === 0 && dy === 0) continue;
        const r = this.step(id, dx, dy);
        if (r.ok) { events.push(r.event); avance = true; if (r.event.type === 'exit') return { events, exited: true }; break; }
      }
      if (!avance) break;
    }
    return { events, exited: false };
  }

  /** Clôt un geste : décompte un coup s'il a réellement déplacé quelque chose. */
  endGesture(aBouge) {
    const events = [];
    if (!aBouge) return events;
    this.movesRemaining--;
    events.push(...this._collectUnlocks());
    this._settle(events);
    return events;
  }

  /** Écoulement du temps, appelé par la boucle de jeu (1 s). */
  tick(seconds = 1) {
    if (this.gameState !== GameState.PLAYING) return [];
    this.timeRemaining = Math.max(0, this.timeRemaining - seconds);
    const events = [];
    this._settle(events);
    return events;
  }

  // --- Historique et bonus -------------------------------------------------

  /**
   * Mémorise un état pour l'annulation. On peut passer un instantané pris plus
   * tôt : l'appelant photographie AVANT de tenter le geste, puis n'empile que
   * si le geste a réellement abouti — sinon un glissé bloqué rendrait le bouton
   * « annuler » actif sans rien avoir à annuler.
   */
  memoriser(snap = null) {
    if (!this._historique) this._historique = [];
    this._historique.push(snap || this.snapshot());
    if (this._historique.length > 30) this._historique.shift();
  }

  peutAnnuler() { return !!this._historique?.length; }

  /** Bonus "annuler" : revient à l'état d'avant le dernier geste. */
  annuler() {
    const snap = this._historique?.pop();
    if (!snap) return false;
    this.restore(snap);
    return true;
  }

  /** Bonus "marteau" : retire un bloc sans qu'il ait à rejoindre sa porte. */
  briser(id) {
    const bloc = this.blocks.get(id);
    if (!bloc || bloc.kind === KIND.WALL) return null;
    this.memoriser();
    this.blocks.delete(id);
    this.exited.push(id);
    this._reindex();
    const evts = this._collectUnlocks();
    this._settle(evts);
    return { type: 'smash', id, evts, restants: this.remaining() };
  }

  /** Bonus "temps" : rallonge le chronomètre. */
  ajouterTemps(secondes) {
    this.timeRemaining += secondes;
  }

  // --- Instantané ----------------------------------------------------------

  /**
   * Photographie l'état des blocs. Sert à explorer des coups sans les jouer
   * (mesure d'équilibrage aujourd'hui, annulation et indices demain).
   */
  snapshot() {
    // On garde les objets Block eux-mêmes : une simulation peut faire sortir un
    // bloc, et il faut pouvoir le remettre en place ensuite.
    return {
      blocs: [...this.blocks.values()].map((b) => ({ b, x: b.x, y: b.y })),
      sortis: [...this.exited],
      coups: this.movesRemaining,
      etat: this.gameState,
      // La capacité des portes se consomme : sans elle dans l'instantané,
      // une annulation rendrait le bloc mais pas la place dans sa porte.
      capacites: this.gates.map((g) => g.capacity),
    };
  }

  restore(snap) {
    this.blocks.clear();
    for (const { b, x, y } of snap.blocs) { b.x = x; b.y = y; this.blocks.set(b.id, b); }
    this.exited = [...snap.sortis];
    this.movesRemaining = snap.coups;
    this.gameState = snap.etat;
    this.gates.forEach((g, i) => { g.capacity = snap.capacites[i]; });
    this._reindex();
  }

  /**
   * Prochain bloc à jouer, d'après la solution de référence.
   *
   * Le joueur a pu s'écarter de l'ordre canonique : on ne se contente donc pas
   * de lire la solution, on VERIFIE en simulant que le bloc proposé peut
   * réellement sortir dans l'état actuel de la grille. C'est ce qui rend
   * l'indice fiable — et donc vendable.
   *
   * @returns {{id:number, gate:string, chemin:Array}|null}
   */
  hint() {
    // Niveau écrit dans l'éditeur : pas de solution de référence, on interroge
    // le solveur.
    if (!this.level.solution?.length) {
      const { resoudre } = this._solveur || {};
      if (!resoudre) return null;
      const r = resoudre(this);
      return r.resoluble ? { id: r.ordre[0], gate: null, chemin: [] } : null;
    }
    for (const etape of this.level.solution) {
      const bloc = this.blocks.get(etape.id);
      if (!bloc || !this.canMove(bloc)) continue;

      const snap = this.snapshot();
      for (const pos of etape.chemin.slice(1)) this.dragTowards(etape.id, pos.x, pos.y);
      let sort = !this.blocks.has(etape.id);
      if (!sort) {
        const [dx, dy] = SIDES[etape.gate];
        sort = this.step(etape.id, dx, dy).ok;
      }
      this.restore(snap);
      if (sort) return { id: etape.id, gate: etape.gate, chemin: etape.chemin };
    }
    return null;
  }

  // --- Fin de niveau -------------------------------------------------------

  /** Blocs restant à sortir (les murs ne comptent pas). */
  remaining() {
    let n = 0;
    for (const b of this.blocks.values()) if (b.kind !== KIND.WALL) n++;
    return n;
  }

  isSolved() { return this.remaining() === 0; }

  _settle(events) {
    if (this.isSolved()) { this.gameState = GameState.WON; return; }
    if (this.movesRemaining <= 0) { this.gameState = GameState.FAILED; this.failReason = 'coups'; return; }
    if (this.timeRemaining <= 0) { this.gameState = GameState.FAILED; this.failReason = 'temps'; }
  }

  /** Glissés réellement consommés depuis le début du niveau. */
  dragsUsed() { return this.level.moveLimit - this.movesRemaining; }

  /**
   * 0 à 3 étoiles. 1★ = niveau résolu ; 2★ et 3★ mesurent l'économie de gestes
   * par rapport à la solution de référence (`starDrags`). Le chrono et la
   * limite de coups restent des conditions de défaite, pas des barèmes : mêler
   * les deux rendait la note illisible.
   */
  stars() {
    if (!this.isSolved()) return 0;
    const [pour3, pour2] = this.level.starDrags;
    const utilises = this.dragsUsed();
    if (utilises <= pour3) return 3;
    if (utilises <= pour2) return 2;
    return 1;
  }
}
