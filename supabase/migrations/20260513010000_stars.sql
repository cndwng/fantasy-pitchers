create table public.user_pitcher_stars (
  user_id           uuid not null references public.users(id) on delete cascade,
  pitcher_name_norm text not null,
  created_at        timestamptz not null default now(),
  primary key (user_id, pitcher_name_norm)
);
create index user_pitcher_stars_user_idx on public.user_pitcher_stars (user_id);
