-- Classement du puzzle du jour, pour TOUS les joueurs — il n'était que local à
-- l'appareil (« Ce classement est local… »), donc chacun y était seul.
--
-- Le puzzle officiel vient d'un fichier (levels/daily.json), pas de
-- `daily_puzzles` : la table `daily_puzzle_scores`, qui exige une ligne dans
-- `daily_puzzles`, ne peut pas le recevoir. D'où cette table simple, indexée
-- par l'identifiant du puzzle tel que le client le connaît
-- (« official-2026-09-30 », ou l'id d'une grille de la communauté).
--
-- Écriture et lecture passent par deux fonctions security definer : aucune
-- politique RLS n'ouvre la table directement.
--   - submit_daily_score : garde le MEILLEUR score du joueur pour ce puzzle ;
--   - daily_leaderboard  : le haut du classement + la ligne de l'appelant, avec
--     le prénom Google (jamais le nom de famille) ou le pseudo, comme
--     public.leaderboard. Les anonymes y figurent sous leur pseudo : c'est le
--     classement de celles et ceux qui ont joué ce puzzle-là.

create table if not exists public.daily_scores (
  puzzle_id text not null check (char_length(puzzle_id) between 1 and 80),
  user_id uuid not null references public.profiles (id) on delete cascade,
  score integer not null check (score between 0 and 1000),
  drags integer not null check (drags >= 0),
  seconds integer not null check (seconds >= 0),
  submitted_at timestamptz not null default now(),
  primary key (puzzle_id, user_id)
);

create index if not exists idx_daily_scores_board on public.daily_scores (puzzle_id, score desc, submitted_at);

alter table public.daily_scores enable row level security;
-- Pas de politique : seuls les deux fonctions ci-dessous y touchent.

create or replace function public.submit_daily_score(
  p_puzzle_id text, p_score integer, p_drags integer, p_seconds integer)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into public.daily_scores (puzzle_id, user_id, score, drags, seconds)
  values (p_puzzle_id, auth.uid(), least(greatest(p_score, 0), 1000),
          greatest(p_drags, 0), greatest(p_seconds, 0))
  on conflict (puzzle_id, user_id) do update
    set score = excluded.score, drags = excluded.drags,
        seconds = excluded.seconds, submitted_at = now()
    where excluded.score > public.daily_scores.score;
end;
$fn$;

create or replace function public.daily_leaderboard(p_puzzle_id text, p_limit integer default 50)
returns table (rank bigint, username text, score integer, is_me boolean, total bigint)
language sql
stable
security definer
set search_path = public
as $fn$
  with ranked as (
    select
      s.user_id,
      coalesce(
        nullif(btrim(u.raw_user_meta_data ->> 'given_name'), ''),
        nullif(split_part(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), ' ', 1), ''),
        p.username
      ) as username,
      s.score,
      rank() over (order by s.score desc, s.submitted_at) as rank,
      count(*) over () as total
    from public.daily_scores s
    join public.profiles p on p.id = s.user_id
    join auth.users u on u.id = s.user_id
    where s.puzzle_id = p_puzzle_id and p.deleted_at is null
  )
  select r.rank, r.username, r.score, r.user_id = (select auth.uid()), r.total
  from ranked r
  where r.rank <= least(greatest(p_limit, 1), 100) or r.user_id = (select auth.uid())
  order by r.rank;
$fn$;

revoke all on function public.submit_daily_score(text, integer, integer, integer) from public;
grant execute on function public.submit_daily_score(text, integer, integer, integer) to authenticated;
revoke all on function public.daily_leaderboard(text, integer) from public;
grant execute on function public.daily_leaderboard(text, integer) to anon, authenticated;
