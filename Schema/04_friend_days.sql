-- =====================================================================
-- 04_friend_days.sql — per-day sparkline for a friend (FA-022)
--
-- RUN THIS IN THE SUPABASE SQL EDITOR, AFTER 02 AND 03.
-- Idempotent: safe to run more than once.
--
-- The 3b friends table draws seven squares per friend — one per day of their
-- last week, in three states (goal met / studied / nothing). `friend_stats`
-- returns only aggregates, so that shape needs its own accessor.
--
-- Same rules as everything else in 02_social.sql: `security definer`, an
-- accepted-friendship gate before any data is touched, base tables rather than
-- the `v_*` views (a `security_invoker` view resolves `auth.uid()` to the
-- CALLER and would hand back the caller's own week), and aggregates only —
-- seven numbers, no topic, title or note.
-- =====================================================================

create or replace function friend_days(p_friend_id uuid)
returns table (
  local_day     date,
  focus_seconds bigint,
  goal_met      boolean
)
language plpgsql security definer set search_path = public stable as $$
declare
  v_today date;
  v_goal  int;
begin
  if auth.uid() is null then
    return;
  end if;

  -- The gate. Nothing below is reachable without an accepted friendship.
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
  -- generate_series, not "whatever rows exist": a day with no study still
  -- needs its square, and the client must never have to invent the gaps.
  with span as (
    select generate_series(v_today - 6, v_today, interval '1 day')::date as d
  ),
  totals as (
    select b.local_day as d,
           coalesce(sum(b.net_seconds) filter (where b.kind = 'focus'), 0)::bigint as secs
    from session_blocks b
    where b.user_id = p_friend_id
      and b.ended_at is not null
      and b.local_day between v_today - 6 and v_today
    group by b.local_day
  )
  select span.d,
         coalesce(totals.secs, 0)::bigint,
         -- A zero daily goal is "no goal", not "met every day".
         (v_goal > 0 and coalesce(totals.secs, 0) / 60.0 >= v_goal)
  from span
  left join totals on totals.d = span.d
  order by span.d;
end $$;

revoke all on function friend_days(uuid) from public;
grant execute on function friend_days(uuid) to authenticated;
