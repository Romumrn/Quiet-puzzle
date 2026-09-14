/**
 * Where levels come from — the seam under `levelStore.js`.
 *
 * The database is the source of truth; the disk is a fallback. Three places are
 * tried, in this order, both for the catalogue and for each realm:
 *
 *  1. the LOCAL CACHE (IndexedDB), so a second launch costs no network at all;
 *  2. SUPABASE, which is authoritative — publishing a realm reaches players
 *     without shipping an application update;
 *  3. the SEED on disk (`levels/`), so a first launch with no network still has
 *     something to play.
 *
 * Only the first realm ships in the packaged application: thirty realms of JSON
 * weigh 3.8 MB, and the point of reading from the database is not to carry them
 * anyway. The other files stay in the repository — the node tools measure the
 * shipped data, and they read them straight off disk through `BUNDLED`.
 *
 * Nothing here throws for a network failure alone: each step falls through to
 * the next, and only the last one is allowed to give up.
 */

const MODE = 'classic';

// --- Local cache ------------------------------------------------------------

/**
 * IndexedDB and not `localStorage`: thirty realms at ~130 kB each come to about
 * 3.9 MB, past the ~5 MB `localStorage` quota once the save file is counted —
 * and the failure mode there is an exception mid-write, with half a realm
 * stored.
 */
const DB_NAME = 'quietpuzzle.levels';
const STORE = 'cache';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      // Private browsing, a browser configured to block site data, a worker
      // without IndexedDB: the cache is an optimisation, never a requirement.
      resolve(null);
    }
  });
  return dbPromise;
}

function transact(mode, run) {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  }).catch(() => null);
}

const cacheGet = (key) => transact('readonly', (store) => store.get(key));
const cachePut = (key, value) => transact('readwrite', (store) => store.put(value, key));

/**
 * A cached entry is only usable if it carries the stamp we expect.
 *
 * The stamp is `max(levels.updated_at)` for the realm, computed by the
 * `level_catalog` view: republishing a single level moves it, and the client
 * throws away exactly the realm that changed rather than the whole cache.
 */
const fresh = (entry, stamp) => entry && entry.stamp != null && entry.stamp === stamp;

/** Forgets everything cached — the admin panel's "reload the levels" button. */
export const clearCache = () => transact('readwrite', (store) => store.clear());

// --- Supabase ---------------------------------------------------------------

/**
 * Imported dynamically, like `api.js` does for `complete_level`: the client
 * comes from a CDN, and a launch served entirely by the cache should not pay
 * for it.
 */
async function client() {
  const { supabase } = await import('./supabaseClient.js');
  return supabase;
}

/** A catalogue row -> the realm shape the application has always read. */
const realmFromRow = (row) => ({
  id: row.position,
  groupId: row.id,
  name: row.name,
  difficulty: row.difficulty_label,
  introduces: row.introduces,
  hue: row.hue,
  palette: row.palette,
  background: row.background_path,
  first: row.first_number,
  last: row.last_number,
  stamp: row.content_stamp,
});

/**
 * A level row -> the flat level object.
 *
 * Everything but `gates`, `blocks` and `solution` lives in its own column; those
 * three travel together in `grid`. What comes out still goes through
 * `normalizeLevel` in the store: the `grid` column was imported verbatim from
 * the JSON files, so it carries the French spellings (`chemin`, `mur`, `ancre`)
 * that normalisation exists to absorb.
 */
const levelFromRow = (row) => ({
  levelId: row.level_code,
  number: row.sequence_number,
  width: row.width,
  height: row.height,
  colorCount: row.color_count,
  moveLimit: row.move_limit,
  timeLimit: row.time_limit,
  minDrags: row.min_drags,
  objective: row.objective,
  starDrags: row.star_thresholds,
  estimatedTime: row.time_limit,
  ...(row.grid || {}),
});

async function catalogFromDb() {
  const supabase = await client();
  const { data, error } = await supabase
    .from('level_catalog')
    .select('*')
    .eq('mode_code', MODE)
    .order('position');
  if (error) throw error;

  // A realm with no published level is a realm being written: it must not
  // appear on the map, and above all must not shift `totalLevels`.
  const realms = (data || []).filter((row) => row.level_count > 0).map(realmFromRow);
  if (!realms.length) throw new Error('Level catalogue: no published realm');

  return {
    version: 1,
    source: 'supabase',
    // Read off the catalogue instead of being a constant of the generator: a
    // realm is free to hold a different number of levels, and the application
    // finds out by asking rather than by being rebuilt.
    levelsPerRealm: realms[0].last - realms[0].first + 1,
    totalLevels: Math.max(...realms.map((r) => r.last)),
    realms,
  };
}

async function realmFromDb(realm) {
  const supabase = await client();
  const { data, error } = await supabase
    .from('levels')
    .select('level_code,sequence_number,width,height,color_count,move_limit,'
      + 'time_limit,min_drags,star_thresholds,objective,grid')
    .eq('level_group_id', realm.groupId)
    .eq('status', 'published')
    .order('sequence_number');
  if (error) throw error;
  if (!data || !data.length) throw new Error(`Realm ${realm.id}: no published level`);
  return data.map(levelFromRow);
}

// --- Seed on disk -----------------------------------------------------------

async function fromDisk(path) {
  const response = await fetch(`levels/${path}`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Level database: cannot read ${path} (${response.status})`);
  return response.json();
}

// --- What the store calls ---------------------------------------------------

/**
 * The catalogue.
 *
 * The cached copy is served straight away when there is one, and it is not
 * revalidated: the stamp that would say whether it is stale lives in the
 * catalogue itself, so checking would mean fetching it anyway. A realm
 * published while the application is open is picked up on the next launch —
 * which is what `clearCache()` is for in the admin panel.
 */
export async function loadCatalog() {
  const cached = await cacheGet('catalog');
  if (cached && cached.index) return cached.index;

  try {
    const index = await catalogFromDb();
    await cachePut('catalog', { index });
    return index;
  } catch {
    // No network on a first launch. The seed carries the first realm, which is
    // enough to start playing; the rest of the map will fill in once the
    // database answers.
    const index = await fromDisk('index.json');
    return { ...index, source: 'seed' };
  }
}

/**
 * One realm's levels.
 *
 * `realm` is a catalogue entry: it carries `groupId` when it came from the
 * database, `file` when it came from the seed, and possibly both.
 */
export async function loadRealmLevels(realm) {
  const key = `realm:${MODE}:${realm.id}`;

  const cached = await cacheGet(key);
  if (fresh(cached, realm.stamp)) return cached.levels;

  if (realm.groupId != null) {
    try {
      const levels = await realmFromDb(realm);
      await cachePut(key, { stamp: realm.stamp, levels });
      return levels;
    } catch {
      // Fall through to the seed: a realm that ships on disk stays playable
      // with no network, and a stale cached copy beats no level at all.
    }
  }

  if (cached && cached.levels) return cached.levels;

  const file = realm.file ?? realm.fichier;
  if (!file) throw new Error(`Realm ${realm.id} unreachable: no network and not bundled`);
  const data = await fromDisk(file);
  return data.levels || [];
}
