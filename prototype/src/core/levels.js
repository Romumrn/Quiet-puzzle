/**
 * LevelManager — equivalent of Scripts/Gameplay/LevelManager.cs (tech doc §4)
 *
 * Levels are generated BACKWARDS, and that is the important part: instead of
 * dropping blocks at random and hoping the result is playable, each block is
 * brought IN through its gate and then walked back into the grid. A level built
 * this way is solvable by construction, and the backward walk yields a
 * reference solution for free — used by the tests, by balancing, and available
 * to the hint system.
 *
 * The solving order is the reverse of the placement order: the last block
 * placed is the first to leave, and its path is clear since it was carved out
 * when only the earlier blocks were there.
 *
 * The RNG is seeded: level n always produces the same grid.
 * Every object matches the shape of `GET /api/level/{levelNumber}` (doc §6.1).
 */

import { SHAPES, LARGE_SHAPES, KIND, capacityCost, colorsOf } from './block.js';
import { Board, SIDES as EXIT_VECTORS } from './board.js';
import { solve } from './solver.js';
import { starThresholds } from './stars.js';

/**
 * A realm spans twenty levels and is defined by a single row of the table
 * below. It brings the player three things, always all three together:
 *
 *  1. A NOVELTY — a block kind, or a rule, they have never seen.
 *  2. A PALETTE — the six families keep their glyphs (●◆▲★■⬢), which carry the
 *     rule, but change hue: the realm is recognisable at a glance without
 *     block/gate matching having to be relearnt.
 *  3. A STEP UP IN DIFFICULTY — a bigger grid, one more colour or gate, and
 *     above all a capacity margin that keeps tightening.
 *
 * Twenty levels per realm rather than five: a new mechanic needs practising
 * before it is combined with the next one. Difficulty rises WITHIN a realm (the
 * quantities written `[start, end]` are interpolated over its twenty levels)
 * and steps up BETWEEN realms.
 */
export const LEVELS_PER_REALM = 20;

