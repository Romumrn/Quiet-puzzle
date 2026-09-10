/**
 * Level database — the source of truth for what the application plays.
 *
 * The application NO LONGER GENERATES its levels: it reads them.
 * `core/levels.js` is still the generator, but it has moved to the authoring
 * tools — `tools/build-levels.mjs` calls it, offline, to fill `levels/`.
 *
 * What that changes, and it is the whole point:
 *
 *  - a level can be TWEAKED by hand without the next run overwriting it, since
 *    nothing recomputes it at startup any more;
 *  - the shipped levels are exactly the ones that were tested, and not the
 *    output of a generator that a change could shift under our feet;
 *  - adding content no longer means touching code: rebuild the database, or
 *    drop a file into it.
 *
 * The database is split by realm: the index is loaded at startup (a few
 * kilobytes), each realm on first demand. Loading all six hundred levels at
 * once would mean waiting for three quarters of a megabyte to play just one.
 */

/**
 * Bundled database. `tools/bundle.mjs` fills this object when building the
 * single-file version: that file has no server to load anything from, and a
 * `fetch` on `file://` would fail. Left empty, we go over the network.
 */
import { t } from '../ui/i18n.js';
import { starThresholds } from '../core/stars.js';

export const BUNDLED = { index: null, realms: {}, calibration: null };

const ROOT = 'levels';
const LEGACY_KIND_MAP = Object.freeze({
  ancre: 'anchor',
  encombrant: 'bulky',
  double: 'dual',
  verrou: 'locked',
  mur: 'wall',
});

let index = null;
const realmLevels = new Map();   // realm id -> array of levels
const byNumber = new Map();

function normalizeRealm(raw) {
  const realm = { ...raw };
  if (typeof realm.name === 'object' && realm.name) realm.name = realm.name.en ?? realm.name.fr ?? realm.name;
  if (!realm.name && raw.nom) realm.name = raw.nom.en ?? raw.nom.fr ?? raw.nom;
  if (typeof realm.difficulty === 'object' && realm.difficulty) realm.difficulty = realm.difficulty.en ?? realm.difficulty.fr ?? realm.difficulty;
  if (!realm.difficulty && raw.difficulte) realm.difficulty = raw.difficulte;
  if (typeof realm.introduces === 'object' && realm.introduces) realm.introduces = realm.introduces.en ?? realm.introduces.fr ?? realm.introduces;
  if (!realm.introduces && raw.apporte) realm.introduces = raw.apporte;
  if (realm.hue == null && raw.teinte != null) realm.hue = raw.teinte;
  if (!realm.file && raw.fichier) realm.file = raw.fichier;
  return realm;
}

function normalizeLevel(level) {
  if (!level) return level;
  const normalized = { ...level };
  if (Array.isArray(level.blocks)) {
    normalized.blocks = level.blocks.map((block) => ({
      ...block,
      kind: LEGACY_KIND_MAP[block.kind] ?? block.kind,
    }));
  }
  return normalized;
}

