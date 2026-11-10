-- Les grilles de la communauté entrent dans la rotation SANS modération, dès
-- que leur solution la plus courte demande au moins 6 coups (décision du
-- 2026-11-10 : le jeu doit vivre sans l'approbation de l'admin).
--
-- Le nombre de coups est celui que l'éditeur a trouvé (`minDrags`, recherche
-- exacte de `checkGrid`, src/core/rush/live.js) : le serveur ne sait pas
-- résoudre une grille, il fait confiance au client, comme pour la note
-- (`complete_level`). Un admin peut toujours rejeter ou archiver une grille
-- après coup depuis le panneau admin ; une grille rejetée ne sort plus.
--
-- Une grille sous le seuil (un vieux client) reste « soumise » et attend la
-- modération, comme avant. `moderated_at` est posé à l'approbation automatique :
-- la rotation (`daily_community_level`) sert les grilles dans cet ordre.

create or replace function public.submit_community_level(p_title text, p_grid jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
  v_moves integer;
  v_auto boolean;
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

  v_moves := case when jsonb_typeof(p_grid -> 'minDrags') = 'number'
                  then floor((p_grid ->> 'minDrags')::numeric)::integer end;
  v_auto := coalesce(v_moves >= 6, false);

  insert into public.community_levels (creator_id, mode_id, title, grid, status, moderated_at, moderation_notes)
  values (
    auth.uid(),
    (select id from public.game_modes where code = 'community'),
    left(coalesce(nullif(btrim(p_title), ''), 'Puzzle'), 60),
    p_grid,
    case when v_auto then 'approved' else 'submitted' end::public.moderation_status,
    case when v_auto then now() end,
    case when v_auto then format('auto: %s coups', v_moves) end
  )
  returning id into v_id;
  return v_id;
end;
$fn$;

revoke all on function public.submit_community_level(text, jsonb) from public, anon;
grant execute on function public.submit_community_level(text, jsonb) to authenticated;

-- Les grilles déjà en attente qui passent le seuil entrent aussi dans la rotation.
-- (Leur `minDrags` comptait les sorties seules : chaque sortie est au moins un
-- coup, le seuil reste vrai.) Le garde-fou des modifications refuse tout
-- changement de statut hors modérateur, et l'éditeur SQL n'en est pas un :
-- il est coupé le temps de cette mise à jour.
alter table public.community_levels disable trigger trg_protect_community_level_edits;
update public.community_levels
  set status = 'approved', moderated_at = now(), moderation_notes = 'auto: ' || (grid ->> 'minDrags') || ' coups'
  where status = 'submitted'
    and jsonb_typeof(grid -> 'minDrags') = 'number'
    and (grid ->> 'minDrags')::numeric >= 6;
alter table public.community_levels enable trigger trg_protect_community_level_edits;
