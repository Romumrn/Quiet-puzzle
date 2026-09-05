/**
 * Base de niveaux — la source de vérité de ce que joue l'application.
 *
 * L'application NE GÉNÈRE PLUS ses niveaux : elle les lit. `core/levels.js`
 * reste le générateur, mais il est passé du côté des outils d'auteur — c'est
 * `tools/build-levels.mjs` qui l'appelle, hors ligne, pour remplir `levels/`.
 *
 * Ce que ça change, et c'est tout l'intérêt :
 *
 *  - un niveau peut être RETOUCHÉ à la main sans que la prochaine exécution
 *    l'écrase, puisque plus rien ne le recalcule au démarrage ;
 *  - les niveaux livrés sont exactement ceux qui ont été testés, et non le
 *    produit d'un générateur qu'une modification pourrait déplacer sous nos
 *    pieds ;
 *  - ajouter du contenu ne demande plus de toucher au code : on régénère la
 *    base, ou on y dépose un fichier.
 *
 * La base est découpée par monde : l'index est chargé au démarrage (quelques
 * kilo-octets), chaque monde à la première demande. Charger les cent soixante
 * niveaux d'un coup ferait attendre trois quarts de méga-octet pour n'en jouer
 * qu'un.
 */

/**
 * Base embarquée. `tools/bundle.mjs` remplit cet objet au moment de fabriquer
 * le fichier unique : celui-ci n'a pas de serveur d'où charger quoi que ce
 * soit, et un `fetch` sur `file://` échouerait. Vide, on passe par le réseau.
 */
export const EMBARQUE = { index: null, mondes: {} };

const RACINE = 'levels';

let index = null;
const mondes = new Map();   // id de monde -> tableau de niveaux
const parNumero = new Map();

async function lire(chemin, embarque) {
  if (embarque) return embarque;
  const reponse = await fetch(`${RACINE}/${chemin}`, { cache: 'no-cache' });
  if (!reponse.ok) throw new Error(`Base de niveaux : ${chemin} illisible (${reponse.status})`);
  return reponse.json();
}

/**
 * Charge le catalogue. À appeler UNE fois, avant d'afficher quoi que ce soit :
 * tout ce qui suit (nombre de niveaux, mondes, palettes) est ensuite lisible de
 * façon synchrone, comme l'était le générateur qu'on remplace.
 */
export async function ouvrir() {
  if (index) return index;
  index = await lire('index.json', EMBARQUE.index);
  return index;
}

const exigeOuvert = () => {
  if (!index) throw new Error('Base de niveaux non ouverte : appeler ouvrir() au démarrage');
  return index;
};

// --- Catalogue, en lecture synchrone ---------------------------------------

export const catalogue = () => exigeOuvert();
export const totalLevels = () => exigeOuvert().totalLevels;
export const levelsPerRealm = () => exigeOuvert().levelsPerRealm;
export const realms = () => exigeOuvert().realms;

/** Le monde auquel appartient le niveau `n` (1-indexé). */
export function realmDe(n) {
  const cat = exigeOuvert();
  const i = Math.floor((n - 1) / cat.levelsPerRealm);
  return cat.realms[Math.min(cat.realms.length - 1, Math.max(0, i))];
}

// --- Niveaux ---------------------------------------------------------------

async function chargerMonde(id) {
  if (mondes.has(id)) return mondes.get(id);
  const monde = exigeOuvert().realms.find((r) => r.id === id);
  if (!monde) throw new Error(`Monde ${id} absent du catalogue`);
  const data = await lire(monde.fichier, EMBARQUE.mondes[monde.fichier]);
  mondes.set(id, data.levels);
  for (const niveau of data.levels) parNumero.set(niveau.number, niveau);
  return data.levels;
}

/**
 * Le niveau `n`, lu dans la base.
 *
 * L'objet rendu est une COPIE : le plateau consomme la capacité des portes en
 * cours de partie, et rendre l'original ferait qu'un niveau rejoué reprendrait
 * avec les portes déjà entamées de la partie précédente.
 */
export async function getLevel(n) {
  const cat = exigeOuvert();
  if (!Number.isInteger(n) || n < 1 || n > cat.totalLevels) throw new Error(`Niveau ${n} introuvable`);
  if (!parNumero.has(n)) await chargerMonde(realmDe(n).id);
  const niveau = parNumero.get(n);
  if (!niveau) throw new Error(`Niveau ${n} absent de la base`);
  return structuredClone(niveau);
}

/** Précharge un monde entier — pour lisser l'entrée dans un nouveau décor. */
export const prechargerMonde = (id) => chargerMonde(id).then(() => undefined, () => undefined);

/**
 * Libellé de l'objectif, pour le pré-niveau et le HUD. Il vit ici et non chez le
 * générateur : il ne lit qu'un objet niveau, et l'application n'a plus de
 * raison de charger le générateur pour une phrase.
 */
export function objectiveLabel(level) {
  const n = level.objective.target;
  return `Faire sortir les ${n} blocs`;
}
