-- Tipsligaen: databaseskema til Supabase
-- Kør hele filen én gang i Supabase > SQL Editor.

-- ---------- Tabeller ----------
create table if not exists public.matches (
  id          text primary key,              -- kamp-id fra football-data.org
  round       int  not null,                 -- runde (matchday)
  home        text not null,
  away        text not null,
  home_crest  text,
  away_crest  text,
  kickoff     timestamptz not null,
  status      text not null default 'SCHEDULED',
  home_goals  int,
  away_goals  int,
  manual      boolean not null default false, -- true = resultat indtastet manuelt, overskrives ikke af synkronisering
  updated_at  timestamptz not null default now()
);
create index if not exists matches_round_idx   on public.matches(round);
create index if not exists matches_kickoff_idx on public.matches(kickoff);

create table if not exists public.players (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  nick      text not null check (char_length(nick) between 1 and 24),
  is_admin  boolean not null default false,
  joined_at timestamptz not null default now()
);

create table if not exists public.tips (
  user_id    uuid not null references public.players(user_id) on delete cascade,
  match_id   text not null references public.matches(id) on delete cascade,
  home       int  not null check (home between 0 and 30),
  away       int  not null check (away between 0 and 30),
  updated_at timestamptz not null default now(),
  primary key (user_id, match_id)
);
create index if not exists tips_match_idx on public.tips(match_id);

create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references public.players(user_id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.reminders_sent (
  user_id  uuid not null references public.players(user_id) on delete cascade,
  match_id text not null references public.matches(id) on delete cascade,
  sent_at  timestamptz not null default now(),
  primary key (user_id, match_id)
);

create table if not exists public.settings (
  id          int primary key default 1 check (id = 1),
  invite_code text not null
);
insert into public.settings (id, invite_code)
values (1, upper(substr(md5(random()::text), 1, 6)))
on conflict (id) do nothing;

-- ---------- Hjælpefunktioner ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from players where user_id = auth.uid() and is_admin);
$$;

create or replace function public.match_started(mid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from matches where id = mid and kickoff <= now());
$$;

-- Højst 10 spillere. Den første spiller bliver automatisk administrator.
create or replace function public.players_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from players) >= 10 then
    raise exception 'Turneringen er fuld (10 spillere)';
  end if;
  new.is_admin  := not exists (select 1 from players);
  new.joined_at := now();
  return new;
end $$;
drop trigger if exists players_bi on public.players;
create trigger players_bi before insert on public.players
for each row execute function public.players_before_insert();

-- Spillere kan kun ændre deres eget navn, ikke gøre sig selv til administrator.
create or replace function public.players_before_update() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.is_admin  := old.is_admin;
    new.user_id   := old.user_id;
    new.joined_at := old.joined_at;
  end if;
  return new;
end $$;
drop trigger if exists players_bu on public.players;
create trigger players_bu before update on public.players
for each row execute function public.players_before_update();

-- Tilmelding kræver invitationskoden.
create or replace function public.join_league(p_nick text, p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Du er ikke logget ind'; end if;
  if upper(trim(p_code)) is distinct from (select upper(invite_code) from settings where id = 1) then
    raise exception 'Forkert invitationskode';
  end if;
  if exists (select 1 from players where user_id = auth.uid()) then
    update players set nick = trim(p_nick) where user_id = auth.uid();
  else
    insert into players (user_id, nick) values (auth.uid(), trim(p_nick));
  end if;
end $$;

-- Administratoren kan se invitationskoden i appen.
create or replace function public.get_invite_code() returns text
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then (select invite_code from settings where id = 1) end;
$$;

revoke execute on function public.join_league(text, text) from public, anon;
revoke execute on function public.get_invite_code() from public, anon;
grant  execute on function public.join_league(text, text) to authenticated;
grant  execute on function public.get_invite_code() to authenticated;

-- ---------- Adgangsregler (RLS) ----------
alter table public.matches            enable row level security;
alter table public.players            enable row level security;
alter table public.tips               enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminders_sent     enable row level security;
alter table public.settings           enable row level security;

drop policy if exists "matches read"         on public.matches;
drop policy if exists "matches admin update" on public.matches;
create policy "matches read" on public.matches for select to authenticated using (true);
create policy "matches admin update" on public.matches for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "players read"   on public.players;
drop policy if exists "players rename" on public.players;
create policy "players read" on public.players for select to authenticated using (true);
create policy "players rename" on public.players for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Tips: egne tips altid synlige, de andres først fra kampstart. Ændringer kun før kampstart.
drop policy if exists "tips read"   on public.tips;
drop policy if exists "tips insert" on public.tips;
drop policy if exists "tips update" on public.tips;
drop policy if exists "tips delete" on public.tips;
create policy "tips read" on public.tips for select to authenticated
  using (user_id = auth.uid() or public.match_started(match_id));
create policy "tips insert" on public.tips for insert to authenticated
  with check (user_id = auth.uid() and not public.match_started(match_id));
create policy "tips update" on public.tips for update to authenticated
  using (user_id = auth.uid() and not public.match_started(match_id))
  with check (user_id = auth.uid() and not public.match_started(match_id));
create policy "tips delete" on public.tips for delete to authenticated
  using (user_id = auth.uid() and not public.match_started(match_id));

drop policy if exists "push own" on public.push_subscriptions;
create policy "push own" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- reminders_sent og settings har ingen regler: kun serverfunktionerne kan læse og skrive dem.

-- ---------- Point ----------
-- 100 point for rigtigt ciffertip, 20 for rigtigt udfald, ellers 0. Kun færdigspillede kampe tæller.
create or replace view public.round_scores as
select
  t.user_id,
  m.round,
  sum(case
        when t.home = m.home_goals and t.away = m.away_goals then 100
        when sign(t.home - t.away) = sign(m.home_goals - m.away_goals) then 20
        else 0 end)::int as points,
  (count(*) filter (where t.home = m.home_goals and t.away = m.away_goals))::int as exact,
  (count(*) filter (where not (t.home = m.home_goals and t.away = m.away_goals)
                      and sign(t.home - t.away) = sign(m.home_goals - m.away_goals)))::int as outcome,
  count(*)::int as tips
from public.tips t
join public.matches m on m.id = t.match_id
where m.status in ('FINISHED', 'AWARDED') and m.home_goals is not null and m.away_goals is not null
group by t.user_id, m.round;

create or replace view public.round_status as
select
  round,
  count(*)::int as total,
  (count(*) filter (where status in ('FINISHED', 'AWARDED')))::int as finished,
  (count(*) filter (where status in ('POSTPONED', 'CANCELLED', 'SUSPENDED')))::int as postponed,
  min(kickoff) as first_kickoff,
  max(kickoff) as last_kickoff
from public.matches
group by round;

revoke all on public.round_scores, public.round_status from anon;
grant select on public.round_scores, public.round_status to authenticated;
