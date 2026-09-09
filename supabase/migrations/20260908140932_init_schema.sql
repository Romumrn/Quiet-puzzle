-- Quiet Puzzle — schéma initial Supabase/PostgreSQL
-- Généré à partir de /Users/rmarin/.claude/plans/fluffy-conjuring-reddy.md (architecture validée).
-- À coller tel quel dans le SQL Editor de Supabase (ordre des blocs important : dépendances de FK).
--
-- Hypothèse Supabase standard : les fonctions créées ici sont propriété du rôle
-- d'exécution du SQL Editor (`postgres`), qui bypass RLS — c'est ce qui permet aux
-- fonctions SECURITY DEFINER ci-dessous d'écrire dans des tables où `authenticated`
-- n'a aucune policy d'écriture. Si ce projet a un rôle propriétaire différent,
-- vérifier qu'il a bien l'attribut BYPASSRLS avant d'exécuter ce script en prod.

-- ============================================================================
-- 0. Extensions
-- ============================================================================
create extension if not exists pgcrypto; -- gen_random_uuid()

-- ============================================================================
-- 1. Enums
-- ============================================================================
create type public.level_status as enum ('draft', 'published', 'archived');
create type public.moderation_status as enum ('draft', 'submitted', 'approved', 'rejected', 'published', 'archived');
create type public.coin_reason as enum (
  'level_reward', 'level_replay', 'daily_bonus', 'streak_bonus',
  'ad_reward', 'iap_purchase', 'hint_purchase', 'continue_purchase',
  'admin_adjustment'
);
create type public.notification_platform as enum ('android', 'ios');
create type public.app_role as enum ('admin', 'moderator');
create type public.daily_source_type as enum ('official_level', 'community_level');

-- ============================================================================
-- 2. profiles (1–1 avec auth.users)
-- ============================================================================
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  avatar_path text,
  locale text not null default 'fr',
  xp integer not null default 0,
  coins_balance integer not null default 0,
  total_stars integer not null default 0,
  current_streak smallint not null default 0,
  last_played_date date,
  last_daily_bonus_claimed_date date,
  settings jsonb not null default '{}'::jsonb,
  notification_preferences jsonb not null default '{"daily_puzzle": true}'::jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint profiles_xp_nonneg check (xp >= 0),
  constraint profiles_stars_nonneg check (total_stars >= 0)
);

comment on table public.profiles is 'Données de jeu du joueur. coins_balance/xp/total_stars sont des caches dénormalisés — source de vérité : coin_transactions / user_progress. Colonnes protégées via GRANT (voir §12).';

-- Création automatique du profil à l'inscription (anonyme ou non).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, 'Joueur' || substr(replace(new.id::text, '-', ''), 1, 8));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 3. user_roles + helpers RLS
-- ============================================================================
create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create or replace function public.is_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles where user_id = p_user_id and role = 'admin'
  );
$$;

create or replace function public.is_moderator(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles where user_id = p_user_id and role in ('admin', 'moderator')
  );
$$;

-- ============================================================================
-- 4. themes
-- ============================================================================
create table public.themes (
  id smallint generated always as identity primary key,
  code text not null unique,
  name jsonb not null,
  emoji text,
  hue smallint,
  palette text[6],
  unlock_condition jsonb not null default '{"type": "always"}'::jsonb,
  is_premium boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_unlocked_themes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  theme_id smallint not null references public.themes (id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, theme_id)
);

