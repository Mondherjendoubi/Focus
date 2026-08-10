-- =====================================================================
-- 02_social.sql — friendships and friend-visible aggregates (FA-018)
--
-- RUN THIS IN THE SUPABASE SQL EDITOR BEFORE THE SOCIAL UI WILL WORK.
-- Idempotent: safe to run more than once.
--
-- ---------------------------------------------------------------------
-- THE DESIGN RULE THIS FILE EXISTS TO PROTECT
--
-- Every existing policy in 01_schema.sql is `for all using (user_id =
-- auth.uid())`, and all 59 queries in the app rely on RLS being the ONLY
-- filter — not one of them writes `.eq('user_id', ...)`. Every analytics view
-- is `security_invoker = on` and inherits the same rule.
--
-- So widening those policies to "mine OR my friend's" would silently fold a
-- friend's rows into every total the app renders, and because the policies are
-- `for all` rather than `for select`, it would hand friends WRITE access too.
--
-- Nothing below touches an existing policy. Friend data is reachable only
-- through the `security definer` functions at the bottom, each of which checks
-- for an accepted friendship first and returns aggregates only — never a topic
-- name, session title, or note.
--
-- Those functions query BASE TABLES rather than the `v_*` views on purpose:
-- a `security_invoker` view still resolves `auth.uid()` to the *caller*, so
-- reading a view inside a definer function would return the caller's own rows
-- and quietly report your numbers as your friend's.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Handles — how someone gets found without exposing their email
-- ---------------------------------------------------------------------

alter table profiles add column if not exists username text;

do $$
begin
  alter table profiles add constraint profiles_username_format
    check (username is null or username ~ '^[a-z0-9_]{3,20}$');
exception
  when duplicate_object then null;
end $$;

-- Partial: a null username is "not discoverable", and any number of users may
-- be undiscoverable. Only claimed handles have to be distinct.
create unique index if not exists profiles_username_unique
  on profiles (username) where username is not null;


-- ---------------------------------------------------------------------
-- 2. Friendships
-- ---------------------------------------------------------------------

do $$
begin
  create type friendship_status as enum ('pending', 'accepted');
exception
  when duplicate_object then null;
end $$;

create table if not exists friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles(id) on delete cascade,
  addressee_id uuid not null references profiles(id) on delete cascade,
  status       friendship_status not null default 'pending',
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  constraint friendships_not_self check (requester_id <> addressee_id)
);

-- One edge per PAIR, in either direction — so A→B and B→A cannot both exist
-- and the two of you can never end up with two disagreeing rows.
create unique index if not exists friendships_unique_pair
  on friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create index if not exists friendships_addressee_idx on friendships (addressee_id, status);
create index if not exists friendships_requester_idx on friendships (requester_id, status);


-- ---------------------------------------------------------------------
-- 3. RLS on friendships — narrow, and split by command on purpose
-- ---------------------------------------------------------------------

alter table friendships enable row level security;

drop policy if exists "see own friendships"  on friendships;
drop policy if exists "send friend request"  on friendships;
drop policy if exists "addressee responds"   on friendships;
drop policy if exists "either party removes" on friendships;

-- You can see an edge only if you are one of its two ends.
create policy "see own friendships" on friendships
  for select using (auth.uid() in (requester_id, addressee_id));

-- You may only create a request as yourself, and only as pending. Inserting a
-- row already marked accepted would be self-approval.
create policy "send friend request" on friendships
  for insert with check (requester_id = auth.uid() and status = 'pending');

-- ONLY the addressee may update. If the requester could update, they could
-- accept their own request.
create policy "addressee responds" on friendships
  for update using (addressee_id = auth.uid())
  with check (addressee_id = auth.uid());

-- Decline, cancel and unfriend are all the same operation: delete the edge.
create policy "either party removes" on friendships
  for delete using (auth.uid() in (requester_id, addressee_id));


-- ---------------------------------------------------------------------
-- 4. Guard trigger — defence in depth behind the update policy
--
-- The update policy pins `addressee_id` to the caller but says nothing about
-- the other columns. Without this, an addressee could rewrite `requester_id`
-- to a third party and mint an accepted friendship with someone who never
-- agreed to one — which would hand them that person's aggregates.
-- ---------------------------------------------------------------------

create or replace function friendships_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.requester_id <> old.requester_id or new.addressee_id <> old.addressee_id then
    raise exception 'friendship parties are immutable';
  end if;

  if new.status = 'accepted' and old.status <> 'accepted' then
    if auth.uid() <> old.addressee_id then
      raise exception 'only the addressee can accept a request';
    end if;
    new.responded_at := now();
  end if;

  return new;
end $$;

drop trigger if exists friendships_guard_trg on friendships;
create trigger friendships_guard_trg
  before update on friendships
  for each row execute function friendships_guard();


