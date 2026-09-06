/**
 * LevelManager — équivalent de Scripts/Gameplay/LevelManager.cs (doc §4)
 *
 * Les niveaux sont générés A L'ENVERS, et c'est le point important : au lieu de
 * poser des blocs au hasard en espérant que ce soit jouable, on fait ENTRER
 * chaque bloc par sa porte puis on le fait reculer dans la grille. Un niveau
 * ainsi construit est résoluble par construction, et la marche arrière fournit
 * gratuitement une solution de référence — utilisée par les tests, par
 * l'équilibrage, et disponible pour un futur système d'indices.
 *
 * L'ordre de résolution est l'inverse de l'ordre de pose : le dernier bloc posé
 * sort en premier, et son chemin est libre puisqu'il a été creusé alors que
 * seuls les blocs précédents étaient là.
 *
 * Le RNG est seedé : le niveau n produit toujours la même grille.
 * Chaque objet respecte la forme de `GET /api/level/{levelNumber}` (doc §6.1).
 */

import { SHAPES, KIND, coutCapacite } from './block.js';
import { Board, SIDES as VECTEURS_SORTIE } from './board.js';
import { resoudre } from './solver.js';

/**
 * Un monde tient sur vingt niveaux et se définit par une seule ligne de la
 * table ci-dessous. Il apporte trois choses au joueur, toujours les trois
 * ensemble :
 *
 *  1. UNE NOUVEAUTÉ — un type de bloc, ou une règle, qu'il n'a jamais vu.
 *  2. UNE PALETTE — les six familles gardent leurs glyphes (●◆▲★■⬢), qui
 *     portent la règle, mais changent de teintes : le monde se reconnaît au
 *     premier coup d'œil sans que l'appariement bloc/porte soit à réapprendre.
 *  3. UN CRAN DE DIFFICULTÉ — grille plus grande, une couleur ou une porte de
 *     plus, et surtout une marge de capacité qui se resserre.
 *
 * Vingt niveaux par monde plutôt que cinq : une mécanique nouvelle a besoin
 * d'être pratiquée avant d'être combinée à la suivante. La difficulté monte
 * DANS le monde (les quantités notées `[début, fin]` sont interpolées sur ses
 * vingt niveaux) et fait un palier ENTRE les mondes.
 */
export const LEVELS_PER_REALM = 20;