-- ============================================================================
-- 5. game_modes
-- ============================================================================
create table public.game_modes (
  id smallint generated always as identity primary key,
  code text not null unique,
  name jsonb not null,
  description jsonb not null default '{}'::jsonb,
  rules jsonb not null default '{}'::jsonb,
  reward_config jsonb not null default '{"coins_per_star": {"1": 2, "2": 5, "3": 10}}'::jsonb,
  default_theme_id smallint references public.themes (id),
  is_active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 6. level_groups ("mondes")
-- ============================================================================
create table public.level_groups (
  id bigint generated always as identity primary key,
  mode_id smallint not null references public.game_modes (id) on delete cascade,
  position smallint not null,
  name jsonb not null,
  difficulty_label jsonb not null default '{}'::jsonb,
  hue smallint,
  palette text[6],
  background_path text,
  created_at timestamptz not null default now(),
  unique (mode_id, position)
);

-- ============================================================================
-- 7. levels (niveaux officiels)
-- ============================================================================
create table public.levels (
  id bigint generated always as identity primary key,
  level_code text not null unique,
  mode_id smallint not null references public.game_modes (id) on delete cascade,
  level_group_id bigint references public.level_groups (id) on delete set null,
  sequence_number integer not null,
  width smallint not null check (width > 0 and width <= 20),
  height smallint not null check (height > 0 and height <= 20),
  color_count smallint not null check (color_count > 0 and color_count <= 8),
  move_limit smallint not null check (move_limit > 0),
  time_limit smallint not null check (time_limit > 0),
  min_drags smallint not null check (min_drags >= 0),
  star_thresholds smallint[2] not null,
  objective jsonb not null default '{"type": "clear_all"}'::jsonb,
  grid jsonb not null,
  status public.level_status not null default 'draft',
  eligible_for_daily boolean not null default true,
  content_version integer not null default 1,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint levels_star_thresholds_len check (array_length(star_thresholds, 1) = 2),
  unique (mode_id, sequence_number)
);

create index idx_levels_published on public.levels (mode_id, sequence_number) where status = 'published';
create index idx_levels_group on public.levels (level_group_id);

-- ============================================================================
-- 8. community_levels + likes
-- ============================================================================
create table public.community_levels (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  mode_id smallint not null references public.game_modes (id),
  title text not null check (char_length(title) between 1 and 60),
  description text,
  -- Contrairement à levels.grid (qui n'a que gates/blocks/solution, le reste
  -- étant en colonnes dédiées), grid embarque ici tout le payload jouable —
  -- largeur/hauteur/moveLimit/minDrags/starDrags inclus — car un niveau
  -- communautaire n'est pas calibré par le solveur ; c'est exactement la
  -- forme déjà produite par src/ui/editor.js (versNiveau()).
  grid jsonb,
  status public.moderation_status not null default 'draft',
  moderation_notes text,
  moderated_by uuid references public.profiles (id),
  moderated_at timestamptz,
  play_count integer not null default 0,
  like_count integer not null default 0,
  completion_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_levels_grid_required check (status = 'draft' or grid is not null)
);

create index idx_community_levels_status on public.community_levels (status, created_at);
create index idx_community_levels_creator on public.community_levels (creator_id);

-- Empêche la modification du contenu une fois le niveau soumis, sauf par un
-- modérateur, ou un retour explicite en brouillon par le créateur lui-même.
create or replace function public.protect_community_level_edits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_moderator() then
    return new;
  end if;

  if old.status <> 'draft' then
    if new.status = 'draft' and old.status = 'submitted' then
      -- retrait autorisé : retour en brouillon avant approbation
      new.title := old.title;
      new.description := old.description;
      new.grid := old.grid;
      new.mode_id := old.mode_id;
      return new;
    end if;
    raise exception 'Un niveau communautaire soumis ne peut plus être modifié par son créateur (statut actuel: %)', old.status;
  end if;

  return new;
end;
$$;

create trigger trg_protect_community_level_edits
  before update on public.community_levels
  for each row execute function public.protect_community_level_edits();

create table public.community_level_likes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  community_level_id uuid not null references public.community_levels (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, community_level_id)
);

create or replace function public.sync_community_level_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.community_levels set like_count = like_count + 1 where id = new.community_level_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.community_levels set like_count = greatest(like_count - 1, 0) where id = old.community_level_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger trg_sync_like_count
  after insert or delete on public.community_level_likes
  for each row execute function public.sync_community_level_like_count();

-- ============================================================================
-- 9. Progression
-- ============================================================================
create table public.user_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  level_id bigint not null references public.levels (id) on delete cascade,
  mode_id smallint not null references public.game_modes (id),
  level_content_version integer not null,
  stars smallint not null check (stars between 0 and 3),
  best_score integer,
  best_moves smallint,
  best_time_ms integer,
  attempts_count integer not null default 0,
  first_completed_at timestamptz,
  last_attempt_at timestamptz not null default now(),
  primary key (user_id, level_id)
);

create index idx_user_progress_mode on public.user_progress (user_id, mode_id);
create index idx_user_progress_leaderboard on public.user_progress (level_id, best_score desc);

create table public.user_mode_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  mode_id smallint not null references public.game_modes (id) on delete cascade,
  highest_unlocked_number integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, mode_id)
);

