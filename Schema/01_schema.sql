-- =====================================================================
-- FOCUS / STUDY TRACKER — PostgreSQL schema for Supabase
-- ---------------------------------------------------------------------
-- Model in one line:
--   topic  ──<  session  ──<  session_block  ──<  block_pause
--   session_template ──< session_template_block   (the reusable plan)
--
-- The atomic fact for ALL analytics is `session_block`: one continuous
-- stretch of time (started_at → ended_at) attributed to one topic.
-- Everything else (daily totals, streaks, heatmaps) is derived from it.
--
-- Paste top-to-bottom into the Supabase SQL editor.
-- =====================================================================

create extension if not exists pgcrypto;    -- gen_random_uuid()
create extension if not exists btree_gist;  -- uuid in exclusion constraints


-- =====================================================================
-- 1. ENUMS
-- =====================================================================

do $$ begin
  create type block_kind      as enum ('focus', 'short_break', 'long_break');
exception when duplicate_object then null; end $$;

do $$ begin
  create type session_status  as enum ('active', 'completed', 'abandoned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type goal_period     as enum ('daily', 'weekly', 'monthly');
exception when duplicate_object then null; end $$;


-- =====================================================================
-- 2. SHARED TRIGGER HELPERS
-- =====================================================================

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;


-- =====================================================================
-- 3. PROFILE
-- ---------------------------------------------------------------------
-- Timezone lives here because "how much did I study on Tuesday?" is a
-- question about the user's local day, not UTC.
-- =====================================================================

create table if not exists profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  display_name        text,
  timezone            text        not null default 'Europe/Berlin',
  daily_goal_minutes  int         not null default 120 check (daily_goal_minutes >= 0),
  week_starts_on      int         not null default 1 check (week_starts_on between 1 and 7), -- ISO: 1 = Monday
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- Auto-create a profile row when a user signs up.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- =====================================================================
-- 4. TOPICS  (self-referencing → supports sub-topics, e.g. Java > JVM)
-- =====================================================================

create table if not exists topics (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  parent_id   uuid references topics(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  color       text not null default '#6366f1' check (color ~* '^#[0-9a-f]{6}$'),
  icon        text,
  description text,
  position    int  not null default 0,           -- manual ordering in the UI
  archived_at timestamptz,                       -- soft delete: keeps history intact
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Same name allowed under different parents, not under the same one.
create unique index if not exists topics_unique_name
  on topics (user_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index if not exists topics_user_idx   on topics (user_id) where archived_at is null;
create index if not exists topics_parent_idx on topics (parent_id);

create trigger topics_updated_at
  before update on topics
  for each row execute function set_updated_at();

-- Guard: a topic cannot become its own ancestor.
create or replace function check_topic_cycle()
returns trigger language plpgsql as $$
declare cur uuid := new.parent_id; depth int := 0;
begin
  while cur is not null loop
    if cur = new.id then
      raise exception 'Topic hierarchy cycle detected for topic %', new.id;
    end if;
    depth := depth + 1;
    if depth > 20 then raise exception 'Topic hierarchy too deep'; end if;
    select parent_id into cur from topics where id = cur;
  end loop;
  return new;
end $$;

create trigger topics_no_cycle
  before insert or update of parent_id on topics
  for each row when (new.parent_id is not null)
  execute function check_topic_cycle();


-- =====================================================================
-- 5. SESSION TEMPLATES  (the reusable plan: "Deep Work 90", "Pomodoro x4")
-- =====================================================================

create table if not exists session_templates (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles(id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  description      text,
  default_topic_id uuid references topics(id) on delete set null,
  is_favorite      boolean not null default false,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists templates_user_idx on session_templates (user_id) where archived_at is null;

create trigger session_templates_updated_at
  before update on session_templates
  for each row execute function set_updated_at();

-- The ordered steps of a template: focus 25 → break 5 → focus 25 → ...
create table if not exists session_template_blocks (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references session_templates(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,  -- denormalised for RLS
  position        int  not null,
  kind            block_kind not null default 'focus',
  planned_seconds int  not null check (planned_seconds > 0),
  topic_id        uuid references topics(id) on delete set null,  -- null = inherit from session
  label           text,
  unique (template_id, position)
);

create index if not exists template_blocks_template_idx on session_template_blocks (template_id, position);

-- Convenience: total planned duration of a template.
create or replace view v_template_totals with (security_invoker = on) as
select t.id            as template_id,
       t.user_id,
       t.name,
       count(b.id)                                                          as block_count,
       coalesce(sum(b.planned_seconds), 0)                                  as planned_seconds,
       coalesce(sum(b.planned_seconds) filter (where b.kind = 'focus'), 0)  as planned_focus_seconds
from session_templates t
left join session_template_blocks b on b.template_id = t.id
group by t.id, t.user_id, t.name;


-- =====================================================================
-- 6. SESSIONS  (one actual sitting)
-- =====================================================================

create table if not exists sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references profiles(id) on delete cascade,
  template_id       uuid references session_templates(id) on delete set null,
  topic_id          uuid references topics(id) on delete set null, -- default topic for its blocks
  title             text,
  status            session_status not null default 'active',
  planned_seconds   int check (planned_seconds is null or planned_seconds > 0),
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  focus_rating      smallint check (focus_rating between 1 and 5),  -- self-report, drives "when am I sharpest"
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create index if not exists sessions_user_time_idx on sessions (user_id, started_at desc);
create index if not exists sessions_topic_idx     on sessions (topic_id);
-- Only one live session per user.
create unique index if not exists sessions_one_active
  on sessions (user_id) where status = 'active';

create trigger sessions_updated_at
  before update on sessions
  for each row execute function set_updated_at();


-- =====================================================================
-- 7. SESSION BLOCKS  ★ the fact table ★
-- ---------------------------------------------------------------------
-- duration_seconds  = wall-clock length
-- net_seconds       = duration minus paused time  ← use this for analytics
-- local_day         = the user's local calendar date (set by trigger)
-- =====================================================================

create table if not exists session_blocks (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references sessions(id) on delete cascade,
  user_id           uuid not null references profiles(id) on delete cascade,
  topic_id          uuid references topics(id) on delete set null,
  template_block_id uuid references session_template_blocks(id) on delete set null,
  kind              block_kind not null default 'focus',
  position          int not null default 0,
  planned_seconds   int check (planned_seconds is null or planned_seconds > 0),
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  paused_seconds    int not null default 0 check (paused_seconds >= 0),
  interruptions     int not null default 0 check (interruptions >= 0),
  completed         boolean not null default false,   -- ran to its planned length
  local_day         date,
  note              text,
  created_at        timestamptz not null default now(),

  duration_seconds  int generated always as (
    case when ended_at is null then null
         else extract(epoch from (ended_at - started_at))::int end
  ) stored,

  net_seconds       int generated always as (
    case when ended_at is null then null
         else greatest(extract(epoch from (ended_at - started_at))::int - paused_seconds, 0) end
  ) stored,

  check (ended_at is null or ended_at >= started_at)
);

create index if not exists blocks_user_day_idx   on session_blocks (user_id, local_day);
create index if not exists blocks_topic_day_idx  on session_blocks (topic_id, local_day);
create index if not exists blocks_session_idx    on session_blocks (session_id, position);
create index if not exists blocks_open_idx       on session_blocks (user_id) where ended_at is null;

-- A user cannot be in two places at once: no overlapping blocks, and at
-- most one open block (open = [started_at, infinity)).
-- Drop this if you ever need to bulk-import messy historical data.
alter table session_blocks drop constraint if exists blocks_no_overlap;
alter table session_blocks add constraint blocks_no_overlap
  exclude using gist (
    user_id with =,
    tstzrange(started_at, coalesce(ended_at, 'infinity'::timestamptz)) with &&
  );

-- Stamp the local calendar day from the user's timezone.
-- A block crossing midnight is attributed to the day it started.
create or replace function set_block_local_day()
returns trigger language plpgsql set search_path = public as $$
declare tz text;
begin
  select timezone into tz from profiles where id = new.user_id;
  new.local_day := (new.started_at at time zone coalesce(tz, 'UTC'))::date;
  return new;
end $$;

create trigger blocks_local_day
  before insert or update of started_at, user_id on session_blocks
  for each row execute function set_block_local_day();


-- =====================================================================
-- 8. PAUSES  (optional precision: "I stopped the timer for 4 minutes")
-- =====================================================================

create table if not exists block_pauses (
  id         uuid primary key default gen_random_uuid(),
  block_id   uuid not null references session_blocks(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at   timestamptz,
  reason     text,
  check (ended_at is null or ended_at >= started_at)
);

create index if not exists pauses_block_idx on block_pauses (block_id);
create unique index if not exists pauses_one_open on block_pauses (block_id) where ended_at is null;

-- Keep session_blocks.paused_seconds in sync automatically.
create or replace function sync_paused_seconds()
returns trigger language plpgsql set search_path = public as $$
declare bid uuid := coalesce(new.block_id, old.block_id);
begin
  update session_blocks b
     set paused_seconds = coalesce((
           select sum(extract(epoch from (p.ended_at - p.started_at))::int)
           from block_pauses p
           where p.block_id = bid and p.ended_at is not null
         ), 0)
   where b.id = bid;
  return null;
end $$;

create trigger pauses_sync
  after insert or update or delete on block_pauses
  for each row execute function sync_paused_seconds();


-- =====================================================================
-- 9. GOALS  (topic_id null = an overall goal across all topics)
-- =====================================================================

create table if not exists goals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles(id) on delete cascade,
  topic_id       uuid references topics(id) on delete cascade,
  period         goal_period not null default 'daily',
  target_minutes int not null check (target_minutes > 0),
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create unique index if not exists goals_unique
  on goals (user_id, coalesce(topic_id, '00000000-0000-0000-0000-000000000000'::uuid), period)
  where active;


-- =====================================================================
-- 10. ROW LEVEL SECURITY  — every table, one rule: it's yours or it isn't
-- =====================================================================

alter table profiles                enable row level security;
alter table topics                  enable row level security;
alter table session_templates       enable row level security;
alter table session_template_blocks enable row level security;
alter table sessions                enable row level security;
alter table session_blocks          enable row level security;
alter table block_pauses            enable row level security;
alter table goals                   enable row level security;

drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array[
    'topics','session_templates','session_template_blocks',
    'sessions','session_blocks','block_pauses','goals'
  ] loop
    execute format('drop policy if exists "own rows" on %I', t);
    execute format(
      'create policy "own rows" on %I for all
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;


-- =====================================================================
-- 11. ANALYTICS VIEWS
-- ---------------------------------------------------------------------
-- All views use security_invoker so RLS still applies to the caller.
-- =====================================================================

-- 11.1 Flattened fact rows — the base every other view builds on.
create or replace view v_block_facts with (security_invoker = on) as
select b.id           as block_id,
       b.user_id,
       b.session_id,
       b.topic_id,
       t.name         as topic_name,
       t.color        as topic_color,
       t.parent_id    as topic_parent_id,
       b.kind,
       b.local_day,
       b.started_at,
       b.ended_at,
       b.net_seconds,
       round(b.net_seconds / 60.0, 2)                                  as net_minutes,
       b.interruptions,
       extract(isodow from b.started_at at time zone p.timezone)::int  as day_of_week,
       extract(hour   from b.started_at at time zone p.timezone)::int  as hour_of_day,
       date_trunc('week',  (b.started_at at time zone p.timezone))::date  as local_week,
       date_trunc('month', (b.started_at at time zone p.timezone))::date  as local_month
from session_blocks b
join profiles p on p.id = b.user_id
left join topics t on t.id = b.topic_id
where b.ended_at is not null;

-- 11.2 Minutes per topic per day — the main chart feed.
create or replace view v_daily_topic_totals with (security_invoker = on) as
select user_id,
       local_day,
       topic_id,
       topic_name,
       topic_color,
       sum(net_seconds) filter (where kind = 'focus')      as focus_seconds,
       sum(net_seconds) filter (where kind <> 'focus')     as break_seconds,
       count(*)         filter (where kind = 'focus')      as focus_blocks,
       sum(interruptions)                                  as interruptions
from v_block_facts
group by user_id, local_day, topic_id, topic_name, topic_color;

-- 11.3 One row per day: totals, goal, hit/miss.
create or replace view v_daily_totals with (security_invoker = on) as
select f.user_id,
       f.local_day,
       sum(f.net_seconds) filter (where f.kind = 'focus')  as focus_seconds,
       round(sum(f.net_seconds) filter (where f.kind = 'focus') / 60.0)::int as focus_minutes,
       sum(f.net_seconds) filter (where f.kind <> 'focus') as break_seconds,
       count(distinct f.session_id)                        as session_count,
       count(distinct f.topic_id)                          as topic_count,
       sum(f.interruptions)                                as interruptions,
       p.daily_goal_minutes                                as goal_minutes,
       (sum(f.net_seconds) filter (where f.kind = 'focus') / 60.0)
         >= p.daily_goal_minutes                           as goal_met
from v_block_facts f
join profiles p on p.id = f.user_id
group by f.user_id, f.local_day, p.daily_goal_minutes;

-- 11.4 All-time totals per topic, INCLUDING descendant sub-topics.
create or replace view v_topic_rollup with (security_invoker = on) as
with recursive tree as (
  select id as root_id, id as node_id, user_id from topics
  union all
  select tr.root_id, c.id, c.user_id
  from tree tr join topics c on c.parent_id = tr.node_id
)
select tr.root_id                                        as topic_id,
       t.name                                            as topic_name,
       t.color                                           as topic_color,
       t.parent_id,
       tr.user_id,
       coalesce(sum(b.net_seconds) filter (where b.kind = 'focus'), 0)                     as total_focus_seconds,
       coalesce(round(sum(b.net_seconds) filter (where b.kind = 'focus') / 3600.0, 2), 0)  as total_focus_hours,
       count(distinct b.session_id)                      as session_count,
       count(distinct b.local_day)                       as active_days,
       max(b.ended_at)                                   as last_studied_at
from tree tr
join topics t on t.id = tr.root_id
left join session_blocks b
       on b.topic_id = tr.node_id and b.ended_at is not null
group by tr.root_id, t.name, t.color, t.parent_id, tr.user_id;

-- 11.5 Heatmap: day-of-week × hour-of-day. "When do I actually focus?"
create or replace view v_focus_heatmap with (security_invoker = on) as
select user_id,
       day_of_week,
       hour_of_day,
       sum(net_seconds)                            as focus_seconds,
       round(sum(net_seconds) / 60.0)::int         as focus_minutes,
       count(*)                                    as block_count,
       round(avg(net_seconds) / 60.0, 1)           as avg_block_minutes
from v_block_facts
where kind = 'focus'
group by user_id, day_of_week, hour_of_day;

-- 11.6 Session summary: planned vs actual, adherence.
create or replace view v_session_summary with (security_invoker = on) as
select s.id            as session_id,
       s.user_id,
       s.title,
       s.status,
       s.template_id,
       tpl.name        as template_name,
       s.topic_id,
       s.started_at,
       s.ended_at,
       s.focus_rating,
       count(b.id)                                                             as block_count,
       coalesce(sum(b.net_seconds) filter (where b.kind = 'focus'), 0)         as actual_focus_seconds,
       coalesce(sum(b.paused_seconds), 0)                                      as paused_seconds,
       coalesce(sum(b.interruptions), 0)                                       as interruptions,
       tt.planned_focus_seconds,
       case when coalesce(tt.planned_focus_seconds, 0) > 0
            then round(
                   coalesce(sum(b.net_seconds) filter (where b.kind = 'focus'), 0)::numeric
                   / tt.planned_focus_seconds, 3)
       end                                                                     as adherence_ratio
from sessions s
left join session_blocks b     on b.session_id = s.id and b.ended_at is not null
left join session_templates tpl on tpl.id = s.template_id
left join v_template_totals tt  on tt.template_id = s.template_id
group by s.id, s.user_id, s.title, s.status, s.template_id, tpl.name,
         s.topic_id, s.started_at, s.ended_at, s.focus_rating, tt.planned_focus_seconds;

-- 11.7 Streaks (gaps-and-islands over days with real focus time).
create or replace view v_streaks with (security_invoker = on) as
with days as (
  select distinct user_id, local_day
  from session_blocks
  where kind = 'focus' and net_seconds > 0
),
grouped as (
  select user_id,
         local_day,
         local_day - (row_number() over (partition by user_id order by local_day))::int as grp
  from days
),
islands as (
  select user_id, grp, min(local_day) as start_day, max(local_day) as end_day, count(*) as len
  from grouped group by user_id, grp
)
select i.user_id,
       max(i.len)                                                as longest_streak,
       coalesce(max(i.len) filter (
         where i.end_day >= (now() at time zone p.timezone)::date - 1
       ), 0)                                                     as current_streak,
       max(i.end_day)                                            as last_active_day
from islands i
join profiles p on p.id = i.user_id
group by i.user_id;


-- =====================================================================
-- 12. RPCs  (call from the client with supabase.rpc('...'))
-- =====================================================================

-- Start a session, optionally instantiating a template's first block.
create or replace function start_session(
  p_template_id uuid default null,
  p_topic_id    uuid default null,
  p_title       text default null
) returns sessions
language plpgsql security invoker set search_path = public as $$
declare s sessions;
begin
  update sessions set status = 'abandoned', ended_at = now()
   where user_id = auth.uid() and status = 'active';

  insert into sessions (user_id, template_id, topic_id, title, planned_seconds)
  values (
    auth.uid(), p_template_id, p_topic_id, p_title,
    (select planned_seconds from v_template_totals where template_id = p_template_id)
  )
  returning * into s;

  return s;
end $$;

-- Start a block. Automatically closes any block still running.
create or replace function start_block(
  p_session_id        uuid,
  p_topic_id          uuid       default null,
  p_kind              block_kind default 'focus',
  p_planned_seconds   int        default null,
  p_template_block_id uuid       default null
) returns session_blocks
language plpgsql security invoker set search_path = public as $$
declare b session_blocks; nxt int;
begin
  update session_blocks set ended_at = now()
   where user_id = auth.uid() and ended_at is null;

  select coalesce(max(position), -1) + 1 into nxt
    from session_blocks where session_id = p_session_id;

  insert into session_blocks (
    session_id, user_id, topic_id, kind, position, planned_seconds, template_block_id
  ) values (
    p_session_id, auth.uid(),
    coalesce(p_topic_id, (select topic_id from sessions where id = p_session_id)),
    p_kind, nxt, p_planned_seconds, p_template_block_id
  ) returning * into b;

  return b;
end $$;

-- End a block; closes an open pause first so paused_seconds stays honest.
create or replace function end_block(p_block_id uuid, p_note text default null)
returns session_blocks
language plpgsql security invoker set search_path = public as $$
declare b session_blocks;
begin
  update block_pauses set ended_at = now()
   where block_id = p_block_id and ended_at is null;

  update session_blocks
     set ended_at  = now(),
         note      = coalesce(p_note, note),
         completed = (planned_seconds is not null
                      and extract(epoch from (now() - started_at)) >= planned_seconds)
   where id = p_block_id and ended_at is null
  returning * into b;

  return b;
end $$;

create or replace function pause_block(p_block_id uuid, p_reason text default null)
returns block_pauses
language plpgsql security invoker set search_path = public as $$
declare p block_pauses;
begin
  insert into block_pauses (block_id, user_id, reason)
  values (p_block_id, auth.uid(), p_reason)
  returning * into p;

  update session_blocks set interruptions = interruptions + 1 where id = p_block_id;
  return p;
end $$;

create or replace function resume_block(p_block_id uuid)
returns block_pauses
language plpgsql security invoker set search_path = public as $$
declare p block_pauses;
begin
  update block_pauses set ended_at = now()
   where block_id = p_block_id and ended_at is null
  returning * into p;
  return p;
end $$;

create or replace function end_session(
  p_session_id   uuid,
  p_status       session_status default 'completed',
  p_focus_rating smallint default null,
  p_notes        text default null
) returns sessions
language plpgsql security invoker set search_path = public as $$
declare s sessions;
begin
  update block_pauses set ended_at = now()
   where ended_at is null
     and block_id in (select id from session_blocks where session_id = p_session_id);

  update session_blocks set ended_at = now()
   where session_id = p_session_id and ended_at is null;

  update sessions
     set status = p_status, ended_at = now(),
         focus_rating = coalesce(p_focus_rating, focus_rating),
         notes = coalesce(p_notes, notes)
   where id = p_session_id
  returning * into s;

  return s;
end $$;


-- =====================================================================
-- 13. EXAMPLE ANALYTICS QUERIES (for the dashboard)
-- =====================================================================

-- Last 30 days, stacked bar of minutes per topic:
--   select local_day, topic_name, topic_color, round(focus_seconds/60.0) as minutes
--   from v_daily_topic_totals
--   where local_day >= current_date - 29
--   order by local_day, topic_name;

-- Topic leaderboard with share of total:
--   select topic_name, total_focus_hours,
--          round(100 * total_focus_seconds
--                / nullif(sum(total_focus_seconds) over (), 0), 1) as pct
--   from v_topic_rollup
--   where parent_id is null
--   order by total_focus_seconds desc;

-- 7-day rolling average focus minutes:
--   select local_day, focus_minutes,
--          round(avg(focus_minutes) over (order by local_day
--                rows between 6 preceding and current row), 1) as rolling_7d
--   from v_daily_totals order by local_day;

-- Best hours of the day. NOTE: v_focus_heatmap is a dow × hour grid, so
-- you must re-aggregate to collapse the day-of-week dimension:
--   select hour_of_day, sum(focus_minutes) as minutes
--   from v_focus_heatmap group by hour_of_day
--   order by minutes desc limit 5;

-- Streak card:
--   select current_streak, longest_streak, last_active_day from v_streaks;
