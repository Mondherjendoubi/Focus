-- =====================================================================
-- MIGRATION 001 - presets become app data, not user data
-- Run AFTER focus_analytics_schema.sql + focus_seed.sql
-- ---------------------------------------------------------------------
-- Three fixes:
--   1. Session templates become SYSTEM rows shared by all users
--      (one copy, not one per account), with copy-on-write editing.
--   2. Starter topics are no longer seeded - an unused seeded topic
--      shows up in analytics forever as a 0h entry.
--   3. The daily goal lives in exactly one place (profiles), not two.
--
-- Safe to re-run. Existing user sessions keep working.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Allow system-owned templates (user_id null = belongs to the app)
-- ---------------------------------------------------------------------

alter table session_templates
  alter column user_id drop not null,
  add column if not exists is_system boolean not null default false,
  add column if not exists forked_from uuid references session_templates(id) on delete set null;

alter table session_template_blocks
  alter column user_id drop not null;

-- A row is either the app's or a user's, never neither/both.
alter table session_templates drop constraint if exists templates_ownership;
alter table session_templates add constraint templates_ownership
  check ((is_system and user_id is null) or (not is_system and user_id is not null));

-- The old unique(user_id, name) lets NULLs duplicate. Split it.
alter table session_templates drop constraint if exists session_templates_user_id_name_key;
drop index if exists templates_user_name_uq;
drop index if exists templates_system_name_uq;
create unique index templates_user_name_uq
  on session_templates (user_id, lower(name)) where user_id is not null;
create unique index templates_system_name_uq
  on session_templates (lower(name)) where is_system;

-- ---------------------------------------------------------------------
-- 2. RLS: everyone READS system templates, nobody WRITES them
-- ---------------------------------------------------------------------

drop policy if exists "own rows"          on session_templates;
drop policy if exists "read templates"    on session_templates;
drop policy if exists "insert templates"  on session_templates;
drop policy if exists "update templates"  on session_templates;
drop policy if exists "delete templates"  on session_templates;

create policy "read templates"   on session_templates for select
  using (user_id = auth.uid() or is_system);
create policy "insert templates" on session_templates for insert
  with check (user_id = auth.uid() and not is_system);
create policy "update templates" on session_templates for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete templates" on session_templates for delete
  using (user_id = auth.uid());

drop policy if exists "own rows"       on session_template_blocks;
drop policy if exists "read tblocks"   on session_template_blocks;
drop policy if exists "insert tblocks" on session_template_blocks;
drop policy if exists "update tblocks" on session_template_blocks;
drop policy if exists "delete tblocks" on session_template_blocks;

create policy "read tblocks"   on session_template_blocks for select
  using (user_id = auth.uid()
         or exists (select 1 from session_templates t
                    where t.id = template_id and t.is_system));
create policy "insert tblocks" on session_template_blocks for insert
  with check (user_id = auth.uid());
create policy "update tblocks" on session_template_blocks for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete tblocks" on session_template_blocks for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3. Install the presets once, as system rows
-- ---------------------------------------------------------------------