-- ============================================================================
-- 10. level_attempts (journal append-only, non partitionné pour l'instant —
--     voir §16 du plan : à partitionner par created_at seulement quand le
--     volume réel le justifie)
-- ============================================================================
create table public.level_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  level_id bigint not null references public.levels (id),
  mode_id smallint not null references public.game_modes (id),
  moves smallint not null,
  time_ms integer not null,
  stars smallint not null check (stars between 0 and 3),
  score integer not null,
  completed boolean not null,
  is_flagged boolean not null default false,
  client_attempt_id text,
  created_at timestamptz not null default now()
);

create index idx_level_attempts_user on public.level_attempts (user_id);
create index idx_level_attempts_level_created on public.level_attempts (level_id, created_at);

-- ============================================================================
-- 11. Niveau du jour
-- ============================================================================
create table public.daily_puzzles (
  puzzle_date date not null,
  mode_id smallint not null references public.game_modes (id),
  source_type public.daily_source_type not null,
  level_id bigint references public.levels (id),
  community_level_id uuid references public.community_levels (id),
  grid_snapshot jsonb not null,
  selected_by text not null default 'auto' check (selected_by in ('auto', 'admin')),
  selected_by_admin uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (puzzle_date, mode_id),
  constraint daily_puzzles_source_check check (
    (source_type = 'official_level' and level_id is not null and community_level_id is null)
    or
    (source_type = 'community_level' and community_level_id is not null and level_id is null)
  )
);

create table public.daily_puzzle_scores (
  puzzle_date date not null,
  mode_id smallint not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  score integer not null,
  moves smallint not null,
  time_ms integer not null,
  submitted_at timestamptz not null default now(),
  primary key (puzzle_date, mode_id, user_id),
  foreign key (puzzle_date, mode_id) references public.daily_puzzles (puzzle_date, mode_id) on delete cascade
);

create index idx_daily_scores_leaderboard on public.daily_puzzle_scores (puzzle_date, mode_id, score desc);

-- ============================================================================
-- 12. Économie
-- ============================================================================
create table public.coin_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount integer not null check (amount <> 0),
  reason public.coin_reason not null,
  metadata jsonb not null default '{}'::jsonb,
  balance_after integer not null,
  created_at timestamptz not null default now()
);

create index idx_coin_transactions_user on public.coin_transactions (user_id, created_at);

create table public.reward_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_key text not null unique,
  event_type text not null,
  coin_transaction_id bigint references public.coin_transactions (id),
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 13. Notifications
-- ============================================================================
create table public.notification_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform public.notification_platform not null,
  push_token text not null unique,
  is_active boolean not null default true,
  app_version text,
  timezone text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  deactivated_at timestamptz
);

create index idx_notification_devices_user on public.notification_devices (user_id);
create index idx_notification_devices_active on public.notification_devices (is_active) where is_active;

-- ============================================================================
-- 14. updated_at générique
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_levels_updated_at before update on public.levels
  for each row execute function public.set_updated_at();

create trigger trg_community_levels_updated_at before update on public.community_levels
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 15. Vues publiques et d'administration
-- ============================================================================
create view public.public_profiles
with (security_invoker = false) as
select id, username, avatar_path, total_stars, xp
from public.profiles
where deleted_at is null;

grant select on public.public_profiles to anon, authenticated;

create view public.moderation_queue
with (security_invoker = true) as
select id, creator_id, mode_id, title, created_at
from public.community_levels
where status = 'submitted'
order by created_at asc;

create view public.daily_puzzle_calendar
with (security_invoker = true) as
select puzzle_date, mode_id, source_type, level_id, community_level_id, selected_by
from public.daily_puzzles
where puzzle_date between current_date - interval '30 days' and current_date + interval '30 days'
order by puzzle_date desc;

create view public.flagged_attempts
with (security_invoker = true) as
select id, user_id, level_id, moves, time_ms, stars, score, created_at
from public.level_attempts
where is_flagged
order by created_at desc;

-- ============================================================================
-- 16. Privilèges de base — rendu explicite plutôt que de dépendre des GRANTs
--     par défaut d'un projet Supabase. RLS (section suivante) reste le vrai
--     filtre ligne par ligne ; ces GRANTs de table ne font qu'autoriser les
--     rôles à *tenter* les opérations que RLS filtrera ensuite.
-- ============================================================================
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- ============================================================================
-- 17. Row Level Security
-- ============================================================================