export const REALMS = [
  {
    id: 0,
    nom: { fr: 'Atelier de Verre', en: 'Glassworks', es: 'Taller de Vidrio', it: 'Vetreria', zh: '玻璃工坊' },
    difficulte: { fr: 'apprentissage', en: 'learning the ropes', es: 'aprendizaje', it: 'apprendistato', zh: '入门' },
    teinte: 345,
    palette: ['#eb9aad', '#93bde4', '#97cfb6', '#e9cd8c', '#bdaadd', '#f0b18b'],
    nouveaute: null,
    apporte: { fr: 'Les blocs et leurs portes', en: 'Blocks and their gates', es: 'Los bloques y sus puertas', it: 'I blocchi e le loro porte', zh: '方块与它们的门' },
    W: 5, H: 6, colorCount: 3, gateCount: 3,
    murs: [0, 0], verrous: [0, 0], rails: [0, 0], ancres: [0, 0], encombrants: [0, 0],
    jokers: 0, marge: null, scelleCouleur: false,
  },
  {
    id: 1,
    nom: { fr: 'Fonderie', en: 'The Foundry', es: 'La Fundición', it: 'La Fonderia', zh: '铸造厂' },
    difficulte: { fr: 'facile', en: 'easy', es: 'fácil', it: 'facile', zh: '简单' },
    teinte: 22,
    palette: ['#e8907b', '#7fb0c9', '#a9c48b', '#edc073', '#c39fc0', '#d9a06b'],
    nouveaute: KIND.RAIL,
    apporte: { fr: 'Blocs sur glissière, portes à capacité', en: 'Blocks on rails, gates with a capacity', es: 'Bloques sobre raíles, puertas con capacidad', it: 'Blocchi su binario, porte con capienza', zh: '滑轨方块，限量的门' },
    W: 6, H: 6, colorCount: 4, gateCount: 4,
    murs: [0, 1], verrous: [0, 0], rails: [1, 5], ancres: [0, 0], encombrants: [0, 0],
    jokers: 0, marge: 3, scelleCouleur: false,
  },
  {
    id: 2,
    nom: { fr: 'Chambre Froide', en: 'Cold Store', es: 'Cámara Fría', it: 'Cella Frigorifera', zh: '冷藏室' },
    difficulte: { fr: 'moyen', en: 'medium', es: 'medio', it: 'medio', zh: '中等' },
    teinte: 196,
    palette: ['#d99aa8', '#8cc6e0', '#8fd3c4', '#d7d295', '#aeb3e0', '#e2b3a6'],
    nouveaute: KIND.WALL,
    apporte: { fr: 'Blocs scellés, immobiles', en: 'Sealed blocks that never move', es: 'Bloques sellados, inmóviles', it: 'Blocchi sigillati, immobili', zh: '封死不动的方块' },
    W: 6, H: 7, colorCount: 4, gateCount: 4,
    murs: [1, 4], verrous: [0, 0], rails: [2, 6], ancres: [0, 0], encombrants: [0, 0],
    jokers: 0, marge: 3, scelleCouleur: false,
  },
  {
    id: 3,
    nom: { fr: 'Tour de Contrôle', en: 'Control Tower', es: 'Torre de Control', it: 'Torre di Controllo', zh: '控制塔' },
    difficulte: { fr: 'soutenu', en: 'steady', es: 'sostenido', it: 'sostenuto', zh: '进阶' },
    teinte: 262,
    palette: ['#e493b4', '#8fa8e2', '#86cbb0', '#e3c886', '#b49ae0', '#7fc4d4'],
    nouveaute: KIND.LOCKED,
    apporte: { fr: 'Verrous à décompte', en: 'Locks with a countdown', es: 'Cerrojos con cuenta atrás', it: 'Serrature con conto alla rovescia', zh: '带计数的锁' },
    W: 6, H: 8, colorCount: 5, gateCount: 5,
    murs: [1, 4], verrous: [1, 3], rails: [3, 7], ancres: [0, 0], encombrants: [0, 0],
    jokers: 0, marge: 2, scelleCouleur: false,
  },
  {
    id: 4,
    nom: { fr: 'Salle des Machines', en: 'Engine Room', es: 'Sala de Máquinas', it: 'Sala Macchine', zh: '机房' },
    difficulte: { fr: 'exigeant', en: 'demanding', es: 'exigente', it: 'impegnativo', zh: '考验' },
    teinte: 30,
    palette: ['#dd9b95', '#96b6cc', '#9fc9a4', '#d9bd7f', '#b2a6c9', '#e0a97f'],
    nouveaute: KIND.JOKER,
    apporte: { fr: 'Le joker, qui sort par où il veut', en: 'The joker, which leaves by any gate', es: 'El comodín, que sale por donde quiere', it: 'Il jolly, che esce da dove vuole', zh: '万能方块，任意门皆可' },
    W: 7, H: 8, colorCount: 5, gateCount: 5,
    murs: [2, 4], verrous: [1, 3], rails: [4, 9], ancres: [0, 0], encombrants: [0, 0],
    jokers: 1, marge: 2, scelleCouleur: false,
  },
  {
    id: 5,
    nom: { fr: 'Serre Suspendue', en: 'Hanging Glasshouse', es: 'Invernadero Colgante', it: 'Serra Sospesa', zh: '悬空温室' },
    difficulte: { fr: 'redoutable', en: 'formidable', es: 'temible', it: 'temibile', zh: '棘手' },
    teinte: 128,
    palette: ['#ec9cc0', '#8ec7d9', '#93cf8e', '#dfd083', '#c1a3dc', '#efb28f'],
    nouveaute: KIND.ANCRE,
    apporte: { fr: 'Ancres, qui n’avancent que vers leur porte', en: 'Anchors, which only move towards their gate', es: 'Anclas, que solo avanzan hacia su puerta', it: 'Ancore, che avanzano solo verso la loro porta', zh: '锚块，只朝自己的门前进' },
    W: 7, H: 9, colorCount: 6, gateCount: 6,
    murs: [2, 5], verrous: [1, 3], rails: [4, 9], ancres: [1, 4], encombrants: [0, 0],
    jokers: 1, marge: 1, scelleCouleur: false,
  },
  {
    id: 6,
    nom: { fr: 'Observatoire', en: 'Observatory', es: 'Observatorio', it: 'Osservatorio', zh: '天文台' },
    difficulte: { fr: 'implacable', en: 'relentless', es: 'implacable', it: 'implacabile', zh: '严苛' },
    teinte: 288,
    palette: ['#d792bb', '#8bacdf', '#8ecdc0', '#e6cd90', '#a99ae0', '#e5a3a0'],
    nouveaute: KIND.ENCOMBRANT,
    apporte: { fr: 'Encombrants, qui coûtent double à leur porte', en: 'Heavy blocks, which cost their gate double', es: 'Voluminosos, que cuestan el doble a su puerta', it: 'Ingombranti, che costano il doppio alla loro porta', zh: '笨重方块，占用双倍容量' },
    W: 8, H: 9, colorCount: 6, gateCount: 6,
    murs: [3, 5], verrous: [2, 3], rails: [5, 10], ancres: [2, 5], encombrants: [1, 4],
    jokers: 1, marge: 1, scelleCouleur: false,
  },
  {
    id: 7,
    nom: { fr: 'Dernière Verrière', en: 'The Last Skylight', es: 'La Última Vidriera', it: 'L’Ultima Vetrata', zh: '最后的天窗' },
    difficulte: { fr: 'intransigeant', en: 'unyielding', es: 'intransigente', it: 'intransigente', zh: '严厉' },
    teinte: 165,
    palette: ['#ef8fa6', '#85b8e8', '#8ad4b1', '#f0cd7e', '#b99ae6', '#f4ab84'],
    nouveaute: 'scelle-couleur',
    apporte: { fr: 'Des scellés qui attendent qu’une couleur ait disparu', en: 'Seals that wait for a whole colour to be gone', es: 'Sellos que esperan a que un color desaparezca', it: 'Sigilli che attendono la scomparsa di un colore', zh: '颜色封印：某色清空才解锁' },
    W: 8, H: 10, colorCount: 6, gateCount: 7,
    murs: [3, 6], verrous: [2, 4], rails: [6, 12], ancres: [3, 6], encombrants: [2, 5],
    // Ce monde fermait autrefois le jeu, et son réglage le disait : plus de
    // joker, plus un pouce de marge. Devenu le huitième sur dix-huit, ce pic au
    // milieu du parcours rendait les quatre mondes suivants plus faciles que
    // lui. La capacité exacte revient donc au tout dernier monde, à qui elle
    // appartient.
    jokers: 1, marge: 1, scelleCouleur: true,
  },
  {
    id: 8,
    nom: { fr: 'Verrerie Basse', en: 'Lower Glassworks', es: 'Vidriería Baja', it: 'Vetreria Bassa', zh: '下层玻璃厂' },
    difficulte: { fr: 'retors', en: 'crafty', es: 'retorcido', it: 'insidioso', zh: '刁钻' },
    teinte: 52,
    palette: ['#e0a08e', '#8fb9d6', '#a3ca9a', '#e3c37f', '#b7a4d4', '#dfa77f'],
    nouveaute: KIND.DOUBLE,
    apporte: { fr: 'Blocs bicolores, qui hésitent entre deux portes', en: 'Two-colour blocks, torn between two gates', es: 'Bloques bicolores, que dudan entre dos puertas', it: 'Blocchi bicolori, indecisi fra due porte', zh: '双色方块，可走两种门' },
    W: 8, H: 10, colorCount: 6, gateCount: 7,
    murs: [3, 6], verrous: [2, 4], rails: [6, 12],
    ancres: [3, 6], encombrants: [2, 5], doubles: [1, 4],
    jokers: 1, marge: 1, scelleCouleur: false,
  },
  {
    id: 9,
    nom: { fr: 'Passage Étroit', en: 'The Narrows', es: 'Paso Estrecho', it: 'Passaggio Stretto', zh: '窄道' },
    difficulte: { fr: 'serré', en: 'tight', es: 'ajustado', it: 'stretto', zh: '局促' },
    teinte: 15,
    palette: ['#dd8f96', '#8aa9cc', '#93c197', '#dcbd7c', '#ac9ccc', '#dc9d84'],
    nouveaute: 'porte-etroite',
    apporte: { fr: 'Des portes de deux cases, jamais plus', en: 'Gates two cells wide, never more', es: 'Puertas de dos casillas, nunca más', it: 'Porte di due caselle, mai di più', zh: '门宽只有两格' },
    W: 8, H: 10, colorCount: 6, gateCount: 7,
    murs: [4, 6], verrous: [3, 4], rails: [7, 12],
    ancres: [4, 7], encombrants: [3, 6], doubles: [1, 3],
    porteLarge: 0.0,
    jokers: 1, marge: 1, scelleCouleur: false,
  },
  {
    id: 10,
    nom: { fr: 'Grande Halle', en: 'The Great Hall', es: 'Gran Nave', it: 'Grande Sala', zh: '大厅' },
    difficulte: { fr: 'massif', en: 'massive', es: 'macizo', it: 'massiccio', zh: '厚重' },
    teinte: 225,
    palette: ['#d18fa8', '#7fa4d8', '#87c3ae', '#d9c084', '#a396d6', '#d59a94'],
    nouveaute: 'grosses-formes',
    apporte: { fr: 'Plus une seule pièce d’une case', en: 'Not a single one-cell piece left', es: 'Ni una sola pieza de una casilla', it: 'Non più un solo pezzo da una casella', zh: '不再有单格方块' },
    W: 8, H: 10, colorCount: 6, gateCount: 7,
    murs: [3, 6], verrous: [3, 4], rails: [7, 13],
    ancres: [4, 7], encombrants: [3, 6], doubles: [1, 3],
    formesMin: 2, densite: [0.26, 0.33],
    jokers: 1, marge: 1, scelleCouleur: false,
  },
  {
    id: 11,
    nom: { fr: 'Quai de Tri', en: 'Sorting Dock', es: 'Muelle de Clasificación', it: 'Molo di Smistamento', zh: '分拣码头' },
    difficulte: { fr: 'trompeur', en: 'deceptive', es: 'engañoso', it: 'ingannevole', zh: '迷惑' },
    teinte: 95,
    palette: ['#cf94a4', '#84b4cc', '#8fc98f', '#d4c286', '#a89dd0', '#d9a68a'],
    nouveaute: 'porte-partagee',
    apporte: { fr: 'Des portes qui servent deux couleurs à la fois', en: 'Gates serving two colours at once', es: 'Puertas que sirven a dos colores a la vez', it: 'Porte che servono due colori insieme', zh: '一门通两色' },
    W: 8, H: 10, colorCount: 6, gateCount: 7,
    murs: [4, 6], verrous: [3, 5], rails: [7, 13],
    ancres: [4, 7], encombrants: [3, 6], doubles: [1, 3],
    portesPartagees: [1, 3],
    jokers: 1, marge: 1, scelleCouleur: false,
  },
  {
    id: 12,
    nom: { fr: 'Salle des Clés', en: 'Hall of Keys', es: 'Sala de las Llaves', it: 'Sala delle Chiavi', zh: '钥匙厅' },
    difficulte: { fr: 'méthodique', en: 'methodical', es: 'metódico', it: 'metodico', zh: '讲究次序' },
    teinte: 310,
    palette: ['#d68fb0', '#8ba6d4', '#8ccbb4', '#dfc57f', '#ab97d8', '#e0a292'],
    nouveaute: 'cle',
    apporte: { fr: 'Une clé, dont la sortie ouvre tous les verrous', en: 'A key whose exit opens every lock', es: 'Una llave cuya salida abre todos los cerrojos', it: 'Una chiave la cui uscita apre tutte le serrature', zh: '一把钥匙，出门即开所有锁' },
    W: 8, H: 10, colorCount: 6, gateCount: 7,
    murs: [4, 6], verrous: [3, 5], rails: [7, 13],
    ancres: [4, 7], encombrants: [3, 6], doubles: [1, 3],
    portesPartagees: [2, 3], densite: [0.26, 0.34],
    jokers: 1, marge: 1, scelleCouleur: false, cle: true,
  },
  {
    id: 13,
    nom: { fr: 'Atelier Comble', en: 'Packed Workshop', es: 'Taller Abarrotado', it: 'Officina Gremita', zh: '拥挤工坊' },
    difficulte: { fr: 'étouffant', en: 'stifling', es: 'asfixiante', it: 'soffocante', zh: '拥塞' },
    teinte: 178,
    palette: ['#cd8c9e', '#7fa8c8', '#84c2a4', '#d3bd7a', '#a291cc', '#d29a88'],
    nouveaute: null,
    apporte: { fr: 'Des grilles remplies aux trois quarts', en: 'Grids packed three quarters full', es: 'Cuadrículas llenas en tres cuartos', it: 'Griglie piene per tre quarti', zh: '棋盘塞满四分之三' },
    W: 9, H: 10, colorCount: 6, gateCount: 8,
    murs: [4, 7], verrous: [3, 5], rails: [8, 14],
    ancres: [5, 8], encombrants: [3, 7], doubles: [1, 3],
    portesPartagees: [1, 2], densite: [0.27, 0.35],
    jokers: 1, marge: 1, scelleCouleur: false,
  },
  {
    id: 14,
    nom: { fr: 'Chaufferie', en: 'The Boiler Room', es: 'Sala de Calderas', it: 'Locale Caldaie', zh: '锅炉房' },
    difficulte: { fr: 'éprouvant', en: 'punishing', es: 'duro', it: 'duro', zh: '磨人' },
    teinte: 40,
    palette: ['#dba38c', '#8fb2c4', '#9ec69b', '#dcc07e', '#b19dc8', '#d9a17e'],
    nouveaute: null,
    apporte: { fr: 'Tous les blocs du jeu, dans la même grille', en: 'Every block in the game, on one grid', es: 'Todos los bloques del juego en una misma cuadrícula', it: 'Tutti i blocchi del gioco, nella stessa griglia', zh: '所有方块类型齐聚一盘' },
    W: 9, H: 10, colorCount: 6, gateCount: 8,
    murs: [5, 7], verrous: [4, 6], rails: [9, 15],
    ancres: [5, 9], encombrants: [4, 8], doubles: [2, 4],
    portesPartagees: [1, 3],
    jokers: 1, marge: 1, scelleCouleur: true, cle: true,
  },
  {
    id: 15,
    nom: { fr: 'Chambre Sourde', en: 'The Dead Room', es: 'Cámara Sorda', it: 'Camera Sorda', zh: '静默室' },
    difficulte: { fr: 'impitoyable', en: 'merciless', es: 'despiadado', it: 'spietato', zh: '无情' },
    teinte: 268,
    palette: ['#c98fae', '#8299d4', '#83c0b0', '#cfbc84', '#9f92d2', '#cf9a95'],
    nouveaute: null,
    apporte: { fr: 'Plus de joker : rien pour desserrer la grille', en: 'No joker left to loosen the grid', es: 'Sin comodín: nada que afloje la cuadrícula', it: 'Niente jolly: nulla che allenti la griglia', zh: '没有万能方块可依靠' },
    W: 9, H: 10, colorCount: 6, gateCount: 8,
    murs: [5, 7], verrous: [4, 6], rails: [9, 15],
    ancres: [6, 9], encombrants: [4, 8], doubles: [2, 4],
    portesPartagees: [2, 3], porteLarge: 0.2,
    jokers: 0, marge: 1, scelleCouleur: true, cle: true,
  },
  {
    id: 16,
    nom: { fr: 'Voûte Haute', en: 'The High Vault', es: 'Bóveda Alta', it: 'Volta Alta', zh: '高穹顶' },
    difficulte: { fr: 'vertigineux', en: 'dizzying', es: 'vertiginoso', it: 'vertiginoso', zh: '眩目' },
    teinte: 140,
    palette: ['#c88fa0', '#7ea6cc', '#7fc3a2', '#ccba7c', '#9c8ecd', '#cd9885'],
    nouveaute: null,
    apporte: { fr: 'Les plus vastes grilles du jeu', en: 'The largest grids in the game', es: 'Las cuadrículas más amplias del juego', it: 'Le griglie più vaste del gioco', zh: '全游戏最大的棋盘' },
    W: 9, H: 11, colorCount: 6, gateCount: 8,
    murs: [5, 8], verrous: [4, 6], rails: [10, 16],
    ancres: [6, 10], encombrants: [5, 9], doubles: [2, 4],
    portesPartagees: [2, 3], porteLarge: 0.2, formesMin: 2, densite: [0.26, 0.33],
    jokers: 0, marge: 1, scelleCouleur: true, cle: true,
  },
  {
    id: 17,
    nom: { fr: 'Dernier Souffle', en: 'Last Breath', es: 'Último Aliento', it: 'Ultimo Respiro', zh: '最后一息' },
    difficulte: { fr: 'sans retour', en: 'no way back', es: 'sin retorno', it: 'senza ritorno', zh: '无路可退' },
    teinte: 200,
    palette: ['#c98b9c', '#7ba2cc', '#7cc09f', '#cbb679', '#9a8aca', '#ca9482'],
    nouveaute: null,
    apporte: { fr: 'Des portes au comptage exact, et rien pour se rattraper', en: 'Gates counted to the cell, and nothing to fall back on', es: 'Puertas contadas al detalle y nada a lo que recurrir', it: 'Porte contate al millimetro e nulla su cui ripiegare', zh: '门的容量精确到格，毫无退路' },
    W: 9, H: 11, colorCount: 6, gateCount: 8,
    murs: [5, 8], verrous: [5, 7], rails: [10, 16],
    ancres: [7, 10], encombrants: [5, 9], doubles: [2, 4],
    portesPartagees: [2, 4], porteLarge: 0.15, formesMin: 2, densite: [0.27, 0.34],
    jokers: 0, marge: 0, scelleCouleur: true, cle: true,
  },
  {
    id: 18,
    nom: { fr: 'Salle des Nœuds', en: 'The Knot Room', es: 'Sala de los Nudos', it: 'Sala dei Nodi', zh: '绳结厅' },
    difficulte: { fr: 'nœud', en: 'knotted', es: 'enredado', it: 'intricato', zh: '纠缠' },
    teinte: 248,
    palette: ['#c78ba6', '#7d9fd0', '#7ec3a8', '#c9b47e', '#9a8ccb', '#c99688'],
    nouveaute: null,
    apporte: { fr: 'Des blocs qui se gênent : il faut trouver l’ordre', en: 'Blocks that get in each other’s way: the order matters', es: 'Bloques que se estorban: hay que dar con el orden', it: 'Blocchi che si ostacolano: bisogna trovare l’ordine', zh: '方块彼此挡路：顺序才是关键' },
    W: 9, H: 11, colorCount: 6, gateCount: 8,
    murs: [4, 7], verrous: [4, 6], rails: [10, 16],
    ancres: [7, 11], encombrants: [5, 9], doubles: [0, 2],
    portesPartagees: [2, 4], porteLarge: 0.15, formesMin: 2, densite: [0.26, 0.32],
    jokers: 0, marge: 0, scelleCouleur: true, cle: true, exigeant: true,
  },
  {
    id: 19,
    nom: { fr: 'Point Mort', en: 'Deadlock', es: 'Punto Muerto', it: 'Punto Morto', zh: '死局' },
    difficulte: { fr: 'inextricable', en: 'inextricable', es: 'inextricable', it: 'inestricabile', zh: '无解之局' },
    teinte: 8,
    palette: ['#c4879c', '#7799c9', '#78bd9c', '#c4b075', '#9385c6', '#c58f80'],
    nouveaute: null,
    apporte: { fr: 'Chaque sortie en ferme une autre', en: 'Every exit closes another one', es: 'Cada salida cierra otra', it: 'Ogni uscita ne chiude un’altra', zh: '每开一门，另一门便闭' },
    W: 9, H: 11, colorCount: 6, gateCount: 8,
    murs: [5, 8], verrous: [5, 7], rails: [12, 18],
    ancres: [8, 12], encombrants: [6, 10], doubles: [0, 1],
    portesPartagees: [3, 5], porteLarge: 0.1, formesMin: 2, densite: [0.27, 0.33],
    jokers: 0, marge: 0, scelleCouleur: true, cle: true, exigeant: true,
  },
];

