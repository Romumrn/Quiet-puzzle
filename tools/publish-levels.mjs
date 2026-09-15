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
 *   SUPABASE_TOKEN=sbp_xxx node tools/publish-levels.mjs --from 18   # resume
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
/**
 * How much SQL goes in one statement.
 *
 * This used to be 20 kB, inherited from a comment in the old `split-realm-sql`
 * about "the ~24 kB payload limit" — which was the limit of the MCP
 * `execute_sql` TOOL, not of this endpoint. Nobody had ever checked. At that
 * size a thousand levels needs some four hundred round trips, which is what ran
 * the Management API's throttle into the ground.
 *
 * So it now starts big and ADAPTS: a batch refused for its size is split in two
 * and each half retried, down to a single level. The real limit never has to be
 * known — which is the point, since it is not ours to know and can change.
 */
const START_BYTES = Number(args.includes('--batch') ? args[args.indexOf('--batch') + 1] : 0) * 1024
  || 400000;

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

/**
 * The Management API THROTTLES, and a thousand levels is some four hundred
 * statements — the payload cap is what forces them to be small and many.
 *
 * Fired back to back the run dies around the three hundred and sixtieth with
 * `429 ThrottlerException`, and every statement after it fails too: nothing
 * backs off, so the burst never subsides. Hence both halves below — a pause
 * between statements to stay under the limit, and a retry that waits when the
 * limit is hit anyway.
 */
const PACE_MS = 350;
const MAX_RETRIES = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function once(query) {
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
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(JSON.parse(data));
        const err = new Error(`HTTP ${res.statusCode} : ${data.slice(0, 200)}`);
        err.status = res.statusCode;
        err.retryAfter = Number(res.headers['retry-after']) || 0;
        reject(err);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sqlRequest(query) {
  let wait = 2000;
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await once(query);
      await sleep(PACE_MS);
      return out;
    } catch (e) {
      // Only throttling and transient server errors are worth retrying. A
      // malformed statement will be just as malformed in ten seconds.
      const worth = e.status === 429 || (e.status >= 500 && e.status < 600);
      if (!worth || attempt >= MAX_RETRIES) throw e;
      const pause = e.retryAfter ? e.retryAfter * 1000 : wait;
      process.stdout.write(`(throttled, ${Math.round(pause / 1000)}s) `);
      await sleep(pause);
      wait = Math.min(wait * 2, 60000);
    }
  }
}

let sent = 0;
let failed = 0;

async function send(label, sql, splittable = false) {
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
    // A refusal on SIZE is not a failure, it is an instruction to send less —
    // the caller splits and tries again. Anything else is a real failure.
    const tooBig = e.status === 413 || /too large|payload|body size/i.test(e.message);
    if (splittable && tooBig) { console.log('trop gros'); throw e; }
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

/**
 * `--from <id>` skips the realms already in. The import is idempotent, so
 * replaying them is harmless — it is simply hundreds of statements and several
 * minutes spent rewriting rows that are already correct, and on an API that
 * throttles those minutes are the scarce thing.
 */
const fromRealm = args.includes('--from') ? Number(args[args.indexOf('--from') + 1]) : null;

const realms = onlyRealm !== null
  ? index.realms.filter((r) => r.id === onlyRealm)
  : fromRealm !== null
    ? index.realms.filter((r) => r.id >= fromRealm)
    : index.realms;

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

  /**
   * Send a run of levels, halving it if the endpoint says it is too big.
   *
   * Recursive rather than a guessed constant: we do not know this API's payload
   * limit and have no business hard-coding it. A refusal on size is information,
   * and splitting on it converges in a couple of steps.
   */
  const sendRun = async (run) => {
    if (!run.length) return;
    const label = `realm ${realm.id} · levels ${run[0].n}–${run[run.length - 1].n}`;
    try {
      await send(label, levelsStatement(run.map((b) => b.sql)), true);
    } catch (e) {
      if (run.length === 1) throw e;
      const half = Math.ceil(run.length / 2);
      console.log(`  ${label} … too large, splitting`);
      await sendRun(run.slice(0, half));
      await sendRun(run.slice(half));
    }
  };

  let run = [];
  let bytes = 0;
  for (const lv of levels) {
    const sql = toRow(lv);
    const size = Buffer.byteLength(sql);
    if (run.length && bytes + size > START_BYTES) { await sendRun(run); run = []; bytes = 0; }
    run.push({ n: lv.number, sql });
    bytes += size;
  }
  await sendRun(run);
}

if (!DRY_RUN) {
  console.log(`\nDone: ${sent} statement(s) applied, ${failed} failed.`);
  process.exit(failed ? 1 : 0);
}
