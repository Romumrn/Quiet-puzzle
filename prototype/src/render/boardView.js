/**
 * BoardView — équivalent de Scripts/Animation/BlockAnimator.cs + VFXManager.cs
 *
 * Seul module autorisé à toucher le DOM du plateau. Il ne décide rien : il
 * rejoue les évènements produits par core/board.js.
 *
 * Les blocs sont des polyominos : chaque case porte un arrondi calculé d'après
 * ses voisines, ce qui donne une forme fusionnée d'un seul tenant plutôt qu'un
 * chapelet de carrés.
 */

import { COLORS, KIND } from '../core/block.js';

const BASE_TIMING = { MOVE: 95, POP: 130, EXIT: 300, UNLOCK: 420, BUMP: 130 };
export const TIMING = { ...BASE_TIMING };

export function setSpeed(multiplier) {
  for (const k of Object.keys(BASE_TIMING)) TIMING[k] = Math.max(1, Math.round(BASE_TIMING[k] * multiplier));
  return TIMING;
}
if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setSpeed(0.15);

/**
 * Attente d'animation. En arrière-plan on ne patiente pas : la logique du coup
 * est déjà résolue, seul l'affichage reste à poser. Sans ce court-circuit,
 * revenir dans l'app rejouerait toute l'animation au ralenti (les navigateurs
 * bloquent les timers des pages cachées à une seconde minimum).
 */
const wait = (ms) => (document.hidden ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

const VECTEURS = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };

export class BoardView {
  constructor(root) {
    this.root = root;
    this.wrap = root.parentElement;
    this.gateLayer = root.querySelector('.gate-layer');
    this.blockLayer = root.querySelector('.block-layer');
    this.fxLayer = root.querySelector('.fx-layer');
    this.gridLayer = root.querySelector('.grid-layer');
    this.nodes = new Map(); // id -> élément
    this.board = null;
    this.cell = 0;

    this._ro = new ResizeObserver(() => this.layout());
    this._ro.observe(this.wrap);
  }

  destroy() { this._ro.disconnect(); }

  // --- Mise en page --------------------------------------------------------

  layout() {
    if (!this.board) return;
    const { W, H } = this.board;
    const mur = 14;
    const dispoW = this.wrap.clientWidth - 2 * mur - 6;
    const dispoH = this.wrap.clientHeight - 2 * mur - 6;
    const cell = Math.max(24, Math.floor(Math.min(dispoW / W, dispoH / H)));

    this.cell = cell;
    this.root.style.setProperty('--cell', `${cell}px`);
    this.root.style.setProperty('--wall', `${mur}px`);
    this.root.style.width = `${cell * W}px`;
    this.root.style.height = `${cell * H}px`;

    for (const [id, node] of this.nodes) {
      const b = this.board.blocks.get(id);
      if (b) this._place(node, b.x, b.y);
    }
    this._drawGates();
  }

  _place(node, x, y) {
    node.style.transform = `translate3d(${x * this.cell}px, ${y * this.cell}px, 0)`;
  }

  // --- Montage -------------------------------------------------------------

  mount(board) {
    this.board = board;
    this.nodes.clear();
    this.blockLayer.replaceChildren();
    this.gateLayer.replaceChildren();
    this.gridLayer.replaceChildren();
    this.fxLayer.replaceChildren();

    this.layout();

    // Fond quadrillé : repère visuel pour anticiper les déplacements.
    for (let y = 0; y < board.H; y++) {
      for (let x = 0; x < board.W; x++) {
        const c = document.createElement('div');
        c.className = 'grid-cell';
        this.gridLayer.appendChild(c);
        this._place(c, x, y);
      }
    }

    for (const b of board.blocks.values()) this._createBlock(b);
    this._drawGates();
  }

  _drawGates() {
    if (!this.board) return;
    this.gateLayer.replaceChildren();
    for (const g of this.board.gates) {
      const el = document.createElement('div');
      el.className = `gate gate-${g.side} c${g.color}`;
      const long = `${g.length * this.cell}px`;
      const debut = `${g.start * this.cell}px`;
      if (g.side === 'top' || g.side === 'bottom') { el.style.left = debut; el.style.width = long; }
      else { el.style.top = debut; el.style.height = long; }
      const glyphe = document.createElement('span');
      glyphe.textContent = COLORS[g.color]?.glyph ?? '';
      el.appendChild(glyphe);

      // Une porte à capacité limitée DOIT afficher ce qu'il lui reste :
      // une contrainte invisible se lit comme un bug, pas comme une règle.
      if (g.capacity !== undefined) {
        const jauge = document.createElement('b');
        jauge.className = 'gate-cap';
        jauge.textContent = g.capacity;
        el.appendChild(jauge);
      }
      this.gateLayer.appendChild(el);
    }
  }

