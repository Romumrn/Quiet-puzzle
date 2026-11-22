-- Admin dashboard: ad log + one admin-only RPC that returns every figure.
--
-- Until now the ads were not recorded anywhere (analytics events live in the
-- phone's memory only, and grant_ad_reward() is never called by the client).
-- `ad_events` fixes that from the next app version on: one row per ad
-- requested, with whether it actually played.

create table if not exists public.ad_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('interstitial', 'rewarded')),
  placement text,
  shown boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_ad_events_created on public.ad_events (created_at);

alter table public.ad_events enable row level security;
-- No policy: nobody reads or writes the table directly. Writes go through
-- log_ad_event(), reads through admin_dashboard().

create or replace function public.log_ad_event(p_kind text, p_placement text, p_shown boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('interstitial', 'rewarded') then return; end if;
  insert into public.ad_events (user_id, kind, placement, shown)
  values (auth.uid(), p_kind, left(p_placement, 40), coalesce(p_shown, false));
end;
$$;
revoke execute on function public.log_ad_event(text, text, boolean) from public, anon;
grant execute on function public.log_ad_event(text, text, boolean) to authenticated;

-- All the dashboard's figures in one round trip. Admin only.
create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  if not public.is_admin() then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'players', (select count(*) from public.profiles where deleted_at is null),
    'anonymous', (select count(*) from auth.users where is_anonymous),
    'new_today', (select count(*) from public.profiles where created_at >= date_trunc('day', now())),
    'new_7d', (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
    'active_1d', (select count(distinct user_id) from public.level_attempts where created_at >= now() - interval '1 day'),
    'active_7d', (select count(distinct user_id) from public.level_attempts where created_at >= now() - interval '7 days'),
    'active_30d', (select count(distinct user_id) from public.level_attempts where created_at >= now() - interval '30 days'),
    'played_once', (select count(distinct user_id) from public.level_attempts where completed),
    'reached_10', (select count(*) from public.profiles where total_stars >= 10),
    'avg_stars', (select round(avg(total_stars), 1) from public.profiles),
    'wins', (select count(*) from public.level_attempts where completed),
    'wins_7d', (select count(*) from public.level_attempts where completed and created_at >= now() - interval '7 days'),
    -- Mean time of a won level, in seconds, capped at 30 min to ignore a phone
    -- left open. This is level time, not session time: sessions are not logged.
    'avg_win_s', (select round(avg(time_ms) / 1000.0, 1) from public.level_attempts where completed and time_ms between 1 and 1800000),
    'avg_win_moves', (select round(avg(moves), 1) from public.level_attempts where completed),
    'daily_scores', (select count(*) from public.daily_scores),
    'signups_14d', coalesce((
      select jsonb_agg(jsonb_build_object('day', d::date, 'n', coalesce(c.n, 0)) order by d)
      from generate_series(current_date - 13, current_date, interval '1 day') d
      left join (select created_at::date as day, count(*) n from public.profiles group by 1) c on c.day = d::date
    ), '[]'::jsonb),
    'wins_14d', coalesce((
      select jsonb_agg(jsonb_build_object('day', d::date, 'n', coalesce(c.n, 0), 'players', coalesce(c.p, 0)) order by d)
      from generate_series(current_date - 13, current_date, interval '1 day') d
      left join (
        select created_at::date as day, count(*) n, count(distinct user_id) p
        from public.level_attempts where completed group by 1
      ) c on c.day = d::date
    ), '[]'::jsonb),
    'ads', jsonb_build_object(
      'since', (select min(created_at) from public.ad_events),
      'total', (select count(*) from public.ad_events),
      'shown', (select count(*) from public.ad_events where shown),
      'shown_7d', (select count(*) from public.ad_events where shown and created_at >= now() - interval '7 days'),
      'by_kind', coalesce((
        select jsonb_agg(jsonb_build_object('kind', kind, 'asked', asked, 'shown', shown))
        from (
          select kind, count(*) asked, count(*) filter (where shown) shown
          from public.ad_events group by kind
        ) k
      ), '[]'::jsonb),
      'by_day', coalesce((
        select jsonb_agg(jsonb_build_object('day', d::date, 'n', coalesce(c.n, 0)) order by d)
        from generate_series(current_date - 13, current_date, interval '1 day') d
        left join (select created_at::date as day, count(*) n from public.ad_events where shown group by 1) c on c.day = d::date
      ), '[]'::jsonb)
    )
  ) into r;

  return r;
end;
$$;
revoke execute on function public.admin_dashboard() from public, anon;
grant execute on function public.admin_dashboard() to authenticated;
