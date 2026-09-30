/**
 * The realm table — fifty worlds of twenty levels.
 *
 * Nothing here is served to the browser: the game reads the level database,
 * never the generator. A world is three things:
 *
 *  1. an IDENTITY — name, hue, palette. These match the map's branch images
 *     (`prototype/tools/mondes.py`, one CSS rule per world), so they do not move;
 *  2. its FEATURES — the mechanics it is built around. The first seventeen worlds
 *     introduce one mechanic each; every world after that COMBINES two or three
 *     the player already knows, never all of them at once;
 *  3. a DIFFICULTY — the number of PARKS its levels need (a park is a gesture
 *     that moves a block without taking it out), ramping inside the world.
 *
 * Why parks and not gestures, density or block counts: the thousand levels this
 * table replaced turned all of those up and stayed easy — a player picking free
 * blocks at random cleared every one of them once capacity was set aside. What
 * makes a player think is having to see that something is in the way and find
 * where to put it, several times over. `generator/rush/` builds for exactly that.
 */

export const LEVELS_PER_REALM = 20;

const LANGS = ['fr', 'en', 'es', 'it', 'zh'];

/**
 * The mechanics, with their name in every language and what each adds to a
 * world's profile (see `generator/rush/build.js` for the fields).
 */
export const FEATURES = {
  walls: { name: { fr: 'murs', en: 'walls', es: 'muros', it: 'muri', zh: '墙块' },
    profile: { counts: { wall: [2, 4] } } },
  locks: { name: { fr: 'verrous', en: 'locks', es: 'cerrojos', it: 'serrature', zh: '锁' },
    profile: { counts: { locked: [2, 4] }, lockMax: 3 } },
  joker: { name: { fr: 'joker', en: 'joker', es: 'comodín', it: 'jolly', zh: '万能块' },
    profile: { counts: { joker: [1, 1] } } },
  anchors: { name: { fr: 'ancres', en: 'anchors', es: 'anclas', it: 'ancore', zh: '锚块' },
    profile: { counts: { anchor: [2, 4] } } },
  capacity: { name: { fr: 'portes à capacité', en: 'gates with a capacity', es: 'puertas con capacidad', it: 'porte con capienza', zh: '限量门' },
    profile: { capacity: true, fewerColors: 1 } },
  bulky: { name: { fr: 'encombrants', en: 'heavy blocks', es: 'voluminosos', it: 'ingombranti', zh: '笨重方块' },
    profile: { capacity: true, fewerColors: 1, counts: { bulky: [2, 3] } } },
  seal: { name: { fr: 'scellés de couleur', en: 'colour seals', es: 'sellos de color', it: 'sigilli di colore', zh: '颜色封印' },
    profile: { colorSeal: true, counts: { locked: [2, 3] } } },
  dual: { name: { fr: 'bicolores', en: 'two-colour blocks', es: 'bloques bicolores', it: 'blocchi bicolori', zh: '双色方块' },
    profile: { counts: { dual: [2, 3] } } },
  narrow: { name: { fr: 'portes étroites', en: 'narrow gates', es: 'puertas estrechas', it: 'porte strette', zh: '窄门' },
    profile: { gateLen: [2, 2] } },
  large: { name: { fr: 'grandes pièces', en: 'large pieces', es: 'piezas grandes', it: 'pezzi grandi', zh: '大块' },
    // Fewer, bigger blocks: at the usual fill, large pieces jam almost every
    // 7×7 board they are drawn on before the climb can start.
    profile: { largeShapes: true, minShapeSize: 2, fill: [0.58, 0.66] } },
  shared: { name: { fr: 'portes partagées', en: 'shared gates', es: 'puertas compartidas', it: 'porte condivise', zh: '共享门' },
    profile: { sharedGates: 2 } },
  key: { name: { fr: 'clé', en: 'key', es: 'llave', it: 'chiave', zh: '钥匙' },
    profile: { key: true, counts: { locked: [2, 3] } } },
  oneway: { name: { fr: 'cases à sens unique', en: 'one-way cells', es: 'casillas de sentido único', it: 'caselle a senso unico', zh: '单向格' },
    profile: { oneWay: [3, 6] } },
  shutter: { name: { fr: 'portes retardées', en: 'late gates', es: 'puertas tardías', it: 'porte in ritardo', zh: '延迟门' },
    profile: { shutters: 2 } },
  slide: { name: { fr: 'glisseurs', en: 'sliders', es: 'bloques deslizantes', it: 'blocchi scivolanti', zh: '滑行块' },
    profile: { counts: { slide: [2, 4] } } },
};