async function read(path, bundled) {
  if (bundled) return bundled;
  const response = await fetch(`${ROOT}/${path}`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Level database: cannot read ${path} (${response.status})`);
  return response.json();
}

/**
 * Loads the catalogue. Call it ONCE, before displaying anything: everything
 * that follows (level count, realms, palettes) is then readable synchronously,
 * just as the generator it replaces was.
 */
export async function open() {
  if (index) return index;
  const rawIndex = await read('index.json', BUNDLED.index);
  index = { ...rawIndex, realms: (rawIndex.realms || []).map(normalizeRealm) };
  if (index.calibration) await loadCalibration(index.calibration);
  return index;
}

// --- Star scale calibration ------------------------------------------------

/**
 * Reference corrected by games actually played: `levelId -> drags`.
 *
 * A level's reference drag count is worth whatever the solution found at
 * generation time was worth. It is not a lower bound: a player who clears the
 * grid in fewer moves simply proves the generator had not found the best one.
 * The scale must then follow, otherwise three stars end up saying nothing about
 * the levels players have learnt to optimise.
 *
 * The POLICY — which percentile of won games sets the reference, from how many
 * games onwards — belongs to the server: it is the one that sees every game,
 * the client only sees its own. Here we apply what we receive, with two
 * safeguards only.
 *
 * This adjustment can take NOTHING away: recorded stars are stored through
 * `Math.max` in `api.completeLevel()`. A tightened reference makes a future 3★
 * harder, never an already-earned 3★ void.
 *
 * Today no file is served and nothing is loaded — not even a request: the
 * database only goes looking for it if its index announces it.
 */
const calibration = new Map();

async function loadCalibration(path) {
  try {
    const table = await read(path, BUNDLED.calibration);
    for (const [levelId, drags] of Object.entries(table)) calibration.set(levelId, drags);
  } catch {
    // A missing or unreadable calibration does not stop play: we keep the
    // thresholds shipped with the database.
  }
}

/**
 * Applies the calibration to a level, in place.
 *
 * It only touches the grading scale. The move limit stays the one from the
 * database: that is the net deciding a defeat, hence the failure rate and
 * everything that depends on it — the defeat screen, the offers. Moving it
 * based on measurements is a game decision, not a calibration, and it is not
 * taken here. Tightening the reference alone is harmless on that side: the
 * thresholds go down, the net does not move and therefore stays above them.
 */
function applyCalibration(level) {
  const ref = calibration.get(level.levelId);
  // A value that makes no sense — zero, negative, or beyond the move limit —
  // says nothing about the level: we keep what the database shipped.
  if (!Number.isInteger(ref) || ref < 1 || ref > level.moveLimit) return level;
  level.minDrags = ref;
  level.starDrags = starThresholds(ref);
  return level;
}

const requireOpen = () => {
  if (!index) throw new Error('Level database not open: call open() at startup');
  return index;
};

// --- Catalogue, read synchronously -----------------------------------------

export const catalog = () => requireOpen();
export const totalLevels = () => requireOpen().totalLevels;
export const levelsPerRealm = () => requireOpen().levelsPerRealm;
export const realms = () => requireOpen().realms;

/** The realm level `n` belongs to (1-indexed). */
export function realmOf(n) {
  const cat = requireOpen();
  const i = Math.floor((n - 1) / cat.levelsPerRealm);
  return cat.realms[Math.min(cat.realms.length - 1, Math.max(0, i))];
}

// --- Levels ----------------------------------------------------------------

async function loadRealm(id) {
  if (realmLevels.has(id)) return realmLevels.get(id);
  const realm = requireOpen().realms.find((r) => r.id === id);
  if (!realm) throw new Error(`Realm ${id} missing from the catalogue`);
  const file = realm.file ?? realm.fichier;
  const data = await read(file, BUNDLED.realms[file]);
  const levels = (data.levels || []).map(normalizeLevel);
  realmLevels.set(id, levels);
  for (const level of levels) byNumber.set(level.number, level);
  return levels;
}

/**
 * Level `n`, read from the database.
 *
 * The returned object is a COPY: the board consumes gate capacity during play,
 * and returning the original would mean a replayed level started with the gates
 * already eaten into by the previous attempt.
 */
export async function getLevel(n) {
  const cat = requireOpen();
  if (!Number.isInteger(n) || n < 1 || n > cat.totalLevels) throw new Error(`Level ${n} not found`);
  if (!byNumber.has(n)) await loadRealm(realmOf(n).id);
  const level = byNumber.get(n);
  if (!level) throw new Error(`Level ${n} missing from the database`);
  return applyCalibration(structuredClone(normalizeLevel(level)));
}

/** Preloads a whole realm — to smooth out entering a new setting. */
export const preloadRealm = (id) => loadRealm(id).then(() => undefined, () => undefined);

/**
 * Objective label, for the briefing screen and the HUD. It lives here rather
 * than in the generator: it only reads a level object, and the application no
 * longer has any reason to load the generator for one sentence.
 */
export function objectiveLabel(level) {
  return t('brief.objective', { n: level.objective.target });
}
