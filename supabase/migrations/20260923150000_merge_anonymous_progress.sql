-- merge_anonymous_progress : fusionne la progression d'un compte anonyme dans
-- le compte fraîchement authentifié (Google) qui prend sa suite, quand un
-- joueur a joué sans compte avant de se connecter.
--
-- Mêmes règles de fusion que syncFromCloud() côté client (le plus grand des
-- deux gagne) et que complete_level() côté colonnes user_progress
-- (stars/best_score plus grand gagne, best_moves/best_time_ms plus petit
-- gagne) : c'est la logique déjà en place partout ailleurs dans le jeu pour
-- ne jamais faire perdre de progression à un joueur.
--
-- security definer + vérification stricte que la source est bien un compte
-- anonyme (auth.users.is_anonymous) : sans ce garde-fou, n'importe quel
-- utilisateur authentifié pourrait fusionner — donc voler — la progression
-- d'un compte réel arbitraire en passant son id en paramètre.
create or replace function public.merge_anonymous_progress(p_anonymous_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_user_id uuid := auth.uid();
  v_is_anonymous boolean;
  v_levels_merged integer := 0;
  v_modes_merged integer := 0;
begin
  if v_new_user_id is null then
    raise exception 'Authentification requise';
  end if;

  if p_anonymous_user_id is null or p_anonymous_user_id = v_new_user_id then
    return jsonb_build_object('merged', false, 'reason', 'no_source');
  end if;

  select is_anonymous into v_is_anonymous from auth.users where id = p_anonymous_user_id;
  if v_is_anonymous is not true then
    raise exception 'Compte source invalide pour une fusion';
  end if;

  -- Verrou de ligne sur les deux profils : sérialise contre un double appel
  -- concurrent (retry réseau côté client).
  perform 1 from public.profiles where id = v_new_user_id for update;
  perform 1 from public.profiles where id = p_anonymous_user_id for update;

  update public.profiles as p
    set coins_balance = greatest(p.coins_balance, anon.coins_balance),
        xp = greatest(p.xp, anon.xp)
    from public.profiles as anon
    where p.id = v_new_user_id and anon.id = p_anonymous_user_id;

  insert into public.user_progress as up (
    user_id, level_id, mode_id, level_content_version, stars,
    best_score, best_moves, best_time_ms, attempts_count,
    first_completed_at, last_attempt_at
  )
  select
    v_new_user_id, level_id, mode_id, level_content_version, stars,
    best_score, best_moves, best_time_ms, attempts_count,
    first_completed_at, last_attempt_at
  from public.user_progress
  where user_id = p_anonymous_user_id
  on conflict (user_id, level_id) do update set
    stars = greatest(up.stars, excluded.stars),
    best_score = greatest(up.best_score, excluded.best_score),
    best_moves = least(up.best_moves, excluded.best_moves),
    best_time_ms = least(up.best_time_ms, excluded.best_time_ms),
    attempts_count = up.attempts_count + excluded.attempts_count,
    first_completed_at = least(up.first_completed_at, excluded.first_completed_at),
    last_attempt_at = greatest(up.last_attempt_at, excluded.last_attempt_at),
    level_content_version = greatest(up.level_content_version, excluded.level_content_version);
  get diagnostics v_levels_merged = row_count;

  -- total_stars est un cache dénormalisé (voir comment sur la table) :
  -- recalculé depuis user_progress plutôt que reconstruit à coups de delta,
  -- pour ne pas pouvoir diverger si la fusion est un jour rejouée.
  update public.profiles
    set total_stars = (select coalesce(sum(stars), 0) from public.user_progress where user_id = v_new_user_id)
    where id = v_new_user_id;

  insert into public.user_mode_progress (user_id, mode_id, highest_unlocked_number, updated_at)
  select v_new_user_id, mode_id, highest_unlocked_number, now()
  from public.user_mode_progress
  where user_id = p_anonymous_user_id
  on conflict (user_id, mode_id) do update set
    highest_unlocked_number = greatest(public.user_mode_progress.highest_unlocked_number, excluded.highest_unlocked_number),
    updated_at = now();
  get diagnostics v_modes_merged = row_count;

  return jsonb_build_object('merged', true, 'levels_merged', v_levels_merged, 'modes_merged', v_modes_merged);
end;
$$;

-- Ce projet accorde EXECUTE à anon/authenticated par défaut sur toute
-- nouvelle fonction (voir 20260908141408_harden_function_privileges_v2.sql) :
-- il faut révoquer explicitement de anon, pas seulement de public.
revoke execute on function public.merge_anonymous_progress(uuid) from public, anon, authenticated;
grant execute on function public.merge_anonymous_progress(uuid) to authenticated;
