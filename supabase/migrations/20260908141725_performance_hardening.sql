-- 1) Index de couverture sur les clés étrangères repérées par l'advisor
--    (jointures/filtres fréquents : mode_id un peu partout, modération, ledger).
create index if not exists idx_community_level_likes_level on public.community_level_likes (community_level_id);
create index if not exists idx_community_levels_mode on public.community_levels (mode_id);
create index if not exists idx_community_levels_moderated_by on public.community_levels (moderated_by);
create index if not exists idx_daily_scores_user on public.daily_puzzle_scores (user_id);
create index if not exists idx_daily_puzzles_community_level on public.daily_puzzles (community_level_id);
create index if not exists idx_daily_puzzles_level on public.daily_puzzles (level_id);
create index if not exists idx_daily_puzzles_mode on public.daily_puzzles (mode_id);
create index if not exists idx_daily_puzzles_selected_by_admin on public.daily_puzzles (selected_by_admin);
create index if not exists idx_game_modes_default_theme on public.game_modes (default_theme_id);
create index if not exists idx_level_attempts_mode on public.level_attempts (mode_id);
create index if not exists idx_reward_events_coin_txn on public.reward_events (coin_transaction_id);
create index if not exists idx_reward_events_user on public.reward_events (user_id);
create index if not exists idx_user_mode_progress_mode on public.user_mode_progress (mode_id);
create index if not exists idx_user_progress_mode_fk on public.user_progress (mode_id);
create index if not exists idx_user_unlocked_themes_theme on public.user_unlocked_themes (theme_id);

-- 2) RLS : (select auth.uid()) / (select public.is_admin()) au lieu de
--    auth.uid() / is_admin() nu, pour que Postgres les évalue une fois par
--    requête (initPlan) plutôt qu'une fois par ligne — impact réel dès que
--    les tables grossissent.

drop policy profiles_select_own on public.profiles;
drop policy profiles_update_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy user_roles_select_admin on public.user_roles;
create policy user_roles_select_admin on public.user_roles
  for select to authenticated using ((select public.is_admin()));

-- themes / game_modes / level_groups / levels : fusion lecture publique +
-- admin en une seule policy SELECT (corrige aussi le doublon "multiple
-- permissive policies"), et policies d'écriture séparées par action.
drop policy themes_public_read on public.themes;
drop policy themes_admin_write on public.themes;
create policy themes_select on public.themes for select to anon, authenticated
  using (is_active or (select public.is_admin()));
create policy themes_insert on public.themes for insert to authenticated
  with check ((select public.is_admin()));
create policy themes_update on public.themes for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy themes_delete on public.themes for delete to authenticated
  using ((select public.is_admin()));

drop policy game_modes_public_read on public.game_modes;
drop policy game_modes_admin_write on public.game_modes;
create policy game_modes_select on public.game_modes for select to anon, authenticated
  using (is_active or (select public.is_admin()));
create policy game_modes_insert on public.game_modes for insert to authenticated
  with check ((select public.is_admin()));
create policy game_modes_update on public.game_modes for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy game_modes_delete on public.game_modes for delete to authenticated
  using ((select public.is_admin()));

drop policy level_groups_public_read on public.level_groups;
drop policy level_groups_admin_write on public.level_groups;
create policy level_groups_select on public.level_groups for select to anon, authenticated using (true);
create policy level_groups_insert on public.level_groups for insert to authenticated
  with check ((select public.is_admin()));
create policy level_groups_update on public.level_groups for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy level_groups_delete on public.level_groups for delete to authenticated
  using ((select public.is_admin()));

drop policy levels_public_read on public.levels;
drop policy levels_admin_write on public.levels;
create policy levels_select on public.levels for select to anon, authenticated
  using (status = 'published' or (select public.is_admin()));
create policy levels_insert on public.levels for insert to authenticated
  with check ((select public.is_admin()));
create policy levels_update on public.levels for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy levels_delete on public.levels for delete to authenticated
  using ((select public.is_admin()));

drop policy user_unlocked_themes_select_own on public.user_unlocked_themes;
create policy user_unlocked_themes_select_own on public.user_unlocked_themes
  for select to authenticated using (user_id = (select auth.uid()));

-- community_levels : fusion des deux policies UPDATE (créateur / modérateur)
-- en une seule (corrige aussi le doublon "multiple permissive policies") ;
-- le trigger protect_community_level_edits() reste le vrai garde-fou sur ce
-- qui peut être modifié, la policy ne fait que gater l'accès à la ligne.
drop policy community_levels_select on public.community_levels;
drop policy community_levels_insert_own on public.community_levels;
drop policy community_levels_update_own on public.community_levels;
drop policy community_levels_moderate on public.community_levels;
create policy community_levels_select on public.community_levels
  for select to anon, authenticated
  using (status = 'published' or creator_id = (select auth.uid()) or (select public.is_moderator()));
create policy community_levels_insert_own on public.community_levels
  for insert to authenticated
  with check (creator_id = (select auth.uid()) and status = 'draft');
create policy community_levels_update on public.community_levels
  for update to authenticated
  using ((select public.is_moderator()) or (creator_id = (select auth.uid()) and status in ('draft', 'submitted')))
  with check ((select public.is_moderator()) or (creator_id = (select auth.uid()) and status in ('draft', 'submitted')));

drop policy community_level_likes_insert_own on public.community_level_likes;
drop policy community_level_likes_delete_own on public.community_level_likes;
create policy community_level_likes_insert_own on public.community_level_likes
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy community_level_likes_delete_own on public.community_level_likes
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy user_progress_select_own on public.user_progress;
create policy user_progress_select_own on public.user_progress
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy user_mode_progress_select_own on public.user_mode_progress;
create policy user_mode_progress_select_own on public.user_mode_progress
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy level_attempts_select_own on public.level_attempts;
create policy level_attempts_select_own on public.level_attempts
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy coin_transactions_select_own on public.coin_transactions;
create policy coin_transactions_select_own on public.coin_transactions
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy reward_events_select_own on public.reward_events;
create policy reward_events_select_own on public.reward_events
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy notification_devices_owner on public.notification_devices;
create policy notification_devices_owner on public.notification_devices
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
