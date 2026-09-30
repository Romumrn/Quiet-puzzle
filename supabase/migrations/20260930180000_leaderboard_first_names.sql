-- Classement : le PRÉNOM des joueurs plutôt que leur pseudo par défaut.
--
-- Les pseudos générés (« JoueurXXXXXXXX », ou des suites comme « c22… »)
-- ne disaient rien à personne : on ne se reconnaissait pas entre amis
-- (retour des testeurs, 2026-09-30). On montre désormais le prénom du compte
-- Google — le prénom SEUL, jamais le nom de famille :
--   1. `given_name` fourni par Google ;
--   2. à défaut, le premier mot de `full_name` / `name` ;
--   3. à défaut, le pseudo de `profiles.username`, comme avant.
--
-- La colonne garde son nom `username` : le client (src/meta/leaderboard.js)
-- ne change pas. Les comptes anonymes restent absents du classement.
--
-- security definer, comme la version précédente : `auth.users` n'est lisible
-- que par le serveur ; la fonction n'en sort que ce prénom.

create or replace function public.leaderboard(p_limit integer default 50)
returns table (rank bigint, username text, total_stars integer, highest_level integer, is_me boolean)
language sql
stable
security definer
set search_path = public
as $fn$
  with ranked as (
    select
      p.id,
      coalesce(
        nullif(btrim(u.raw_user_meta_data ->> 'given_name'), ''),
        nullif(split_part(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), ' ', 1), ''),
        p.username
      ) as username,
      p.total_stars,
      greatest(coalesce(m.highest_unlocked_number, 1) - 1, 0) as highest_level,
      rank() over (order by p.total_stars desc, coalesce(m.highest_unlocked_number, 1) desc) as rank
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.user_mode_progress m on m.user_id = p.id and m.mode_id = 1
    where p.deleted_at is null
      and not coalesce(u.is_anonymous, false)
  )
  select r.rank, r.username, r.total_stars, r.highest_level, r.id = (select auth.uid())
  from ranked r
  where r.rank <= least(greatest(p_limit, 1), 100) or r.id = (select auth.uid())
  order by r.rank, r.username;
$fn$;

revoke all on function public.leaderboard(integer) from public;
grant execute on function public.leaderboard(integer) to anon, authenticated;