/** The sentence a world that introduces ONE mechanic announces it with. */
const INTRODUCES = {
  basics: {fr: 'Les blocs et leurs portes', en: 'Blocks and their gates', es: 'Los bloques y sus puertas', it: 'I blocchi e le loro porte', zh: '方块与它们的门'},
  walls: {fr: 'Blocs scellés, immobiles', en: 'Sealed blocks that never move', es: 'Bloques sellados, inmóviles', it: 'Blocchi sigillati, immobili', zh: '封死不动的方块'},
  locks: {fr: 'Verrous à décompte', en: 'Locks with a countdown', es: 'Cerrojos con cuenta atrás', it: 'Serrature con conto alla rovescia', zh: '带计数的锁'},
  joker: {fr: 'Le joker, qui sort par où il veut', en: 'The joker, which leaves by any gate', es: 'El comodín, que sale por donde quiere', it: 'Il jolly, che esce da dove vuole', zh: '万能方块，任意门皆可'},
  anchors: {fr: 'Ancres, qui n’avancent que vers leur porte', en: 'Anchors, which only move towards their gate', es: 'Anclas, que solo avanzan hacia su puerta', it: 'Ancore, che avanzano solo verso la loro porta', zh: '锚块，只朝自己的门前进'},
  bulky: {fr: 'Encombrants, qui coûtent double à leur porte', en: 'Heavy blocks, which cost their gate double', es: 'Voluminosos, que cuestan el doble a su puerta', it: 'Ingombranti, che costano il doppio alla loro porta', zh: '笨重方块，占用双倍容量'},
  seal: {fr: 'Des scellés qui attendent qu’une couleur ait disparu', en: 'Seals that wait for a whole colour to be gone', es: 'Sellos que esperan a que un color desaparezca', it: 'Sigilli che attendono la scomparsa di un colore', zh: '颜色封印：某色清空才解锁'},
  dual: {fr: 'Blocs bicolores, qui hésitent entre deux portes', en: 'Two-colour blocks, torn between two gates', es: 'Bloques bicolores, que dudan entre dos puertas', it: 'Blocchi bicolori, indecisi fra due porte', zh: '双色方块，可走两种门'},
  narrow: {fr: 'Des portes de deux cases, jamais plus', en: 'Gates two cells wide, never more', es: 'Puertas de dos casillas, nunca más', it: 'Porte di due caselle, mai di più', zh: '门宽只有两格'},
  large: {fr: 'Plus une seule pièce d’une case', en: 'Not a single one-cell piece left', es: 'Ni una sola pieza de una casilla', it: 'Non più un solo pezzo da una casella', zh: '不再有单格方块'},
  shared: {fr: 'Des portes qui servent deux couleurs à la fois', en: 'Gates serving two colours at once', es: 'Puertas que sirven a dos colores a la vez', it: 'Porte che servono due colori insieme', zh: '一门通两色'},
  key: {fr: 'Une clé, dont la sortie ouvre tous les verrous', en: 'A key whose exit opens every lock', es: 'Una llave cuya salida abre todos los cerrojos', it: 'Una chiave la cui uscita apre tutte le serrature', zh: '一把钥匙，出门即开所有锁'},
  oneway: {fr: 'Des cases à sens unique', en: 'One-way cells', es: 'Casillas de sentido único', it: 'Caselle a senso unico', zh: '单向格子'},
  shutter: {fr: 'Des portes qui ouvrent en retard', en: 'Gates that open late', es: 'Puertas que abren tarde', it: 'Porte che si aprono in ritardo', zh: '延迟开启的门'},
  slide: {fr: 'Des blocs qui glissent sans s’arrêter', en: 'Blocks that slide until something stops them', es: 'Bloques que se deslizan sin parar', it: 'Blocchi che scivolano senza fermarsi', zh: '一滑到底的方块'},  rails: { fr: 'Blocs sur glissière', en: 'Blocks on rails', es: 'Bloques sobre raíles', it: 'Blocchi su binario', zh: '滑轨方块' },
  capacity: { fr: 'Portes à capacité : chacune a sa limite', en: 'Gates with a capacity: each has its limit', es: 'Puertas con capacidad: cada una tiene su límite', it: 'Porte con capienza: ognuna ha il suo limite', zh: '限量的门：每扇门都有上限' },
};

/**
 * The plan. `features` names what the world is about; `parks` is what its
 * easiest and its hardest levels need — in between, the twenty levels follow
 * a sawtooth (see `SLOTS` in index.js), not a straight ramp.
 *
 * The ramp was set by playtesting (2026-09): the first world at 2 to 5 parks,
 * the third at 8 to 10 ("exactly what we want"), 12 at most before level 200 —
 * 15 parks with traps around level 150 needed the solution shown. Past level
 * 200 the boards grow to 8×8 and the peaks to 15–18 parks.
 *
 * `traps`: jokers are added, and capacities chosen so that some gate a joker
 * can reach first is the wrong one (see `countTraps` in rush/solve.js). On
 * worlds that have capacity, from the eighth on — a trap needs a capacity.
 *
 * Rails are everywhere from world 1: a rail cannot step round an obstacle, and
 * that is what makes a board jam. The first world has none, on purpose.
 */

