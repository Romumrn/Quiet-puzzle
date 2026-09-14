/**
 * Level database — the source of truth for what the application plays.
 *
 * The application NO LONGER GENERATES its levels: it reads them.
 * The generator lives outside the application entirely, in `generator/` at the
 * repository root — `tools/build-levels.mjs` calls it, offline, to fill
 * `levels/`. No module served to the browser imports it.
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
 *
 * WHERE those two reads go is not decided here — `levelSource.js` tries the
 * local cache, then Supabase, then the seed on disk. This file only cares about
 * the SHAPE of what comes back, and about keeping the catalogue readable
 * synchronously once `open()` has resolved: `totalLevels()`, `realms()` and
 * `realmOf()` are called from render paths that cannot await.
 */

/**
 * Bundled database. `tools/bundle.mjs` fills this object when building the
 * single-file version, and `tools/base.mjs` fills it so the node tools measure
 * the JSON in the repository rather than whatever the database currently holds.
 * It wins over every other source, so a tool never reaches the network.
 */
import { t } from '../ui/i18n.js';
import { starThresholds } from '../core/stars.js';
import { loadCatalog, loadRealmLevels } from './levelSource.js';

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

/**
 * Renames the legacy French keys, and NOTHING else.
 *
 * It used to also collapse each `{ fr, en, … }` table to its English string,
 * which silently undid the reason those tables exist: `i18n.realmText()` reads
 * them to show a realm in the player's language, and by the time it got one
 * there was only English left — a French interface announced "learning the
 * ropes". The database stores these labels as jsonb in every language, so
 * flattening them here would throw away exactly what we came to fetch.
 *
 * `realmText` accepts both a table and a bare string, so a seed index whose
 * `name` is already a plain string still works.
 */
function normalizeRealm(raw) {
  const realm = { ...raw };
  if (!realm.name && raw.nom) realm.name = raw.nom;
  if (!realm.difficulty && raw.difficulte) realm.difficulty = raw.difficulte;
  if (!realm.introduces && raw.apporte) realm.introduces = raw.apporte;
  if (realm.hue == null && raw.teinte != null) realm.hue = raw.teinte;
  if (!realm.file && raw.fichier) realm.file = raw.fichier;
  return realm;
}

function normalizeStep(step) {
  if (!step || typeof step !== 'object') return step;
  const path = Array.isArray(step.path) ? step.path : Array.isArray(step.chemin) ? step.chemin : [];
  return {
    ...step,
    path: path.filter((pos) => pos && typeof pos.x === 'number' && typeof pos.y === 'number'),
  };
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
  if (Array.isArray(level.solution)) {
    normalized.solution = level.solution.map(normalizeStep);
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
  const rawIndex = BUNDLED.index ?? await loadCatalog();
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

/**
 * The realm level `n` belongs to (1-indexed).
 *
 * The catalogue carries each realm's real range, so we read it rather than
 * dividing: a realm is free to hold a different number of levels from its
 * neighbours, and dividing by `levelsPerRealm` would silently send the player to
 * the wrong palette the day one does. The division stays as the fallback, for a
 * seed index whose realms predate `first`/`last`.
 */
export function realmOf(n) {
  const cat = requireOpen();
  const found = cat.realms.find((r) => n >= r.first && n <= r.last);
  if (found) return found;
  const i = Math.floor((n - 1) / cat.levelsPerRealm);
  return cat.realms[Math.min(cat.realms.length - 1, Math.max(0, i))];
}

// --- Levels ----------------------------------------------------------------

async function loadRealm(id) {
  if (realmLevels.has(id)) return realmLevels.get(id);
  const realm = requireOpen().realms.find((r) => r.id === id);
  if (!realm) throw new Error(`Realm ${id} missing from the catalogue`);
  const file = realm.file ?? realm.fichier;
  const bundled = file ? BUNDLED.realms[file] : null;
  const raw = bundled ? (bundled.levels || []) : await loadRealmLevels(realm);
  const levels = raw.map(normalizeLevel);
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
