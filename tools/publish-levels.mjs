/**
 * Publishes the level database to Supabase — `node tools/publish-levels.mjs`
 *
 * One step instead of three. It replaces the chain that used to go
 * `build-levels.mjs` -> `supabase-import-levels.mjs` (or `gen-import-batches`)
 * -> 108 .sql files on disk -> `import-levels-direct.mjs`: the SQL is built in
 * memory, batched, and sent.
 *
 * Source of truth is `prototype/levels/`, not the generator: we publish exactly
 * what was generated, tested and balanced, never what the generator would
 * produce if it ran again right now.
 *
 * Usage:
 *   node tools/publish-levels.mjs --dry-run            # print, send nothing
 *   SUPABASE_TOKEN=sbp_xxx node tools/publish-levels.mjs
 *   SUPABASE_TOKEN=sbp_xxx node tools/publish-levels.mjs --realm 30
 *
 * The token is a personal access token from
 * https://supabase.com/dashboard/account/tokens. It goes through the Management
 * API, which bypasses RLS — that is the point, since `levels` is admin-write
 * only. Never commit it; `.env` is git-ignored.
 *
 * Idempotent: every statement is an upsert keyed on `level_code` (or
 * `(mode_id, position)` for realms), so an interrupted run is simply rerun.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS_DIR = join(ROOT, 'prototype', 'levels');
const PROJECT = 'vwriqaufkrihmxrvykec';
const TOKEN = process.env.SUPABASE_TOKEN;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const onlyRealm = args.includes('--realm')
  ? Number(args[args.indexOf('--realm') + 1])
  : null;

/**
 * The Management API refuses payloads past roughly 24 kB — the whole reason
 * `split-realm-sql.mjs` existed, which cut by a fixed count of five rows.
 *
 * By COUNT is the wrong unit: a level of the first realm is under 2 kB, one of
 * the last is past 8 kB, so five rows is 11 kB at one end of the game and 40 kB
 * at the other. We fill up to a byte budget instead, and a single row that
 * exceeds it still goes out alone rather than being silently dropped.
 */
const BATCH_BYTES = 20000;

// --- SQL literals -----------------------------------------------------------

const sqlString = (v) => `'${String(v).replace(/'/g, "''")}'`;
const sqlJsonb = (v) => `${sqlString(JSON.stringify(v))}::jsonb`;
const sqlTextArray = (v) => `ARRAY[${v.map(sqlString).join(', ')}]::text[]`;
const sqlSmallintArray = (v) => `ARRAY[${v.map(Number).join(', ')}]::smallint[]`;
const sqlNumber = (v) => (v == null ? 'null' : Number(v));

const modeSubquery = `(select id from public.game_modes where code = 'classic')`;
const groupSubquery = (position) =>
  `(select id from public.level_groups where mode_id = ${modeSubquery} and position = ${position})`;

const backgroundPath = (realmId) =>
  `realm-backgrounds/branche-${String(realmId + 1).padStart(2, '0')}.webp`;

/**
 * The catalogue ships all five languages, but a realm may have been written
 * with a plain string. Both must end up as the jsonb object the
 * `level_catalog` view hands back to the client.
 */
const i18n = (value) => (value && typeof value === 'object' ? value : { en: String(value ?? '') });

// --- Statements -------------------------------------------------------------

function realmsStatement(realms) {
  const rows = realms.map((realm) => `  (${[
    modeSubquery,
    realm.id,
    sqlJsonb(i18n(realm.name ?? realm.nom)),
    sqlJsonb(i18n(realm.difficulty ?? realm.difficulte)),
    // `introduces` has no equivalent in the old import scripts: the column was
    // only added with the catalogue view, and the sentence lived in index.json.
    sqlJsonb(i18n(realm.introduces ?? realm.apporte)),
    sqlNumber(realm.hue ?? realm.teinte),
    sqlTextArray(realm.palette ?? []),
    sqlString(backgroundPath(realm.id)),
  ].join(', ')})`);

  return `insert into public.level_groups
  (mode_id, position, name, difficulty_label, introduces, hue, palette, background_path)
values
${rows.join(',\n')}
on conflict (mode_id, position) do update set
  name = excluded.name,
  difficulty_label = excluded.difficulty_label,
  introduces = excluded.introduces,
  hue = excluded.hue,
  palette = excluded.palette,
  background_path = excluded.background_path;`;
}