const PLAN = [
  // Chapter 1 — one new mechanic per world
  // Worlds 1 and 2 are a steady ramp (RAMP_REALMS in core/sawtooth.js), and a
  // level may overshoot its target by one park at most: playtesters found the
  // sawtooth and the +3 overshoots "very irregular" there (2026-09-30).
  { features: ['basics'], W: 5, H: 5, colors: 3, parks: [2, 5], railShare: 0, overshoot: 1 },
  { features: ['rails'], W: 5, H: 6, colors: 3, parks: [4, 8], overshoot: 1 },
  { features: ['walls'], W: 6, H: 6, colors: 4, parks: [6, 10] },
  { features: ['locks'], W: 6, H: 7, colors: 4, parks: [6, 10] },
  { features: ['joker'], W: 7, H: 7, colors: 4, parks: [6, 11] },
  { features: ['anchors'], W: 7, H: 7, colors: 4, parks: [6, 11] },
  { features: ['capacity'], W: 7, H: 7, colors: 4, parks: [6, 12] },
  { features: ['bulky'], W: 7, H: 7, colors: 4, parks: [6, 12], traps: true },
  { features: ['seal'], W: 7, H: 7, colors: 4, parks: [6, 12] },
  { features: ['dual'], W: 7, H: 7, colors: 4, parks: [7, 12] },
  { features: ['narrow'], W: 8, H: 8, colors: 4, parks: [8, 15] },
  { features: ['large'], W: 8, H: 8, colors: 4, parks: [8, 15] },
  { features: ['shared'], W: 8, H: 8, colors: 4, parks: [8, 15] },
  { features: ['key'], W: 8, H: 8, colors: 4, parks: [8, 15] },
  { features: ['oneway'], W: 8, H: 8, colors: 4, parks: [8, 15] },
  { features: ['shutter'], W: 8, H: 8, colors: 4, parks: [8, 15] },
  { features: ['slide'], W: 8, H: 8, colors: 4, parks: [8, 15] },
  // Chapter 2 — pairs
  { features: ['anchors', 'walls'], W: 8, H: 8, colors: 4, parks: [8, 15] },
  { features: ['locks', 'capacity'], W: 8, H: 8, colors: 4, parks: [8, 15], traps: true },
  { features: ['dual', 'shared'], W: 8, H: 8, colors: 4, parks: [8, 15] },
  { features: ['bulky', 'narrow'], W: 8, H: 8, colors: 4, parks: [8, 16], traps: true },
  { features: ['slide', 'walls'], W: 8, H: 8, colors: 4, parks: [8, 16] },
  { features: ['oneway', 'locks'], W: 8, H: 8, colors: 4, parks: [8, 16] },
  { features: ['key', 'anchors'], W: 8, H: 8, colors: 4, parks: [8, 16] },
  { features: ['seal', 'dual'], W: 8, H: 8, colors: 4, parks: [8, 16] },
  { features: ['shutter', 'capacity'], W: 8, H: 8, colors: 4, parks: [8, 16], traps: true },
  { features: ['slide', 'anchors'], W: 8, H: 8, colors: 4, parks: [8, 16] },
  { features: ['large', 'oneway'], W: 8, H: 8, colors: 4, parks: [8, 16] },
  { features: ['joker', 'capacity'], W: 8, H: 8, colors: 5, parks: [8, 16], traps: true },
  { features: ['bulky', 'shared'], W: 8, H: 8, colors: 4, parks: [8, 16], traps: true },
  { features: ['oneway', 'anchors'], W: 8, H: 8, colors: 4, parks: [9, 17] },
  { features: ['slide', 'shutter'], W: 8, H: 8, colors: 4, parks: [9, 17] },
  { features: ['key', 'seal'], W: 8, H: 8, colors: 4, parks: [9, 17] },
  { features: ['anchors', 'narrow'], W: 8, H: 8, colors: 4, parks: [9, 17] },
  // Chapter 3 — trios, and pairs not met yet
  { features: ['dual', 'capacity', 'bulky'], W: 8, H: 8, colors: 4, parks: [9, 17], traps: true },
  { features: ['slide', 'oneway'], W: 8, H: 8, colors: 4, parks: [9, 17] },
  { features: ['shared', 'seal'], W: 8, H: 8, colors: 5, parks: [9, 17] },
  { features: ['locks', 'shutter', 'walls'], W: 8, H: 8, colors: 4, parks: [9, 17] },
  { features: ['large', 'anchors', 'walls'], W: 8, H: 8, colors: 4, parks: [9, 17] },
  { features: ['key', 'slide'], W: 8, H: 8, colors: 4, parks: [9, 17] },
  { features: ['capacity', 'narrow', 'large'], W: 8, H: 8, colors: 4, parks: [10, 18], traps: true },
  { features: ['oneway', 'anchors', 'locks'], W: 8, H: 8, colors: 4, parks: [10, 18] },
  { features: ['dual', 'shutter'], W: 8, H: 8, colors: 5, parks: [10, 18] },
  { features: ['bulky', 'slide'], W: 8, H: 8, colors: 4, parks: [10, 18], traps: true },
  { features: ['seal', 'oneway'], W: 8, H: 8, colors: 4, parks: [10, 18] },
  { features: ['key', 'capacity', 'shared'], W: 8, H: 8, colors: 5, parks: [10, 18], traps: true },
  { features: ['slide', 'oneway', 'walls'], W: 8, H: 8, colors: 4, parks: [10, 18] },
  { features: ['anchors', 'bulky', 'shutter'], W: 8, H: 8, colors: 4, parks: [10, 18], traps: true },
  { features: ['dual', 'key', 'large'], W: 8, H: 8, colors: 5, parks: [10, 18] },
  { features: ['oneway', 'slide', 'capacity'], W: 8, H: 8, colors: 4, parks: [10, 18], traps: true },
];

/** What every world starts from, before its features are added. */
const BASE = {
  gatesPerSide: [1, 2], gateLen: [2, 3], fill: [0.66, 0.74], railShare: 0.7,
  counts: {},
};

