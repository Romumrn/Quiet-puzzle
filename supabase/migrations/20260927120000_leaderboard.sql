-- Classement des joueurs connectés.
--
-- Seuls les comptes NON anonymes y figurent : un joueur anonyme n'a pas choisi
-- d'exister auprès des autres, et ses progrès peuvent encore être fusionnés
-- dans un compte (merge_anonymous_progress). Les noms affichés sont les
-- pseudos de `profiles.username` (« JoueurXXXXXXXX » par défaut), jamais
-- l'identité Google.
--
-- Rang : étoiles d'abord, puis le niveau le plus loin atteint en mode classique.
-- La fonction renvoie le haut du classement ET la ligne de l'appelant, où qu'il
-- soit : c'est la ligne qu'il cherche.
--
-- security definer : `profiles` n'est lisible que par son propriétaire (RLS) ;
-- la fonction ne sort que les colonnes publiques, déjà exposées par la vue
-- `public_profiles`.

create or replace function public.leaderboard(p_limit integer default 50)
returns table (rank bigint, username text, total_stars integer, highest_level integer, is_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select
      p.id,
      p.username,
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
$$;

revoke all on function public.leaderboard(integer) from public;
grant execute on function public.leaderboard(integer) to anon, authenticated;
