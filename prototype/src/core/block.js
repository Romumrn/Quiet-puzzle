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
 *  - ANCRE  : un bloc qui n'avance que DANS LA DIRECTION de sa porte, jamais en
 *             arrière ni de côté. Le rail interdit un axe, l'ancre interdit
 *             trois directions sur quatre : on ne peut pas l'écarter pour
 *             dégager un passage, il faut faire le tour.
 *  - ENCOMBRANT : un bloc qui consomme DEUX FOIS sa taille dans la capacité de
 *             la porte. Il ne change rien au déplacement, tout au routage : la
 *             porte qui l'accueille se referme sur les autres.
 *
 * Chaque monde n'en introduit qu'un (voir REALMS dans levels.js). Un type de
 * bloc jamais rencontré doit pouvoir s'apprendre sur une grille par ailleurs
 * connue, sinon le joueur ne sait pas à quoi attribuer sa difficulté.
 */
export const KIND = Object.freeze({
  NORMAL: 'normal',
  WALL: 'wall',
  LOCKED: 'locked',
  RAIL: 'rail',
  JOKER: 'joker',
  ANCRE: 'ancre',
  ENCOMBRANT: 'encombrant',
});

/** Types qu'un joueur peut saisir (les murs, non). */
export const DEPLACABLES = new Set([
  KIND.NORMAL, KIND.LOCKED, KIND.RAIL, KIND.JOKER, KIND.ANCRE, KIND.ENCOMBRANT,
]);

/**
 * Ce que ce bloc coûte à la porte qui l'avale, en cases de capacité.
 *
 * Partagé par le moteur, le solveur et le générateur : c'est la seule façon de
 * garantir qu'ils comptent tous les trois la même chose. Un générateur qui
 * provisionnerait moins que ce que le moteur consomme produirait des niveaux
 * infaisables, et le joueur ne pourrait pas le prévoir.
 */
export function coutCapacite(block) {
  return block.cells.length * (block.kind === KIND.ENCOMBRANT ? 2 : 1);
}

/**
 * Palette. Le glyphe n'est pas décoratif : c'est lui, et non la teinte, qui
 * identifie une famille — il ne change jamais, quand les couleurs, elles,
 * changent à chaque monde.
 *
 * Il était aussi porté par les portes, ce qui donnait l'appariement bloc/porte
 * sans recourir à la couleur. Les portes affichent désormais le SENS de sortie
 * (▲▶▼◀) ; l'appariement passe donc par la teinte, et le nom de la couleur
 * reste dans l'infobulle de la porte.
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
  /** @param {{id?, color, cells, x, y, kind?, axis?, dir?, condition?}} data */
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
     * Direction autorisée pour un bloc ANCRE : 'top' | 'right' | 'bottom' |
     * 'left'. C'est celle de sa porte, et la flèche portée sur le bloc la dit.
     */
    this.dir = data.dir || null;
    /**
     * Condition de déverrouillage d'un bloc LOCKED. Deux formes :
     *   { type: 'exits', count: n }  — n blocs doivent être sortis
     *   { type: 'color', color: c }  — la couleur c doit avoir quitté la grille
     *
     * Le décompte se lit sur le bloc. La condition de couleur a longtemps été
     * écartée comme indevinable — le joueur ne sait pas combien de blocs de
     * cette couleur restent — jusqu'à ce que le bloc porte le glyphe de la
     * couleur attendue : il lui suffit alors de compter à l'écran ce qu'il voit.
     * Elle n'apparaît qu'au dernier monde, quand le décompte est acquis.
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
                       kind: this.kind, axis: this.axis, dir: this.dir, condition: this.condition });
  }
}

export function resetBlockIds() { nextId = 1; }
