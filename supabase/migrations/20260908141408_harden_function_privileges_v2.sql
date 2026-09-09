-- Ce projet Supabase a des privilèges par défaut qui accordent EXECUTE
-- directement à anon/authenticated sur toute nouvelle fonction (confirmé via
-- pg_proc.proacl : {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,
-- service_role=X/postgres} même après un REVOKE ... FROM public). Il faut donc
-- révoquer explicitement de anon ET authenticated, pas seulement de public.

revoke execute on function public.is_admin(uuid) from anon, authenticated;
revoke execute on function public.is_moderator(uuid) from anon, authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.protect_community_level_edits() from anon, authenticated;
revoke execute on function public.sync_community_level_like_count() from anon, authenticated;
revoke execute on function public.set_updated_at() from anon, authenticated;
revoke execute on function public.complete_level(bigint, smallint, integer, boolean, text) from anon, authenticated;
revoke execute on function public.spend_coins(integer, public.coin_reason, jsonb, text) from anon, authenticated;
revoke execute on function public.grant_ad_reward(text) from anon, authenticated;
revoke execute on function public.claim_daily_bonus() from anon, authenticated;
revoke execute on function public.submit_daily_score(date, smallint, smallint, integer) from anon, authenticated;
revoke execute on function public.select_daily_puzzle(date, smallint, bigint, uuid) from anon, authenticated;

-- Re-grants ciblés : uniquement ce que chaque rôle utilise réellement.
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_moderator(uuid) to anon, authenticated;
grant execute on function public.complete_level(bigint, smallint, integer, boolean, text) to authenticated;
grant execute on function public.spend_coins(integer, public.coin_reason, jsonb, text) to authenticated;
grant execute on function public.grant_ad_reward(text) to authenticated;
grant execute on function public.claim_daily_bonus() to authenticated;
grant execute on function public.submit_daily_score(date, smallint, smallint, integer) to authenticated;
grant execute on function public.select_daily_puzzle(date, smallint, bigint, uuid) to authenticated;

-- handle_new_user / protect_community_level_edits / sync_community_level_like_count /
-- set_updated_at restent sans aucun grant à anon/authenticated : ce sont des
-- fonctions déclencheurs, invoquées uniquement par Postgres via les triggers
-- (qui ne passent pas par une vérification EXECUTE du rôle appelant), jamais
-- destinées à un appel RPC direct.
