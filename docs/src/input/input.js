/**
 * InputHandler — equivalent of Scripts/Gameplay/InputHandler.cs (tech doc §4)
 *
 * One single gesture: grab a block and drag it. The block follows the finger
 * cell by cell and stops at the first obstacle; if it reaches a gate of its
 * colour, it exits.
 *
 * The target position is recomputed on every move from the cell grabbed at the
 * start, not from the last step: otherwise the block drifts when the finger
 * passes over occupied cells.
 *
 * A quick release extends the gesture: the block carries on along the axis it
 * was already travelling, up to its next obstacle — as if it had been flicked.
 */

/** Recent window over which release speed is measured. */
const FLICK_WINDOW_MS = 120;
/** Speed above which a release counts as a flick, in cells/ms. */
const FLICK_THRESHOLD = 1 / 90;
/** Distance a flick aims for — beyond any playable grid, so the first obstacle stops the block. */
const FLICK_RANGE = 24;

export class InputHandler {
  /**
   * @param {BoardView} view
   * @param {{onDrag:(id,x,y)=>void, onEnd:(id,moved:boolean)=>void,
   *          canGrab:(id)=>boolean, onRefused:(id)=>void}} hooks
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

    if (!this.hooks.canGrab(id)) { this.hooks.onRefused(id); return; }

    const block = this.view.board.blocks.get(id);
    const grab = this.view.cellFromPointFloat(ev.clientX, ev.clientY);
    ev.preventDefault();
    this.drag = {
      id,
      grabX: grab.x, grabY: grab.y,
      originX: block.x, originY: block.y,
      moved: false,
      history: [{ x: grab.x, y: grab.y, t: ev.timeStamp }],
    };
    this.view.setGrabbed(id, true);
  }

  _onMove(ev) {
    if (this.locked || !this.drag) return;

    // Target position as a continuous value, then rounded: the block tips from
    // cell to cell halfway, as the finger expects.
    const p = this.view.cellFromPointFloat(ev.clientX, ev.clientY);
    const floatX = this.drag.originX + (p.x - this.drag.grabX);
    const floatY = this.drag.originY + (p.y - this.drag.grabY);

    const block = this.view.board.blocks.get(this.drag.id);
    if (!block) return;

    const targetX = Math.round(floatX);
    const targetY = Math.round(floatY);
    if (block.x !== targetX || block.y !== targetY) {
      if (this.hooks.onDrag(this.drag.id, targetX, targetY)) this.drag.moved = true;
    }

    // Then the block leans towards the finger, even when it can no longer move.
    const after = this.view.board.blocks.get(this.drag.id);
    if (after) this.view.setLean(this.drag.id, floatX - after.x, floatY - after.y);

    // Sliding history, to measure speed at release.
    const hist = this.drag.history;
    hist.push({ x: p.x, y: p.y, t: ev.timeStamp });
    while (hist.length > 1 && ev.timeStamp - hist[0].t > FLICK_WINDOW_MS) hist.shift();
  }

  _onUp(ev) {
    if (!this.drag) return;
    const { id, moved } = this.drag;
    if (moved) this._flick(ev);
    this.drag = null;
    this.view.setGrabbed(id, false);
    this.hooks.onEnd(id, moved);
  }

  /**
   * A fast enough release continues the gesture along its dominant axis, up to
   * the next obstacle — without it, a quick drag stops exactly where the finger
   * left the screen, often one cell too early.
   */
  _flick(ev) {
    const { id, history } = this.drag;
    const start = history[0];
    const dt = ev.timeStamp - start.t;
    if (dt <= 0) return;

    const p = this.view.cellFromPointFloat(ev.clientX, ev.clientY);
    const vx = (p.x - start.x) / dt, vy = (p.y - start.y) / dt;
    if (Math.max(Math.abs(vx), Math.abs(vy)) < FLICK_THRESHOLD) return;

    const block = this.view.board.blocks.get(id);
    if (!block) return;
    const targetX = Math.abs(vx) >= Math.abs(vy) ? block.x + Math.sign(vx) * FLICK_RANGE : block.x;
    const targetY = Math.abs(vx) >= Math.abs(vy) ? block.y : block.y + Math.sign(vy) * FLICK_RANGE;
    this.hooks.onDrag(id, targetX, targetY);
  }
}
