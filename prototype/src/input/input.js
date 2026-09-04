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
 */

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
    const saisie = this.view.cellFromPoint(ev.clientX, ev.clientY);
    ev.preventDefault();
    this.drag = {
      id,
      saisieX: saisie.x, saisieY: saisie.y,
      origineX: bloc.x, origineY: bloc.y,
      bouge: false,
    };
    this.view.setGrabbed(id, true);
  }

  _onMove(ev) {
    if (this.locked || !this.drag) return;
    const p = this.view.cellFromPoint(ev.clientX, ev.clientY);
    const cibleX = this.drag.origineX + (p.x - this.drag.saisieX);
    const cibleY = this.drag.origineY + (p.y - this.drag.saisieY);
    const bloc = this.view.board.blocks.get(this.drag.id);
    if (!bloc) return;
    if (bloc.x === cibleX && bloc.y === cibleY) return;
    if (this.hooks.onDrag(this.drag.id, cibleX, cibleY)) this.drag.bouge = true;
  }

  _onUp() {
    if (!this.drag) return;
    const { id, bouge } = this.drag;
    this.drag = null;
    this.view.setGrabbed(id, false);
    this.hooks.onEnd(id, bouge);
  }
}
