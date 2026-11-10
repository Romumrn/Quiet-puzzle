-- Niveaux de la communauté dans le puzzle du jour.
--
-- Les grilles proposées depuis l'éditeur ne quittaient pas l'appareil de leur
-- auteur (file locale de `src/meta/dailyPuzzle.js`) : personne d'autre ne les
-- jouait. Le schéma, lui, était prêt depuis le début — `community_levels`
-- (brouillon → soumis → approuvé, modération dans le panneau admin) et
-- `daily_puzzles` (une ligne par date, source officielle ou communauté) — mais
-- aucun client ne s'en servait. Deux fonctions les relient :
--
--   - submit_community_level : l'éditeur envoie la grille, directement au statut
--     « soumis » ; elle attend la modération (panneau admin → Approuver). Le
--     titre et la grille sont du contenu de joueur montré à tous : rien ne
--     passe sans avoir été regardé.
--   - daily_community_level : la grille de la communauté du jour, ou rien.
--
-- ROTATION : un jour sur deux (jours impairs depuis le 2026-01-01, UTC) est un
-- jour « communauté ». Ce jour-là, le premier appel prend la plus ancienne
-- grille approuvée jamais encore choisie (premier arrivé, premier servi : c'est
-- le plus juste pour les créateurs) et l'inscrit dans `daily_puzzles` — tous
-- les joueurs ont ensuite la même jusqu'à minuit UTC. Pas de grille en
-- attente, ou jour pair : rien, et le client joue le puzzle officiel
-- (`levels/daily.json`). Une ligne posée par un admin (`select_daily_puzzle`)
-- passe avant la rotation, quel que soit le jour.
--
-- Le créateur est nommé comme dans le classement : prénom Google seul, sinon le
-- pseudo du profil.

create or replace function public.submit_community_level(p_title text, p_grid jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_grid is null or jsonb_typeof(p_grid -> 'blocks') is distinct from 'array'
     or octet_length(p_grid::text) > 20000 then
    raise exception 'grille invalide';
  end if;
  -- Au plus 5 propositions par joueur et par jour : la file reste lisible.
  if (select count(*) from public.community_levels
      where creator_id = auth.uid() and created_at > now() - interval '1 day') >= 5 then
    raise exception 'trop de propositions aujourd''hui';
  end if;

  insert into public.community_levels (creator_id, mode_id, title, grid, status)
  values (
    auth.uid(),
    (select id from public.game_modes where code = 'community'),
    left(coalesce(nullif(btrim(p_title), ''), 'Puzzle'), 60),
    p_grid,
    'submitted'
  )
  returning id into v_id;
  return v_id;
end;
$fn$;

revoke all on function public.submit_community_level(text, jsonb) from public, anon;
grant execute on function public.submit_community_level(text, jsonb) to authenticated;


create or replace function public.daily_community_level()
returns table (id uuid, title text, grid jsonb, author text)
language plpgsql
security definer
set search_path = public
as $fn$
#variable_conflict use_column
declare
  v_date date := (now() at time zone 'utc')::date;
  v_mode smallint := (select gm.id from public.game_modes gm where gm.code = 'daily');
  v_found boolean;
  v_pick uuid;
begin
  select true into v_found from public.daily_puzzles dp
    where dp.puzzle_date = v_date and dp.mode_id = v_mode;

  if v_found is null and (v_date - date '2026-01-01') % 2 = 1 then
    select cl.id into v_pick from public.community_levels cl
      where cl.status in ('approved', 'published')
        and not exists (select 1 from public.daily_puzzles d where d.community_level_id = cl.id)
      order by cl.moderated_at nulls last, cl.created_at
      limit 1;
    if v_pick is not null then
      -- Deux joueurs au même instant : le second ne fait rien et lit la ligne
      -- du premier.
      insert into public.daily_puzzles (puzzle_date, mode_id, source_type, community_level_id, grid_snapshot, selected_by)
      select v_date, v_mode, 'community_level', cl.id, cl.grid, 'auto'
      from public.community_levels cl where cl.id = v_pick
      on conflict (puzzle_date, mode_id) do nothing;
    end if;
  end if;

  return query
    select cl.id, cl.title, dp.grid_snapshot,
      coalesce(
        nullif(btrim(u.raw_user_meta_data ->> 'given_name'), ''),
        nullif(split_part(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), ' ', 1), ''),
        p.username
      )
    from public.daily_puzzles dp
    join public.community_levels cl on cl.id = dp.community_level_id
    join public.profiles p on p.id = cl.creator_id
    join auth.users u on u.id = p.id
    where dp.puzzle_date = v_date and dp.mode_id = v_mode
      and dp.source_type = 'community_level';
end;
$fn$;

revoke all on function public.daily_community_level() from public;
grant execute on function public.daily_community_level() to anon, authenticated;