create or replace function install_system_templates()
returns text language plpgsql security definer set search_path = public as $fn$
declare tpl_id uuid; n int := 0;
begin
  insert into session_templates (user_id, name, description, is_system, is_favorite)
  values (null, 'Pomodoro', '4 x 25 min focus with short breaks', true, true)
  on conflict do nothing returning id into tpl_id;
  if tpl_id is not null then
    insert into session_template_blocks (template_id, user_id, position, kind, planned_seconds, label) values
      (tpl_id, null, 0, 'focus',       1500, 'Focus 1'),
      (tpl_id, null, 1, 'short_break',  300, 'Break'),
      (tpl_id, null, 2, 'focus',       1500, 'Focus 2'),
      (tpl_id, null, 3, 'short_break',  300, 'Break'),
      (tpl_id, null, 4, 'focus',       1500, 'Focus 3'),
      (tpl_id, null, 5, 'short_break',  300, 'Break'),
      (tpl_id, null, 6, 'focus',       1500, 'Focus 4'),
      (tpl_id, null, 7, 'long_break',   900, 'Long break');
    n := n + 1;
  end if;

  tpl_id := null;
  insert into session_templates (user_id, name, description, is_system)
  values (null, 'Deep Work 90', 'One 90 min block, one 20 min break', true)
  on conflict do nothing returning id into tpl_id;
  if tpl_id is not null then
    insert into session_template_blocks (template_id, user_id, position, kind, planned_seconds, label) values
      (tpl_id, null, 0, 'focus',      5400, 'Deep work'),
      (tpl_id, null, 1, 'long_break', 1200, 'Recover');
    n := n + 1;
  end if;

  tpl_id := null;
  insert into session_templates (user_id, name, description, is_system)
  values (null, '52 / 17', '52 min focus, 17 min break', true)
  on conflict do nothing returning id into tpl_id;
  if tpl_id is not null then
    insert into session_template_blocks (template_id, user_id, position, kind, planned_seconds, label) values
      (tpl_id, null, 0, 'focus',       3120, 'Focus'),
      (tpl_id, null, 1, 'short_break', 1020, 'Break');
    n := n + 1;
  end if;

  return format('Installed %s system templates', n);
end $fn$;

select install_system_templates();

-- ---------------------------------------------------------------------
-- 4. Copy-on-write: user edits a preset -> they get their own copy
-- ---------------------------------------------------------------------

create or replace function fork_template(p_template_id uuid, p_new_name text default null)
returns session_templates
language plpgsql security invoker set search_path = public as $fn$
declare src session_templates; copy session_templates;
begin
  select * into src from session_templates where id = p_template_id;
  if not found then raise exception 'Template % not found', p_template_id; end if;

  insert into session_templates (user_id, name, description, default_topic_id, forked_from)
  values (auth.uid(),
          coalesce(p_new_name, src.name || ' (my copy)'),
          src.description, src.default_topic_id, src.id)
  returning * into copy;

  insert into session_template_blocks (template_id, user_id, position, kind, planned_seconds, topic_id, label)
  select copy.id, auth.uid(), position, kind, planned_seconds, topic_id, label
  from session_template_blocks where template_id = src.id;

  return copy;
end $fn$;

-- ---------------------------------------------------------------------
-- 5. Retire the seeded per-user duplicates (only those never used)
-- ---------------------------------------------------------------------

delete from session_templates t
where t.user_id is not null
  and t.forked_from is null
  and lower(t.name) in ('pomodoro', 'deep work 90', '52 / 17')
  and not exists (select 1 from sessions s where s.template_id = t.id);

-- ---------------------------------------------------------------------
-- 6. One home for the daily goal
--    profiles.daily_goal_minutes = overall goal (what v_daily_totals uses)
--    goals                       = per-topic goals only
-- ---------------------------------------------------------------------

delete from goals where topic_id is null;

alter table goals drop constraint if exists goals_topic_required;
alter table goals add constraint goals_topic_required check (topic_id is not null);

drop index if exists goals_unique;
create unique index goals_unique on goals (user_id, topic_id, period) where active;

-- ---------------------------------------------------------------------
-- 7. New signups get a profile only - no guessed topics, no copied presets
-- ---------------------------------------------------------------------

create or replace function seed_user_defaults(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  -- Intentionally empty. Presets are system rows; topics come from
  -- onboarding, where the user names the first thing they want to study.
  return;
end $fn$;

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $fn$;

-- ---------------------------------------------------------------------
-- 8. Template list for the UI: system presets + the user's own
-- ---------------------------------------------------------------------

create or replace view v_available_templates with (security_invoker = on) as
select t.id, t.name, t.description, t.is_system, t.is_favorite, t.forked_from,
       t.user_id is not null                                                 as is_editable,
       count(b.id)                                                           as block_count,
       coalesce(sum(b.planned_seconds), 0)                                   as planned_seconds,
       coalesce(sum(b.planned_seconds) filter (where b.kind = 'focus'), 0)   as planned_focus_seconds
from session_templates t
left join session_template_blocks b on b.template_id = t.id
where t.archived_at is null
group by t.id;

commit;