function merge(a, b) {
  const out = { ...a, ...b };
  if (a.counts || b.counts) {
    out.counts = { ...(a.counts || {}) };
    for (const [k, v] of Object.entries(b.counts || {})) {
      // Two features asking for the same kind (key and locks both want locks):
      // take the larger ramp, never the sum.
      const cur = out.counts[k];
      out.counts[k] = cur ? [Math.max(cur[0], v[0]), Math.max(cur[1], v[1])] : v;
    }
  }
  return out;
}

/** A world's generator profile: base, then its features, then its board. */
export function profileOf(plan) {
  let p = { ...BASE };
  for (const f of plan.features) if (FEATURES[f]) p = merge(p, FEATURES[f].profile);
  const { features, ...board } = plan;
  p = merge(p, board);
  if (p.traps) p = merge(p, { counts: { joker: [2, 3] } });
  // Capacity only bites when a colour can leave by more than one gate: fewer
  // colours than gates makes that happen.
  if (p.fewerColors) p.colors = Math.max(2, p.colors - p.fewerColors);
  return p;
}

const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const AND = { fr: ' et ', en: ' and ', es: ' y ', it: ' e ', zh: '与' };
const COMMA = { fr: ', ', en: ', ', es: ', ', it: ', ', zh: '、' };

/** "Anchors and walls", "Locks, late gates and walls" — in every language. */
function combinationText(features) {
  const out = {};
  for (const l of LANGS) {
    const names = features.map((f) => FEATURES[f].name[l]);
    const text = names.length === 1 ? names[0]
      : names.slice(0, -1).join(COMMA[l]) + AND[l] + names[names.length - 1];
    out[l] = l === 'zh' ? text : capital(text);
  }
  return out;
}

