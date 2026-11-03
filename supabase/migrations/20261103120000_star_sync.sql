-- Les étoiles du classement et celles de l'accueil ne disaient pas la même chose.
--
-- L'accueil compte la sauvegarde de l'appareil ; le classement compte
-- `profiles.total_stars`, alimenté par `complete_level`. Trois écarts :
--
--   1. `complete_level` lisait les seuils à l'envers. `star_thresholds` vaut
--      `[3★, 2★]` (`starThresholds()` dans prototype/src/core/stars.js, publié
--      tel quel par tools/publish-levels.mjs) : il donnait 3★ jusqu'au seuil du
--      2★, et 1★ au-delà — jamais 2★.
--   2. Il refusait toute victoire au-delà de `move_limit`, alors que le jeu la
--      compte (0★, niveau suivant débloqué) : le serveur restait en arrière.
--   3. Une victoire hors ligne, ou dont l'envoi échouait, n'atteignait jamais le
--      serveur : rien ne la renvoyait. `sync_progress` ci-dessous pousse la
--      sauvegarde de l'appareil, appelée par `syncFromCloud()` (api.js).
--
-- Le client envoie désormais aussi la note qu'il a affichée (`p_stars`) : lui
-- seul connaît le chrono (2★ au plus une fois le temps écoulé). Le serveur la
-- plafonne à ce que les gestes valent, et ne la croit jamais au-dessus.

-- Note d'une victoire d'après ses gestes seuls : la règle de `Board.dragStars()`.
create or replace function public.grade_drags(p_moves integer, p_thresholds smallint[], p_move_limit integer)
returns smallint
language sql
immutable
set search_path = public
as $fn$
  select case
    when p_moves is null then 0
    when p_moves <= p_thresholds[1] then 3
    when p_moves <= p_thresholds[2] then 2
    when p_moves <= p_move_limit then 1
    else 0
  end::smallint;
$fn$;

revoke all on function public.grade_drags(integer, smallint[], integer) from public, anon, authenticated;

-- complete_level : même fonction, seuils dans le bon ordre, p_stars en plus.
-- La signature change : l'ancienne est retirée pour qu'aucun appel ne tombe sur
-- elle. Un client qui n'envoie pas p_stars reste servi (valeur par défaut).
drop function if exists public.complete_level(bigint, smallint, integer, boolean, text);