export const REALMS = [
  {
    id: 0,
    name: { fr: 'Peaceful Sakura', en: 'Peaceful Sakura', es: 'Peaceful Sakura', it: 'Peaceful Sakura', zh: 'Peaceful Sakura' },
    difficulty: { fr: 'apprentissage', en: 'learning the ropes', es: 'aprendizaje', it: 'apprendistato', zh: '入门' },
    hue: 345,
    palette: ['#eb9aad', '#93bde4', '#97cfb6', '#e9cd8c', '#bdaadd', '#f0b18b'],
    novelty: null,
    introduces: { fr: 'Les blocs et leurs portes', en: 'Blocks and their gates', es: 'Los bloques y sus puertas', it: 'I blocchi e le loro porte', zh: '方块与它们的门' },
    W: 5, H: 5, colorCount: 3, gateCount: 3,
    walls: [0, 0], locks: [0, 0], rails: [0, 0], anchors: [0, 0], bulky: [0, 0],
    jokers: 0, margin: null, colorSeal: false,
  },
  {
    id: 1,
    name: { fr: 'Wisteria Veil', en: 'Wisteria Veil', es: 'Wisteria Veil', it: 'Wisteria Veil', zh: 'Wisteria Veil' },
    difficulty: { fr: 'facile', en: 'easy', es: 'fácil', it: 'facile', zh: '简单' },
    hue: 275,
    palette: ['#e8907b', '#7fb0c9', '#a9c48b', '#edc073', '#c39fc0', '#d9a06b'],
    novelty: KIND.RAIL,
    introduces: { fr: 'Blocs sur glissière, portes à capacité', en: 'Blocks on rails, gates with a capacity', es: 'Bloques sobre raíles, puertas con capacidad', it: 'Blocchi su binario, porte con capienza', zh: '滑轨方块，限量的门' },
    W: 6, H: 6, colorCount: 4, gateCount: 4,
    walls: [0, 1], locks: [0, 0], rails: [1, 5], anchors: [0, 0], bulky: [0, 0],
    jokers: 0, margin: 1, colorSeal: false,
  },
  {
    id: 2,
    name: { fr: 'Blue Lys', en: 'Blue Lys', es: 'Blue Lys', it: 'Blue Lys', zh: 'Blue Lys' },
    difficulty: { fr: 'moyen', en: 'medium', es: 'medio', it: 'medio', zh: '中等' },
    hue: 225,
    palette: ['#d99aa8', '#8cc6e0', '#8fd3c4', '#d7d295', '#aeb3e0', '#e2b3a6'],
    novelty: KIND.WALL,
    introduces: { fr: 'Blocs scellés, immobiles', en: 'Sealed blocks that never move', es: 'Bloques sellados, inmóviles', it: 'Blocchi sigillati, immobili', zh: '封死不动的方块' },
    W: 6, H: 7, colorCount: 4, gateCount: 4,
    walls: [1, 4], locks: [0, 0], rails: [2, 6], anchors: [0, 0], bulky: [0, 0],
    jokers: 0, margin: 1, colorSeal: false,
  },
  {
    id: 3,
    name: { fr: 'Forget Me Not', en: 'Forget Me Not', es: 'Forget Me Not', it: 'Forget Me Not', zh: 'Forget Me Not' },
    difficulty: { fr: 'soutenu', en: 'steady', es: 'sostenido', it: 'sostenuto', zh: '进阶' },
    hue: 200,
    palette: ['#e493b4', '#8fa8e2', '#86cbb0', '#e3c886', '#b49ae0', '#7fc4d4'],
    novelty: KIND.LOCKED,
    introduces: { fr: 'Verrous à décompte', en: 'Locks with a countdown', es: 'Cerrojos con cuenta atrás', it: 'Serrature con conto alla rovescia', zh: '带计数的锁' },
    W: 6, H: 8, colorCount: 5, gateCount: 5,
    walls: [1, 4], locks: [1, 3], rails: [3, 7], anchors: [0, 0], bulky: [0, 0],
    jokers: 0, margin: 0, colorSeal: false,
  },
  {
    id: 4,
    name: { fr: 'Eucalyptus Calm', en: 'Eucalyptus Calm', es: 'Eucalyptus Calm', it: 'Eucalyptus Calm', zh: 'Eucalyptus Calm' },
    difficulty: { fr: 'exigeant', en: 'demanding', es: 'exigente', it: 'impegnativo', zh: '考验' },
    hue: 145,
    palette: ['#dd9b95', '#96b6cc', '#9fc9a4', '#d9bd7f', '#b2a6c9', '#e0a97f'],
    novelty: KIND.JOKER,
    introduces: { fr: 'Le joker, qui sort par où il veut', en: 'The joker, which leaves by any gate', es: 'El comodín, que sale por donde quiere', it: 'Il jolly, che esce da dove vuole', zh: '万能方块，任意门皆可' },
    W: 6, H: 8, colorCount: 5, gateCount: 5,
    walls: [2, 4], locks: [1, 3], rails: [4, 9], anchors: [0, 0], bulky: [0, 0],
    jokers: 1, margin: 0, colorSeal: false,
  },
  {
    id: 5,
    name: { fr: 'Mimosa Sun', en: 'Mimosa Sun', es: 'Mimosa Sun', it: 'Mimosa Sun', zh: 'Mimosa Sun' },
    difficulty: { fr: 'redoutable', en: 'formidable', es: 'temible', it: 'temibile', zh: '棘手' },
    hue: 55,
    palette: ['#ec9cc0', '#8ec7d9', '#93cf8e', '#dfd083', '#c1a3dc', '#efb28f'],
    novelty: KIND.ANCHOR,
    introduces: { fr: 'Ancres, qui n’avancent que vers leur porte', en: 'Anchors, which only move towards their gate', es: 'Anclas, que solo avanzan hacia su puerta', it: 'Ancore, che avanzano solo verso la loro porta', zh: '锚块，只朝自己的门前进' },
    W: 7, H: 8, colorCount: 6, gateCount: 6,
    walls: [2, 5], locks: [1, 3], rails: [4, 9], anchors: [1, 4], bulky: [0, 0],
    jokers: 1, margin: 0, colorSeal: false,
  },
  {
    id: 6,
    name: { fr: 'Golden Ginkgo', en: 'Golden Ginkgo', es: 'Golden Ginkgo', it: 'Golden Ginkgo', zh: 'Golden Ginkgo' },
    difficulty: { fr: 'implacable', en: 'relentless', es: 'implacable', it: 'implacabile', zh: '严苛' },
    hue: 40,
    palette: ['#d792bb', '#8bacdf', '#8ecdc0', '#e6cd90', '#a99ae0', '#e5a3a0'],
    novelty: KIND.BULKY,
    introduces: { fr: 'Encombrants, qui coûtent double à leur porte', en: 'Heavy blocks, which cost their gate double', es: 'Voluminosos, que cuestan el doble a su puerta', it: 'Ingombranti, che costano il doppio alla loro porta', zh: '笨重方块，占用双倍容量' },
    W: 7, H: 8, colorCount: 6, gateCount: 6,
    walls: [3, 5], locks: [2, 3], rails: [5, 10], anchors: [2, 5], bulky: [1, 4],
    jokers: 1, margin: 0, colorSeal: false,
  },
  {
    id: 7,
    name: { fr: 'Autumn Elm', en: 'Autumn Elm', es: 'Autumn Elm', it: 'Autumn Elm', zh: 'Autumn Elm' },
    difficulty: { fr: 'intransigeant', en: 'unyielding', es: 'intransigente', it: 'intransigente', zh: '严厉' },
    hue: 25,
    palette: ['#ef8fa6', '#85b8e8', '#8ad4b1', '#f0cd7e', '#b99ae6', '#f4ab84'],
    novelty: 'color-seal',
    introduces: { fr: 'Des scellés qui attendent qu’une couleur ait disparu', en: 'Seals that wait for a whole colour to be gone', es: 'Sellos que esperan a que un color desaparezca', it: 'Sigilli che attendono la scomparsa di un colore', zh: '颜色封印：某色清空才解锁' },
    W: 8, H: 8, colorCount: 6, gateCount: 7,
    walls: [3, 6], locks: [2, 4], rails: [6, 12], anchors: [3, 6], bulky: [2, 5],
    // This realm used to close the game, and its tuning said so: no joker, not
    // an inch of margin. Once it became the eighth of eighteen, that mid-run
    // spike made the four realms after it feel easier than itself. Exact gate
    // capacity therefore belongs to the very last realm, where it belongs.
    jokers: 1, margin: 0, colorSeal: true,
  },
  {
    id: 8,
    name: { fr: 'Winter Maple', en: 'Winter Maple', es: 'Winter Maple', it: 'Winter Maple', zh: 'Winter Maple' },
    difficulty: { fr: 'retors', en: 'crafty', es: 'retorcido', it: 'insidioso', zh: '刁钻' },
    hue: 5,
    palette: ['#e0a08e', '#8fb9d6', '#a3ca9a', '#e3c37f', '#b7a4d4', '#dfa77f'],
    novelty: KIND.DUAL,
    introduces: { fr: 'Blocs bicolores, qui hésitent entre deux portes', en: 'Two-colour blocks, torn between two gates', es: 'Bloques bicolores, que dudan entre dos puertas', it: 'Blocchi bicolori, indecisi fra due porte', zh: '双色方块，可走两种门' },
    W: 8, H: 8, colorCount: 6, gateCount: 7,
    walls: [3, 6], locks: [2, 4], rails: [6, 12],
    anchors: [3, 6], bulky: [2, 5], duals: [1, 4],
    jokers: 1, margin: 0, colorSeal: false,
  },
  {
    id: 9,
    name: { fr: 'Apple Blossom', en: 'Apple Blossom', es: 'Apple Blossom', it: 'Apple Blossom', zh: 'Apple Blossom' },
    difficulty: { fr: 'serré', en: 'tight', es: 'ajustado', it: 'stretto', zh: '局促' },
    hue: 30,
    palette: ['#dd8f96', '#8aa9cc', '#93c197', '#dcbd7c', '#ac9ccc', '#dc9d84'],
    novelty: 'narrow-gate',
    introduces: { fr: 'Des portes de deux cases, jamais plus', en: 'Gates two cells wide, never more', es: 'Puertas de dos casillas, nunca más', it: 'Porte di due caselle, mai di più', zh: '门宽只有两格' },
    W: 8, H: 8, colorCount: 6, gateCount: 7,
    walls: [4, 6], locks: [3, 4], rails: [7, 12],
    anchors: [4, 7], bulky: [3, 6], duals: [1, 3],
    wideGateRatio: 0.0,
    jokers: 1, margin: 0, colorSeal: false,
  },
  {
    id: 10,
    name: { fr: 'Quiet Camellia', en: 'Quiet Camellia', es: 'Quiet Camellia', it: 'Quiet Camellia', zh: 'Quiet Camellia' },
    difficulty: { fr: 'massif', en: 'massive', es: 'macizo', it: 'massiccio', zh: '厚重' },
    hue: 345,
    palette: ['#d18fa8', '#7fa4d8', '#87c3ae', '#d9c084', '#a396d6', '#d59a94'],
    novelty: 'large-shapes',
    introduces: { fr: 'Plus une seule pièce d’une case', en: 'Not a single one-cell piece left', es: 'Ni una sola pieza de una casilla', it: 'Non più un solo pezzo da una casella', zh: '不再有单格方块' },
    W: 9, H: 8, colorCount: 6, gateCount: 7,
    walls: [3, 6], locks: [3, 4], rails: [7, 13],
    anchors: [4, 7], bulky: [3, 6], duals: [1, 3],
    minShapeSize: 2, density: [0.26, 0.33],
    jokers: 1, margin: 0, colorSeal: false,
  },
  {
    id: 11,
    name: { fr: 'Lilac Drift', en: 'Lilac Drift', es: 'Lilac Drift', it: 'Lilac Drift', zh: 'Lilac Drift' },
    difficulty: { fr: 'trompeur', en: 'deceptive', es: 'engañoso', it: 'ingannevole', zh: '迷惑' },
    hue: 275,
    palette: ['#cf94a4', '#84b4cc', '#8fc98f', '#d4c286', '#a89dd0', '#d9a68a'],
    novelty: 'shared-gate',
    introduces: { fr: 'Des portes qui servent deux couleurs à la fois', en: 'Gates serving two colours at once', es: 'Puertas que sirven a dos colores a la vez', it: 'Porte che servono due colori insieme', zh: '一门通两色' },
    W: 9, H: 8, colorCount: 6, gateCount: 7,
    walls: [4, 6], locks: [3, 5], rails: [7, 13],
    anchors: [4, 7], bulky: [3, 6], duals: [1, 3],
    sharedGates: [1, 3],
    jokers: 1, margin: 0, colorSeal: false,
  },
  {
    id: 12,
    name: { fr: 'Cornflower Blue', en: 'Cornflower Blue', es: 'Cornflower Blue', it: 'Cornflower Blue', zh: 'Cornflower Blue' },
    difficulty: { fr: 'méthodique', en: 'methodical', es: 'metódico', it: 'metodico', zh: '讲究次序' },
    hue: 225,
    palette: ['#d68fb0', '#8ba6d4', '#8ccbb4', '#dfc57f', '#ab97d8', '#e0a292'],
    novelty: 'key',
    introduces: { fr: 'Une clé, dont la sortie ouvre tous les verrous', en: 'A key whose exit opens every lock', es: 'Una llave cuya salida abre todos los cerrojos', it: 'Una chiave la cui uscita apre tutte le serrature', zh: '一把钥匙，出门即开所有锁' },
    W: 9, H: 9, colorCount: 6, gateCount: 7,
    walls: [4, 6], locks: [3, 5], rails: [7, 13],
    anchors: [4, 7], bulky: [3, 6], duals: [1, 3],
    sharedGates: [2, 3], density: [0.26, 0.34],
    jokers: 1, margin: 0, colorSeal: false, key: true, largeShapes: true,
  },
  {
    id: 13,
    name: { fr: 'Morning Glory', en: 'Morning Glory', es: 'Morning Glory', it: 'Morning Glory', zh: 'Morning Glory' },
    difficulty: { fr: 'étouffant', en: 'stifling', es: 'asfixiante', it: 'soffocante', zh: '拥塞' },
    hue: 200,
    palette: ['#cd8c9e', '#7fa8c8', '#84c2a4', '#d3bd7a', '#a291cc', '#d29a88'],
    novelty: null,
    introduces: { fr: 'Des grilles remplies aux trois quarts', en: 'Grids packed three quarters full', es: 'Cuadrículas llenas en tres cuartos', it: 'Griglie piene per tre quarti', zh: '棋盘塞满四分之三' },
    W: 9, H: 9, colorCount: 6, gateCount: 8,
    walls: [4, 7], locks: [3, 5], rails: [8, 14],
    anchors: [5, 8], bulky: [3, 7], duals: [1, 3],
    sharedGates: [1, 2], density: [0.27, 0.35],
    jokers: 1, margin: 0, colorSeal: false, largeShapes: true,
  },
  {
    id: 14,
    name: { fr: 'Sage Fern', en: 'Sage Fern', es: 'Sage Fern', it: 'Sage Fern', zh: 'Sage Fern' },
    difficulty: { fr: 'éprouvant', en: 'punishing', es: 'duro', it: 'duro', zh: '磨人' },
    hue: 145,
    palette: ['#dba38c', '#8fb2c4', '#9ec69b', '#dcc07e', '#b19dc8', '#d9a17e'],
    novelty: null,
    introduces: { fr: 'Tous les blocs du jeu, dans la même grille', en: 'Every block in the game, on one grid', es: 'Todos los bloques del juego en una misma cuadrícula', it: 'Tutti i blocchi del gioco, nella stessa griglia', zh: '所有方块类型齐聚一盘' },
    W: 9, H: 9, colorCount: 6, gateCount: 8,
    walls: [5, 7], locks: [4, 6], rails: [9, 15],
    anchors: [5, 9], bulky: [4, 8], duals: [2, 4],
    sharedGates: [1, 3],
    jokers: 1, margin: 0, colorSeal: true, key: true, demandTarget: 16, largeShapes: true,
  },
  {
    id: 15,
    name: { fr: 'Honey Acacia', en: 'Honey Acacia', es: 'Honey Acacia', it: 'Honey Acacia', zh: 'Honey Acacia' },
    difficulty: { fr: 'impitoyable', en: 'merciless', es: 'despiadado', it: 'spietato', zh: '无情' },
    hue: 55,
    palette: ['#c98fae', '#8299d4', '#83c0b0', '#cfbc84', '#9f92d2', '#cf9a95'],
    novelty: null,
    introduces: { fr: 'Plus de joker : rien pour desserrer la grille', en: 'No joker left to loosen the grid', es: 'Sin comodín: nada que afloje la cuadrícula', it: 'Niente jolly: nulla che allenti la griglia', zh: '没有万能方块可依靠' },
    W: 9, H: 10, colorCount: 6, gateCount: 8,
    walls: [5, 7], locks: [4, 6], rails: [9, 15],
    anchors: [6, 9], bulky: [4, 8], duals: [2, 4],
    sharedGates: [2, 3], wideGateRatio: 0.2,
    jokers: 0, margin: 0, colorSeal: true, key: true, demandTarget: 20, largeShapes: true,
  },
  {
    id: 16,
    name: { fr: 'Amber Birch', en: 'Amber Birch', es: 'Amber Birch', it: 'Amber Birch', zh: 'Amber Birch' },
    difficulty: { fr: 'vertigineux', en: 'dizzying', es: 'vertiginoso', it: 'vertiginoso', zh: '眩目' },
    hue: 40,
    palette: ['#c88fa0', '#7ea6cc', '#7fc3a2', '#ccba7c', '#9c8ecd', '#cd9885'],
    novelty: null,
    introduces: { fr: 'Les plus vastes grilles du jeu', en: 'The largest grids in the game', es: 'Las cuadrículas más amplias del juego', it: 'Le griglie più vaste del gioco', zh: '全游戏最大的棋盘' },
    W: 9, H: 10, colorCount: 6, gateCount: 8,
    walls: [5, 8], locks: [4, 6], rails: [10, 16],
    anchors: [6, 10], bulky: [5, 9], duals: [2, 4],
    sharedGates: [2, 3], wideGateRatio: 0.2, minShapeSize: 2, density: [0.26, 0.33],
    jokers: 0, margin: 0, colorSeal: true, key: true, demandTarget: 26, largeShapes: true,
  },
  {
    id: 17,
    name: { fr: 'Apricot Branch', en: 'Apricot Branch', es: 'Apricot Branch', it: 'Apricot Branch', zh: 'Apricot Branch' },
    difficulty: { fr: 'sans retour', en: 'no way back', es: 'sin retorno', it: 'senza ritorno', zh: '无路可退' },
    hue: 25,
    palette: ['#c98b9c', '#7ba2cc', '#7cc09f', '#cbb679', '#9a8aca', '#ca9482'],
    novelty: null,
    introduces: { fr: 'Des portes au comptage exact, et rien pour se rattraper', en: 'Gates counted to the cell, and nothing to fall back on', es: 'Puertas contadas al detalle y nada a lo que recurrir', it: 'Porte contate al millimetro e nulla su cui ripiegare', zh: '门的容量精确到格，毫无退路' },
    W: 9, H: 11, colorCount: 6, gateCount: 8,
    walls: [5, 8], locks: [5, 7], rails: [10, 16],
    anchors: [7, 10], bulky: [5, 9], duals: [2, 4],
    sharedGates: [2, 4], wideGateRatio: 0.15, minShapeSize: 2, density: [0.27, 0.34],
    jokers: 0, margin: 0, colorSeal: true, key: true, demandTarget: 32, largeShapes: true,
  },
  {
    id: 18,
    name: { fr: 'Red Berry', en: 'Red Berry', es: 'Red Berry', it: 'Red Berry', zh: 'Red Berry' },
    difficulty: { fr: 'nœud', en: 'knotted', es: 'enredado', it: 'intricato', zh: '纠缠' },
    hue: 5,
    palette: ['#c78ba6', '#7d9fd0', '#7ec3a8', '#c9b47e', '#9a8ccb', '#c99688'],
    novelty: null,
    introduces: { fr: 'Des blocs qui se gênent : il faut trouver l’ordre', en: 'Blocks that get in each other’s way: the order matters', es: 'Bloques que se estorban: hay que dar con el orden', it: 'Blocchi che si ostacolano: bisogna trovare l’ordine', zh: '方块彼此挡路：顺序才是关键' },
    W: 9, H: 11, colorCount: 6, gateCount: 8,
    walls: [4, 7], locks: [4, 6], rails: [10, 16],
    anchors: [7, 11], bulky: [5, 9], duals: [0, 2],
    sharedGates: [2, 4], wideGateRatio: 0.15, minShapeSize: 2, density: [0.26, 0.32],
    jokers: 0, margin: 0, colorSeal: true, key: true, demandTarget: 40, largeShapes: true,
  },
  {
    id: 19,
    name: { fr: 'Snow Willow', en: 'Snow Willow', es: 'Snow Willow', it: 'Snow Willow', zh: 'Snow Willow' },
    difficulty: { fr: 'inextricable', en: 'inextricable', es: 'inextricable', it: 'inestricabile', zh: '无解之局' },
    hue: 30,
    palette: ['#c4879c', '#7799c9', '#78bd9c', '#c4b075', '#9385c6', '#c58f80'],
    novelty: null,
    introduces: { fr: 'Chaque sortie en ferme une autre', en: 'Every exit closes another one', es: 'Cada salida cierra otra', it: 'Ogni uscita ne chiude un’altra', zh: '每开一门，另一门便闭' },
    W: 9, H: 11, colorCount: 6, gateCount: 8,
    walls: [5, 8], locks: [5, 7], rails: [12, 18],
    anchors: [8, 12], bulky: [6, 10], duals: [0, 1],
    sharedGates: [3, 5], wideGateRatio: 0.1, minShapeSize: 2, density: [0.27, 0.33],
    jokers: 0, margin: 0, colorSeal: true, key: true, demandTarget: 48, largeShapes: true,
  },
  {
    id: 20,
    name: { fr: 'Blush Plum', en: 'Blush Plum', es: 'Blush Plum', it: 'Blush Plum', zh: 'Blush Plum' },
    difficulty: { fr: 'cloisonné', en: 'partitioned', es: 'compartimentado', it: 'compartimentato', zh: '分隔' },
    hue: 345,
    palette: ['#c98fa4', '#849dc6', '#83bfa4', '#c8b47c', '#9c8dc4', '#c99a8a'],
    novelty: null,
    introduces: { fr: 'Des murs partout : l’espace se referme', en: 'Walls everywhere: the space closes in', es: 'Muros por doquier: el espacio se cierra', it: 'Muri ovunque: lo spazio si chiude', zh: '四处是墙，空间收紧' },
    W: 9, H: 11, colorCount: 6, gateCount: 8,
    walls: [7, 10], locks: [3, 5], rails: [8, 13],
    anchors: [5, 8], bulky: [4, 7], duals: [0, 2],
    sharedGates: [2, 3], wideGateRatio: 0.12, minShapeSize: 2, density: [0.22, 0.28],
    jokers: 0, margin: 0, colorSeal: true, key: true, demandTarget: 56, largeShapes: true,
  },
  {
    id: 21,
    name: { fr: 'Lavender Field', en: 'Lavender Field', es: 'Lavender Field', it: 'Lavender Field', zh: 'Lavender Field' },
    difficulty: { fr: 'enchaîné', en: 'chained', es: 'encadenado', it: 'concatenato', zh: '环环相扣' },
    hue: 275,
    palette: ['#c58ba0', '#7fa3cb', '#7cc0a8', '#c6b17e', '#9689c8', '#c69688'],
    novelty: null,
    introduces: { fr: 'Des verrous qui s’ouvrent l’un après l’autre', en: 'Locks that open one after another', es: 'Cerrojos que se abren uno tras otro', it: 'Serrature che si aprono una dopo l’altra', zh: '锁需依次开启' },
    W: 9, H: 11, colorCount: 6, gateCount: 8,
    walls: [4, 7], locks: [6, 9], rails: [8, 13],
    anchors: [5, 9], bulky: [4, 7], duals: [0, 2],
    sharedGates: [2, 4], wideGateRatio: 0.12, minShapeSize: 2, density: [0.22, 0.28],
    jokers: 0, margin: 0, colorSeal: true, key: true, demandTarget: 64, largeShapes: true,
  },
  {
    id: 22,
    name: { fr: 'Blue Hydrangea', en: 'Blue Hydrangea', es: 'Blue Hydrangea', it: 'Blue Hydrangea', zh: 'Blue Hydrangea' },
    difficulty: { fr: 'rigide', en: 'rigid', es: 'rígido', it: 'rigido', zh: '僵硬' },
    hue: 225,
    palette: ['#d2947e', '#86aec2', '#93c191', '#ccb377', '#a292c0', '#cc9b7e'],
    novelty: null,
    introduces: { fr: 'Presque rien ne circule librement', en: 'Almost nothing moves freely', es: 'Casi nada circula libremente', it: 'Quasi nulla si muove liberamente', zh: '几乎无一可自由移动' },
    W: 9, H: 11, colorCount: 6, gateCount: 8,
    walls: [4, 6], locks: [4, 6], rails: [13, 19],
    anchors: [9, 14], bulky: [3, 6], duals: [0, 2],
    sharedGates: [2, 3], wideGateRatio: 0.12, minShapeSize: 2, density: [0.22, 0.28],
    jokers: 0, margin: 0, colorSeal: true, key: true, demandTarget: 72, largeShapes: true,
  },
  {
    id: 23,
    name: { fr: 'Winter Frost', en: 'Winter Frost', es: 'Winter Frost', it: 'Winter Frost', zh: 'Winter Frost' },
    difficulty: { fr: 'pesant', en: 'weighty', es: 'pesado', it: 'pesante', zh: '沉重' },
    hue: 200,
    palette: ['#c08bb0', '#8296cc', '#7fbdac', '#c4ad7d', '#9887c9', '#c1948f'],
    novelty: null,
    introduces: { fr: 'Les encombrants saturent les portes', en: 'Heavy blocks saturate the gates', es: 'Los voluminosos saturan las puertas', it: 'Gli ingombranti saturano le porte', zh: '笨重方块塞满门口' },
    W: 9, H: 11, colorCount: 6, gateCount: 8,
    walls: [4, 7], locks: [4, 6], rails: [8, 12],
    anchors: [5, 9], bulky: [9, 14], duals: [0, 2],
    sharedGates: [2, 4], wideGateRatio: 0.12, minShapeSize: 2, density: [0.22, 0.28],
    jokers: 0, margin: 0, colorSeal: true, key: true, demandTarget: 80, largeShapes: true,
  },
  {
    id: 24,
    name: { fr: 'Bamboo Breeze', en: 'Bamboo Breeze', es: 'Bamboo Breeze', it: 'Bamboo Breeze', zh: 'Bamboo Breeze' },
    difficulty: { fr: 'trouble', en: 'murky', es: 'turbio', it: 'torbido', zh: '混沌' },
    hue: 145,
    palette: ['#c68fa2', '#84a8c9', '#88c495', '#c9b57a', '#9c8ec6', '#c59a85'],
    novelty: null,
    introduces: { fr: 'Presque chaque porte sert deux couleurs', en: 'Nearly every gate serves two colours', es: 'Casi cada puerta sirve a dos colores', it: 'Quasi ogni porta serve due colori', zh: '几乎每道门都通两色' },
    W: 9, H: 11, colorCount: 6, gateCount: 8,
    walls: [4, 7], locks: [4, 6], rails: [9, 14],
    anchors: [6, 10], bulky: [5, 8], duals: [0, 2],
    sharedGates: [5, 7], wideGateRatio: 0.12, minShapeSize: 2, density: [0.22, 0.28],
    jokers: 0, margin: 0, colorSeal: true, key: true, demandTarget: 88, largeShapes: true,
  },
  {
    id: 25,
    name: { fr: 'Yellow Broom', en: 'Yellow Broom', es: 'Yellow Broom', it: 'Yellow Broom', zh: 'Yellow Broom' },
    difficulty: { fr: 'inextricable', en: 'tangled', es: 'intrincado', it: 'intricato', zh: '纠缠难解' },
    hue: 55,
    palette: ['#bd88a4', '#7d95c6', '#79bba6', '#c0aa78', '#9184c4', '#bf9086'],
    novelty: null,
    introduces: { fr: 'De grosses pièces dans des couloirs étroits', en: 'Big pieces in narrow corridors', es: 'Piezas grandes en pasillos estrechos', it: 'Pezzi grandi in corridoi stretti', zh: '大块方块，窄小通道' },
    W: 9, H: 11, colorCount: 6, gateCount: 8,
    walls: [7, 10], locks: [4, 6], rails: [9, 14],
    anchors: [7, 11], bulky: [5, 9], duals: [0, 2],
    sharedGates: [3, 5], wideGateRatio: 0.12, minShapeSize: 2, density: [0.22, 0.28],
    jokers: 0, margin: 0, colorSeal: true, key: true, demandTarget: 96, largeShapes: true,
  },
  {
    id: 26,
    name: { fr: 'Wheat Field', en: 'Wheat Field', es: 'Wheat Field', it: 'Wheat Field', zh: 'Wheat Field' },
    difficulty: { fr: 'implacable', en: 'relentless', es: 'implacable', it: 'implacabile', zh: '毫不留情' },
    hue: 40,
    palette: ['#c4877f', '#83a3c0', '#84bd93', '#c3ae76', '#9787c2', '#c3927c'],
    novelty: null,
    introduces: { fr: 'Tout se déplace sur un rail ou une flèche', en: 'Everything runs on a rail or an arrow', es: 'Todo se mueve sobre un raíl o una flecha', it: 'Tutto scorre su un binario o una freccia', zh: '一切皆循轨与箭' },
    W: 9, H: 11, colorCount: 6, gateCount: 8,
    walls: [4, 7], locks: [5, 7], rails: [15, 21],
    anchors: [11, 16], bulky: [4, 8], duals: [0, 2],
    sharedGates: [3, 5], wideGateRatio: 0.12, minShapeSize: 2, density: [0.22, 0.28],
    jokers: 0, margin: 0, colorSeal: true, key: true, demandTarget: 104, largeShapes: true,
  },
  {
    id: 27,
    name: { fr: 'Copper Beech', en: 'Copper Beech', es: 'Copper Beech', it: 'Copper Beech', zh: 'Copper Beech' },
    difficulty: { fr: 'compté', en: 'counted', es: 'contado', it: 'contato', zh: '分秒必争' },
    hue: 25,
    palette: ['#bd8697', '#7a9cc4', '#77bba2', '#bfa974', '#8f81be', '#bd8f81'],
    novelty: null,
    introduces: { fr: 'Chaque porte est comptée à la case près', en: 'Every gate counted to the cell', es: 'Cada puerta contada al detalle', it: 'Ogni porta contata al millimetro', zh: '每道门的容量精确到格' },
    W: 9, H: 11, colorCount: 6, gateCount: 8,
    walls: [5, 8], locks: [5, 7], rails: [10, 15],
    anchors: [8, 12], bulky: [6, 10], duals: [0, 2],
    sharedGates: [3, 5], wideGateRatio: 0.12, minShapeSize: 2, density: [0.22, 0.28],
    jokers: 0, margin: 0, colorSeal: true, key: true, demandTarget: 112, largeShapes: true,
  },
  {
    id: 28,
    name: { fr: 'Crimson Vine', en: 'Crimson Vine', es: 'Crimson Vine', it: 'Crimson Vine', zh: 'Crimson Vine' },
    difficulty: { fr: 'sans complaisance', en: 'unforgiving', es: 'sin concesiones', it: 'senza sconti', zh: '绝不宽容' },
    hue: 5,
    palette: ['#b9839f', '#7692c0', '#73b79e', '#bba572', '#8b7dba', '#b98b7d'],
    novelty: null,
    introduces: { fr: 'Tout le jeu à la fois, sans rien pour souffler', en: 'The whole game at once, no let-up', es: 'Todo el juego a la vez, sin respiro', it: 'Tutto il gioco insieme, senza tregua', zh: '全部机制齐上，毫无喘息' },
    W: 9, H: 11, colorCount: 6, gateCount: 8,
    walls: [6, 9], locks: [6, 8], rails: [12, 18],
    anchors: [9, 14], bulky: [7, 11], duals: [0, 2],
    sharedGates: [4, 6], wideGateRatio: 0.12, minShapeSize: 2, density: [0.22, 0.28],
    jokers: 0, margin: 0, colorSeal: true, key: true, demandTarget: 122, largeShapes: true,
  },
  {
    id: 29,
    name: { fr: 'Silver Mist', en: 'Silver Mist', es: 'Silver Mist', it: 'Silver Mist', zh: 'Silver Mist' },
    difficulty: { fr: 'vertigineux', en: 'dizzying', es: 'vertiginoso', it: 'vertiginoso', zh: '令人眩晕' },
    hue: 30,
    palette: ['#b57f9b', '#728ebc', '#6fb39a', '#b7a16e', '#8779b6', '#b58779'],
    novelty: null,
    introduces: { fr: 'Les grilles les plus retorses du jeu', en: 'The most devious grids in the game', es: 'Las cuadrículas más retorcidas del juego', it: 'Le griglie più insidiose del gioco', zh: '全游戏最刁钻的棋盘' },
    W: 9, H: 11, colorCount: 6, gateCount: 8,
    walls: [6, 9], locks: [6, 9], rails: [13, 19],
    anchors: [10, 15], bulky: [8, 12], duals: [0, 2],
    sharedGates: [4, 7], wideGateRatio: 0.12, minShapeSize: 2, density: [0.22, 0.28],
    jokers: 0, margin: 0, colorSeal: true, key: true, demandTarget: 135, largeShapes: true,
  },];

