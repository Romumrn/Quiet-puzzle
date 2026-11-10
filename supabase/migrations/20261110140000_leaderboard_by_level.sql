-- Classement : au choix par ÉTOILES (comme avant) ou par NIVEAU atteint
-- (demande du 2026-11-10 : « voir les gens par niveau »).
--
-- `p_by` = 'stars' (défaut) : étoiles, puis niveau ; 'level' : niveau le plus
-- loin, puis étoiles. Même sortie, mêmes noms (prénom Google seul, sinon le
-- pseudo), mêmes exclusions (comptes anonymes) que 20260930180000.
--
-- L'ancienne fonction à un argument est remplacée, pas surchargée : avec deux
-- versions, `leaderboard(p_limit => 50)` d'un client pas encore mis à jour
-- serait ambigu. Avec des valeurs par défaut, ce même appel tombe sur celle-ci.

drop function if exists public.leaderboard(integer);

create or replace function public.leaderboard(p_limit integer default 50, p_by text default 'stars')
returns table (rank bigint, username text, total_stars integer, highest_level integer, is_me boolean)
language sql
stable
security definer
set search_path = public
as $fn$
  with players as (
    select
      p.id,
      coalesce(
        nullif(btrim(u.raw_user_meta_data ->> 'given_name'), ''),
        nullif(split_part(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), ' ', 1), ''),
        p.username
      ) as username,
      p.total_stars,
      greatest(coalesce(m.highest_unlocked_number, 1) - 1, 0) as highest_level
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.user_mode_progress m on m.user_id = p.id and m.mode_id = 1
    where p.deleted_at is null
      and not coalesce(u.is_anonymous, false)
  ),
  ranked as (
    select *,
      case when p_by = 'level'
        then rank() over (order by highest_level desc, total_stars desc)
        else rank() over (order by total_stars desc, highest_level desc)
      end as rank
    from players
  )
  select r.rank, r.username, r.total_stars, r.highest_level, r.id = (select auth.uid())
  from ranked r
  where r.rank <= least(greatest(p_limit, 1), 100) or r.id = (select auth.uid())
  order by r.rank, r.username;
$fn$;

revoke all on function public.leaderboard(integer, text) from public;
grant execute on function public.leaderboard(integer, text) to anon, authenticated;
