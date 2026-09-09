// Génère des fichiers SQL par lot de BATCH_SIZE niveaux,
// pour chaque monde (realm) de startRealm à endRealm inclus.
// Output : supabase/seed/batches/realm-NN-batch-M.sql
// Usage : node tools/gen-import-batches.mjs [startRealm=3] [endRealm=29] [batchSize=5]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS_DIR = join(ROOT, 'prototype', 'levels');
const OUT_DIR = join(ROOT, 'supabase', 'seed', 'batches');

function sqlString(v) { return `'${String(v).replace(/'/g, "''")}'`; }
function sqlJsonb(v) { return `${sqlString(JSON.stringify(v))}::jsonb`; }
function sqlSmallintArray(a) { return `ARRAY[${a.map(Number).join(', ')}]::smallint[]`; }
function modeQ() { return `(select id from public.game_modes where code = 'classic')`; }
function groupQ(pos) {
  return `(select id from public.level_groups where mode_id = ${modeQ()} and position = ${pos})`;
}

function levelRow(lv, realm) {
  const grid = { gates: lv.gates, blocks: lv.blocks, solution: lv.solution };
  return `  (${[
    sqlString(lv.levelId), modeQ(), groupQ(realm), lv.number,
    lv.width, lv.height, lv.colorCount, lv.moveLimit, lv.timeLimit, lv.minDrags,
    sqlSmallintArray(lv.starDrags), sqlJsonb(lv.objective), sqlJsonb(grid), `'published'`,
  ].join(', ')})`;
}

function batchSql(rows) {
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
  width = excluded.width, height = excluded.height,
  color_count = excluded.color_count, move_limit = excluded.move_limit,
  time_limit = excluded.time_limit, min_drags = excluded.min_drags,
  star_thresholds = excluded.star_thresholds,
  objective = excluded.objective, grid = excluded.grid,
  status = excluded.status,
  content_version = public.levels.content_version + 1,
  published_at = coalesce(public.levels.published_at, now());
`;
}

const startRealm = parseInt(process.argv[2] ?? '3', 10);
const endRealm   = parseInt(process.argv[3] ?? '29', 10);
const batchSize  = parseInt(process.argv[4] ?? '5', 10);

mkdirSync(OUT_DIR, { recursive: true });

const index = JSON.parse(readFileSync(join(LEVELS_DIR, 'index.json'), 'utf8'));
let totalFiles = 0;

for (const realmMeta of index.realms) {
  if (realmMeta.id < startRealm || realmMeta.id > endRealm) continue;

  const data = JSON.parse(readFileSync(join(LEVELS_DIR, realmMeta.fichier), 'utf8'));
  const rows = data.levels.map(lv => levelRow(lv, realmMeta.id));

  let batchNum = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const outName = `realm-${String(realmMeta.id).padStart(2, '0')}-batch-${batchNum}.sql`;
    writeFileSync(join(OUT_DIR, outName), batchSql(batch));
    batchNum++;
    totalFiles++;
  }
  console.log(`Monde ${realmMeta.id} (${realmMeta.name ?? realmMeta.nom}) — ${batchNum} lots`);
}

console.log(`\nTerminé : ${totalFiles} fichiers dans ${OUT_DIR}`);
