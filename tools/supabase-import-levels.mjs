// Génère le SQL d'import des niveaux officiels (prototype/levels/) vers les
// tables Supabase `level_groups` et `levels`. Ne se connecte à rien : produit
// des fichiers .sql sous supabase/seed/levels/, à exécuter ensuite (SQL Editor
// Supabase, ou le MCP execute_sql). Idempotent (ON CONFLICT ... DO UPDATE),
// donc rejouable sans risque après une régénération des niveaux.
//
// Usage : node tools/supabase-import-levels.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS_DIR = join(ROOT, 'prototype', 'levels');
const OUT_DIR = join(ROOT, 'supabase', 'seed', 'levels');

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJsonb(value) {
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}

function sqlTextArray(values) {
  return `ARRAY[${values.map(sqlString).join(', ')}]::text[]`;
}

function sqlSmallintArray(values) {
  return `ARRAY[${values.map((n) => Number(n)).join(', ')}]::smallint[]`;
}

function modeSubquery() {
  return `(select id from public.game_modes where code = 'classic')`;
}

function levelGroupSubquery(position) {
  return `(select id from public.level_groups where mode_id = ${modeSubquery()} and position = ${position})`;
}

function branchImagePath(realmId) {
  const n = String(realmId + 1).padStart(2, '0');
  return `realm-backgrounds/branche-${n}.webp`;
}

function buildLevelGroupsSql(index) {
  const rows = index.realms.map((realm) => {
    const cols = [
      modeSubquery(),
      realm.id,
      sqlJsonb(realm.nom),
      sqlJsonb(realm.difficulte),
      realm.teinte ?? 'null',
      sqlTextArray(realm.palette ?? []),
      sqlString(branchImagePath(realm.id)),
    ];
    return `  (${cols.join(', ')})`;
  });

  return `-- Généré par tools/supabase-import-levels.mjs — ne pas éditer à la main.
insert into public.level_groups (mode_id, position, name, difficulty_label, hue, palette, background_path)
values
${rows.join(',\n')}
on conflict (mode_id, position) do update set
  name = excluded.name,
  difficulty_label = excluded.difficulty_label,
  hue = excluded.hue,
  palette = excluded.palette,
  background_path = excluded.background_path;
`;
}

function buildRealmLevelsSql(realmData) {
  const rows = realmData.levels.map((lv) => {
    const grid = { gates: lv.gates, blocks: lv.blocks, solution: lv.solution };
    const cols = [
      sqlString(lv.levelId),
      modeSubquery(),
      levelGroupSubquery(realmData.realm),
      lv.number,
      lv.width,
      lv.height,
      lv.colorCount,
      lv.moveLimit,
      lv.timeLimit,
      lv.minDrags,
      sqlSmallintArray(lv.starDrags),
      sqlJsonb(lv.objective),
      sqlJsonb(grid),
      `'published'`,
    ];
    return `  (${cols.join(', ')})`;
  });

  return `-- Généré par tools/supabase-import-levels.mjs — ne pas éditer à la main.
-- Monde ${realmData.realm} — ${realmData.name}
insert into public.levels (
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
  content_version = public.levels.content_version + 1,
  published_at = coalesce(public.levels.published_at, now());
`;
}

function main() {
  const index = JSON.parse(readFileSync(join(LEVELS_DIR, 'index.json'), 'utf8'));
  mkdirSync(OUT_DIR, { recursive: true });

  writeFileSync(join(OUT_DIR, '00_level_groups.sql'), buildLevelGroupsSql(index));
  console.log(`00_level_groups.sql — ${index.realms.length} mondes`);

  for (const realm of index.realms) {
    const data = JSON.parse(readFileSync(join(LEVELS_DIR, realm.fichier), 'utf8'));
    const sql = buildRealmLevelsSql(data);
    const outName = `realm-${String(realm.id).padStart(2, '0')}.sql`;
    writeFileSync(join(OUT_DIR, outName), sql);
    console.log(`${outName} — ${data.levels.length} niveaux (monde ${realm.id} : ${realm.name})`);
  }

  console.log(`\nTerminé. SQL généré dans ${OUT_DIR}`);
}

main();
