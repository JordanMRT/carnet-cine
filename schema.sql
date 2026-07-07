-- ============================================
-- SCHEMA — à exécuter dans Supabase > SQL Editor
-- ============================================

-- Bibliothèque (à voir / en cours / terminé / abandonné)
create table if not exists library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  tmdb_id bigint not null,
  media_type text not null check (media_type in ('movie', 'tv')),
  title text not null,
  poster_path text,
  status text not null check (status in ('watchlist', 'watching', 'completed', 'dropped')),
  added_at timestamptz default now(),
  updated_at timestamptz default now(),
  first_watched_date date,
  last_watched_date date,
  watch_count int default 0,
  watched_episodes int default 0,
  total_episodes int default 0,
  total_seasons int default 0,
  progress numeric(5,1) default 0,
  tmdb_last_sync timestamptz,
  unique (user_id, tmdb_id, media_type)
);

-- Migration : si tu avais déjà créé la table library avant l'ajout de la
-- progression, exécute ces lignes pour ajouter les colonnes manquantes
-- (sans danger si elles existent déjà) :
alter table library add column if not exists first_watched_date date;
alter table library add column if not exists last_watched_date date;
alter table library add column if not exists watch_count int default 0;
alter table library add column if not exists watched_episodes int default 0;
alter table library add column if not exists total_episodes int default 0;
alter table library add column if not exists total_seasons int default 0;
alter table library add column if not exists progress numeric(5,1) default 0;
alter table library add column if not exists tmdb_last_sync timestamptz;

-- Journal de visionnage (chaque "ticket")
create table if not exists diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  tmdb_id bigint,
  media_type text not null check (media_type in ('movie', 'tv')),
  title text not null,
  poster_path text,
  season int,
  episode int,
  watched_date date not null,
  rating numeric(3,1) check (rating >= 0 and rating <= 10),
  rewatch boolean default false,
  note text,
  genres text[] default '{}',
  runtime_minutes int,
  created_at timestamptz default now()
);

-- Badges obtenus
create table if not exists badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  badge_key text not null,
  earned_at timestamptz default now(),
  unique (user_id, badge_key)
);

-- Index utiles
create index if not exists idx_library_user on library(user_id);
create index if not exists idx_diary_user on diary_entries(user_id);
create index if not exists idx_diary_watched_date on diary_entries(watched_date);
create index if not exists idx_badges_user on badges(user_id);

-- ============================================
-- ROW LEVEL SECURITY — chacun ne voit que ses données
-- ============================================
alter table library enable row level security;
alter table diary_entries enable row level security;
alter table badges enable row level security;

drop policy if exists "Users manage their own library" on library;
create policy "Users manage their own library"
  on library for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage their own diary" on diary_entries;
create policy "Users manage their own diary"
  on diary_entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users manage their own badges" on badges;
create policy "Users manage their own badges"
  on badges for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