-- profiles ------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Barrière au niveau des privilèges SQL : même si RLS autorise l'UPDATE de sa
-- propre ligne, seules ces colonnes sont réellement modifiables par le client.
revoke update on public.profiles from authenticated;
grant update (username, avatar_path, locale, settings, notification_preferences) on public.profiles to authenticated;

-- user_roles ------------------------------------------------------------------
alter table public.user_roles enable row level security;

create policy user_roles_select_admin on public.user_roles
  for select to authenticated
  using (public.is_admin());

-- themes / game_modes / level_groups / levels --------------------------------
alter table public.themes enable row level security;
create policy themes_public_read on public.themes for select to anon, authenticated using (is_active);
create policy themes_admin_write on public.themes for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.game_modes enable row level security;
create policy game_modes_public_read on public.game_modes for select to anon, authenticated using (is_active);
create policy game_modes_admin_write on public.game_modes for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.level_groups enable row level security;
create policy level_groups_public_read on public.level_groups for select to anon, authenticated using (true);
create policy level_groups_admin_write on public.level_groups for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.levels enable row level security;
create policy levels_public_read on public.levels for select to anon, authenticated using (status = 'published');
create policy levels_admin_write on public.levels for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- user_unlocked_themes --------------------------------------------------------
alter table public.user_unlocked_themes enable row level security;
create policy user_unlocked_themes_select_own on public.user_unlocked_themes
  for select to authenticated using (user_id = auth.uid());

-- community_levels + likes ----------------------------------------------------
alter table public.community_levels enable row level security;

create policy community_levels_select on public.community_levels
  for select to anon, authenticated
  using (status = 'published' or creator_id = auth.uid() or public.is_moderator());

create policy community_levels_insert_own on public.community_levels
  for insert to authenticated
  with check (creator_id = auth.uid() and status = 'draft');

create policy community_levels_update_own on public.community_levels
  for update to authenticated
  using (creator_id = auth.uid() and status in ('draft', 'submitted'))
  with check (creator_id = auth.uid() and status in ('draft', 'submitted'));

create policy community_levels_moderate on public.community_levels
  for update to authenticated
  using (public.is_moderator())
  with check (public.is_moderator());

alter table public.community_level_likes enable row level security;
create policy community_level_likes_select on public.community_level_likes for select to anon, authenticated using (true);
create policy community_level_likes_insert_own on public.community_level_likes for insert to authenticated with check (user_id = auth.uid());
create policy community_level_likes_delete_own on public.community_level_likes for delete to authenticated using (user_id = auth.uid());

-- progression / tentatives / économie : lecture seule pour le client, écriture
-- réservée aux fonctions SECURITY DEFINER (aucune policy d'écriture ci-dessous
-- pour anon/authenticated = refus par défaut).
alter table public.user_progress enable row level security;
create policy user_progress_select_own on public.user_progress for select to authenticated using (user_id = auth.uid() or public.is_admin());

alter table public.user_mode_progress enable row level security;
create policy user_mode_progress_select_own on public.user_mode_progress for select to authenticated using (user_id = auth.uid() or public.is_admin());

alter table public.level_attempts enable row level security;
create policy level_attempts_select_own on public.level_attempts for select to authenticated using (user_id = auth.uid() or public.is_admin());

alter table public.coin_transactions enable row level security;
create policy coin_transactions_select_own on public.coin_transactions for select to authenticated using (user_id = auth.uid() or public.is_admin());

alter table public.reward_events enable row level security;
create policy reward_events_select_own on public.reward_events for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- daily_puzzles / daily_puzzle_scores : lecture publique, écriture serveur uniquement.
alter table public.daily_puzzles enable row level security;
create policy daily_puzzles_public_read on public.daily_puzzles for select to anon, authenticated using (true);

alter table public.daily_puzzle_scores enable row level security;
create policy daily_scores_public_read on public.daily_puzzle_scores for select to anon, authenticated using (true);

-- notification_devices : CRUD complet par le propriétaire.
alter table public.notification_devices enable row level security;
create policy notification_devices_owner on public.notification_devices
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================================
-- 18. Fonctions RPC (SECURITY DEFINER) — logique de jeu côté serveur
-- ============================================================================