const levelRow = (realmId) => (lv) => `  (${[
    sqlString(lv.levelId),
    modeSubquery,
    groupSubquery(realmId),
    lv.number,
    lv.width,
    lv.height,
    lv.colorCount,
    lv.moveLimit,
    lv.timeLimit,
    lv.minDrags,
    sqlSmallintArray(lv.starDrags),
    sqlJsonb(lv.objective),
    // Only these three travel in `grid`; every other field has its own column,
    // which is what lets the catalogue view count and order without opening the
    // jsonb.
    sqlJsonb({ gates: lv.gates, blocks: lv.blocks, solution: lv.solution }),
    `'published'`,
  ].join(', ')})`;

function levelsStatement(rows) {
  return `insert into public.levels (
  level_code, mode_id, level_group_id, sequence_number,
  width, height, color_count, move_limit, time_limit, min_drags,
  star_thresholds, objective, grid, status
)
values
${rows.join(',\n')}
on conflict (level_code) do update set
  level_group_id = excluded.level_group_id,
  sequence_number = excluded.sequence_number,
  width = excluded.width,
  height = excluded.height,
  color_count = excluded.color_count,
  move_limit = excluded.move_limit,
  time_limit = excluded.time_limit,
  min_drags = excluded.min_drags,
  star_thresholds = excluded.star_thresholds,
  objective = excluded.objective,
  grid = excluded.grid,
  status = excluded.status,
  -- Bumping the version is what tells a client its cached copy is stale, and
  -- what user_progress.level_content_version is compared against.
  content_version = public.levels.content_version + 1,
  published_at = coalesce(public.levels.published_at, now());`;
}

// --- Transport --------------------------------------------------------------

function sqlRequest(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT}/database/query`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(data));
        else reject(new Error(`HTTP ${res.statusCode} : ${data.slice(0, 300)}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

let sent = 0;
let failed = 0;

async function send(label, sql) {
  if (DRY_RUN) {
    const kb = (Buffer.byteLength(sql) / 1024).toFixed(1);
    console.log(`\n-- ${label} (${kb} kB)\n${sql}`);
    return;
  }
  process.stdout.write(`  ${label} … `);
  try {
    await sqlRequest(sql);
    console.log('ok');
    sent++;
  } catch (e) {
    console.log(`FAILED — ${e.message.slice(0, 160)}`);
    failed++;
  }
}

// --- Run --------------------------------------------------------------------

if (!TOKEN && !DRY_RUN) {
  console.error('SUPABASE_TOKEN missing. Either:');
  console.error('  SUPABASE_TOKEN=sbp_xxx node tools/publish-levels.mjs');
  console.error('  node tools/publish-levels.mjs --dry-run');
  process.exit(1);
}

const readJson = (name) => JSON.parse(readFileSync(join(LEVELS_DIR, name), 'utf8'));
const index = readJson('index.json');

const realms = onlyRealm === null
  ? index.realms
  : index.realms.filter((r) => r.id === onlyRealm);

if (!realms.length) {
  console.error(`No realm ${onlyRealm} in the catalogue.`);
  process.exit(1);
}

console.log(`Publishing ${realms.length} realm(s) to ${PROJECT}${DRY_RUN ? ' — DRY RUN' : ''}\n`);

// Realms first: a level's `level_group_id` is resolved by subquery, so the row
// it points at has to exist.
await send('level_groups', realmsStatement(realms));

for (const realm of realms) {
  const data = readJson(realm.file ?? realm.fichier);
  const levels = data.levels || [];
  const toRow = levelRow(realm.id);

  let batch = [];
  let bytes = 0;

  const flush = async () => {
    if (!batch.length) return;
    const label = `realm ${realm.id} · levels ${batch[0].n}–${batch[batch.length - 1].n}`;
    await send(label, levelsStatement(batch.map((b) => b.sql)));
    batch = [];
    bytes = 0;
  };

  for (const lv of levels) {
    const sql = toRow(lv);
    const size = Buffer.byteLength(sql);
    if (bytes + size > BATCH_BYTES) await flush();
    batch.push({ n: lv.number, sql });
    bytes += size;
  }
  await flush();
}

if (!DRY_RUN) {
  console.log(`\nDone: ${sent} statement(s) applied, ${failed} failed.`);
  process.exit(failed ? 1 : 0);
}
