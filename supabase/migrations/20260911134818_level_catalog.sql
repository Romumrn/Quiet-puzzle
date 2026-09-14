-- Level catalogue — what the application needs BEFORE it opens a level.
--
-- Until now the game read `levels/index.json` from disk: realm names, hues,
-- palettes, and the number of levels per realm all travelled in that file. The
-- database held the levels themselves but nothing that describes a realm to a
-- player, so switching the client over meant one round trip per realm just to
-- count rows. This migration closes that gap.
--
-- Paste into the SQL editor, like the other migrations in this folder.

-- ---------------------------------------------------------------------------
-- 1. The one field the catalogue was missing
-- ---------------------------------------------------------------------------

-- `introduces` is the i18n sentence that tells the player what a realm teaches
-- ("Blocks on rails, gates with a capacity"). `level_groups` carries `name` and
-- `difficulty_label` but never had a column for it — it only existed in
-- index.json.
alter table public.level_groups
  add column if not exists introduces jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. Let a signed-out player read the published content
-- ---------------------------------------------------------------------------

-- The content policies read `status = 'published' or (select is_admin())`, and
-- `is_admin(uuid)` is granted to `authenticated` only. Postgres evaluates that
-- sub-select as an InitPlan before filtering any row, so an ANONYMOUS reader
-- does not get `false` — the whole query dies with
-- `permission denied for function is_admin`.
--
-- Nobody noticed because the client never read these tables: levels came from
-- disk. The moment it asks Supabase for them it hits this, and the game has a
-- deliberate signed-out route (the login screen offers to play offline), so
-- `anon` is a supported state, not an edge case.
--
-- The fix splits each policy in two. Permissive policies are OR'd, and the
-- admin half is restricted `to authenticated`, so an anonymous reader never
-- evaluates the function at all. Granting `is_admin` to `anon` instead would
-- have worked too, but that function takes a uuid: it would let anyone test
-- whether a given account is an admin.

drop policy if exists levels_select on public.levels;
create policy levels_select_published on public.levels for select to anon, authenticated
  using (status = 'published');
create policy levels_select_admin on public.levels for select to authenticated
  using ((select public.is_admin()));

drop policy if exists game_modes_select on public.game_modes;
create policy game_modes_select_active on public.game_modes for select to anon, authenticated
  using (is_active);
create policy game_modes_select_admin on public.game_modes for select to authenticated
  using ((select public.is_admin()));

drop policy if exists themes_select on public.themes;
create policy themes_select_active on public.themes for select to anon, authenticated
  using (is_active);
create policy themes_select_admin on public.themes for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 3. The catalogue itself
-- ---------------------------------------------------------------------------

-- One row per realm, everything the map screen and the theme engine read, in a
-- single request.
--
-- `security_invoker = true` so the view is filtered by the RLS of the tables it
-- reads, not by the owner's rights: the `levels` policy is
-- `status = 'published' or is_admin()`, so an anonymous player counts published
-- levels only, while an admin sees drafts in the same view. A security definer
-- view here would have leaked the existence of unpublished levels through the
-- counts.
create or replace view public.level_catalog
with (security_invoker = true) as
select
  g.id,
  g.mode_id,
  m.code                 as mode_code,
  g.position,
  g.name,
  g.difficulty_label,
  g.introduces,
  g.hue,
  g.palette,
  g.background_path,
  count(l.id)            as level_count,
  min(l.sequence_number) as first_number,
  max(l.sequence_number) as last_number,
  -- Cache stamp: the client keeps a realm in IndexedDB and throws it away as
  -- soon as this moves. `levels.updated_at` is maintained by the
  -- `set_updated_at` trigger, so republishing a single level invalidates
  -- exactly the realm it belongs to.
  max(l.updated_at)      as content_stamp
from public.level_groups g
join public.game_modes m on m.id = g.mode_id
left join public.levels l on l.level_group_id = g.id
group by g.id, m.code;

grant select on public.level_catalog to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reading a realm's levels
-- ---------------------------------------------------------------------------

-- The client fetches one realm at a time, ordered, filtered on published. The
-- existing `idx_levels_published` is on (mode_id, sequence_number) — it serves
-- the daily-puzzle picker, not this access path, which starts from the group.
create index if not exists idx_levels_group_published
  on public.levels (level_group_id, sequence_number)
  where status = 'published';
