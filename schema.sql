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
  avg_rating numeric(3,1),
  last_note text,
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
alter table library add column if not exists avg_rating numeric(3,1);
alter table library add column if not exists last_note text;
alter table diary_entries add column if not exists air_date date;

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
  air_date date,
  created_at timestamptz default now()
);

-- Notes (par série/saison/épisodes)

alter table library add column if not exists series_rating numeric(3,1);

-- Préserve la note actuelle de chaque utilisateur : la valeur de avg_rating
-- aujourd'hui correspond exactement à ce qu'ils ont cliqué sur "Ta note"
-- (le mécanisme actuel écrasait toutes les entrées à cette même valeur).
update library
set series_rating = avg_rating
where avg_rating is not null;

-- Badges obtenus
create table if not exists badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  badge_key text not null,
  tier int default 1,
  earned_at timestamptz default now(),
  unique (user_id, badge_key)
);

alter table badges add column if not exists tier int default 1;

-- Profils publics (recherche, pages profil, réglages de confidentialité)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  avatar_path text,
  avatar_url text,
  banner_path text,
  is_searchable boolean not null default false,
  visibility text not null default 'followers' check (visibility in ('public', 'followers', 'private')),
  updated_at timestamptz default now()
);

-- Relations d'abonnement (suivi mutuel auto à l'acceptation, cf. js/supabase-client.js)
create table if not exists follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid references auth.users(id) on delete cascade not null,
  followed_id uuid references auth.users(id) on delete cascade not null,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz default now(),
  unique (follower_id, followed_id)
);

-- Abonnements Web Push (VAPID)
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now(),
  unique (user_id, endpoint)
);

-- Verrou anti-doublon pour les notifications de sortie (send-release-notifications,
-- 5 runs cron/jour) : une ligne insérée avec succès = notif à envoyer, un échec
-- (contrainte unique violée) = déjà envoyée aujourd'hui pour cet élément.
create table if not exists sent_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  media_type text not null check (media_type in ('movie', 'tv')),
  tmdb_id bigint not null,
  season int,
  episode int,
  sent_date date not null,
  created_at timestamptz default now()
);

-- Films et séries favoris
create table if not exists favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  tmdb_id bigint not null,
  media_type text not null check (media_type in ('movie', 'tv')),
  created_at timestamptz default now(),
  unique (user_id, tmdb_id, media_type)
);

-- Activer la sécurité au niveau des lignes pour la table favorites
alter table favorites enable row level security;

drop policy if exists "Users manage their own favorites" on favorites;
create policy "Users manage their own favorites"
  on favorites for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Index utiles
create index if not exists idx_library_user on library(user_id);
create index if not exists idx_diary_user on diary_entries(user_id);
create index if not exists idx_diary_watched_date on diary_entries(watched_date);
create index if not exists idx_badges_user on badges(user_id);
create index if not exists idx_follows_follower on follows(follower_id);
create index if not exists idx_follows_followed on follows(followed_id);
create index if not exists idx_push_subscriptions_user on push_subscriptions(user_id);

-- IMPORTANT : index unique sur sent_notifications avec coalesce(season/episode, -1).
-- Un film a toujours season/episode à NULL, et PostgreSQL ne considère jamais deux
-- NULL comme égaux dans une contrainte unique classique — sans ce coalesce, le
-- dédoublonnage ne bloquerait jamais les notifications de films (seulement les
-- épisodes de séries), permettant un envoi en double à chacun des 5 runs cron/jour.
create unique index if not exists idx_sent_notifications_dedup
  on sent_notifications (user_id, media_type, tmdb_id, coalesce(season, -1), coalesce(episode, -1), sent_date);

-- ============================================
-- ROW LEVEL SECURITY — chacun ne voit que ses données
-- ============================================
alter table library enable row level security;
alter table diary_entries enable row level security;
alter table badges enable row level security;
alter table profiles enable row level security;
alter table follows enable row level security;
alter table push_subscriptions enable row level security;
alter table sent_notifications enable row level security;

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

-- Profils : tout le monde peut lire (recherche + pages profil publiques),
-- mais chacun ne modifie que le sien. La confidentialité fine (qui voit
-- la bibliothèque/stats de qui) est gérée côté application via la colonne
-- `visibility`, pas par RLS — la ligne de profil elle-même reste lisible
-- pour permettre la recherche par pseudo.
drop policy if exists "Profiles are publicly readable" on profiles;
create policy "Profiles are publicly readable"
  on profiles for select
  using (true);

drop policy if exists "Users manage their own profile" on profiles;
create policy "Users manage their own profile"
  on profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Users update their own profile" on profiles;
create policy "Users update their own profile"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Follows : chacun voit les relations où il apparaît (comme follower ou
-- comme followed, pour afficher les demandes reçues), et ne peut créer/
-- modifier/supprimer que les lignes où il est le follower — sauf pour le
-- suivi mutuel automatique à l'acceptation, qui insère une ligne où
-- l'utilisateur courant est le followed (cf. respondToRequest côté client).
drop policy if exists "Users view their own follow relations" on follows;
create policy "Users view their own follow relations"
  on follows for select
  using (auth.uid() = follower_id or auth.uid() = followed_id);

drop policy if exists "Users create follow requests" on follows;
create policy "Users create follow requests"
  on follows for insert
  with check (auth.uid() = follower_id or auth.uid() = followed_id);

drop policy if exists "Users update their own follow relations" on follows;
create policy "Users update their own follow relations"
  on follows for update
  using (auth.uid() = follower_id or auth.uid() = followed_id)
  with check (auth.uid() = follower_id or auth.uid() = followed_id);

drop policy if exists "Users delete their own follow relations" on follows;
create policy "Users delete their own follow relations"
  on follows for delete
  using (auth.uid() = follower_id or auth.uid() = followed_id);

drop policy if exists "Users manage their own push subscriptions" on push_subscriptions;
create policy "Users manage their own push subscriptions"
  on push_subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- sent_notifications : écrite uniquement par l'Edge Function via la clé
-- service_role (qui bypass RLS) — aucune policy client nécessaire, RLS
-- activée seule suffit à bloquer tout accès direct depuis le navigateur.

-- ---------- WRAPPED : verrou anti-doublon de la notif annuelle ----------
-- Séparée de sent_notifications plutôt que d'y ajouter media_type='wrapped',
-- car cette dernière a une contrainte CHECK (media_type in ('movie','tv'))
-- qu'on préfère ne pas toucher sur une table déjà en prod. Clé primaire
-- (user_id, year) = le verrou lui-même, un seul envoi possible par
-- utilisateur et par année, quel que soit le nombre de passages du cron
-- dans la journée du 30 décembre.
create table if not exists wrapped_notifications_sent (
  user_id uuid references auth.users(id) on delete cascade not null,
  year int not null,
  sent_at timestamptz default now(),
  primary key (user_id, year)
);

alter table wrapped_notifications_sent enable row level security;
-- Même raisonnement que sent_notifications : écrite uniquement par
-- l'Edge Function via service_role, RLS activée sans policy = accès
-- client direct bloqué.