  _createBlock(b) {
    const node = document.createElement('div');
    node.className = `block k-${b.kind}`
      + (b.color >= 0 && b.kind !== KIND.JOKER ? ` c${b.color}` : '')
      + (b.kind === KIND.RAIL ? ` axis-${b.axis}` : '');
    node.dataset.id = b.id;
    node.style.width = `${b.width * this.cell}px`;
    node.style.height = `${b.height * this.cell}px`;

    const a = (dx, dy) => b.cells.some(([p, q]) => p === dx && q === dy);
    for (const [dx, dy] of b.cells) {
      const c = document.createElement('i');
      c.className = 'block-cell';
      c.style.left = `${dx * this.cell}px`;
      c.style.top = `${dy * this.cell}px`;
      // Le reflet est calé sur la BOÎTE DU BLOC, pas sur la case : chaque case
      // n'en montre que sa portion, et la forme entière paraît d'un seul tenant.
      c.style.backgroundSize = `${b.width * this.cell}px ${b.height * this.cell}px`;
      c.style.backgroundPosition = `${-dx * this.cell}px ${-dy * this.cell}px`;
      // Arrondi uniquement sur les coins réellement extérieurs à la forme.
      const r = 'var(--bevel)';
      c.style.borderTopLeftRadius = !a(dx, dy - 1) && !a(dx - 1, dy) ? r : '0';
      c.style.borderTopRightRadius = !a(dx, dy - 1) && !a(dx + 1, dy) ? r : '0';
      c.style.borderBottomLeftRadius = !a(dx, dy + 1) && !a(dx - 1, dy) ? r : '0';
      c.style.borderBottomRightRadius = !a(dx, dy + 1) && !a(dx + 1, dy) ? r : '0';
      node.appendChild(c);
    }

    if (b.kind !== KIND.WALL) {
      const marque = document.createElement('span');
      marque.className = 'block-mark';
      const [gx, gy] = this._centreCell(b);
      marque.style.left = `${gx * this.cell}px`;
      marque.style.top = `${gy * this.cell}px`;
      if (b.kind === KIND.LOCKED) {
        // Cadenas et décompte tiennent DANS la case : une étiquette débordante
        // recouvrait les blocs voisins et rendait la grille illisible.
        marque.classList.add('locked-mark');
        marque.innerHTML = '<span>🔒</span><b class="lock-count"></b>';
      } else {
        marque.textContent = b.kind === KIND.JOKER ? '✳' : COLORS[b.color].glyph;
      }
      node.appendChild(marque);
    }

    // Glissière : un rail traversant, qui dit d'un coup d'œil sur quel axe le
    // bloc peut aller.
    if (b.kind === KIND.RAIL) {
      const rail = document.createElement('u');
      rail.className = 'block-rail';
      node.appendChild(rail);
    }

    if (b.kind === KIND.LOCKED) this._majVerrou(node, b);

    this._place(node, b.x, b.y);
    this.blockLayer.appendChild(node);
    this.nodes.set(b.id, node);
    return node;
  }

  /** Case de la forme la plus proche de son centre — pour poser le glyphe. */
  _centreCell(b) {
    const cx = (b.width - 1) / 2, cy = (b.height - 1) / 2;
    let best = b.cells[0], d = Infinity;
    for (const [dx, dy] of b.cells) {
      const dd = (dx - cx) ** 2 + (dy - cy) ** 2;
      if (dd < d) { d = dd; best = [dx, dy]; }
    }
    return best;
  }

  // --- Rejeu des évènements ------------------------------------------------

  async apply(events) {
    for (const e of events) {
      if (e.type === 'move') {
        const node = this.nodes.get(e.id);
        if (node) this._place(node, e.x, e.y);
      } else if (e.type === 'exit') {
        await this._exit(e);
      } else if (e.type === 'unlock') {
        this._unlock(e.id);
      }
    }
  }