-- complete_level : point d'entrée unique pour valider une victoire, recalculer
-- étoiles/pièces/XP, et écrire le ledger. Idempotent via client_attempt_id.
create or replace function public.complete_level(
  p_level_id bigint,
  p_moves smallint,
  p_time_ms integer,
  p_completed boolean,
  p_client_attempt_id text
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

  if p_completed and p_moves > v_level.move_limit then
    raise exception 'Tentative implausible : gestes (%) au-delà de la limite du niveau (%)', p_moves, v_level.move_limit;
  end if;

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

  v_stars := case
    when p_moves <= v_level.star_thresholds[2] then 3
    when p_moves <= v_level.star_thresholds[1] then 2
    else 1
  end;
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

grant execute on function public.complete_level(bigint, smallint, integer, boolean, text) to authenticated;

-- spend_coins : débit générique idempotent (indices, continuer une partie...).
create or replace function public.spend_coins(
  p_amount integer,
  p_reason public.coin_reason,
  p_metadata jsonb,
  p_client_attempt_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_event_key text;
  v_event_id bigint;
  v_balance integer;
  v_txn_id bigint;
begin
  if v_user_id is null then
    raise exception 'Authentification requise';
  end if;
  if p_amount <= 0 then
    raise exception 'p_amount doit être positif (le débit est appliqué automatiquement)';
  end if;

  v_event_key := format('spend:%s:%s:%s:%s', v_user_id, p_reason, p_client_attempt_id, p_amount);

  insert into public.reward_events (user_id, event_key, event_type)
  values (v_user_id, v_event_key, p_reason::text)
  on conflict (event_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select re.coin_transaction_id into v_txn_id from public.reward_events re where re.event_key = v_event_key;
    return jsonb_build_object('replayed', true, 'coin_transaction_id', v_txn_id);
  end if;

  select coins_balance into v_balance from public.profiles where id = v_user_id for update;

  if v_balance < p_amount then
    raise exception 'Solde insuffisant (% < %)', v_balance, p_amount;
  end if;

  v_balance := v_balance - p_amount;
  insert into public.coin_transactions (user_id, amount, reason, metadata, balance_after)
  values (v_user_id, -p_amount, p_reason, coalesce(p_metadata, '{}'::jsonb), v_balance)
  returning id into v_txn_id;

  update public.profiles set coins_balance = v_balance where id = v_user_id;
  update public.reward_events set coin_transaction_id = v_txn_id where id = v_event_id;

  return jsonb_build_object('balance', v_balance, 'coin_transaction_id', v_txn_id);
end;
$$;

grant execute on function public.spend_coins(integer, public.coin_reason, jsonb, text) to authenticated;

-- grant_ad_reward : crédit pour une publicité récompensée, plafonné par jour.
create or replace function public.grant_ad_reward(p_client_attempt_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_event_key text;
  v_event_id bigint;
  v_count_today integer;
  v_reward constant integer := 25;
  v_daily_cap constant integer := 5;
  v_balance integer;
  v_txn_id bigint;
begin
  if v_user_id is null then
    raise exception 'Authentification requise';
  end if;

  v_event_key := format('ad_reward:%s:%s', v_user_id, p_client_attempt_id);
  insert into public.reward_events (user_id, event_key, event_type)
  values (v_user_id, v_event_key, 'ad_reward')
  on conflict (event_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select re.coin_transaction_id into v_txn_id from public.reward_events re where re.event_key = v_event_key;
    return jsonb_build_object('replayed', true, 'coin_transaction_id', v_txn_id);
  end if;

  select count(*) into v_count_today from public.coin_transactions
    where user_id = v_user_id and reason = 'ad_reward' and created_at::date = current_date;

  if v_count_today >= v_daily_cap then
    raise exception 'Plafond quotidien de pubs récompensées atteint (%/%)', v_count_today, v_daily_cap;
  end if;

  select coins_balance into v_balance from public.profiles where id = v_user_id for update;
  v_balance := v_balance + v_reward;

  insert into public.coin_transactions (user_id, amount, reason, balance_after)
  values (v_user_id, v_reward, 'ad_reward', v_balance)
  returning id into v_txn_id;

  update public.profiles set coins_balance = v_balance where id = v_user_id;
  update public.reward_events set coin_transaction_id = v_txn_id where id = v_event_id;

  return jsonb_build_object('coins_earned', v_reward, 'balance', v_balance, 'coin_transaction_id', v_txn_id);
end;
$$;

grant execute on function public.grant_ad_reward(text) to authenticated;

-- claim_daily_bonus : bonus de série quotidienne (une fois par jour calendaire UTC).
create or replace function public.claim_daily_bonus()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_event_key text;
  v_event_id bigint;
  v_new_streak smallint;
  v_reward integer;
  v_balance integer;
  v_txn_id bigint;
begin
  if v_user_id is null then
    raise exception 'Authentification requise';
  end if;

  select * into v_profile from public.profiles where id = v_user_id for update;

  if v_profile.last_daily_bonus_claimed_date = current_date then
    raise exception 'Bonus quotidien déjà réclamé aujourd''hui';
  end if;

  v_event_key := format('daily_bonus:%s:%s', v_user_id, current_date);
  insert into public.reward_events (user_id, event_key, event_type)
  values (v_user_id, v_event_key, 'daily_bonus_claim')
  on conflict (event_key) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select re.coin_transaction_id into v_txn_id from public.reward_events re where re.event_key = v_event_key;
    return jsonb_build_object('replayed', true, 'coin_transaction_id', v_txn_id);
  end if;

  v_new_streak := case
    when v_profile.last_played_date = current_date - 1 then v_profile.current_streak + 1
    else 1
  end;

  -- Paliers repris de src/meta/daily.js (PALIERS) — à ajuster ici si le
  -- barème du jeu évolue, un seul endroit à changer côté serveur.
  v_reward := case
    when v_new_streak >= 30 then 125
    when v_new_streak >= 14 then 75
    when v_new_streak >= 7 then 50
    when v_new_streak >= 5 then 38
    when v_new_streak >= 3 then 25
    when v_new_streak >= 2 then 18
    else 12
  end;

  v_balance := v_profile.coins_balance + v_reward;
  insert into public.coin_transactions (user_id, amount, reason, metadata, balance_after)
  values (v_user_id, v_reward, 'streak_bonus', jsonb_build_object('streak', v_new_streak), v_balance)
  returning id into v_txn_id;

  update public.profiles
    set coins_balance = v_balance,
        current_streak = v_new_streak,
        last_daily_bonus_claimed_date = current_date
    where id = v_user_id;

  update public.reward_events set coin_transaction_id = v_txn_id where id = v_event_id;

  return jsonb_build_object('streak', v_new_streak, 'coins_earned', v_reward, 'balance', v_balance);
end;
$$;

grant execute on function public.claim_daily_bonus() to authenticated;

-- submit_daily_score : score du puzzle du jour, un seul (meilleur) par joueur/jour.
create or replace function public.submit_daily_score(
  p_puzzle_date date,
  p_mode_id smallint,
  p_moves smallint,
  p_time_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_puzzle public.daily_puzzles%rowtype;
  v_min_drags smallint;
  v_score integer;
  v_existing_score integer;
begin
  if v_user_id is null then
    raise exception 'Authentification requise';
  end if;

  select * into v_puzzle from public.daily_puzzles where puzzle_date = p_puzzle_date and mode_id = p_mode_id;
  if not found then
    raise exception 'Aucun niveau du jour pour cette date/mode';
  end if;

  v_min_drags := coalesce((v_puzzle.grid_snapshot ->> 'minDrags')::smallint, 1);
  v_score := greatest(100, 1000 - (p_moves - v_min_drags) * 25 - round(p_time_ms / 1000.0) * 2);

  select score into v_existing_score from public.daily_puzzle_scores
    where puzzle_date = p_puzzle_date and mode_id = p_mode_id and user_id = v_user_id;

  if v_existing_score is not null and v_existing_score >= v_score then
    return jsonb_build_object('score', v_existing_score, 'improved', false);
  end if;

  insert into public.daily_puzzle_scores (puzzle_date, mode_id, user_id, score, moves, time_ms)
  values (p_puzzle_date, p_mode_id, v_user_id, v_score, p_moves, p_time_ms)
  on conflict (puzzle_date, mode_id, user_id) do update set
    score = excluded.score, moves = excluded.moves, time_ms = excluded.time_ms, submitted_at = now();

  return jsonb_build_object('score', v_score, 'improved', true);
end;
$$;

grant execute on function public.submit_daily_score(date, smallint, smallint, integer) to authenticated;

-- select_daily_puzzle : sélection automatique (pg_cron) ou forçage admin.
create or replace function public.select_daily_puzzle(
  p_date date,
  p_mode_id smallint,
  p_level_id bigint default null,
  p_community_level_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_level public.levels%rowtype;
  v_community public.community_levels%rowtype;
  v_is_admin_call boolean := p_level_id is not null or p_community_level_id is not null;
begin
  if v_is_admin_call and not public.is_admin() then
    raise exception 'Seul un administrateur peut forcer le niveau du jour';
  end if;

  if p_community_level_id is not null then
    select * into v_community from public.community_levels
      where id = p_community_level_id and status in ('approved', 'published');
    if not found then
      raise exception 'Niveau communautaire introuvable ou non approuvé';
    end if;
    insert into public.daily_puzzles (puzzle_date, mode_id, source_type, community_level_id, grid_snapshot, selected_by, selected_by_admin)
    values (p_date, p_mode_id, 'community_level', p_community_level_id, v_community.grid, 'admin', auth.uid())
    on conflict (puzzle_date, mode_id) do update set
      source_type = excluded.source_type, level_id = null, community_level_id = excluded.community_level_id,
      grid_snapshot = excluded.grid_snapshot, selected_by = excluded.selected_by, selected_by_admin = excluded.selected_by_admin;
    return;
  end if;

  if p_level_id is not null then
    select * into v_level from public.levels where id = p_level_id and status = 'published';
    if not found then
      raise exception 'Niveau introuvable ou non publié';
    end if;
  else
    -- Sélection automatique : au hasard parmi les niveaux éligibles non joués
    -- comme niveau du jour dans les 60 derniers jours.
    select * into v_level from public.levels
      where status = 'published' and eligible_for_daily and mode_id = p_mode_id
        and id not in (
          select level_id from public.daily_puzzles
          where mode_id = p_mode_id and level_id is not null and puzzle_date >= p_date - interval '60 days'
        )
      order by random()
      limit 1;
    if not found then
      raise exception 'Aucun niveau éligible trouvé pour le niveau du jour du %', p_date;
    end if;
  end if;

  -- grid_snapshot regroupe la grille (gates/blocks/solution) ET les métadonnées
  -- de calibration (minDrags/moveLimit/starDrags), mêmes clés que le JSON de
  -- niveau déjà utilisé par le client — c'est ce que lit submit_daily_score().
  insert into public.daily_puzzles (puzzle_date, mode_id, source_type, level_id, grid_snapshot, selected_by, selected_by_admin)
  values (
    p_date, p_mode_id, 'official_level', v_level.id,
    v_level.grid || jsonb_build_object(
      'levelId', v_level.level_code, 'width', v_level.width, 'height', v_level.height,
      'colorCount', v_level.color_count, 'moveLimit', v_level.move_limit,
      'timeLimit', v_level.time_limit, 'minDrags', v_level.min_drags,
      'starDrags', v_level.star_thresholds, 'objective', v_level.objective
    ),
    case when p_level_id is not null then 'admin' else 'auto' end,
    case when p_level_id is not null then auth.uid() else null end
  )
  on conflict (puzzle_date, mode_id) do update set
    source_type = excluded.source_type, level_id = excluded.level_id, community_level_id = null,
    grid_snapshot = excluded.grid_snapshot, selected_by = excluded.selected_by, selected_by_admin = excluded.selected_by_admin;
end;
$$;

grant execute on function public.select_daily_puzzle(date, smallint, bigint, uuid) to authenticated;

-- ============================================================================
-- 19. Données de départ
-- ============================================================================
insert into public.game_modes (code, name, sort_order) values
  ('classic', '{"fr": "Classique", "en": "Classic"}'::jsonb, 0),
  ('daily', '{"fr": "Niveau du jour", "en": "Daily puzzle"}'::jsonb, 1),
  ('community', '{"fr": "Créations", "en": "Community"}'::jsonb, 2);

-- pg_cron (à activer dans Database > Extensions si nécessaire) :
-- select cron.schedule('daily-puzzle-selection', '5 0 * * *',
--   $$select public.select_daily_puzzle(current_date, (select id from public.game_modes where code = 'daily'));$$);
