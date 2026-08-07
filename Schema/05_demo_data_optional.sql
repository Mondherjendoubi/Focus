-- =====================================================================
-- DEMO DATA GENERATOR (optional, standalone)
-- Run AFTER focus_analytics_schema.sql + focus_migration_001 + focus_my_topics.sql
-- ---------------------------------------------------------------------
-- Fills your account with realistic history so you can build and tune
-- the analytics UI before you have real sessions logged.
--
--   select generate_demo_data((select id from auth.users
--                              where email = 'you@example.com'), 90);
--
-- When you're done, wipe it - it only deletes rows titled 'Demo session',
-- so your real sessions are untouched:
--
--   select clear_demo_data((select id from auth.users
--                           where email = 'you@example.com'));
--
-- Requires at least one topic to exist first.
-- =====================================================================

create or replace function generate_demo_data(p_user_id uuid, p_days int default 90)
returns text language plpgsql security definer set search_path = public as $fn$
declare
  tz            text;
  topic_ids     uuid[];
  n_topics      int;
  day_offset    int;
  day_start     timestamptz;
  slot_idx      int;
  n_slots       int;
  slot_hours    int[] := array[9, 14, 20];
  sess_id       uuid;
  cursor_ts     timestamptz;
  block_pos     int;
  n_blocks      int;
  focus_len     int;
  break_len     int;
  chosen_topic  uuid;
  blocks_made   int := 0;
  sessions_made int := 0;
begin
  select coalesce(timezone, 'UTC') into tz from profiles where id = p_user_id;
  tz := coalesce(tz, 'UTC');

  select array_agg(id) into topic_ids
  from topics where user_id = p_user_id and archived_at is null;

  if topic_ids is null then
    raise exception 'No topics for user % - run seed_user_defaults() first', p_user_id;
  end if;
  n_topics := array_length(topic_ids, 1);

  for day_offset in reverse (p_days - 1) .. 0 loop
    if random() < 0.22 then continue; end if;

    day_start := (((now() at time zone tz)::date - day_offset)::timestamp) at time zone tz;

    n_slots := case when random() < 0.45 then 1 when random() < 0.8 then 2 else 3 end;

    for slot_idx in 1 .. n_slots loop
      cursor_ts := day_start
                 + make_interval(hours => slot_hours[slot_idx])
                 + make_interval(mins  => (random() * 30)::int);

      insert into sessions (user_id, topic_id, title, status, started_at, ended_at, focus_rating)
      values (p_user_id,
              topic_ids[1 + floor(random() * n_topics)::int],
              'Demo session', 'completed', cursor_ts, cursor_ts,
              (1 + floor(random() * 5))::smallint)
      returning id into sess_id;
      sessions_made := sessions_made + 1;

      n_blocks := 2 + floor(random() * 4)::int;

      for block_pos in 0 .. (n_blocks - 1) loop
        chosen_topic := topic_ids[1 + floor(random() * n_topics)::int];
        focus_len := (20 + floor(random() * 30))::int * 60;
        break_len := (5  + floor(random() * 8))::int * 60;

        insert into session_blocks (
          session_id, user_id, topic_id, kind, position,
          planned_seconds, started_at, ended_at, paused_seconds,
          interruptions, completed
        ) values (
          sess_id, p_user_id, chosen_topic, 'focus', block_pos * 2,
          1500, cursor_ts, cursor_ts + make_interval(secs => focus_len),
          (floor(random() * 180))::int,
          (floor(random() * 3))::int,
          random() < 0.7
        );
        cursor_ts := cursor_ts + make_interval(secs => focus_len);
        blocks_made := blocks_made + 1;

        if block_pos < n_blocks - 1 then
          insert into session_blocks (
            session_id, user_id, topic_id, kind, position,
            planned_seconds, started_at, ended_at, completed
          ) values (
            sess_id, p_user_id, chosen_topic, 'short_break', block_pos * 2 + 1,
            300, cursor_ts, cursor_ts + make_interval(secs => break_len), true
          );
          cursor_ts := cursor_ts + make_interval(secs => break_len);
          blocks_made := blocks_made + 1;
        end if;
      end loop;

      update sessions set ended_at = cursor_ts where id = sess_id;
    end loop;
  end loop;

  return format('Generated %s sessions and %s blocks over %s days',
                sessions_made, blocks_made, p_days);
end $fn$;

create or replace function clear_demo_data(p_user_id uuid)
returns text language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  delete from sessions where user_id = p_user_id and title = 'Demo session';
  get diagnostics n = row_count;
  return format('Deleted %s demo sessions (blocks cascade)', n);
end $fn$;