  /**
   * Sortie d'un bloc, en deux temps : il se gonfle une fraction de seconde
   * (l'accusé de réception du geste), puis file par la porte pendant qu'une
   * gerbe d'étincelles part de l'ouverture. C'est le seul moment de
   * récompense du jeu : il doit se voir.
   */
  async _exit(e) {
    const node = this.nodes.get(e.id);
    if (!node) return;
    this.nodes.delete(e.id);
    const base = node.style.transform;

    // Le bloc sort en pleine saisie : on lui rend ses transitions, que la
    // classe « grabbed » avait coupées pour coller au doigt.
    node.classList.remove('grabbed');
    node.classList.add('exiting');
    node.style.transition = 'transform 0ms ease-out, opacity 0ms linear';
    node.style.transitionDuration = `${TIMING.POP}ms`;
    node.style.transform = `${base} scale(1.09)`;
    await wait(TIMING.POP);

    this._flashGate(e.gate);
    this._gerbe(e.gate, node);

    node.style.transitionTimingFunction = 'cubic-bezier(.45,0,.85,.5)';
    node.style.transitionDuration = `${TIMING.EXIT}ms`;
    node.style.transform =
      `${base} translate3d(${e.dx * this.cell * 2.6}px, ${e.dy * this.cell * 2.6}px, 0) scale(0.45)`;
    node.style.opacity = '0';
    await wait(TIMING.EXIT);
    node.remove();
  }

  /** Centre d'une porte, en pixels du plateau. */
  _centrePorte(gate) {
    const milieu = (gate.start + gate.length / 2) * this.cell;
    if (gate.side === 'top') return { x: milieu, y: 0 };
    if (gate.side === 'bottom') return { x: milieu, y: this.board.H * this.cell };
    if (gate.side === 'left') return { x: 0, y: milieu };
    return { x: this.board.W * this.cell, y: milieu };
  }

  /** Anneau + étincelles à la porte, dans la couleur du bloc sorti. */
  _gerbe(gate, source) {
    const { x, y } = this._centrePorte(gate);
    const teinte = getComputedStyle(source).getPropertyValue('--tile') || 'currentColor';

    const anneau = document.createElement('div');
    anneau.className = 'ring';
    anneau.style.setProperty('--tile', teinte);
    anneau.style.left = `${x}px`;
    anneau.style.top = `${y}px`;
    anneau.style.width = anneau.style.height = `${this.cell * 1.4}px`;
    this.fxLayer.appendChild(anneau);
    setTimeout(() => anneau.remove(), 560);

    const normale = Math.atan2(
      gate.side === 'bottom' ? 1 : gate.side === 'top' ? -1 : 0,
      gate.side === 'right' ? 1 : gate.side === 'left' ? -1 : 0,
    );
    for (let i = 0; i < 10; i++) {
      const angle = normale + (Math.random() - 0.5) * 2.1;
      const dist = this.cell * (0.7 + Math.random() * 1.5);
      const p = document.createElement('div');
      p.className = 'spark';
      p.style.setProperty('--tile', teinte);
      p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      p.style.left = `${x}px`;
      p.style.top = `${y}px`;
      p.style.animationDelay = `${Math.random() * 70}ms`;
      const taille = this.cell * (0.12 + Math.random() * 0.14);
      p.style.width = p.style.height = `${taille}px`;
      this.fxLayer.appendChild(p);
      setTimeout(() => p.remove(), 700);
    }
  }

