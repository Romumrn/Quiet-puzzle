/**
 * InputHandler — équivalent de Scripts/Gameplay/InputHandler.cs (doc §4)
 *
 * Un seul geste : on attrape un bloc et on le fait glisser. Le bloc suit le
 * doigt case par case et s'arrête sur le premier obstacle ; s'il arrive contre
 * une porte de sa couleur, il sort.
 *
 * La position visée est recalculée à chaque mouvement à partir de la case
 * saisie au départ, et non du dernier pas : sinon le bloc dérive quand le doigt
 * passe sur des cases occupées.
 *
 * Un relâchement rapide prolonge le geste : le bloc continue dans l'axe où il
 * venait déjà, jusqu'à son prochain obstacle — comme s'il avait été lancé.
 */

/** Fenêtre récente sur laquelle la vitesse de relâchement est mesurée. */
const FENETRE_LANCER_MS = 120;
/** Vitesse à partir de laquelle un relâchement compte comme un lancer, en cases/ms. */
const SEUIL_LANCER = 1 / 90;
/** Distance visée par un lancer — au-delà de toute grille jouable, le premier obstacle arrête le bloc. */
const PORTEE_LANCER = 24;

export class InputHandler {
  /**
   * @param {BoardView} view
   * @param {{onDrag:(id,x,y)=>void, onEnd:(id,bouge:boolean)=>void,
   *          canGrab:(id)=>boolean, onRefus:(id)=>void}} hooks
   */
  constructor(view, hooks) {
    this.view = view;
    this.hooks = hooks;
    this.locked = false;
    this.drag = null;

    this._down = this._onDown.bind(this);
    this._move = this._onMove.bind(this);
    this._up = this._onUp.bind(this);

    view.root.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('pointercancel', this._up);
  }

  destroy() {
    this.view.root.removeEventListener('pointerdown', this._down);
    window.removeEventListener('pointermove', this._move);
    window.removeEventListener('pointerup', this._up);
    window.removeEventListener('pointercancel', this._up);
  }

  _onDown(ev) {
    if (this.locked) return;
    const id = this.view.blockIdFromPoint(ev.clientX, ev.clientY);
    if (id === null) return;

    if (!this.hooks.canGrab(id)) { this.hooks.onRefus(id); return; }

    const bloc = this.view.board.blocks.get(id);
    const saisie = this.view.cellFromPointFloat(ev.clientX, ev.clientY);
    ev.preventDefault();
    this.drag = {
      id,
      saisieX: saisie.x, saisieY: saisie.y,
      origineX: bloc.x, origineY: bloc.y,
      bouge: false,
      historique: [{ x: saisie.x, y: saisie.y, t: ev.timeStamp }],
    };
    this.view.setGrabbed(id, true);
  }

  _onMove(ev) {
    if (this.locked || !this.drag) return;

    // Position visée en valeur continue, puis arrondie : le bloc bascule de
    // case à mi-parcours, comme le doigt s'y attend.
    const p = this.view.cellFromPointFloat(ev.clientX, ev.clientY);
    const flotX = this.drag.origineX + (p.x - this.drag.saisieX);
    const flotY = this.drag.origineY + (p.y - this.drag.saisieY);

    const bloc = this.view.board.blocks.get(this.drag.id);
    if (!bloc) return;

    const cibleX = Math.round(flotX);
    const cibleY = Math.round(flotY);
    if (bloc.x !== cibleX || bloc.y !== cibleY) {
      if (this.hooks.onDrag(this.drag.id, cibleX, cibleY)) this.drag.bouge = true;
    }

    // Puis le bloc penche vers le doigt, y compris quand il ne peut plus avancer.
    const apres = this.view.board.blocks.get(this.drag.id);
    if (apres) this.view.setLean(this.drag.id, flotX - apres.x, flotY - apres.y);

    // Historique glissant, pour mesurer la vitesse au relâchement.
    const hist = this.drag.historique;
    hist.push({ x: p.x, y: p.y, t: ev.timeStamp });
    while (hist.length > 1 && ev.timeStamp - hist[0].t > FENETRE_LANCER_MS) hist.shift();
  }

  _onUp(ev) {
    if (!this.drag) return;
    const { id, bouge } = this.drag;
    if (bouge) this._lancer(ev);
    this.drag = null;
    this.view.setGrabbed(id, false);
    this.hooks.onEnd(id, bouge);
  }

  /**
   * Un relâchement assez rapide continue le geste dans son axe dominant,
   * jusqu'au prochain obstacle — sans ça, un glissé rapide s'arrête pile où
   * le doigt a quitté l'écran, souvent une case trop tôt.
   */
  _lancer(ev) {
    const { id, historique } = this.drag;
    const depart = historique[0];
    const dt = ev.timeStamp - depart.t;
    if (dt <= 0) return;

    const p = this.view.cellFromPointFloat(ev.clientX, ev.clientY);
    const vx = (p.x - depart.x) / dt, vy = (p.y - depart.y) / dt;
    if (Math.max(Math.abs(vx), Math.abs(vy)) < SEUIL_LANCER) return;

    const bloc = this.view.board.blocks.get(id);
    if (!bloc) return;
    const cibleX = Math.abs(vx) >= Math.abs(vy) ? bloc.x + Math.sign(vx) * PORTEE_LANCER : bloc.x;
    const cibleY = Math.abs(vx) >= Math.abs(vy) ? bloc.y : bloc.y + Math.sign(vy) * PORTEE_LANCER;
    this.hooks.onDrag(id, cibleX, cibleY);
  }
}
