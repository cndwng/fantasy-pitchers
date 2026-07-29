create extension if not exists pgcrypto;

create table public.users (
  id           uuid primary key default gen_random_uuid(),
  yahoo_guid   text unique not null,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

create table public.yahoo_tokens (
  user_id        uuid primary key references public.users(id) on delete cascade,
  access_token   text not null,
  refresh_token  text not null,
  expires_at     timestamptz not null,
  updated_at     timestamptz not null default now()
);

create table public.user_selections (
  user_id     uuid primary key references public.users(id) on delete cascade,
  league_key  text not null,
  team_key    text not null,
  league_name text,
  team_name   text,
  updated_at  timestamptz not null default now()
);

create table public.pitchers (
  name_norm   text primary key,
  name        text not null,
  team        text,
  schedule    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create table public.col_dates (
  date  text primary key,
  day   text not null,
  ord   smallint not null
);
create index col_dates_ord_idx on public.col_dates (ord);

create type public.pitcher_status as enum ('roster', 'available');

create table public.user_pitcher_status (
  user_id            uuid not null references public.users(id) on delete cascade,
  pitcher_name_norm  text not null,
  status             public.pitcher_status not null,
  yahoo_player_key   text,
  synced_at          timestamptz not null default now(),
  primary key (user_id, pitcher_name_norm)
);
create index user_pitcher_status_user_idx on public.user_pitcher_status (user_id);
