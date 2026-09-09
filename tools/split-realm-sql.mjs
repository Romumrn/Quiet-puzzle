// Découpe les SQL de realm en lots de N niveaux pour contourner
// les limites de taille des appels MCP execute_sql (~24 KB / lot).
// Usage : node tools/split-realm-sql.mjs <realm_id> [batch_size=5]
//   -> affiche les lots sur stdout, séparés par "--- BATCH ---"

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS_DIR = join(ROOT, 'prototype', 'levels');

function sqlString(v) { return `'${String(v).replace(/'/g, "''")}'`; }
function sqlJsonb(v) { return `${sqlString(JSON.stringify(v))}::jsonb`; }
function sqlSmallintArray(a) { return `ARRAY[${a.map(Number).join(', ')}]::smallint[]`; }
function modeQ() { return `(select id from public.game_modes where code = 'classic')`; }
function groupQ(pos) { return `(select id from public.level_groups where mode_id = ${modeQ()} and position = ${pos})`; }

function levelRow(lv, realm) {
  const grid = { gates: lv.gates, blocks: lv.blocks, solution: lv.solution };
  const cols = [
    sqlString(lv.levelId), modeQ(), groupQ(realm), lv.number,
    lv.width, lv.height, lv.colorCount, lv.moveLimit, lv.timeLimit, lv.minDrags,
    sqlSmallintArray(lv.starDrags), sqlJsonb(lv.objective), sqlJsonb(grid), `'published'`,
  ];
  return `  (${cols.join(', ')})`;
}

function batchSql(rows, realm) {
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
  published_at = coalesce(public.levels.published_at, now());`;
}

const realmId = parseInt(process.argv[2] ?? '3', 10);
const batchSize = parseInt(process.argv[3] ?? '5', 10);

const index = JSON.parse(readFileSync(join(LEVELS_DIR, 'index.json'), 'utf8'));
const realmMeta = index.realms.find(r => r.id === realmId);
if (!realmMeta) { console.error(`Realm ${realmId} introuvable`); process.exit(1); }

const data = JSON.parse(readFileSync(join(LEVELS_DIR, realmMeta.fichier), 'utf8'));
const rows = data.levels.map(lv => levelRow(lv, realmId));

for (let i = 0; i < rows.length; i += batchSize) {
  const batch = rows.slice(i, i + batchSize);
  if (i > 0) process.stdout.write('\n--- BATCH ---\n');
  process.stdout.write(batchSql(batch, realmId));
}
process.stdout.write('\n');
