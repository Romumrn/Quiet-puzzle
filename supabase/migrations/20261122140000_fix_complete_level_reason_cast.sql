-- complete_level failed on every call with
--   42804: column "reason" is of type coin_reason but expression is of type text
-- A CASE over two string literals is typed text, which Postgres will not
-- store in an enum column. Same function as 20261103120000_star_sync.sql, the
-- two literals cast to public.coin_reason. Nothing else changes.
--
-- Until this runs, no win reached the server: no level_attempts row, no
-- progress, no stars on the leaderboard.

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
  values (v_user_id, v_coins_earned, case when v_is_new_best then 'level_reward'::public.coin_reason else 'level_replay'::public.coin_reason end, jsonb_build_object('level_id', p_level_id, 'stars', v_stars), v_balance)
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