-- ---------------------------------------------------------------------
-- 5. Discovery — exact handle lookup only
--
-- `profiles` RLS hides every other user, so a client-side search cannot work.
-- This is the sanctioned window: EXACT match only (no prefix or fuzzy search,
-- which would let someone enumerate the whole user table), and it returns only
-- the three fields needed to render "is this the right person?".
-- ---------------------------------------------------------------------

create or replace function find_profile_by_username(p_username text)
returns table (id uuid, username text, display_name text)
language sql security definer set search_path = public stable as $$
  select p.id, p.username, p.display_name
  from profiles p
  where auth.uid() is not null
    and p.username = lower(trim(p_username))
    and p.id <> auth.uid()
  limit 1
$$;


-- ---------------------------------------------------------------------
-- 6. My friends and pending requests, with the names attached
-- ---------------------------------------------------------------------

create or replace function my_friends()
returns table (
  friendship_id uuid,
  friend_id     uuid,
  username      text,
  display_name  text,
  status        friendship_status,
  -- 'friend' once accepted; otherwise which way the pending request points.
  direction     text,
  created_at    timestamptz
)
language sql security definer set search_path = public stable as $$
  select f.id,
         other.id,
         other.username,
         other.display_name,
         f.status,
         case
           when f.status = 'accepted'        then 'friend'
           when f.requester_id = auth.uid()  then 'outgoing'
           else 'incoming'
         end,
         f.created_at
  from friendships f
  join profiles other
    on other.id = case when f.requester_id = auth.uid()
                       then f.addressee_id else f.requester_id end
  where auth.uid() in (f.requester_id, f.addressee_id)
  order by f.status, f.created_at desc
$$;


-- ---------------------------------------------------------------------
-- 7. Friend aggregates — the only window onto someone else's data
--
-- Returns NOTHING without an accepted friendship. Aggregates only: no topic
-- names, no session titles, no notes, no per-session rows.
--
-- Day windows use the FRIEND's timezone and their server-stamped `local_day`,
-- so their week is their week and not the caller's.
-- ---------------------------------------------------------------------

create or replace function friend_stats(p_friend_id uuid)
returns table (
  week_seconds      bigint,
  prev_week_seconds bigint,
  current_streak    int,
  longest_streak    int,
  goal_days_hit     int,
  active_days       int
)
language plpgsql security definer set search_path = public stable as $$
declare
  v_today date;
  v_goal  int;
begin
  if auth.uid() is null then
    return;
  end if;

  -- The gate. Everything below is unreachable without this.
  if not exists (
    select 1 from friendships f
    where f.status = 'accepted'
      and least(f.requester_id, f.addressee_id)    = least(auth.uid(), p_friend_id)
      and greatest(f.requester_id, f.addressee_id) = greatest(auth.uid(), p_friend_id)
  ) then
    return;
  end if;

  select (now() at time zone p.timezone)::date, p.daily_goal_minutes
    into v_today, v_goal
  from profiles p
  where p.id = p_friend_id;

  if v_today is null then
    return;
  end if;

  return query
  with daily as (
    select b.local_day,
           coalesce(sum(b.net_seconds) filter (where b.kind = 'focus'), 0)::bigint as focus_seconds
    from session_blocks b
    where b.user_id = p_friend_id
      and b.ended_at is not null
    group by b.local_day
  ),
  -- Same gaps-and-islands as v_streaks. Repeated rather than reused because
  -- v_streaks is security_invoker and would resolve to the CALLER in here.
  islands as (
    select d.local_day,
           d.local_day - (row_number() over (order by d.local_day))::int as grp
    from daily d
    where d.focus_seconds > 0
  ),
  runs as (
    select grp, max(local_day) as end_day, count(*)::int as len
    from islands
    group by grp
  )
  select
    (select coalesce(sum(focus_seconds), 0)::bigint from daily
      where local_day >  v_today - 7  and local_day <= v_today),
    (select coalesce(sum(focus_seconds), 0)::bigint from daily
      where local_day >  v_today - 14 and local_day <= v_today - 7),
    (select coalesce(max(len) filter (where end_day >= v_today - 1), 0) from runs),
    (select coalesce(max(len), 0) from runs),
    -- A zero daily goal is "no goal", not "a goal met every day".
    (select count(*)::int from daily
      where v_goal > 0
        and local_day > v_today - 7 and local_day <= v_today
        and focus_seconds / 60.0 >= v_goal),
    (select count(*)::int from daily
      where local_day > v_today - 7 and local_day <= v_today and focus_seconds > 0);
end $$;


-- ---------------------------------------------------------------------
-- 8. Grants — these functions are the API; the tables behind them are not
-- ---------------------------------------------------------------------

revoke all on function find_profile_by_username(text) from public;
revoke all on function my_friends()                   from public;
revoke all on function friend_stats(uuid)             from public;

grant execute on function find_profile_by_username(text) to authenticated;
grant execute on function my_friends()                   to authenticated;
grant execute on function friend_stats(uuid)             to authenticated;