  _flashGate(gate) {
    const el = [...this.gateLayer.children].find((n) =>
      n.classList.contains(`gate-${gate.side}`) && n.classList.contains(`c${gate.color}`));
    if (!el) return;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 420);
  }

  _unlock(id) {
    const node = this.nodes.get(id);
    if (!node) return;
    node.classList.remove('k-locked');
    node.classList.add('k-normal', 'unlocking');
    const b = this.board.blocks.get(id);
    const marque = node.querySelector('.block-mark');
    if (marque && b) marque.textContent = COLORS[b.color].glyph;
    node.querySelector('.block-cond')?.remove();
    setTimeout(() => node.classList.remove('unlocking'), TIMING.UNLOCK);
  }

  /** Refus de déplacement : petite secousse, pour que l'échec soit lisible. */
  bump(id) {
    const node = this.nodes.get(id);
    if (!node || node.classList.contains('bumping')) return;
    node.classList.add('bumping');
    setTimeout(() => node.classList.remove('bumping'), TIMING.BUMP * 2);
  }

  /**
   * Rafraîchit les étiquettes de verrou. Le décompte doit descendre à chaque
   * bloc sorti : c'est ce qui rend la condition lisible en cours de partie.
   */
  refreshLocks() {
    for (const [id, node] of this.nodes) {
      const b = this.board.blocks.get(id);
      if (b && b.kind === KIND.LOCKED) this._majVerrou(node, b);
    }
  }

  _majVerrou(node, b) {
    const compteur = node.querySelector('.lock-count');
    if (!compteur) return;
    const reste = this.board.restantAvantOuverture(b);
    compteur.textContent = reste > 0 ? reste : '';
    node.classList.toggle('lock-open', reste === 0);
  }

  /** Rafraîchit les capacités restantes affichées sur les portes. */
  refreshGates() {
    const jauges = this.gateLayer.querySelectorAll('.gate');
    this.board.gates.forEach((g, i) => {
      const jauge = jauges[i]?.querySelector('.gate-cap');
      if (!jauge) return;
      jauge.textContent = g.capacity;
      jauges[i].classList.toggle('gate-full', g.capacity <= 0);
    });
  }

  /** Retire un bloc du plateau (marteau). */
  async removeBlock(id) {
    const node = this.nodes.get(id);
    if (!node) return;
    node.classList.add('smashed');
    this.nodes.delete(id);
    await wait(TIMING.EXIT);
    node.remove();
  }

  /** Reconstruit l'affichage depuis l'état du plateau (annulation). */
  resync() {
    const board = this.board;
    for (const [id, node] of [...this.nodes]) {
      if (!board.blocks.has(id)) { node.remove(); this.nodes.delete(id); }
    }
    for (const b of board.blocks.values()) {
      if (!this.nodes.has(b.id)) this._createBlock(b);
      else this._place(this.nodes.get(b.id), b.x, b.y);
    }
    this.refreshLocks();
  }

  /** Met en évidence le bloc désigné par un indice. */
  highlight(id) {
    const node = this.nodes.get(id);
    if (!node) return;
    node.classList.add('hinted');
    setTimeout(() => node.classList.remove('hinted'), 3400);
  }

  setGrabbed(id, on) {
    const node = this.nodes.get(id);
    if (!node) return;
    node.classList.toggle('grabbed', on);
    if (!on) {
      // Fin du geste : on efface le débord et on rend sa transition au bloc.
      const b = this.board.blocks.get(id);
      if (b) this._place(node, b.x, b.y);
    }
  }

  /**
   * Débord du bloc vers le doigt, en fraction de case.
   *
   * Le bloc se déplace de case en case, mais le doigt, lui, est continu. Sans
   * ce décalage le mouvement paraît saccadé ; avec lui, le bloc suit le doigt
   * et vient buter visiblement contre ce qui le bloque.
   */
  setLean(id, lx, ly) {
    const node = this.nodes.get(id);
    const b = this.board.blocks.get(id);
    if (!node || !b) return;
    const max = 0.3;
    const cx = Math.max(-max, Math.min(max, lx)) * this.cell;
    const cy = Math.max(-max, Math.min(max, ly)) * this.cell;
    node.style.transform = `translate3d(${b.x * this.cell + cx}px, ${b.y * this.cell + cy}px, 0)`;
  }

  // --- Repérage ------------------------------------------------------------

  /** Position en cases, en valeur continue — sert au suivi du doigt. */
  cellFromPointFloat(clientX, clientY) {
    const r = this.root.getBoundingClientRect();
    return { x: (clientX - r.left) / this.cell, y: (clientY - r.top) / this.cell };
  }

  /** Case de la grille sous un point écran (peut sortir des bornes). */
  cellFromPoint(clientX, clientY) {
    const r = this.root.getBoundingClientRect();
    return {
      x: Math.floor((clientX - r.left) / this.cell),
      y: Math.floor((clientY - r.top) / this.cell),
    };
  }

  blockIdFromPoint(clientX, clientY) {
    const { x, y } = this.cellFromPoint(clientX, clientY);
    if (!this.board.inside(x, y)) return null;
    return this.board.blockAt(x, y)?.id ?? null;
  }
}

/**
 * Libellé d'une condition de déverrouillage. Avec un plateau en argument, on
 * affiche ce qu'il RESTE à faire plutôt que la condition brute : « Encore 2 »
 * se comprend en cours de partie, « 3 sortis » demande au joueur de compter.
 */
export function conditionLabel(condition, board = null) {
  if (!condition) return '';
  if (condition.type === 'exits') {
    if (!board) return `${condition.count} sortis`;
    const reste = Math.max(0, condition.count - board.exited.length);
    return reste === 0 ? 'Ouvert' : `Encore ${reste}`;
  }
  return `${COLORS[condition.color].glyph} fini`;
}
