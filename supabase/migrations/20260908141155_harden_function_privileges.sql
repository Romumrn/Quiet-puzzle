-- Postgres accorde EXECUTE à PUBLIC par défaut à la création d'une fonction.
-- Je n'avais explicitement GRANT qu'à `authenticated` sur les RPC de jeu,
-- mais sans REVOKE du grant implicite à PUBLIC, le rôle `anon` en héritait
-- quand même (confirmé par l'advisor sécurité). Ces RPC restent inoffensives
-- pour un appelant anonyme (elles rejettent tout de suite faute de auth.uid()),
-- mais ce n'est pas une raison pour laisser la porte ouverte : on ferme au
-- niveau du GRANT, pas seulement dans la logique métier.
--
-- NOTE (voir la migration suivante, _v2) : ce projet Supabase a en réalité
-- des privilèges par défaut qui accordent EXECUTE directement à anon/authenticated
-- sur toute nouvelle fonction (pas seulement via PUBLIC). Ce REVOKE FROM public
-- s'est donc révélé insuffisant à lui seul — la correction effective est dans
-- 20260908141408_harden_function_privileges_v2.sql. Conservé ici pour
-- fidélité avec l'historique réellement appliqué sur le projet.

revoke execute on function public.is_admin(uuid) from public;
revoke execute on function public.is_moderator(uuid) from public;
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.protect_community_level_edits() from public;
revoke execute on function public.sync_community_level_like_count() from public;
revoke execute on function public.set_updated_at() from public;
revoke execute on function public.complete_level(bigint, smallint, integer, boolean, text) from public;
revoke execute on function public.spend_coins(integer, public.coin_reason, jsonb, text) from public;
revoke execute on function public.grant_ad_reward(text) from public;
revoke execute on function public.claim_daily_bonus() from public;
revoke execute on function public.submit_daily_score(date, smallint, smallint, integer) from public;
revoke execute on function public.select_daily_puzzle(date, smallint, bigint, uuid) from public;

grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_moderator(uuid) to anon, authenticated;
grant execute on function public.complete_level(bigint, smallint, integer, boolean, text) to authenticated;
grant execute on function public.spend_coins(integer, public.coin_reason, jsonb, text) to authenticated;
grant execute on function public.grant_ad_reward(text) to authenticated;
grant execute on function public.claim_daily_bonus() to authenticated;
grant execute on function public.submit_daily_score(date, smallint, smallint, integer) to authenticated;
grant execute on function public.select_daily_puzzle(date, smallint, bigint, uuid) to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