/** Name, hue, palette — fixed: the map's branch images are drawn from them. */
const IDENTITY = [
  { id: 0, hue: 345,
    name: {fr: 'Sakura Paisible', en: 'Peaceful Sakura', es: 'Sakura Apacible', it: 'Sakura Sereno', zh: '静谧樱花'},
    difficulty: {fr: 'apprentissage', en: 'learning the ropes', es: 'aprendizaje', it: 'apprendistato', zh: '入门'},
    palette: ['#eb9aad', '#93bde4', '#97cfb6', '#e9cd8c', '#bdaadd', '#f0b18b'] },
  { id: 1, hue: 275,
    name: {fr: 'Voile de Glycine', en: 'Wisteria Veil', es: 'Velo de Glicina', it: 'Velo di Glicine', zh: '紫藤轻纱'},
    difficulty: {fr: 'facile', en: 'easy', es: 'fácil', it: 'facile', zh: '简单'},
    palette: ['#e8907b', '#7fb0c9', '#a9c48b', '#edc073', '#c39fc0', '#d9a06b'] },
  { id: 2, hue: 225,
    name: {fr: 'Lys Bleu', en: 'Blue Lys', es: 'Lirio Azul', it: 'Giglio Blu', zh: '蓝色百合'},
    difficulty: {fr: 'moyen', en: 'medium', es: 'medio', it: 'medio', zh: '中等'},
    palette: ['#d99aa8', '#8cc6e0', '#8fd3c4', '#d7d295', '#aeb3e0', '#e2b3a6'] },
  { id: 3, hue: 200,
    name: {fr: 'Myosotis', en: 'Forget Me Not', es: 'Nomeolvides', it: 'Nontiscordardimé', zh: '勿忘我'},
    difficulty: {fr: 'soutenu', en: 'steady', es: 'sostenido', it: 'sostenuto', zh: '进阶'},
    palette: ['#e493b4', '#8fa8e2', '#86cbb0', '#e3c886', '#b49ae0', '#7fc4d4'] },
  { id: 4, hue: 145,
    name: {fr: 'Calme d’Eucalyptus', en: 'Eucalyptus Calm', es: 'Calma de Eucalipto', it: 'Calma di Eucalipto', zh: '桉树静谧'},
    difficulty: {fr: 'exigeant', en: 'demanding', es: 'exigente', it: 'impegnativo', zh: '考验'},
    palette: ['#dd9b95', '#96b6cc', '#9fc9a4', '#d9bd7f', '#b2a6c9', '#e0a97f'] },
  { id: 5, hue: 55,
    name: {fr: 'Soleil de Mimosa', en: 'Mimosa Sun', es: 'Sol de Mimosa', it: 'Sole di Mimosa', zh: '金合欢暖阳'},
    difficulty: {fr: 'redoutable', en: 'formidable', es: 'temible', it: 'temibile', zh: '棘手'},
    palette: ['#ec9cc0', '#8ec7d9', '#93cf8e', '#dfd083', '#c1a3dc', '#efb28f'] },
  { id: 6, hue: 40,
    name: {fr: 'Ginkgo Doré', en: 'Golden Ginkgo', es: 'Ginkgo Dorado', it: 'Ginkgo Dorato', zh: '金色银杏'},
    difficulty: {fr: 'implacable', en: 'relentless', es: 'implacable', it: 'implacabile', zh: '无情'},
    palette: ['#d792bb', '#8bacdf', '#8ecdc0', '#e6cd90', '#a99ae0', '#e5a3a0'] },
  { id: 7, hue: 25,
    name: {fr: 'Orme d’Automne', en: 'Autumn Elm', es: 'Olmo de Otoño', it: 'Olmo d’Autunno', zh: '秋日榆树'},
    difficulty: {fr: 'intransigeant', en: 'unyielding', es: 'inquebrantable', it: 'intransigente', zh: '不屈'},
    palette: ['#ef8fa6', '#85b8e8', '#8ad4b1', '#f0cd7e', '#b99ae6', '#f4ab84'] },
  { id: 8, hue: 5,
    name: {fr: 'Érable d’Hiver', en: 'Winter Maple', es: 'Arce de Invierno', it: 'Acero d’Inverno', zh: '冬日枫叶'},
    difficulty: {fr: 'retors', en: 'crafty', es: 'retorcido', it: 'insidioso', zh: '刁钻'},
    palette: ['#e0a08e', '#8fb9d6', '#a3ca9a', '#e3c37f', '#b7a4d4', '#dfa77f'] },
  { id: 9, hue: 30,
    name: {fr: 'Fleur de Pommier', en: 'Apple Blossom', es: 'Flor de Manzano', it: 'Fiore di Melo', zh: '苹果花开'},
    difficulty: {fr: 'serré', en: 'tight', es: 'ajustado', it: 'stretto', zh: '局促'},
    palette: ['#dd8f96', '#8aa9cc', '#93c197', '#dcbd7c', '#ac9ccc', '#dc9d84'] },
  { id: 10, hue: 345,
    name: {fr: 'Camélia Silencieux', en: 'Quiet Camellia', es: 'Camelia Silenciosa', it: 'Camelia Silenziosa', zh: '静谧山茶'},
    difficulty: {fr: 'massif', en: 'massive', es: 'macizo', it: 'massiccio', zh: '厚重'},
    palette: ['#d18fa8', '#7fa4d8', '#87c3ae', '#d9c084', '#a396d6', '#d59a94'] },
  { id: 11, hue: 275,
    name: {fr: 'Nuage de Lilas', en: 'Lilac Drift', es: 'Deriva de Lila', it: 'Deriva di Lillà', zh: '丁香浮云'},
    difficulty: {fr: 'trompeur', en: 'deceptive', es: 'engañoso', it: 'ingannevole', zh: '迷惑'},
    palette: ['#cf94a4', '#84b4cc', '#8fc98f', '#d4c286', '#a89dd0', '#d9a68a'] },
  { id: 12, hue: 225,
    name: {fr: 'Bleuet', en: 'Cornflower Blue', es: 'Aciano Azul', it: 'Fiordaliso Blu', zh: '矢车菊蓝'},
    difficulty: {fr: 'méthodique', en: 'methodical', es: 'metódico', it: 'metodico', zh: '讲究次序'},
    palette: ['#d68fb0', '#8ba6d4', '#8ccbb4', '#dfc57f', '#ab97d8', '#e0a292'] },
  { id: 13, hue: 200,
    name: {fr: 'Belle-de-Jour', en: 'Morning Glory', es: 'Gloria de la Mañana', it: 'Gloria del Mattino', zh: '牵牛花开'},
    difficulty: {fr: 'étouffant', en: 'stifling', es: 'asfixiante', it: 'soffocante', zh: '拥塞'},
    palette: ['#cd8c9e', '#7fa8c8', '#84c2a4', '#d3bd7a', '#a291cc', '#d29a88'] },
  { id: 14, hue: 145,
    name: {fr: 'Fougère Sauge', en: 'Sage Fern', es: 'Helecho Salvia', it: 'Felce Salvia', zh: '鼠尾草蕨'},
    difficulty: {fr: 'éprouvant', en: 'punishing', es: 'duro', it: 'duro', zh: '磨人'},
    palette: ['#dba38c', '#8fb2c4', '#9ec69b', '#dcc07e', '#b19dc8', '#d9a17e'] },
  { id: 15, hue: 55,
    name: {fr: 'Acacia Miel', en: 'Honey Acacia', es: 'Acacia de Miel', it: 'Acacia al Miele', zh: '蜜色金合欢'},
    difficulty: {fr: 'impitoyable', en: 'merciless', es: 'despiadado', it: 'spietato', zh: '残酷'},
    palette: ['#c98fae', '#8299d4', '#83c0b0', '#cfbc84', '#9f92d2', '#cf9a95'] },
  { id: 16, hue: 40,
    name: {fr: 'Bouleau Ambré', en: 'Amber Birch', es: 'Abedul Ámbar', it: 'Betulla Ambrata', zh: '琥珀桦树'},
    difficulty: {fr: 'vertigineux', en: 'dizzying', es: 'vertiginoso', it: 'vertiginoso', zh: '眩目'},
    palette: ['#c88fa0', '#7ea6cc', '#7fc3a2', '#ccba7c', '#9c8ecd', '#cd9885'] },
  { id: 17, hue: 25,
    name: {fr: 'Branche d’Abricotier', en: 'Apricot Branch', es: 'Rama de Albaricoque', it: 'Ramo di Albicocco', zh: '杏枝'},
    difficulty: {fr: 'sans retour', en: 'no way back', es: 'sin retorno', it: 'senza ritorno', zh: '无路可退'},
    palette: ['#c98b9c', '#7ba2cc', '#7cc09f', '#cbb679', '#9a8aca', '#ca9482'] },
  { id: 18, hue: 5,
    name: {fr: 'Baie Rouge', en: 'Red Berry', es: 'Baya Roja', it: 'Bacca Rossa', zh: '红浆果'},
    difficulty: {fr: 'nœud', en: 'knotted', es: 'enredado', it: 'intricato', zh: '纠缠'},
    palette: ['#c78ba6', '#7d9fd0', '#7ec3a8', '#c9b47e', '#9a8ccb', '#c99688'] },
  { id: 19, hue: 30,
    name: {fr: 'Saule Enneigé', en: 'Snow Willow', es: 'Sauce Nevado', it: 'Salice Innevato', zh: '雪柳'},
    difficulty: {fr: 'inextricable', en: 'inextricable', es: 'inextricable', it: 'inestricabile', zh: '无解之局'},
    palette: ['#c4879c', '#7799c9', '#78bd9c', '#c4b075', '#9385c6', '#c58f80'] },
  { id: 20, hue: 345,
    name: {fr: 'Prunier Rosé', en: 'Blush Plum', es: 'Ciruelo Rosado', it: 'Susino Rosato', zh: '绯色梅花'},
    difficulty: {fr: 'cloisonné', en: 'partitioned', es: 'compartimentado', it: 'compartimentato', zh: '分隔'},
    palette: ['#c98fa4', '#849dc6', '#83bfa4', '#c8b47c', '#9c8dc4', '#c99a8a'] },
  { id: 21, hue: 275,
    name: {fr: 'Champ de Lavande', en: 'Lavender Field', es: 'Campo de Lavanda', it: 'Campo di Lavanda', zh: '薰衣草田'},
    difficulty: {fr: 'enchaîné', en: 'chained', es: 'encadenado', it: 'concatenato', zh: '环环相扣'},
    palette: ['#c58ba0', '#7fa3cb', '#7cc0a8', '#c6b17e', '#9689c8', '#c69688'] },
  { id: 22, hue: 225,
    name: {fr: 'Hortensia Bleu', en: 'Blue Hydrangea', es: 'Hortensia Azul', it: 'Ortensia Blu', zh: '蓝色绣球'},
    difficulty: {fr: 'rigide', en: 'rigid', es: 'rígido', it: 'rigido', zh: '僵硬'},
    palette: ['#d2947e', '#86aec2', '#93c191', '#ccb377', '#a292c0', '#cc9b7e'] },
  { id: 23, hue: 200,
    name: {fr: 'Givre d’Hiver', en: 'Winter Frost', es: 'Escarcha de Invierno', it: 'Brina d’Inverno', zh: '冬霜'},
    difficulty: {fr: 'pesant', en: 'weighty', es: 'pesado', it: 'pesante', zh: '沉重'},
    palette: ['#c08bb0', '#8296cc', '#7fbdac', '#c4ad7d', '#9887c9', '#c1948f'] },
  { id: 24, hue: 145,
    name: {fr: 'Brise de Bambou', en: 'Bamboo Breeze', es: 'Brisa de Bambú', it: 'Brezza di Bambù', zh: '竹林微风'},
    difficulty: {fr: 'trouble', en: 'murky', es: 'turbio', it: 'torbido', zh: '混沌'},
    palette: ['#c68fa2', '#84a8c9', '#88c495', '#c9b57a', '#9c8ec6', '#c59a85'] },
  { id: 25, hue: 55,
    name: {fr: 'Genêt Jaune', en: 'Yellow Broom', es: 'Retama Amarilla', it: 'Ginestra Gialla', zh: '金雀花'},
    difficulty: {fr: 'inextricable', en: 'tangled', es: 'intrincado', it: 'intricato', zh: '纠缠难解'},
    palette: ['#bd88a4', '#7d95c6', '#79bba6', '#c0aa78', '#9184c4', '#bf9086'] },
  { id: 26, hue: 40,
    name: {fr: 'Champ de Blé', en: 'Wheat Field', es: 'Campo de Trigo', it: 'Campo di Grano', zh: '麦田'},
    difficulty: {fr: 'implacable', en: 'relentless', es: 'implacable', it: 'implacabile', zh: '无情'},
    palette: ['#c4877f', '#83a3c0', '#84bd93', '#c3ae76', '#9787c2', '#c3927c'] },
  { id: 27, hue: 25,
    name: {fr: 'Hêtre Cuivré', en: 'Copper Beech', es: 'Haya Cobriza', it: 'Faggio Ramato', zh: '铜色山毛榉'},
    difficulty: {fr: 'compté', en: 'counted', es: 'contado', it: 'contato', zh: '分秒必争'},
    palette: ['#bd8697', '#7a9cc4', '#77bba2', '#bfa974', '#8f81be', '#bd8f81'] },
  { id: 28, hue: 5,
    name: {fr: 'Vigne Pourpre', en: 'Crimson Vine', es: 'Vid Carmesí', it: 'Vite Cremisi', zh: '绯红藤蔓'},
    difficulty: {fr: 'sans complaisance', en: 'unforgiving', es: 'sin concesiones', it: 'senza sconti', zh: '绝不宽容'},
    palette: ['#b9839f', '#7692c0', '#73b79e', '#bba572', '#8b7dba', '#b98b7d'] },
  { id: 29, hue: 30,
    name: {fr: 'Brume d’Argent', en: 'Silver Mist', es: 'Bruma de Plata', it: 'Bruma d’Argento', zh: '银雾'},
    difficulty: {fr: 'vertigineux', en: 'dizzying', es: 'vertiginoso', it: 'vertiginoso', zh: '令人眩晕'},
    palette: ['#b57f9b', '#728ebc', '#6fb39a', '#b7a16e', '#8779b6', '#b58779'] },
  { id: 30, hue: 345,
    name: {fr: 'Magnolia Ivoire', en: 'Ivory Magnolia', es: 'Magnolia Marfil', it: 'Magnolia Avorio', zh: '象牙玉兰'},
    difficulty: {fr: 'inextricable', en: 'inextricable', es: 'inextricable', it: 'inestricabile', zh: '无解之局'},
    palette: ['#fecce8', '#7ee1e7', '#8cd6b3', '#cfbe7f', '#9cb2f0', '#e5997e'] },
  { id: 31, hue: 275,
    name: {fr: 'Iris du Crépuscule', en: 'Dusk Iris', es: 'Iris del Ocaso', it: 'Iris del Crepuscolo', zh: '暮色鸢尾'},
    difficulty: {fr: 'inextricable', en: 'inextricable', es: 'inextricable', it: 'inestricabile', zh: '无解之局'},
    palette: ['#fecbec', '#82defb', '#9fd3a3', '#d6bb7f', '#9eb2f0', '#ea958c'] },
  { id: 32, hue: 225,
    name: {fr: 'Bleuet Profond', en: 'Deep Cornflower', es: 'Aciano Profundo', it: 'Fiordaliso Intenso', zh: '深邃矢车菊'},
    difficulty: {fr: 'implacable', en: 'relentless', es: 'implacable', it: 'implacabile', zh: '无情'},
    palette: ['#fecce5', '#7fe1e3', '#aed199', '#ddb980', '#aaafed', '#e79783'] },
  { id: 33, hue: 200,
    name: {fr: 'Éperon Pâle', en: 'Pale Larkspur', es: 'Espuela de Caballero Pálida', it: 'Speronella Pallida', zh: '淡雅飞燕草'},
    difficulty: {fr: 'implacable', en: 'relentless', es: 'implacable', it: 'implacabile', zh: '无情'},
    palette: ['#fecdda', '#7fe1e5', '#9dd3a5', '#d3bc7f', '#a7afee', '#e69782'] },
  { id: 34, hue: 145,
    name: {fr: 'Cèdre Moussu', en: 'Moss Cedar', es: 'Cedro Musgoso', it: 'Cedro Muschiato', zh: '苔痕雪松'},
    difficulty: {fr: 'intraitable', en: 'unyielding', es: 'inquebrantable', it: 'intransigente', zh: '不屈'},
    palette: ['#fdcde3', '#7fdff5', '#87d6b7', '#d0bd7f', '#b3aceb', '#ea948d'] },
  { id: 35, hue: 55,
    name: {fr: 'Mimosa Tardif', en: 'Late Mimosa', es: 'Mimosa Tardía', it: 'Mimosa Tardiva', zh: '迟开金合欢'},
    difficulty: {fr: 'intraitable', en: 'unyielding', es: 'inquebrantable', it: 'intransigente', zh: '不屈'},
    palette: ['#fecbed', '#81dff8', '#9fd3a3', '#e2b782', '#82b7f1', '#ea958c'] },
  { id: 36, hue: 40,
    name: {fr: 'Ginkgo Bronze', en: 'Bronze Ginkgo', es: 'Ginkgo Bronce', it: 'Ginkgo Bronzo', zh: '青铜银杏'},
    difficulty: {fr: 'inflexible', en: 'inflexible', es: 'inflexible', it: 'inflessibile', zh: '冷硬'},
    palette: ['#fecbef', '#7de0ee', '#a6d29e', '#eeb189', '#97b3f0', '#eb929a'] },
  { id: 37, hue: 25,
    name: {fr: 'Érable Braise', en: 'Ember Maple', es: 'Arce Ascua', it: 'Acero Brace', zh: '炽焰枫叶'},
    difficulty: {fr: 'inflexible', en: 'inflexible', es: 'inflexible', it: 'inflessibile', zh: '冷硬'},
    palette: ['#faccf3', '#81e1df', '#add19a', '#dfb881', '#a6b0ee', '#eb948f'] },
  { id: 38, hue: 5,
    name: {fr: 'Oseille Grenat', en: 'Garnet Sorrel', es: 'Acedera Granate', it: 'Acetosa Granato', zh: '石榴红酸模'},
    difficulty: {fr: 'impitoyable', en: 'merciless', es: 'despiadado', it: 'spietato', zh: '残酷'},
    palette: ['#ffcce6', '#81dff9', '#88d6b6', '#e0b781', '#9fb1ef', '#eb9394'] },
  { id: 39, hue: 30,
    name: {fr: 'Aster Givré', en: 'Frost Aster', es: 'Áster Escarchado', it: 'Astro Brinato', zh: '霜之紫菀'},
    difficulty: {fr: 'impitoyable', en: 'merciless', es: 'despiadado', it: 'spietato', zh: '残酷'},
    palette: ['#fbccf2', '#7ee1e9', '#aad19c', '#d5bc7f', '#96b3f0', '#e69782'] },
  { id: 40, hue: 345,
    name: {fr: 'Pivoine d’Hiver', en: 'Winter Peony', es: 'Peonía de Invierno', it: 'Peonia d’Inverno', zh: '冬牡丹'},
    difficulty: {fr: 'sans merci', en: 'without mercy', es: 'sin piedad', it: 'senza pietà', zh: '毫不留情'},
    palette: ['#fcccf1', '#80dff7', '#a7d29e', '#d0bd7f', '#87b6f1', '#e69782'] },
  { id: 41, hue: 275,
    name: {fr: 'Chardon Violet', en: 'Violet Thistle', es: 'Cardo Violeta', it: 'Cardo Violetto', zh: '紫蓟'},
    difficulty: {fr: 'sans merci', en: 'without mercy', es: 'sin piedad', it: 'senza pietà', zh: '毫不留情'},
    palette: ['#fecbe9', '#81e1e0', '#98d4a9', '#ddb980', '#7ab9f0', '#eb9395'] },
  { id: 42, hue: 225,
    name: {fr: 'Lin Indigo', en: 'Indigo Flax', es: 'Lino Índigo', it: 'Lino Indaco', zh: '靛蓝亚麻'},
    difficulty: {fr: 'vertigineux', en: 'vertiginous', es: 'vertiginoso', it: 'vertiginoso', zh: '眩晕'},
    palette: ['#fecce8', '#7ee1e7', '#8cd6b3', '#cfbe7f', '#9cb2f0', '#e5997e'] },
  { id: 43, hue: 200,
    name: {fr: 'Sauge Glaciaire', en: 'Glacier Sage', es: 'Salvia Glaciar', it: 'Salvia Glaciale', zh: '冰川鼠尾草'},
    difficulty: {fr: 'vertigineux', en: 'vertiginous', es: 'vertiginoso', it: 'vertiginoso', zh: '眩晕'},
    palette: ['#fecbec', '#82defb', '#9fd3a3', '#d6bb7f', '#9eb2f0', '#ea958c'] },
  { id: 44, hue: 145,
    name: {fr: 'Ombre de Pin', en: 'Pine Shadow', es: 'Sombra de Pino', it: 'Ombra di Pino', zh: '松影'},
    difficulty: {fr: 'abyssal', en: 'abyssal', es: 'abisal', it: 'abissale', zh: '深渊'},
    palette: ['#fecce5', '#7fe1e3', '#aed199', '#ddb980', '#aaafed', '#e79783'] },
  { id: 45, hue: 55,
    name: {fr: 'Roseau Ambré', en: 'Amber Reed', es: 'Junco Ámbar', it: 'Canna Ambrata', zh: '琥珀芦苇'},
    difficulty: {fr: 'abyssal', en: 'abyssal', es: 'abisal', it: 'abissale', zh: '深渊'},
    palette: ['#fecdda', '#7fe1e5', '#9dd3a5', '#d3bc7f', '#a7afee', '#e69782'] },
  { id: 46, hue: 40,
    name: {fr: 'Aulne Rouillé', en: 'Rust Alder', es: 'Aliso Oxidado', it: 'Ontano Ruggine', zh: '锈色赤杨'},
    difficulty: {fr: 'insondable', en: 'unfathomable', es: 'insondable', it: 'insondabile', zh: '深不可测'},
    palette: ['#fdcde3', '#7fdff5', '#87d6b7', '#d0bd7f', '#b3aceb', '#ea948d'] },
  { id: 47, hue: 25,
    name: {fr: 'Sorbier Cendré', en: 'Cinder Rowan', es: 'Serbal Ceniciento', it: 'Sorbo Cinereo', zh: '灰烬花楸'},
    difficulty: {fr: 'insondable', en: 'unfathomable', es: 'insondable', it: 'insondabile', zh: '深不可测'},
    palette: ['#fecbed', '#81dff8', '#9fd3a3', '#e2b782', '#82b7f1', '#ea958c'] },
  { id: 48, hue: 5,
    name: {fr: 'If Cramoisi', en: 'Crimson Yew', es: 'Tejo Carmesí', it: 'Tasso Cremisi', zh: '绯红紫杉'},
    difficulty: {fr: 'ultime', en: 'final', es: 'final', it: 'finale', zh: '终极'},
    palette: ['#fecbef', '#7de0ee', '#a6d29e', '#eeb189', '#97b3f0', '#eb929a'] },
  { id: 49, hue: 30,
    name: {fr: 'Dernière Lumière', en: 'Last Light', es: 'Última Luz', it: 'Ultima Luce', zh: '最后之光'},
    difficulty: {fr: 'ultime', en: 'final', es: 'final', it: 'finale', zh: '终极'},
    palette: ['#faccf3', '#81e1df', '#add19a', '#dfb881', '#a6b0ee', '#eb948f'] },];

export const REALMS = IDENTITY.map((identity, i) => {
  const plan = PLAN[i];
  const single = plan.features.length === 1;
  return {
    ...identity,
    features: plan.features,
    // The first world of each mechanic says what it is; a combination says
    // what it combines. That text is the "New:" badge on the world's first level.
    novelty: single ? plan.features[0] : null,
    introduces: single ? INTRODUCES[plan.features[0]] : combinationText(plan.features),
    parks: plan.parks,
    profile: profileOf(plan),
  };
});

export const TOTAL_LEVELS = REALMS.length * LEVELS_PER_REALM;

/** The realm level `n` belongs to (1-indexed). */
export function realmOf(n) {
  return REALMS[Math.min(REALMS.length - 1, Math.floor((n - 1) / LEVELS_PER_REALM))];
}
