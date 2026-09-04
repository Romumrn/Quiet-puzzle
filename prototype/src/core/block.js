/**
 * Block — équivalent de Scripts/Gameplay/BlockController.cs (doc §4)
 *
 * Donnée pure, aucun accès au DOM. Un bloc est un polyomino : une liste de
 * cases relatives, une couleur, une position d'origine sur la grille.
 */

/**
 * Nature d'un bloc. Les trois derniers types sont les "effets" du jeu ; ils
 * reprennent des mécaniques éprouvées du genre plutôt que d'en inventer :
 *
 *  - RAIL   : un bloc monté sur glissière, qui ne bouge que sur un axe. C'est
 *             la mécanique de Rush Hour, et de loin la plus efficace pour
 *             créer de la difficulté sans ajouter de règle à expliquer.
 *  - JOKER  : un bloc multicolore qui sort par n'importe quelle porte. Sert de
 *             soupape : il détend une grille trop contrainte.
 *  - LOCKED : un bloc scellé jusqu'à ce que N blocs soient sortis. La condition
 *             est un simple décompte, affiché sur le bloc — le joueur doit
 *             pouvoir lire ce qui l'ouvrira sans le deviner.
 */
export const KIND = Object.freeze({
  NORMAL: 'normal',
  WALL: 'wall',
  LOCKED: 'locked',
  RAIL: 'rail',
  JOKER: 'joker',
});

/** Types qu'un joueur peut saisir (les murs, non). */
export const DEPLACABLES = new Set([KIND.NORMAL, KIND.LOCKED, KIND.RAIL, KIND.JOKER]);

/**
 * Palette. Le glyphe n'est pas décoratif : il est repris à l'identique sur la
 * porte correspondante, pour que l'appariement bloc/porte reste lisible sans
 * dépendre de la couleur (daltonisme).
 */
export const COLORS = Object.freeze([
  { id: 0, name: 'Rubis', glyph: '●' },
  { id: 1, name: 'Saphir', glyph: '◆' },
  { id: 2, name: 'Émeraude', glyph: '▲' },
  { id: 3, name: 'Ambre', glyph: '★' },
  { id: 4, name: 'Améthyste', glyph: '■' },
  { id: 5, name: 'Topaze', glyph: '⬢' },
]);

/**
 * Formes disponibles. `cells` liste les cases relatives ; `w`/`h` l'encombrement.
 * Une forme ne peut sortir que par une porte au moins aussi large que son
 * encombrement perpendiculaire à la sortie.
 */
export const SHAPES = Object.freeze([
  { key: 'i1', cells: [[0, 0]] },
  { key: 'i2h', cells: [[0, 0], [1, 0]] },
  { key: 'i2v', cells: [[0, 0], [0, 1]] },
  { key: 'i3h', cells: [[0, 0], [1, 0], [2, 0]] },
  { key: 'i3v', cells: [[0, 0], [0, 1], [0, 2]] },
  { key: 'o4', cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { key: 'l3a', cells: [[0, 0], [0, 1], [1, 1]] },
  { key: 'l3b', cells: [[1, 0], [0, 1], [1, 1]] },
  { key: 'l3c', cells: [[0, 0], [1, 0], [0, 1]] },
  { key: 'l3d', cells: [[0, 0], [1, 0], [1, 1]] },
  { key: 't4', cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
].map((s) => ({
  ...s,
  w: Math.max(...s.cells.map((c) => c[0])) + 1,
  h: Math.max(...s.cells.map((c) => c[1])) + 1,
})));

let nextId = 1;

export class Block {
  /** @param {{id?, color, cells, x, y, kind?, condition?}} data */
  constructor(data) {
    this.id = data.id ?? nextId++;
    this.color = data.color;
    this.cells = data.cells.map(([dx, dy]) => [dx, dy]);
    this.x = data.x;
    this.y = data.y;
    this.kind = data.kind || KIND.NORMAL;
    /**
     * Axe autorisé pour un bloc RAIL : 'h' (horizontal) ou 'v' (vertical).
     */
    this.axis = data.axis || null;
    /**
     * Condition de déverrouillage d'un bloc LOCKED :
     *   { type: 'exits', count: n } — n blocs doivent être sortis
     *
     * Le générateur n'émet que ce type. Une condition liée à une couleur
     * ("toute la couleur ▲ sortie") est indevinable en cours de partie : le
     * joueur ne sait pas combien de blocs de cette couleur restent, ni si le
     * bloc verrouillé compte lui-même. Le décompte, lui, se lit sur le bloc.
     * Le format couleur reste accepté pour les niveaux écrits à la main.
     */
    this.condition = data.condition || null;
  }

  /** Cases absolues occupées sur la grille. */
  absolute() {
    return this.cells.map(([dx, dy]) => [this.x + dx, this.y + dy]);
  }

  get width() { return Math.max(...this.cells.map((c) => c[0])) + 1; }
  get height() { return Math.max(...this.cells.map((c) => c[1])) + 1; }

  /** Lignes (resp. colonnes) couvertes — sert à tester le passage d'une porte. */
  rows() { return [...new Set(this.cells.map((c) => this.y + c[1]))]; }
  cols() { return [...new Set(this.cells.map((c) => this.x + c[0]))]; }

  clone() {
    return new Block({ id: this.id, color: this.color, cells: this.cells, x: this.x, y: this.y,
                       kind: this.kind, axis: this.axis, condition: this.condition });
  }
}

export function resetBlockIds() { nextId = 1; }