export const TOTAL_LEVELS = REALMS.length * LEVELS_PER_REALM;

/** The realm level `n` belongs to (1-indexed). */
export function realmOf(n) {
  return REALMS[Math.min(REALMS.length - 1, Math.floor((n - 1) / LEVELS_PER_REALM))];
}

const SIDES = ['top', 'right', 'bottom', 'left'];

/**
 * Can a block placed in a gate's opening really get out of it?
 *
 * A non-rectangular shape (T, L) hangs over on both sides of the gate: its
 * shoulders must be able to advance too. Without this check, generation
 * produced levels whose solution only held together because the engine let a
 * block pass straight through its neighbours.
 */
function canLeaveItsGate(grid, gate, shape, x, y, id) {
  const [dx, dy] = EXIT_VECTORS[gate.side];
  return shape.cells.every(([cx, cy]) => {
    const nx = x + cx + dx, ny = y + cy + dy;
    if (!grid.inside(nx, ny)) return true;
    const occ = grid.occ.get(grid.key(nx, ny));
    return occ === undefined || occ === id;
  });
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const shuffled = (rng, arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/**
 * Difficulty curve: what the generator must produce for level `n`.
 *
 * Everything comes from the REALMS table. The realm fixes the setting and the
 * ceilings, the position WITHIN the realm fixes the quantities: `t` is 0 at the
 * realm's first level and 1 at its twentieth, and every `[start, end]` interval
 * is read at that point. A mechanic therefore arrives drop by drop — one anchor
 * at level 101, six at level 120 — instead of landing all at once when the
 * realm changes.
 */
function curve(n) {
  const R = realmOf(n);
  const rank = (n - 1) % LEVELS_PER_REALM;                 // 0 … 19
  const t = LEVELS_PER_REALM > 1 ? rank / (LEVELS_PER_REALM - 1) : 0;
  const ramp = ([a, b]) => Math.round(a + (b - a) * t);

  // DENSITY makes the difficulty, not path length: an isolated block always
  // reaches its gate in a single drag. What makes you think is that blocks get
  // in each other's way and impose an exit order. So we aim for a well-filled
  // grid (55 to 70 % of cells occupied).
  //
  // The block count is derived from the AREA rather than from an absolute ramp:
  // that is the only way to get a grid as full at a realm's first level as at
  // the previous realm's last one, when the grid has just grown. A shape
  // averages 2.3 cells, hence the coefficients.
  const [lowDensity, highDensity] = R.density || [0.24, 0.33];
  const minShapeSize = R.minShapeSize ?? 1;
  // Four-cell bar, six-cell slab: reserved for the realms that announce them —
  // on a small grid, a single such piece blocks a whole row.
  const largeShapes = R.largeShapes === true;
  const shapeAllowed = (f) => largeShapes || !LARGE_SHAPES.has(f.key);

  // The block count is derived from the AREA, but it has to be corrected by the
  // SIZE of the available pieces: forbidding one-cell pieces raises the average,
  // and aiming for the same count amounted to asking for a grid 97 % full — the
  // generator could not manage it and the level became unfindable. The same
  // correction applies to large shapes when a realm excludes them: without it,
  // their mere presence in `SHAPES` would have skewed the density calibration
  // of every realm that does not use them.
  const meanSize = (min) => {
    const available = SHAPES.filter((f) => f.cells.length >= min && shapeAllowed(f));
    return available.reduce((sum, f) => sum + f.cells.length, 0) / available.length;
  };
  const correction = meanSize(1) / meanSize(minShapeSize);
  const blockCount = Math.round(
    R.W * R.H * (lowDensity + (highDensity - lowDensity) * t) * correction);


  return {
    W: R.W, H: R.H, colorCount: R.colorCount, gateCount: R.gateCount,
    walls: ramp(R.walls),
    locks: ramp(R.locks),
    rails: ramp(R.rails),
    anchors: ramp(R.anchors),
    bulky: ramp(R.bulky),
    duals: ramp(R.duals || [0, 0]),
    sharedGates: ramp(R.sharedGates || [0, 0]),
    // Share of three-cell gates, and minimum shape size: two levers that cost
    // the engine nothing and tighten the grid a great deal.
    wideGateRatio: R.wideGateRatio ?? 0.35,
    minShapeSize: R.minShapeSize ?? 1,
    largeShapes,
    key: R.key === true,
    // A "demanding" realm has its grids arbitrated by the solver: we keep the
    // one that requires the most backtracking rather than the densest one.
    // Expensive — a few seconds per level — so it is reserved for the realms
    // that make it their subject, and paid once at build time.
    demanding: R.demanding === true || R.demandTarget > 0,
    /**
     * States explored per block to reach before the search stops looking.
     *
     * This is the ONLY lever that still scales. Grid, colours, gates, block
     * kinds: everything is at its playable maximum, and piling on quantities
     * would only fill space. A target that rises from one realm to the next, on
     * the other hand, asks for grids where you go wrong more and more often
     * before finding the way — and that is exactly what "thinking" means here.
     */
    demandTarget: R.demandTarget ?? 12,
    jokers: R.jokers,
    blockCount,
    /**
     * Length of the backward walk, indexed on the REALM and not on how far the
     * player is through the whole game.
     *
     * It used to be: `11 + 5 × (n / TOTAL_LEVELS)`. Adding realms then changed
     * the walk-back of EVERY already-published level — hence their grid, hence
     * players' records. A quantity that decides the shape of a grid must depend
     * only on its realm, never on the length of the game.
     */
    walkBack: R.walkBack || [6, 11 + Math.min(5, R.id)],
    // `margin` is the slack granted to capacity gates, on top of what the
    // reference solution routes through them. Without capacity, no exit order
    // can be a bad one — clearing a block only frees up room — and the level
    // solves itself on the first try whatever the method. Capacity is the only
    // lever that creates a real puzzle; the shrinking margin tunes its severity,
    // down to zero in the last realm.
    capacity: R.margin !== null,
    margin: R.margin ?? 0,
    colorSeal: R.colorSeal,
  };
}

// ---------------------------------------------------------------------------
// Working grid
// ---------------------------------------------------------------------------

class Grid {
  constructor(W, H) { this.W = W; this.H = H; this.occ = new Map(); }
  key(x, y) { return y * this.W + x; }
  inside(x, y) { return x >= 0 && x < this.W && y >= 0 && y < this.H; }
  free(cells, except) {
    return cells.every(([x, y]) => {
      if (!this.inside(x, y)) return false;
      const o = this.occ.get(this.key(x, y));
      return o === undefined || o === except;
    });
  }
  place(id, cells) { for (const [x, y] of cells) this.occ.set(this.key(x, y), id); }
  remove(cells) { for (const [x, y] of cells) this.occ.delete(this.key(x, y)); }
}

const absolute = (shape, x, y) => shape.cells.map(([dx, dy]) => [x + dx, y + dy]);

/** Gates: spread over the sides, never overlapping, every colour served. */
function makeGates({ W, H, colorCount, gateCount, wideGateRatio, sharedGates }, rng) {
  const gates = [];
  const bySide = { top: [], right: [], bottom: [], left: [] };
  const lengthOf = (side) => (side === 'top' || side === 'bottom' ? W : H);

  const colors = shuffled(rng, [...Array(colorCount).keys()]);
  for (let i = 0; i < gateCount; i++) {
    const color = colors[i % colorCount];
    for (let attempt = 0; attempt < 40; attempt++) {
      const side = pick(rng, SIDES);
      const max = lengthOf(side);
      // `wideGateRatio` is the share of three-cell gates. Bringing it down to
      // zero only ever opens two-cell passages: bulky shapes then have to aim
      // precisely, and the choice of gate stops being a formality.
      const length = Math.min(max, rng() < wideGateRatio ? 3 : 2);
      const start = Math.floor(rng() * (max - length + 1));
      const overlaps = bySide[side].some((g) => start < g.start + g.length && g.start < start + length);
      if (overlaps) continue;
      const gate = { side, start, length, color };
      bySide[side].push(gate);
      gates.push(gate);
      break;
    }
  }

  // Shared gates: a second colour admitted. The player gains an option, and
  // loses the certainty that a gate only serves one family — two colours then
  // compete for the same capacity.
  for (let i = 0; i < (sharedGates || 0) && i < gates.length; i++) {
    const g = gates[gates.length - 1 - i];
    const others = colors.filter((c) => c !== g.color);
    if (!others.length) break;
    g.colors = [g.color, pick(rng, others)];
  }
  return gates;
}

/**
 * Keeps only the gates a placed block can actually use.
 *
 * Gates are opened BEFORE any block — one per realm colour — and the backward
 * placement starts from them. When it never manages to bring a block in through
 * one of them (walls, capacity, a shape too big, or the block quota reached
 * before its turn), that gate is left with no customers. This is not difficulty
 * but a FALSE CLUE: the player hunts for blocks of a colour that is not on the
 * grid. There were 125 of them, across 117 levels.
 *
 * Removing them cannot break anything: a gate no block accepts appears in no
 * solution — steps name a SIDE, not an index — and capacity is provisioned gate
 * by gate.
 *
 * A joker exits through any gate: its presence makes them all useful, and there
 * is nothing to remove.
 */
function usefulGates(gates, blocks) {
  if (blocks.some((b) => b.kind === KIND.JOKER)) return gates;
  const colors = new Set();
  for (const b of blocks) {
    if (b.kind === KIND.WALL) continue;
    for (const c of colorsOf(b)) if (c >= 0) colors.add(c);
  }
  const useful = gates.filter((g) => colorsOf(g).some((c) => colors.has(c)));
  // Safety net: a grid without a gate cannot be played. The case cannot occur —
  // every block came in through a gate — but the invariant costs one line and
  // the failure would cost an unplayable level.
  return useful.length ? useful : gates;
}

/**
 * Distance from a shape to its gate, in cells. This is the measure the backward
 * walk tries to maximise: a block sitting right in front of its gate asks the
 * player no question at all.
 */
function distanceToGate(gate, shape, x, y, W, H) {
  if (gate.side === 'right') return W - (x + shape.w);
  if (gate.side === 'left') return x;
  if (gate.side === 'bottom') return H - (y + shape.h);
  return y;
}

/** Placement position of a shape, pressed into a gate's opening. */
function placeAtGate(gate, shape, W, H, rng) {
  if (shape.w > (gate.side === 'top' || gate.side === 'bottom' ? gate.length : W)) return null;
  if (shape.h > (gate.side === 'left' || gate.side === 'right' ? gate.length : H)) return null;

  if (gate.side === 'right') {
    if (shape.h > gate.length) return null;
    return { x: W - shape.w, y: gate.start + Math.floor(rng() * (gate.length - shape.h + 1)) };
  }
  if (gate.side === 'left') {
    if (shape.h > gate.length) return null;
    return { x: 0, y: gate.start + Math.floor(rng() * (gate.length - shape.h + 1)) };
  }
  if (gate.side === 'bottom') {
    if (shape.w > gate.length) return null;
    return { x: gate.start + Math.floor(rng() * (gate.length - shape.w + 1)), y: H - shape.h };
  }
  if (shape.w > gate.length) return null;
  return { x: gate.start + Math.floor(rng() * (gate.length - shape.w + 1)), y: 0 };
}

/**
 * Number of GESTURES actually needed to solve the level.
 *
 * It cannot be deduced from the turns in the path: a finger following an
 * L-shaped track turns the block in a single drag, the engine advancing cell by
 * cell towards the target position. Counting direction changes therefore
 * overestimated the cost by 60 %, and the star thresholds became unreachable
 * the other way round — everybody got 3★.
 *
 * So we measure: for each block, we look for the furthest point on its path
 * reachable in a single gesture, play it, and start again.
 */
function measureGestures(base) {
  const b = new Board({ ...base, moveLimit: 9999, timeLimit: 9999, starDrags: [0, 0] });
  let gestures = 0;

  for (const step of base.solution) {
    const path = step.path;
    const last = path.length - 1;
    let pos = 0;
    let guard = 0;

    while (pos < last && guard++ < 40) {
      let reached = pos;
      for (let j = last; j > pos; j--) {
        const snap = b.snapshot();
        b.dragTowards(step.id, path[j].x, path[j].y);
        const block = b.blocks.get(step.id);
        const ok = block && block.x === path[j].x && block.y === path[j].y;
        b.restore(snap);
        if (ok) { reached = j; break; }
      }
      if (reached === pos) reached = pos + 1; // safety: advance one notch
      b.dragTowards(step.id, path[reached].x, path[reached].y);
      gestures++;
      pos = reached;
    }

    // The exit extends the last drag: the finger does not lift.
    if (b.blocks.has(step.id)) {
      const [dx, dy] = EXIT_VECTORS[step.gate];
      if (b.step(step.id, dx, dy).ok && pos === 0) gestures++;
    }
    b.endGesture(true);
  }
  return Math.max(base.solution.length, gestures);
}

// ---------------------------------------------------------------------------

/**
 * How much BACKTRACKING a grid imposes.
 *
 * This is the only honest measure of "you have to think". Density, block count,
 * effects: all of those can be high without any choice ever being a bad one —
 * the solver then plays its first move and wins, and so does the player. The
 * measurements taken on the first eighteen realms are damning: nearly every
 * grid solves in as many states as it has blocks, that is, without going wrong
 * even once.
 *
 * A demanding grid is one where the solver has to undo what it just did. We
 * give it a tight budget: beyond that the grid is already devious enough, and
 * knowing the exact figure would not change the choice.
 */
/**
 * Budget for the demand measurement, sized to what we are looking for.
 *
 * It used to be a flat thirty thousand states — fifteen times the highest
 * target (sixty-four states per block across some thirty blocks). The most
 * devious grids, precisely the ones we want to keep, were therefore the most
 * expensive to measure, for a figure of which only the order of magnitude
 * mattered. Half again above the target is enough to arbitrate, and the build
 * drops from seventeen minutes to under five.
 */
const demandBudget = (target, blocks) => Math.max(1500, Math.round(target * blocks * 1.5));

function demandOf(g, budget = 30000) {
  const board = new Board({
    width: g.W, height: g.H, gates: g.gates, blocks: g.blocks,
    moveLimit: 9999, timeLimit: 9999, solution: [],
  });
  const r = solve(board, budget);
  // A grid the solver cannot clear within its budget is not thereby a good one:
  // we do not arbitrate at random, we take it as it stands — its reference
  // solution still exists.
  return r.states;
}

function build(n) {
  const rng = mulberry32(0x5eed * n + 1013904223);
  const p = curve(n);
  const { W, H } = p;

  /**
   * Last level of a realm: roughly 50 % more gestures than this level would
   * have yielded without this treatment, at unchanged size and block count — we
   * only pick, among the grids already explored for the same position in the
   * realm, the one that demands the most. Depends on `LEVELS_PER_REALM`, never
   * on `TOTAL_LEVELS`: adding a realm must change nothing about levels that are
   * already published.
   */
  const realmFinale = (n - 1) % LEVELS_PER_REALM === LEVELS_PER_REALM - 1;

  // Allowed shapes. Forbidding small pieces is a lever in its own right: a lone
  // cell slips in anywhere and acts as a gap filler, whereas a tetromino has to
  // find a passage its own size. The four-cell bar and the six-cell slab stay
  // reserved for the realms that announce them.
  const shapes = SHAPES.filter((f) =>
    f.cells.length >= p.minShapeSize && (p.largeShapes || !LARGE_SHAPES.has(f.key)));

  // Several grids are explored and the DENSEST is kept: difficulty in this
  // genre comes from congestion, and settling for the first acceptable grid
  // gave half-empty levels.
  let best = null;

  /**
   * Selection on DEMAND, for the realms that make it their subject.
   *
   * We evaluate as we go rather than ranking at the end: the ranking is done on
   * the score — density, distance, load — which says nothing about how awkward
   * a grid is. Ten well-filled grids can all solve on the first try, and that is
   * exactly what we were getting.
   *
   * So only the top candidates are evaluated, we stop as soon as a grid reaches
   * the target, and the number of calls is bounded: the solver costs seconds,
   * and spending a hundred of them per level is out of the question.
   */
  const finalists = [];
  // The higher the target, the more candidates are needed to arbitrate: in the
  // last realms only one grid in ten reaches the required level.
  const FINALISTS = p.demanding ? Math.min(60, 20 + Math.round(p.demandTarget)) : 30;

  /**
   * Selection on GESTURES, for the last level of each realm.
   *
   * `measureGestures` only costs a simulation — not the solver — so we can
   * afford to run it on EVERY valid candidate rather than on a short list
   * restricted by score: it is precisely outside that short list (grids whose
   * exit order gets in its own way more than average) that the candidates
   * demanding genuinely more gestures are found. Limiting them to the top of
   * the pile by score excluded them systematically, and the best found capped at
   * 20-25 % better instead of 50.
   *
   * They are all kept (candidate, gestures, playable blocks) rather than
   * tracking only the best as we go: the "no fewer blocks than normal" floor is
   * read off `best`, which is only known once the loop ends — filtering too
   * early would have discarded every grid while the reference was not yet set.
   */
  const hardCandidates = [];

  // A demanding realm needs a pool: on very constrained grids most attempts
  // fail, and without extra attempts only one or two candidates are left to
  // arbitrate — arbitration then arbitrates nothing. The last level of a realm
  // needs it for the same reason: searching harder than average assumes there
  // is something to choose from.
  const ATTEMPTS = realmFinale ? 2000 : p.demanding ? 700 : 220;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const grid = new Grid(W, H);
    const gates = makeGates(p, rng);
    if (gates.length === 0) continue;
    const blocks = [];
    let nextId = 1;

    // Walls first: block paths will be carved out around them.
    for (let i = 0; i < p.walls; i++) {
      const x = 1 + Math.floor(rng() * (W - 2));
      const y = 1 + Math.floor(rng() * (H - 2));
      if (!grid.free([[x, y]])) continue;
      const b = { id: nextId++, color: -1, cells: [[0, 0]], x, y, kind: KIND.WALL };
      grid.place(b.id, [[x, y]]);
      blocks.push(b);
    }

    // Backward placement: in through the gate, then walk back into the grid.
    const placements = [];
    const perGate = new Map(gates.map((g) => [g, 0]));
    const placedPerKind = { [KIND.RAIL]: 0, [KIND.ANCHOR]: 0, [KIND.BULKY]: 0 };
    const ceiling = { [KIND.RAIL]: p.rails, [KIND.ANCHOR]: p.anchors, [KIND.BULKY]: p.bulky };

    for (let i = 0; i < p.blockCount; i++) {
      // Several attempts per block: we keep the first one that pushes the block
      // far enough from its gate, otherwise the best obtained. Flatly rejecting
      // a placement that was too close lost blocks and made generation
      // impossible on dense grids.
      let bestAttempt = null;

      for (let a = 0; a < 8 && (!bestAttempt || bestAttempt.distance < 3); a++) {
        const order = [gates[(i + a) % gates.length], ...shuffled(rng, gates)];
        let spot = null;
        let gate = null;

        for (const candidate of order) {
          for (const shape of shuffled(rng, shapes)) {
            const at = placeAtGate(candidate, shape, W, H, rng);
            if (!at) continue;
            if (!grid.free(absolute(shape, at.x, at.y))) continue;
            // Placing at the gate is not enough: it must be able to get back out.
            grid.place(-1, absolute(shape, at.x, at.y));
            const canLeave = canLeaveItsGate(grid, candidate, shape, at.x, at.y, -1);
            grid.remove(absolute(shape, at.x, at.y));
            if (!canLeave) continue;
            spot = { shape, x: at.x, y: at.y };
            gate = candidate;
            break;
          }
          if (spot) break;
        }
        if (!spot) break; // no room left at all: no point insisting

        const id = nextId++;
        let { x, y } = spot;
        grid.place(id, absolute(spot.shape, x, y));
        const path = [{ x, y }];

        // This block's special kind. It is decided BEFORE the backward walk,
        // because a block restricted in movement must walk back under the same
        // restriction: otherwise the return path, which is the solution read
        // backwards, would be unplayable. The anchor comes first — it is the
        // strongest constraint, and leaving it second made it unfindable.
        const gateAxis = gate.side === 'left' || gate.side === 'right' ? 'h' : 'v';
        const available = (k) => placedPerKind[k] < ceiling[k];
        const special =
          available(KIND.ANCHOR) && rng() < 0.4 ? KIND.ANCHOR :
          available(KIND.RAIL) && rng() < 0.55 ? KIND.RAIL :
          available(KIND.BULKY) && rng() < 0.5 ? KIND.BULKY :
          null;
        const axis = special === KIND.RAIL ? gateAxis : null;

        // ORIENTED backward walk: at each step we favour the direction that
        // moves the block AWAY from its gate. A purely random walk left it one
        // or two cells from its exit, and the level played itself.
        const steps = p.walkBack[0] + Math.floor(rng() * (p.walkBack[1] - p.walkBack[0] + 1));
        // An anchor knows only one way to travel: for it, walking back means
        // moving away in a straight line, exactly opposite its gate.
        const [sx, sy] = EXIT_VECTORS[gate.side];
        for (let r = 0; r < steps; r++) {
          const all = special === KIND.ANCHOR ? [[-sx, -sy]]
            : axis === 'h' ? [[1, 0], [-1, 0]]
            : axis === 'v' ? [[0, 1], [0, -1]]
            : [[1, 0], [-1, 0], [0, 1], [0, -1]];

          const legal = all.filter(([dx, dy]) =>
            grid.free(absolute(spot.shape, x + dx, y + dy), id));
          if (!legal.length) break;

          // 80 % of the time we move away, otherwise at random: without that
          // grain of chance every block runs in a straight line to the back of
          // the grid.
          const chosen = rng() < 0.8
            ? legal.reduce((bestDir, d) =>
                distanceToGate(gate, spot.shape, x + d[0], y + d[1], W, H) >
                distanceToGate(gate, spot.shape, x + bestDir[0], y + bestDir[1], W, H) ? d : bestDir)
            : pick(rng, legal);

          grid.remove(absolute(spot.shape, x, y));
          x += chosen[0]; y += chosen[1];
          grid.place(id, absolute(spot.shape, x, y));
          path.push({ x, y });
        }

        const distance = distanceToGate(gate, spot.shape, x, y, W, H);
        const candidate = { id, gate, path, spot, x, y, axis, distance, special };

        if (!bestAttempt || distance > bestAttempt.distance) {
          if (bestAttempt) grid.remove(absolute(bestAttempt.spot.shape, bestAttempt.x, bestAttempt.y));
          bestAttempt = candidate;
        } else {
          grid.remove(absolute(spot.shape, x, y));
        }
      }

      // A block still touching its gate brings nothing to the puzzle.
      if (!bestAttempt || bestAttempt.distance < 1 || bestAttempt.path.length < 2) {
        if (bestAttempt) grid.remove(absolute(bestAttempt.spot.shape, bestAttempt.x, bestAttempt.y));
        continue;
      }

      const { id, gate, path, spot, x, y, axis, special } = bestAttempt;
      if (special) placedPerKind[special]++;
      blocks.push({
        id, color: gate.color, cells: spot.shape.cells, x, y,
        kind: special || KIND.NORMAL,
        axis: special === KIND.RAIL ? axis : null,
        dir: special === KIND.ANCHOR ? gate.side : null,
      });
      perGate.set(gate, (perGate.get(gate) || 0) + 1);
      placements.push({ id, gate, path });
    }

    // Widened from 6 to 10: large shapes (four-cell bar, six-cell slab) take up
    // more room per placed piece, and in the already most constrained realms
    // (walls, rails, anchors, bulky blocks all at maximum) a few seeds never
    // reached the full count — without this slack, 3 levels out of 600 found no
    // valid grid at all.
    if (placements.length < Math.max(5, p.blockCount - 10)) continue;

    // Reference solution: last placed, first out.
    const solution = [...placements].reverse().map(({ id, gate, path }) => ({
      id, gate: gate.side, path: [...path].reverse(),
    }));

    const byId = new Map(blocks.map((b) => [b.id, b]));

    // Colour seals: "I open once every ▲ has left the grid". The condition is
    // only set if the reference solution already satisfies it at the right
    // moment — that is, if the whole target colour exits BEFORE this block. The
    // player reads it off the block and counts the ▲ still on screen.
    // It comes BEFORE countdown locks: its condition is far more demanding — it
    // needs a colour entirely cleared — and letting the countdown help itself
    // first left it a candidate in only one level out of four, the realm's
    // novelty missing from the other three.
    if (p.colorSeal) {
      const rankOf = new Map(solution.map((step, i) => [step.id, i]));
      const lastRank = new Map();
      for (const b of blocks) {
        if (b.kind === KIND.WALL) continue;
        const r = rankOf.get(b.id);
        if (r === undefined) continue;
        lastRank.set(b.color, Math.max(lastRank.get(b.color) ?? -1, r));
      }
      for (let rank = solution.length - 1; rank >= 0; rank--) {
        const b = byId.get(solution[rank].id);
        if (!b || b.kind !== KIND.NORMAL) continue;
        // A colour fully cleared before this block, and not its own: otherwise
        // the block would be waiting on itself and never open.
        const colors = [...lastRank.entries()]
          .filter(([c, last]) => c !== b.color && last < rank);
        if (!colors.length) continue;
        b.kind = KIND.LOCKED;
        b.axis = null;
        b.dir = null;
        b.condition = { type: 'color', color: pick(rng, colors)[0] };
        break; // one per grid: two colour waits are unreadable
      }
    }

    // Locks: a block can only be locked by a condition already satisfied at the
    // moment the solution asks it to move.
    let locksPlaced = 0;
    for (let rank = solution.length - 1; rank >= 0 && locksPlaced < p.locks; rank--) {
      const exitedBefore = rank; // number of blocks leaving before this one
      if (exitedBefore < 2) continue;
      const b = byId.get(solution[rank].id);
      if (!b || b.kind !== KIND.NORMAL) continue;

      // A countdown only: the player must be able to READ what will open the
      // block. A condition like "the whole ▲ colour has left" is unguessable
      // mid-game and reads like a bug.
      b.kind = KIND.LOCKED;
      b.axis = null;
      b.condition = { type: 'exits', count: Math.min(exitedBefore, 2 + Math.floor(rng() * 3)) };
      locksPlaced++;
    }

    // Dual blocks: a second colour accepted on top of their own. Safe for
    // solvability — their original gate stays valid — and they open only one
    // more family, where the joker opens them all.
    // The draw only happens if the realm asks for it: `shuffled` consumes the
    // RNG, and calling it for nothing would shift every grid of the earlier
    // realms — level n must yield the same grid as yesterday.
    let dualsPlaced = 0;
    for (const step of (p.duals > 0 ? shuffled(rng, solution) : [])) {
      if (dualsPlaced >= p.duals) break;
      const b = byId.get(step.id);
      if (!b || b.kind !== KIND.NORMAL) continue;
      const others = [...Array(p.colorCount).keys()].filter((c) => c !== b.color);
      if (!others.length) break;
      b.kind = KIND.DUAL;
      b.colors = [b.color, pick(rng, others)];
      dualsPlaced++;
    }

    // Jokers: a normal block becomes multicoloured. Always safe for solvability
    // — a joker accepts its original gate as well as all the others.
    let jokersPlaced = 0;
    for (const s of shuffled(rng, solution)) {
      if (jokersPlaced >= p.jokers) break;
      const b = byId.get(s.id);
      if (!b || b.kind !== KIND.NORMAL) continue;
      b.kind = KIND.JOKER;
      jokersPlaced++;
    }

    /**
     * The key. A block whose exit opens every lock in a level at once — the
     * locks no longer count exits, they wait for it.
     *
     * It has to leave BEFORE them in the reference solution, otherwise the
     * condition would never be met at the right moment. So we take the last
     * ordinary block preceding the first lock.
     */
    if (p.key) {
      const locked = solution
        .map((step, rank) => ({ b: byId.get(step.id), rank }))
        .filter(({ b }) => b && b.kind === KIND.LOCKED && b.condition?.type === 'exits');
      const firstLock = Math.min(...locked.map((v) => v.rank));
      if (locked.length && Number.isFinite(firstLock)) {
        // Any block the player can grab makes a key: the role does not restrict
        // movement. Reserving it for ordinary blocks left a candidate in only
        // three levels out of five, the others having nothing but rails and
        // anchors ahead of their first lock.
        const KEY_BEARERS = [KIND.NORMAL, KIND.RAIL, KIND.ANCHOR, KIND.BULKY];
        for (let rank = firstLock - 1; rank >= 0; rank--) {
          const b = byId.get(solution[rank].id);
          if (!b || !KEY_BEARERS.includes(b.kind)) continue;
          b.isKey = true;
          for (const v of locked) v.b.condition = { type: 'block', id: b.id };
          break;
        }
      }
    }

    // Gate capacity: each gate only accepts the number of cells the reference
    // solution routes through it, plus a small margin. Routing a block to the
    // wrong gate of the right colour then becomes a mistake — and that is what
    // turns the grid into a puzzle.
    if (p.capacity) {
      const demand = new Map(gates.map((g) => [g, 0]));
      let jokerQuota = 0;
      for (const placement of placements) {
        const b = byId.get(placement.id);
        // `capacityCost` and not `cells.length`: a bulky block consumes double,
        // and provisioning less than what the engine takes away would make the
        // level impossible without the player being able to see it coming.
        const cost = capacityCost(b);
        if (b.kind === KIND.JOKER) { jokerQuota += cost; continue; }
        demand.set(placement.gate, demand.get(placement.gate) + cost);
      }
      // The joker exits through whichever gate it likes: if its quota were only
      // counted against its original gate, sending it elsewhere would starve
      // that other gate and make the level impossible — without the player
      // being able to see it coming. So its size is provisioned on EVERY gate.
      //
      // On EVERY one, without exception: a gate the reference solution never
      // uses (two gates of the same colour, only one picked by the backward
      // placement) was left with no capacity — unlimited, as far as the engine
      // is concerned. The player could then clear any block of that colour
      // through that free gate, bypassing the whole capacity puzzle. As soon as
      // one gate in the level is limited, none may be left without a counter.
      for (const g of gates) {
        const need = demand.get(g) || 0;
        g.capacity = need + jokerQuota + p.margin;
      }
    }

    const occupied = blocks.reduce((sum, b) => sum + b.cells.length, 0);
    const meanDistance = placements.reduce((sum, placement) => {
      const b = byId.get(placement.id);
      const shape = { w: Math.max(...b.cells.map((c) => c[0])) + 1, h: Math.max(...b.cells.map((c) => c[1])) + 1 };
      return sum + distanceToGate(placement.gate, shape, b.x, b.y, W, H);
    }, 0) / Math.max(1, placements.length);

    // Share of the most represented colour. A grid can be dense and well spread
    // out while being three quarters a single colour: gates clog up as pieces
    // are placed, and every later block falls back on the last one still clear.
    // The result plays worse and looks worse, so it has to be penalised
    // explicitly.
    const perColor = new Map();
    for (const placement of placements) {
      const c = byId.get(placement.id).color;
      perColor.set(c, (perColor.get(c) || 0) + 1);
    }
    const dominant = Math.max(...perColor.values()) / Math.max(1, placements.length);

    const density = occupied / (W * H);

    // The NUMBER of blocks counts towards the score, not just the occupied
    // cells: at equal density, a grid of fifteen large blocks needs fewer exits
    // than one of twenty small ones. Without this term, the load from one level
    // to the next dipped by four blocks inside the same realm, and progression
    // felt like it was going backwards.
    const load = placements.length / p.blockCount;
    const score = density + meanDistance / 8 + load / 3
      - 1.6 * Math.max(0, dominant - 0.4);
    // The filter is applied BEFORE the difficulty measurement: what the solver
    // weighs must be exactly the grid that will ship.
    const candidate = { W, H, gates: usefulGates(gates, blocks), blocks, solution,
      occupied, score, meanDistance, dominant, colorCount: p.colorCount };
    if (!best || score > best.score) best = candidate;

    if (realmFinale) {
      const gestures = measureGestures({ width: W, height: H, gates: candidate.gates, blocks: candidate.blocks, solution: candidate.solution });
      hardCandidates.push({ candidate, gestures, playable: placements.length });
    }

    if (p.demanding) {
      // Accumulate first, measure later. Evaluating as we went spent the solver
      // budget on whatever grids came first: the comparison threshold rises with
      // the best known score, so the mediocre early candidates all got through.
      finalists.push(candidate);
      finalists.sort((a, b) => b.score - a.score);
      if (finalists.length > FINALISTS) finalists.length = FINALISTS;
      continue;
    }
    // The last level of a realm needs the whole pool of attempts: stopping
    // early on the first acceptable grid, as an ordinary level does, would
    // deprive it of the hardest candidates.
    if (!realmFinale && density >= 0.6 && meanDistance >= 3.2 && dominant <= 0.4 && load >= 0.9) break;
  }

  /**
   * Arbitrating between the finalists: we keep the one that forces the solver
   * to backtrack the most, and stop as soon as a grid reaches the target — a
   * dozen states per block, enough for a player to have to try twice too.
   * Measuring them all would cost seconds for nothing.
   */
  if (p.demanding && finalists.length) {
    let kept = null;
    let maxDemand = -1;
    for (const c of finalists) {
      const states = demandOf(c, demandBudget(p.demandTarget, c.blocks.length));
      if (states > maxDemand) { maxDemand = states; kept = c; }
      if (states >= c.blocks.length * p.demandTarget) break;
    }
    best = kept;
    best.demand = maxDemand;
  }

  /**
   * Last level of a realm: among the candidates matching at least the playable
   * block count of what this level would have been without this treatment
   * (`best`, chosen by density — or by demand for a realm that is demanding —
   * like any other level), we keep the one requiring the most gestures. It is
   * only replaced if something better turns up; failing that, `best` stays the
   * best honest attempt rather than a random pick — the 50 %-more target is a
   * goal, not a guarantee.
   */
  if (realmFinale && hardCandidates.length) {
    const referencePlayable = best.blocks.filter((b) => b.kind !== KIND.WALL).length;
    let kept = best;
    let keptGestures = measureGestures({ width: W, height: H, gates: best.gates, blocks: best.blocks, solution: best.solution });
    for (const { candidate, gestures, playable } of hardCandidates) {
      if (playable < referencePlayable) continue;
      if (gestures > keptGestures) { kept = candidate; keptGestures = gestures; }
    }
    best = kept;
  }

  if (!best) return null;
  best.minDrags = measureGestures({
    width: best.W, height: best.H, gates: best.gates,
    blocks: best.blocks, solution: best.solution,
  });
  return best;
}

const cache = new Map();

/** Returns the data for level `n` (1-indexed). */
export function getLevel(n) {
  if (cache.has(n)) return cache.get(n);
  const g = build(n);
  if (!g) throw new Error(`Cannot generate level ${n}`);

  const realm = realmOf(n);
  // Margins tighten across the WHOLE progression, not over its first twenty
  // levels: indexed on an absolute number, this factor bottomed out before the
  // end of the first realm and had nothing left to give afterwards. Tightening
  // pushed to the maximum: up to 60 % less at the last level, so that failure —
  // and the offer to continue in exchange for an ad — becomes frequent again
  // even late in the game.
  const tighten = 1 - 0.6 * ((n - 1) / (TOTAL_LEVELS - 1));

  const starDrags = starThresholds(g.minDrags);

  /**
   * The move limit is a SAFETY NET, not a grading scale — the clock carries the
   * tension. So it sits above the 2★ threshold: below it, a laborious player
   * lost instead of earning a star, and the result screen promised a grade no
   * play-through could reach. The floor (`+1`) is the minimum that keeps that
   * threshold reachable: the margin is trimmed to the strict minimum so failure
   * punishes the slightest wasted gesture rather than comfortably absorbing
   * trial and error.
   */
  const moveLimit = starDrags[1] + Math.max(1, Math.round(g.minDrags * 0.15 * tighten));
  // Time plays on thinking, not on the number of gestures: it is sized on the
  // number of blocks to clear. Tightened to the maximum, but never below 3
  // seconds per drag of the reference solution — under that it is no longer a
  // tight time, it is a time no finger can hold whatever the skill level.
  // `tools/balance.mjs` checks this floor across the whole database.
  const playable = g.blocks.filter((b) => b.kind !== KIND.WALL).length;
  const timeLimit = Math.max(3 * g.minDrags,
    Math.min(120, Math.max(25, Math.round((playable * 4 + 8) * tighten / 5) * 5)));

  const level = {
    levelId: `lvl_${String(n).padStart(3, '0')}`,
    number: n,
    // English label: this is the realm's human-readable identifier in the data.
    // What the player sees goes through the catalogue and `i18n.realmText`,
    // which has all five languages.
    realm: realm.name.en,
    difficulty: realm.difficulty.en,
    width: g.W,
    height: g.H,
    colorCount: g.colorCount,
    moveLimit,
    timeLimit,
    minDrags: g.minDrags,
    /**
     * Number of states a solver explores to clear the grid. A level that stays
     * near its block count solves without ever going wrong; beyond that, you
     * have to backtrack. Measured at build time for demanding realms, absent
     * elsewhere — balancing reads it, the game ignores it.
     */
    ...(g.demand === undefined ? {} : { demand: g.demand }),
    objective: { type: 'clear_all', target: g.blocks.filter((b) => b.kind !== KIND.WALL).length },
    starDrags,
    estimatedTime: timeLimit,
    gates: g.gates,
    blocks: g.blocks,
    solution: g.solution, // used by tests, balancing and the hint system
  };
  cache.set(n, level);
  return level;
}