export const TOTAL_LEVELS = REALMS.length * LEVELS_PER_REALM;

/** Le monde auquel appartient le niveau `n` (1-indexé). */
export function realmDe(n) {
  return REALMS[Math.min(REALMS.length - 1, Math.floor((n - 1) / LEVELS_PER_REALM))];
}

const SIDES = ['top', 'right', 'bottom', 'left'];

/**
 * Un bloc posé dans l'ouverture d'une porte peut-il vraiment en sortir ?
 *
 * Une forme non rectangulaire (T, L) déborde de part et d'autre de la porte :
 * ses épaules doivent aussi pouvoir avancer. Sans cette vérification, la
 * génération produisait des niveaux dont la solution ne tenait que parce que
 * le moteur laissait alors un bloc traverser ses voisins.
 */
function peutSortirDeSaPorte(grille, gate, shape, x, y, id) {
  const [dx, dy] = VECTEURS_SORTIE[gate.side];
  return shape.cells.every(([cx, cy]) => {
    const nx = x + cx + dx, ny = y + cy + dy;
    if (!grille.inside(nx, ny)) return true;
    const occ = grille.occ.get(grille.key(nx, ny));
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
 * Courbe de difficulté : ce que le générateur doit produire pour le niveau `n`.
 *
 * Tout vient de la table REALMS. Le monde fixe le décor et les plafonds, la
 * position DANS le monde fixe les quantités : `t` vaut 0 au premier niveau du
 * monde, 1 au vingtième, et chaque intervalle `[début, fin]` est lu à ce point.
 * Une mécanique arrive donc au compte-gouttes — une ancre au niveau 101, six au
 * niveau 120 — au lieu de tomber d'un bloc au changement de monde.
 */
function curve(n) {
  const R = realmDe(n);
  const rang = (n - 1) % LEVELS_PER_REALM;                 // 0 … 19
  const t = LEVELS_PER_REALM > 1 ? rang / (LEVELS_PER_REALM - 1) : 0;
  const rampe = ([a, b]) => Math.round(a + (b - a) * t);

  // La DENSITE fait la difficulté, pas la longueur des chemins : un bloc isolé
  // rejoint toujours sa porte d'un seul glissé. Ce qui fait réfléchir, c'est
  // que les blocs se gênent et imposent un ordre de sortie. On vise donc une
  // grille bien remplie (55 à 70 % des cases occupées).
  //
  // Le nombre de blocs se déduit de la SURFACE et non d'une rampe absolue :
  // c'est la seule façon d'avoir une grille aussi remplie au premier niveau
  // d'un monde qu'au dernier du précédent, alors que la grille vient de
  // grandir. Une forme fait 2,3 cases en moyenne, d'où les coefficients.
  const [densiteBasse, densiteHaute] = R.densite || [0.24, 0.33];
  const formesMin = R.formesMin ?? 1;

  // Le nombre de blocs se déduit de la SURFACE, mais il faut le corriger par la
  // TAILLE des pièces disponibles : interdire les pièces d'une case fait monter
  // la moyenne, et viser le même compte revenait à demander une grille remplie
  // à 97 % — le générateur n'y arrivait pas et rendait le niveau introuvable.
  const taille = (min) => {
    const dispo = SHAPES.filter((f) => f.cells.length >= min);
    return dispo.reduce((somme, f) => somme + f.cells.length, 0) / dispo.length;
  };
  const correction = taille(1) / taille(formesMin);
  const blockCount = Math.round(
    R.W * R.H * (densiteBasse + (densiteHaute - densiteBasse) * t) * correction);


  return {
    W: R.W, H: R.H, colorCount: R.colorCount, gateCount: R.gateCount,
    murs: rampe(R.murs),
    verrous: rampe(R.verrous),
    rails: rampe(R.rails),
    ancres: rampe(R.ancres),
    encombrants: rampe(R.encombrants),
    doubles: rampe(R.doubles || [0, 0]),
    portesPartagees: rampe(R.portesPartagees || [0, 0]),
    // Part de portes de trois cases, et taille minimale des formes : deux
    // leviers qui ne coûtent rien au moteur et resserrent beaucoup la grille.
    porteLarge: R.porteLarge ?? 0.35,
    formesMin: R.formesMin ?? 1,
    cle: R.cle === true,
    // Un monde « exigeant » fait départager ses grilles par le solveur : on y
    // retient celle qui demande le plus de retours en arrière, et non la plus
    // dense. Coûteux — quelques secondes par niveau — donc réservé aux mondes
    // qui en font leur sujet, et payé une seule fois à la fabrication.
    exigeant: R.exigeant === true,
    jokers: R.jokers,
    blockCount,
    /**
     * Longueur de la marche arrière, indexée sur le MONDE et non sur
     * l'avancement dans le jeu entier.
     *
     * Elle l'était : `11 + 5 × (n / TOTAL_LEVELS)`. Ajouter des mondes changeait
     * alors le recul de TOUS les niveaux déjà publiés — donc leur grille, donc
     * les records des joueurs. Une quantité qui décide de la forme d'une grille
     * ne doit dépendre que de son monde, jamais de la longueur du jeu.
     */
    recul: R.recul || [6, 11 + Math.min(5, R.id)],
    // `marge` est le rab accordé aux portes à capacité, au-delà de ce que la
    // solution de référence leur destine. Sans capacité, aucun ordre de sortie
    // ne peut être mauvais — sortir un bloc ne fait que libérer de la place — et
    // le niveau se résout au premier essai quelle que soit la méthode. La
    // capacité est le seul levier qui crée un vrai casse-tête ; la marge
    // décroissante en règle la sévérité, jusqu'à zéro au dernier monde.
    capacite: R.marge !== null,
    marge: R.marge ?? 0,
    scelleCouleur: R.scelleCouleur,
  };
}

// ---------------------------------------------------------------------------
// Grille de travail
// ---------------------------------------------------------------------------

class Grille {
  constructor(W, H) { this.W = W; this.H = H; this.occ = new Map(); }
  key(x, y) { return y * this.W + x; }
  inside(x, y) { return x >= 0 && x < this.W && y >= 0 && y < this.H; }
  libre(cells, sauf) {
    return cells.every(([x, y]) => {
      if (!this.inside(x, y)) return false;
      const o = this.occ.get(this.key(x, y));
      return o === undefined || o === sauf;
    });
  }
  poser(id, cells) { for (const [x, y] of cells) this.occ.set(this.key(x, y), id); }
  retirer(cells) { for (const [x, y] of cells) this.occ.delete(this.key(x, y)); }
}

const absolute = (shape, x, y) => shape.cells.map(([dx, dy]) => [x + dx, y + dy]);

/** Portes : réparties sur les côtés, sans chevauchement, chaque couleur servie. */
function makeGates({ W, H, colorCount, gateCount, porteLarge, portesPartagees }, rng) {
  const gates = [];
  const parSide = { top: [], right: [], bottom: [], left: [] };
  const longueurDe = (side) => (side === 'top' || side === 'bottom' ? W : H);

  const couleurs = shuffled(rng, [...Array(colorCount).keys()]);
  for (let i = 0; i < gateCount; i++) {
    const color = couleurs[i % colorCount];
    for (let essai = 0; essai < 40; essai++) {
      const side = pick(rng, SIDES);
      const max = longueurDe(side);
      // `porteLarge` est la part de portes de trois cases. La ramener à zéro
      // n'ouvre plus que des passages de deux : les formes encombrantes doivent
      // alors viser juste, et le choix de la porte cesse d'être une formalité.
      const length = Math.min(max, rng() < porteLarge ? 3 : 2);
      const start = Math.floor(rng() * (max - length + 1));
      const chevauche = parSide[side].some((g) => start < g.start + g.length && g.start < start + length);
      if (chevauche) continue;
      const gate = { side, start, length, color };
      parSide[side].push(gate);
      gates.push(gate);
      break;
    }
  }

  // Portes partagées : une seconde couleur admise. Le joueur y gagne une
  // option, et y perd la certitude qu'une porte ne sert qu'une famille — deux
  // couleurs se disputent alors la même capacité.
  for (let i = 0; i < (portesPartagees || 0) && i < gates.length; i++) {
    const g = gates[gates.length - 1 - i];
    const autres = couleurs.filter((c) => c !== g.color);
    if (!autres.length) break;
    g.colors = [g.color, pick(rng, autres)];
  }
  return gates;
}

/**
 * Distance d'une forme à sa porte, en cases. C'est la mesure que la marche
 * arrière cherche à maximiser : un bloc posé juste devant sa porte ne pose
 * aucune question au joueur.
 */
function distanceALaPorte(gate, shape, x, y, W, H) {
  if (gate.side === 'right') return W - (x + shape.w);
  if (gate.side === 'left') return x;
  if (gate.side === 'bottom') return H - (y + shape.h);
  return y;
}

/** Position de pose d'une forme, plaquée dans l'ouverture d'une porte. */
function poseAuPorte(gate, shape, W, H, rng) {
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
 * Nombre de GESTES réellement nécessaires pour résoudre le niveau.
 *
 * On ne peut pas le déduire des virages du chemin : un doigt qui suit un tracé
 * en L fait tourner le bloc en un seul glissé, le moteur avançant case par case
 * vers la position visée. Compter les changements de direction surestimait donc
 * le coût de 60 %, et les seuils d'étoiles devenaient inatteignables à l'envers
 * — tout le monde décrochait 3★.
 *
 * On mesure : pour chaque bloc, on cherche le point le plus lointain de son
 * chemin atteignable d'un seul geste, on le joue, et on recommence.
 */
function mesureGestes(base) {
  const b = new Board({ ...base, moveLimit: 9999, timeLimit: 9999, starDrags: [0, 0] });
  let gestes = 0;

  for (const etape of base.solution) {
    const chemin = etape.chemin;
    const dernier = chemin.length - 1;
    let pos = 0;
    let garde = 0;

    while (pos < dernier && garde++ < 40) {
      let atteint = pos;
      for (let j = dernier; j > pos; j--) {
        const snap = b.snapshot();
        b.dragTowards(etape.id, chemin[j].x, chemin[j].y);
        const bloc = b.blocks.get(etape.id);
        const ok = bloc && bloc.x === chemin[j].x && bloc.y === chemin[j].y;
        b.restore(snap);
        if (ok) { atteint = j; break; }
      }
      if (atteint === pos) atteint = pos + 1; // sécurité : on avance d'un cran
      b.dragTowards(etape.id, chemin[atteint].x, chemin[atteint].y);
      gestes++;
      pos = atteint;
    }

    // La sortie prolonge le dernier glissé : le doigt ne se relève pas.
    if (b.blocks.has(etape.id)) {
      const [dx, dy] = VECTEURS_SORTIE[etape.gate];
      if (b.step(etape.id, dx, dy).ok && pos === 0) gestes++;
    }
    b.endGesture(true);
  }
  return Math.max(base.solution.length, gestes);
}

// ---------------------------------------------------------------------------

/**
 * Combien de RETOURS EN ARRIÈRE une grille impose.
 *
 * C'est la seule mesure honnête de « il faut réfléchir ». La densité, le nombre
 * de blocs, les effets : tout cela peut être élevé sans qu'aucun choix ne soit
 * jamais mauvais — le solveur pose alors son premier coup et gagne, et le
 * joueur aussi. Les mesures relevées sur les dix-huit premiers mondes sont
 * édifiantes : la quasi-totalité des grilles se résolvent en autant d'états
 * qu'elles ont de blocs, c'est-à-dire sans se tromper une seule fois.
 *
 * Une grille exigeante est une grille où le solveur doit défaire ce qu'il vient
 * de faire. On lui donne un budget serré : au-delà, la grille est déjà bien
 * assez retorse, et connaître le chiffre exact ne changerait pas le choix.
 */
const BUDGET_EXIGENCE = 30000;

function exigenceDe(g) {
  const board = new Board({
    width: g.W, height: g.H, gates: g.gates, blocks: g.blocks,
    moveLimit: 9999, timeLimit: 9999, solution: [],
  });
  const r = resoudre(board, BUDGET_EXIGENCE);
  // Une grille que le solveur n'arrive pas à vider dans son budget n'est pas
  // pour autant bonne : on ne la départage pas au hasard, on la prend telle
  // qu'elle est — sa solution de référence, elle, existe toujours.
  return r.etats;
}

function build(n) {
  const rng = mulberry32(0x5eed * n + 1013904223);
  const p = curve(n);
  const { W, H } = p;

  // Formes autorisées. Interdire les petites pièces est un levier à part
  // entière : une case isolée se faufile partout et sert de bouche-trou, alors
  // qu'un tétromino doit trouver un passage à sa mesure.
  const formes = SHAPES.filter((f) => f.cells.length >= p.formesMin);

  // On explore plusieurs grilles et on garde la PLUS DENSE : la difficulté de
  // ce genre vient de l'encombrement, et se contenter de la première grille
  // acceptable donnait des niveaux à moitié vides.
  let meilleure = null;

  /**
   * Sélection sur l'EXIGENCE, pour les mondes qui en font leur sujet.
   *
   * On évalue au fil de l'eau, et non un palmarès constitué à la fin : le
   * classement se fait sur la note — densité, éloignement, charge — qui ne dit
   * rien de l'embarras. Dix grilles bien remplies peuvent toutes se résoudre du
   * premier coup, et c'est exactement ce qu'on obtenait.
   *
   * On n'évalue donc que les candidates du haut du panier, on s'arrête dès
   * qu'une grille atteint la cible, et on borne le nombre d'appels : le solveur
   * coûte des secondes, et il n'est pas question d'en dépenser cent par niveau.
   */
  const finalistes = [];
  const FINALISTES = 30;

  for (let tentative = 0; tentative < 220; tentative++) {
    const grille = new Grille(W, H);
    const gates = makeGates(p, rng);
    if (gates.length === 0) continue;
    const blocks = [];
    let idSuivant = 1;

    // Murs d'abord : les chemins des blocs seront creusés en les évitant.
    for (let i = 0; i < p.murs; i++) {
      const x = 1 + Math.floor(rng() * (W - 2));
      const y = 1 + Math.floor(rng() * (H - 2));
      if (!grille.libre([[x, y]])) continue;
      const b = { id: idSuivant++, color: -1, cells: [[0, 0]], x, y, kind: KIND.WALL };
      grille.poser(b.id, [[x, y]]);
      blocks.push(b);
    }

    // Pose à l'envers : entrée par la porte, puis recul dans la grille.
    const poses = [];
    const parPorte = new Map(gates.map((g) => [g, 0]));
    const poses_par_type = { [KIND.RAIL]: 0, [KIND.ANCRE]: 0, [KIND.ENCOMBRANT]: 0 };
    const plafond = { [KIND.RAIL]: p.rails, [KIND.ANCRE]: p.ancres, [KIND.ENCOMBRANT]: p.encombrants };

    for (let i = 0; i < p.blockCount; i++) {
      // Plusieurs tentatives par bloc : on garde la première qui éloigne
      // suffisamment le bloc de sa porte, sinon la meilleure obtenue. Rejeter
      // sèchement une pose trop proche faisait perdre des blocs et rendait la
      // génération impossible sur les grilles denses.
      let meilleurEssai = null;

      for (let essai = 0; essai < 8 && (!meilleurEssai || meilleurEssai.eloignement < 3); essai++) {
        const ordre = [gates[(i + essai) % gates.length], ...shuffled(rng, gates)];
        let pose = null;
        let gate = null;

        for (const candidate of ordre) {
          for (const shape of shuffled(rng, formes)) {
            const at = poseAuPorte(candidate, shape, W, H, rng);
            if (!at) continue;
            if (!grille.libre(absolute(shape, at.x, at.y))) continue;
            // Poser à la porte ne suffit pas : il faut pouvoir en ressortir.
            grille.poser(-1, absolute(shape, at.x, at.y));
            const sortable = peutSortirDeSaPorte(grille, candidate, shape, at.x, at.y, -1);
            grille.retirer(absolute(shape, at.x, at.y));
            if (!sortable) continue;
            pose = { shape, x: at.x, y: at.y };
            gate = candidate;
            break;
          }
          if (pose) break;
        }
        if (!pose) break; // plus de place du tout : inutile d'insister

        const id = idSuivant++;
        let { x, y } = pose;
        grille.poser(id, absolute(pose.shape, x, y));
        const chemin = [{ x, y }];

        // Type spécial de ce bloc. Il se décide AVANT la marche arrière, parce
        // qu'un bloc bridé en déplacement doit reculer sous la même bride :
        // sinon le chemin retour, qui est la solution lue à l'envers, serait
        // injouable. L'ancre passe en premier — c'est la contrainte la plus
        // forte, et la laisser en second la rendrait introuvable.
        const axeDeLaPorte = gate.side === 'left' || gate.side === 'right' ? 'h' : 'v';
        const dispo = (k) => poses_par_type[k] < plafond[k];
        const special =
          dispo(KIND.ANCRE) && rng() < 0.4 ? KIND.ANCRE :
          dispo(KIND.RAIL) && rng() < 0.55 ? KIND.RAIL :
          dispo(KIND.ENCOMBRANT) && rng() < 0.5 ? KIND.ENCOMBRANT :
          null;
        const axe = special === KIND.RAIL ? axeDeLaPorte : null;

        // Marche arrière ORIENTEE : à chaque pas on privilégie la direction qui
        // ELOIGNE le bloc de sa porte. Une marche purement aléatoire le laissait
        // à une ou deux cases de sa sortie, et le niveau se jouait tout seul.
        const reculs = p.recul[0] + Math.floor(rng() * (p.recul[1] - p.recul[0] + 1));
        // Une ancre ne connaît qu'un sens de marche : reculer, pour elle, c'est
        // s'éloigner en ligne droite à l'exact opposé de sa porte.
        const [sx, sy] = VECTEURS_SORTIE[gate.side];
        for (let r = 0; r < reculs; r++) {
          const toutes = special === KIND.ANCRE ? [[-sx, -sy]]
            : axe === 'h' ? [[1, 0], [-1, 0]]
            : axe === 'v' ? [[0, 1], [0, -1]]
            : [[1, 0], [-1, 0], [0, 1], [0, -1]];

          const legales = toutes.filter(([dx, dy]) =>
            grille.libre(absolute(pose.shape, x + dx, y + dy), id));
          if (!legales.length) break;

          // 80 % du temps on s'éloigne, sinon au hasard : sans ce grain d'aléa
          // tous les blocs filent en ligne droite vers le fond de la grille.
          const choisi = rng() < 0.8
            ? legales.reduce((meilleur, d) =>
                distanceALaPorte(gate, pose.shape, x + d[0], y + d[1], W, H) >
                distanceALaPorte(gate, pose.shape, x + meilleur[0], y + meilleur[1], W, H) ? d : meilleur)
            : pick(rng, legales);

          grille.retirer(absolute(pose.shape, x, y));
          x += choisi[0]; y += choisi[1];
          grille.poser(id, absolute(pose.shape, x, y));
          chemin.push({ x, y });
        }

        const eloignement = distanceALaPorte(gate, pose.shape, x, y, W, H);
        const candidat = { id, gate, chemin, pose, x, y, axe, eloignement, special };

        if (!meilleurEssai || eloignement > meilleurEssai.eloignement) {
          if (meilleurEssai) grille.retirer(absolute(meilleurEssai.pose.shape, meilleurEssai.x, meilleurEssai.y));
          meilleurEssai = candidat;
        } else {
          grille.retirer(absolute(pose.shape, x, y));
        }
      }

      // Un bloc qui touche encore sa porte n'apporte rien au casse-tête.
      if (!meilleurEssai || meilleurEssai.eloignement < 1 || meilleurEssai.chemin.length < 2) {
        if (meilleurEssai) grille.retirer(absolute(meilleurEssai.pose.shape, meilleurEssai.x, meilleurEssai.y));
        continue;
      }

      const { id, gate, chemin, pose, x, y, axe, special } = meilleurEssai;
      if (special) poses_par_type[special]++;
      blocks.push({
        id, color: gate.color, cells: pose.shape.cells, x, y,
        kind: special || KIND.NORMAL,
        axis: special === KIND.RAIL ? axe : null,
        dir: special === KIND.ANCRE ? gate.side : null,
      });
      parPorte.set(gate, (parPorte.get(gate) || 0) + 1);
      poses.push({ id, gate, chemin });
    }

    if (poses.length < Math.max(5, p.blockCount - 6)) continue;

    // Solution de référence : dernier posé sorti en premier.
    const solution = [...poses].reverse().map(({ id, gate, chemin }) => ({
      id, gate: gate.side, chemin: [...chemin].reverse(),
    }));

    const parId = new Map(blocks.map((b) => [b.id, b]));

    // Scellés de couleur : « je m'ouvre quand tous les ▲ ont quitté la grille ».
    // La condition n'est posée que si la solution de référence la remplit déjà
    // au moment voulu — donc si toute la couleur visée sort AVANT ce bloc. Le
    // joueur, lui, la lit sur le bloc et compte les ▲ restants à l'écran.
    // Il passe AVANT les verrous à décompte : sa condition est bien plus
    // exigeante — il lui faut une couleur entièrement évacuée — et laisser le
    // décompte se servir d'abord ne lui laissait un candidat que dans un
    // niveau sur quatre, la nouveauté du monde manquant aux trois autres.
    if (p.scelleCouleur) {
      const rangDe = new Map(solution.map((etape, i) => [etape.id, i]));
      const dernierRang = new Map();
      for (const b of blocks) {
        if (b.kind === KIND.WALL) continue;
        const r = rangDe.get(b.id);
        if (r === undefined) continue;
        dernierRang.set(b.color, Math.max(dernierRang.get(b.color) ?? -1, r));
      }
      for (let rang = solution.length - 1; rang >= 0; rang--) {
        const b = parId.get(solution[rang].id);
        if (!b || b.kind !== KIND.NORMAL) continue;
        // Une couleur entièrement évacuée avant ce bloc, et qui n'est pas la
        // sienne : sans quoi le bloc s'attendrait lui-même et ne s'ouvrirait
        // jamais.
        const couleurs = [...dernierRang.entries()]
          .filter(([c, dernier]) => c !== b.color && dernier < rang);
        if (!couleurs.length) continue;
        b.kind = KIND.LOCKED;
        b.axis = null;
        b.dir = null;
        b.condition = { type: 'color', color: pick(rng, couleurs)[0] };
        break; // un seul par grille : deux attentes de couleur sont illisibles
      }
    }

    // Verrous : un bloc ne peut être verrouillé que par une condition déjà
    // remplie au moment où la solution lui demande de bouger.
    let poses_verrouillees = 0;
    for (let rang = solution.length - 1; rang >= 0 && poses_verrouillees < p.verrous; rang--) {
      const sortisAvant = rang; // nombre de blocs qui sortent avant celui-ci
      if (sortisAvant < 2) continue;
      const b = parId.get(solution[rang].id);
      if (!b || b.kind !== KIND.NORMAL) continue;

      // Uniquement un décompte : le joueur doit pouvoir LIRE ce qui ouvrira le
      // bloc. Une condition du type "toute la couleur ▲ sortie" est indevinable
      // en cours de partie et se lit comme un bug.
      b.kind = KIND.LOCKED;
      b.axis = null;
      b.condition = { type: 'exits', count: Math.min(sortisAvant, 2 + Math.floor(rng() * 3)) };
      poses_verrouillees++;
    }

    // Blocs doubles : une seconde couleur acceptée, en plus de la leur. Sûr
    // pour la résolubilité — leur porte d'origine reste valable — et ils
    // n'ouvrent qu'une famille de plus, là où le joker les ouvre toutes.
    // Le tirage n'a lieu que si le monde en demande : `shuffled` consomme le
    // RNG, et l'appeler pour rien décalerait toutes les grilles des mondes
    // antérieurs — le niveau n doit rendre la même grille qu'hier.
    let doublesPoses = 0;
    for (const etape of (p.doubles > 0 ? shuffled(rng, solution) : [])) {
      if (doublesPoses >= p.doubles) break;
      const b = parId.get(etape.id);
      if (!b || b.kind !== KIND.NORMAL) continue;
      const autres = [...Array(p.colorCount).keys()].filter((c) => c !== b.color);
      if (!autres.length) break;
      b.kind = KIND.DOUBLE;
      b.colors = [b.color, pick(rng, autres)];
      doublesPoses++;
    }

    // Jokers : un bloc normal devient multicolore. Toujours sûr pour la
    // résolubilité — un joker accepte sa porte d'origine comme toutes les autres.
    let jokersPoses = 0;
    for (const s of shuffled(rng, solution)) {
      if (jokersPoses >= p.jokers) break;
      const b = parId.get(s.id);
      if (!b || b.kind !== KIND.NORMAL) continue;
      b.kind = KIND.JOKER;
      jokersPoses++;
    }

    /**
     * La clé. Un bloc dont la sortie ouvre d'un coup tous les verrous d'un
     * niveau — les verrous ne comptent plus les sorties, ils l'attendent lui.
     *
     * Il faut qu'il sorte AVANT eux dans la solution de référence, sans quoi la
     * condition ne serait jamais remplie au moment voulu. On prend donc le
     * dernier bloc ordinaire qui précède le premier verrou.
     */
    if (p.cle) {
      const verrouilles = solution
        .map((etape, rang) => ({ b: parId.get(etape.id), rang }))
        .filter(({ b }) => b && b.kind === KIND.LOCKED && b.condition?.type === 'exits');
      const premierVerrou = Math.min(...verrouilles.map((v) => v.rang));
      if (verrouilles.length && Number.isFinite(premierVerrou)) {
        // N'importe quel bloc que le joueur peut saisir fait une clé : le rôle ne
        // contraint pas le déplacement. Le réserver aux blocs ordinaires n'en
        // laissait un candidat que dans trois niveaux sur cinq, les autres
        // n'ayant devant leur premier verrou que des glissières et des ancres.
        const PORTEURS = [KIND.NORMAL, KIND.RAIL, KIND.ANCRE, KIND.ENCOMBRANT];
        for (let rang = premierVerrou - 1; rang >= 0; rang--) {
          const b = parId.get(solution[rang].id);
          if (!b || !PORTEURS.includes(b.kind)) continue;
          b.estCle = true;
          for (const v of verrouilles) v.b.condition = { type: 'block', id: b.id };
          break;
        }
      }
    }

    // Capacité des portes : chaque porte n'accepte que le nombre de cases que
    // la solution de référence lui destine, plus une petite marge. Router un
    // bloc vers la mauvaise porte de la bonne couleur devient alors une erreur
    // — c'est ce qui transforme la grille en énigme.
    if (p.capacite) {
      const demande = new Map(gates.map((g) => [g, 0]));
      let quotaJokers = 0;
      for (const pose of poses) {
        const b = parId.get(pose.id);
        // `coutCapacite` et non `cells.length` : un encombrant consomme le
        // double, et provisionner moins que ce que le moteur retire rendrait le
        // niveau infaisable sans que le joueur puisse le prévoir.
        const cout = coutCapacite(b);
        if (b.kind === KIND.JOKER) { quotaJokers += cout; continue; }
        demande.set(pose.gate, demande.get(pose.gate) + cout);
      }
      // Le joker sort par la porte qu'il veut : si son quota n'était compté que
      // sur sa porte d'origine, l'envoyer ailleurs affamerait cette autre porte
      // et rendrait le niveau infaisable — sans que le joueur puisse le prévoir.
      // On provisionne donc sa taille sur TOUTES les portes.
      for (const g of gates) {
        const besoin = demande.get(g) || 0;
        if (besoin > 0) g.capacity = besoin + quotaJokers + p.marge;
      }
    }

    const occupees = blocks.reduce((sum, b) => sum + b.cells.length, 0);
    const eloignementMoyen = poses.reduce((sum, pose) => {
      const b = parId.get(pose.id);
      const forme = { w: Math.max(...b.cells.map((c) => c[0])) + 1, h: Math.max(...b.cells.map((c) => c[1])) + 1 };
      return sum + distanceALaPorte(pose.gate, forme, b.x, b.y, W, H);
    }, 0) / Math.max(1, poses.length);

    // Part de la couleur la plus représentée. Une grille peut être dense et
    // bien étalée tout en étant aux trois quarts d'une seule couleur : les
    // portes se bouchent au fil des poses, et les blocs suivants se rabattent
    // tous sur la dernière encore dégagée. Le résultat se joue moins bien et se
    // regarde mal, il faut donc le pénaliser explicitement.
    const parCouleur = new Map();
    for (const pose of poses) {
      const c = parId.get(pose.id).color;
      parCouleur.set(c, (parCouleur.get(c) || 0) + 1);
    }
    const dominante = Math.max(...parCouleur.values()) / Math.max(1, poses.length);

    const densite = occupees / (W * H);

    // Le NOMBRE de blocs compte dans la note, pas seulement les cases occupées :
    // à densité égale, une grille de quinze gros blocs demande moins de sorties
    // qu'une de vingt petits. Sans ce terme, la charge d'un niveau à l'autre
    // faisait des creux de quatre blocs à l'intérieur d'un même monde, et la
    // progression se sentait reculer.
    const charge = poses.length / p.blockCount;
    const note = densite + eloignementMoyen / 8 + charge / 3
      - 1.6 * Math.max(0, dominante - 0.4);
    const candidate = { W, H, gates, blocks, solution, occupees, note, eloignementMoyen, dominante, colorCount: p.colorCount };
    if (!meilleure || note > meilleure.note) meilleure = candidate;

    if (p.exigeant) {
      // On accumule d'abord, on mesure ensuite. Évaluer au fil de l'eau
      // dépensait le budget de solveur sur les premières grilles venues :
      // le seuil de comparaison monte avec la meilleure note connue, si bien
      // que les candidates médiocres du début passaient toutes.
      finalistes.push(candidate);
      finalistes.sort((a, b) => b.note - a.note);
      if (finalistes.length > FINALISTES) finalistes.length = FINALISTES;
      continue;
    }
    if (densite >= 0.6 && eloignementMoyen >= 3.2 && dominante <= 0.4 && charge >= 0.9) break;
  }

  /**
   * Départage des finalistes : on garde celle qui oblige le plus le solveur à
   * revenir sur ses pas, et l'on s'arrête dès qu'une grille atteint la cible —
   * une douzaine d'états par bloc, de quoi qu'un joueur ait lui aussi à s'y
   * reprendre. Les mesurer toutes coûterait des secondes pour rien.
   */
  if (p.exigeant && finalistes.length) {
    let retenue = null;
    let exigenceMax = -1;
    for (const c of finalistes) {
      const etats = exigenceDe(c);
      if (etats > exigenceMax) { exigenceMax = etats; retenue = c; }
      if (etats >= c.blocks.length * 12) break;
    }
    meilleure = retenue;
    meilleure.exigence = exigenceMax;
  }

  if (!meilleure) return null;
  meilleure.minDrags = mesureGestes({
    width: meilleure.W, height: meilleure.H, gates: meilleure.gates,
    blocks: meilleure.blocks, solution: meilleure.solution,
  });
  return meilleure;
}

const cache = new Map();

/** Retourne la data du niveau `n` (1-indexé). */
export function getLevel(n) {
  if (cache.has(n)) return cache.get(n);
  const g = build(n);
  if (!g) throw new Error(`Génération impossible pour le niveau ${n}`);

  const realm = realmDe(n);
  // Les marges se resserrent sur TOUTE la progression, pas sur ses vingt
  // premiers niveaux : indexé sur un nombre absolu, ce facteur touchait le fond
  // avant la fin du premier monde et n'avait plus rien à donner ensuite.
  const serre = 1 - 0.3 * ((n - 1) / (TOTAL_LEVELS - 1));

  /**
   * Barème des étoiles, indexé sur la solution de référence. Une fraction de
   * `moveLimit` ne marchait pas : la limite de coups se resserrant avec la
   * progression, un joueur parfait plafonnait à 2★ passé le niveau 7. Ici,
   * bien jouer paie à tout niveau.
   */
  const starDrags = [Math.ceil(g.minDrags * 1.3), Math.ceil(g.minDrags * 1.8)];

  /**
   * La limite de coups est un FILET, pas un barème — c'est le chrono qui porte
   * la tension. Elle se cale donc au-dessus du seuil 1★ : sous ce seuil, un
   * joueur laborieux perdait au lieu de décrocher une étoile, et l'écran de
   * résultat promettait une note qu'aucune partie ne pouvait obtenir. Le
   * précédent plancher fixe (`minDrags + 5`) le garantissait tant que la
   * solution tenait en quinze glissés ; au-delà il passait sous le seuil 3★, et
   * toute victoire valait alors trois étoiles. La marge est désormais
   * proportionnelle, `serre` la resserrant au fil de la progression.
   */
  const moveLimit = starDrags[1] + Math.max(2, Math.round(g.minDrags * 0.4 * serre));
  // Le temps se joue sur la réflexion, pas sur le nombre de gestes : on le cale
  // sur le nombre de blocs à sortir. Registre casual : une à deux minutes.
  const jouables = g.blocks.filter((b) => b.kind !== KIND.WALL).length;
  // Le plafond suit la taille des grilles : à 120 s, les vingt-six blocs du
  // dernier monde laissaient moins de cinq secondes par sortie, geste compris.
  const timeLimit = Math.min(180, Math.max(40, Math.round((jouables * 7 + 15) * serre / 5) * 5));

  const level = {
    levelId: `lvl_${String(n).padStart(3, '0')}`,
    number: n,
    // Libellé français : c'est l'identifiant lisible du monde dans les données.
    // Ce que le joueur voit passe par le catalogue et `i18n.texteMonde`, qui
    // dispose des cinq langues.
    realm: realm.nom.fr,
    difficulty: realm.difficulte.fr,
    width: g.W,
    height: g.H,
    colorCount: g.colorCount,
    moveLimit,
    timeLimit,
    minDrags: g.minDrags,
    /**
     * Nombre d'états qu'un solveur explore pour vider la grille. Un niveau qui
     * s'en tient au nombre de blocs se résout sans jamais se tromper ; au-delà,
     * il faut revenir sur ses pas. Mesuré à la fabrication pour les mondes
     * exigeants, absent ailleurs — l'équilibrage le lit, le jeu l'ignore.
     */
    ...(g.exigence === undefined ? {} : { exigence: g.exigence }),
    objective: { type: 'clear_all', target: g.blocks.filter((b) => b.kind !== KIND.WALL).length },
    starDrags,
    estimatedTime: timeLimit,
    gates: g.gates,
    blocks: g.blocks,
    solution: g.solution, // sert aux tests, à l'équilibrage et aux futurs indices
  };
  cache.set(n, level);
  return level;
}