create or replace function public.complete_level(
  p_level_id bigint,
  p_moves smallint,
  p_time_ms integer,
  p_completed boolean,
  p_client_attempt_id text,
  p_stars smallint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_level public.levels%rowtype;
  v_existing public.user_progress%rowtype;
  v_event_key text;
  v_event_id bigint;
  v_stars smallint := 0;
  v_score integer := 0;
  v_is_new_best boolean := false;
  v_coins_earned integer := 0;
  v_xp_earned integer := 0;
  v_coins_per_star jsonb;
  v_balance integer;
  v_txn_id bigint;
  v_attempt_id bigint;
begin
  if v_user_id is null then
    raise exception 'Authentification requise';
  end if;

  select * into v_level from public.levels where id = p_level_id and status = 'published';
  if not found then
    raise exception 'Niveau introuvable ou non publié';
  end if;

  -- A win past move_limit is no longer refused: it is worth 0 stars, and it
  -- still unlocks the next level, as on the device.

  v_event_key := format('level_completion:%s:%s:%s', v_user_id, p_level_id, p_client_attempt_id);

  -- Idempotence : un retry réseau sur le même client_attempt_id ne doit rien
  -- créditer de plus.
  insert into public.reward_events (user_id, event_key, event_type)
  values (v_user_id, v_event_key, 'level_completion')
  on conflict (event_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select re.coin_transaction_id into v_txn_id from public.reward_events re where re.event_key = v_event_key;
    return jsonb_build_object('replayed', true, 'coin_transaction_id', v_txn_id);
  end if;

  -- Verrou de ligne : sérialise les écritures concurrentes sur ce profil.
  select coins_balance into v_balance from public.profiles where id = v_user_id for update;

  select * into v_existing from public.user_progress where user_id = v_user_id and level_id = p_level_id;

  -- Journal, quel que soit le résultat (réussite ou échec) — utile pour l'audit.
  insert into public.level_attempts (user_id, level_id, mode_id, moves, time_ms, stars, score, completed, is_flagged, client_attempt_id)
  values (
    v_user_id, p_level_id, v_level.mode_id, p_moves, p_time_ms, 0, 0, p_completed,
    -- heuristique de plausibilité très permissive : moins de 120ms/geste = suspect, à affiner.
    (p_completed and p_time_ms < p_moves * 120),
    p_client_attempt_id
  )
  returning id into v_attempt_id;

  if not p_completed then
    update public.reward_events set event_type = 'level_completion_failed' where id = v_event_id;
    return jsonb_build_object('completed', false);
  end if;

  -- The client's own grade (it knows the clock), never above what the drags
  -- alone are worth; an older client sends none and gets the drags' grade.
  v_stars := public.grade_drags(p_moves, v_level.star_thresholds, v_level.move_limit);
  if p_stars is not null then v_stars := least(v_stars, greatest(p_stars, 0)); end if;
  v_score := greatest(0, 1000 - (p_moves - v_level.min_drags) * 25 - round(p_time_ms / 1000.0) * 2);
  v_is_new_best := v_existing.user_id is null or v_existing.best_moves is null or p_moves < v_existing.best_moves;

  v_coins_per_star := (select rc.reward_config -> 'coins_per_star' from public.game_modes rc where rc.id = v_level.mode_id);
  v_coins_earned := case
    when v_is_new_best then coalesce((v_coins_per_star ->> v_stars::text)::integer, v_stars * 2)
    else 1
  end;
  v_xp_earned := v_stars * 10;

  update public.level_attempts set stars = v_stars, score = v_score where id = v_attempt_id;

  insert into public.user_progress as up (user_id, level_id, mode_id, level_content_version, stars, best_score, best_moves, best_time_ms, attempts_count, first_completed_at, last_attempt_at)
  values (v_user_id, p_level_id, v_level.mode_id, v_level.content_version, v_stars, v_score, p_moves, p_time_ms, 1, now(), now())
  on conflict (user_id, level_id) do update set
    stars = greatest(up.stars, excluded.stars),
    best_score = greatest(up.best_score, excluded.best_score),
    best_moves = least(up.best_moves, excluded.best_moves),
    best_time_ms = least(up.best_time_ms, excluded.best_time_ms),
    attempts_count = up.attempts_count + 1,
    first_completed_at = coalesce(up.first_completed_at, now()),
    last_attempt_at = now(),
    level_content_version = excluded.level_content_version;

  insert into public.user_mode_progress (user_id, mode_id, highest_unlocked_number, updated_at)
  values (v_user_id, v_level.mode_id, v_level.sequence_number + 1, now())
  on conflict (user_id, mode_id) do update set
    highest_unlocked_number = greatest(public.user_mode_progress.highest_unlocked_number, excluded.highest_unlocked_number),
    updated_at = now();

  v_balance := v_balance + v_coins_earned;
  insert into public.coin_transactions (user_id, amount, reason, metadata, balance_after)
  values (v_user_id, v_coins_earned, case when v_is_new_best then 'level_reward' else 'level_replay' end, jsonb_build_object('level_id', p_level_id, 'stars', v_stars), v_balance)
  returning id into v_txn_id;

  update public.profiles
    set coins_balance = v_balance,
        xp = xp + v_xp_earned,
        total_stars = total_stars - coalesce(v_existing.stars, 0) + greatest(coalesce(v_existing.stars, 0), v_stars),
        last_played_date = current_date
    where id = v_user_id;

  update public.reward_events set coin_transaction_id = v_txn_id where id = v_event_id;

  return jsonb_build_object(
    'completed', true, 'stars', v_stars, 'score', v_score,
    'coins_earned', v_coins_earned, 'xp_earned', v_xp_earned,
    'is_new_best', v_is_new_best, 'coin_transaction_id', v_txn_id
  );
end;
$$;


revoke all on function public.complete_level(bigint, smallint, integer, boolean, text, smallint) from public, anon;
grant execute on function public.complete_level(bigint, smallint, integer, boolean, text, smallint) to authenticated;

-- sync_progress : la sauvegarde de l'appareil vers le serveur.
--
-- `p_levels` : `[{ "n": 12, "stars": 2, "moves": 17 }, …]`, un élément par
-- niveau gagné (numéro de séquence du mode classique, meilleur nombre de gestes).
-- Fusion au maximum, comme `syncFromCloud()` dans l'autre sens ; chaque note
-- est plafonnée à ce que ses gestes valent. Le curseur ne dépasse jamais le
-- niveau qui suit le plus loin gagné. `total_stars` est recalculé en entier.
create or replace function public.sync_progress(p_levels jsonb, p_unlocked integer)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_farthest integer;
begin
  if v_user_id is null then
    raise exception 'Authentification requise';
  end if;

  insert into public.user_progress as up
    (user_id, level_id, mode_id, level_content_version, stars, best_moves, attempts_count, first_completed_at, last_attempt_at)
  select v_user_id, l.id, l.mode_id, l.content_version,
         least(greatest(coalesce(e.stars, 0), 0), public.grade_drags(e.moves, l.star_thresholds, l.move_limit)),
         e.moves, 1, now(), now()
  from (
    select distinct on (n) n, stars, moves
    from jsonb_to_recordset(coalesce(p_levels, '[]'::jsonb)) as x(n integer, stars integer, moves integer)
    where moves > 0
    order by n, moves
  ) e
  join public.levels l on l.mode_id = 1 and l.sequence_number = e.n and l.status = 'published'
  on conflict (user_id, level_id) do update set
    stars = greatest(up.stars, excluded.stars),
    best_moves = least(coalesce(up.best_moves, excluded.best_moves), excluded.best_moves),
    first_completed_at = coalesce(up.first_completed_at, excluded.first_completed_at);

  select max(l.sequence_number) into v_farthest
  from public.user_progress up
  join public.levels l on l.id = up.level_id
  where up.user_id = v_user_id and up.mode_id = 1;

  if v_farthest is not null then
    insert into public.user_mode_progress (user_id, mode_id, highest_unlocked_number, updated_at)
    values (v_user_id, 1, least(greatest(coalesce(p_unlocked, 1), 1), v_farthest + 1), now())
    on conflict (user_id, mode_id) do update set
      highest_unlocked_number = greatest(public.user_mode_progress.highest_unlocked_number, excluded.highest_unlocked_number),
      updated_at = now();
  end if;

  update public.profiles
    set total_stars = (select coalesce(sum(stars), 0) from public.user_progress where user_id = v_user_id)
    where id = v_user_id;
end;
$fn$;

revoke all on function public.sync_progress(jsonb, integer) from public, anon;
grant execute on function public.sync_progress(jsonb, integer) to authenticated;

-- Réparation : les notes déjà gonflées par les seuils inversés redescendent à ce
-- que leurs meilleurs gestes valent, puis chaque total est recompté.
update public.user_progress up
  set stars = public.grade_drags(up.best_moves, l.star_thresholds, l.move_limit)
  from public.levels l
  where l.id = up.level_id
    and up.best_moves is not null
    and up.stars > public.grade_drags(up.best_moves, l.star_thresholds, l.move_limit);

update public.profiles p
  set total_stars = coalesce((select sum(stars) from public.user_progress where user_id = p.id), 0)
  where p.total_stars is distinct from coalesce((select sum(stars) from public.user_progress where user_id = p.id), 0);
