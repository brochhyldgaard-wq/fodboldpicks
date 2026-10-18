-- Tipsligaen: Premier League-tabel, topscorere og indbyrdes opgør
-- Kør hele filen én gang i Supabase > SQL Editor.

create table if not exists public.pl_standings (
  team          text primary key,
  position      int  not null,
  crest         text,
  played        int,
  won           int,
  draw          int,
  lost          int,
  points        int,
  goals_for     int,
  goals_against int,
  goal_diff     int,
  updated_at    timestamptz not null default now()
);

create table if not exists public.pl_scorers (
  rank       int primary key,
  player     text not null,
  team       text,
  crest      text,
  goals      int,
  assists    int,
  penalties  int,
  played     int,
  updated_at timestamptz not null default now()
);

create table if not exists public.pl_h2h (
  match_id   text primary key references public.matches(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.pl_standings enable row level security;
alter table public.pl_scorers   enable row level security;
alter table public.pl_h2h       enable row level security;

drop policy if exists "pl_standings read" on public.pl_standings;
drop policy if exists "pl_scorers read"   on public.pl_scorers;
drop policy if exists "pl_h2h read"       on public.pl_h2h;
create policy "pl_standings read" on public.pl_standings for select to authenticated using (true);
create policy "pl_scorers read"   on public.pl_scorers   for select to authenticated using (true);
create policy "pl_h2h read"       on public.pl_h2h       for select to authenticated using (true);
-- Kun serverfunktionerne skriver i tabellerne.
