-- =====================================================================
-- PERSONAL TOPICS - Kotlin / Kubernetes / Terraform / CI-CD / Observability
-- Run AFTER focus_analytics_schema.sql + focus_migration_001
-- ---------------------------------------------------------------------
-- These ARE user data (unlike the session-template presets), so they go
-- in as rows owned by you.
--
-- HOW TO RUN
--   From the Supabase SQL editor, auth.uid() is null, so pass your id:
--     select seed_my_topics((select id from auth.users
--                            where email = 'you@example.com'));
--   From the app (authenticated):
--     select seed_my_topics(auth.uid());
--
-- Re-runnable: existing topics are skipped, not duplicated.
-- =====================================================================

create or replace function seed_my_topics(p_user_id uuid)
returns table (topic_name text, subtopics bigint)
language plpgsql security definer set search_path = public as $fn$
declare
  root_id uuid;
  child   text;
  pos     int;
  roots   text[][] := array[
    ['Kotlin',        '#7f52ff'],
    ['Kubernetes',    '#326ce5'],
    ['Terraform',     '#7b42bc'],
    ['CI/CD',         '#f97316'],
    ['Observability', '#10b981']
  ];
  kids_kotlin text[] := array[
    'Language fundamentals',      -- null safety, data/sealed classes, scope fns
    'Coroutines & Flow',
    'Spring Boot with Kotlin',
    'Testing (Kotest / MockK)',
    'Gradle Kotlin DSL',
    'Java interop & migration'
  ];
  kids_k8s text[] := array[
    'Core objects (Pod/Deploy/Svc)',
    'Networking & Ingress',
    'Storage & StatefulSets',
    'Config & Secrets',
    'RBAC & security',
    'Helm',
    'Operators & CRDs',
    'Debugging & troubleshooting'
  ];
  kids_tf text[] := array[
    'HCL & language basics',
    'State & backends',
    'Modules & composition',
    'AWS provider',
    'Workspaces & environments',
    'Policy & scanning (tflint/Checkov)'
  ];
  kids_cicd text[] := array[
    'Pipeline design',
    'GitHub Actions',
    'Docker image builds',
    'Deployment strategies (blue-green/canary)',
    'Secrets management',
    'GitOps (ArgoCD / Flux)'
  ];
  kids_obs text[] := array[
    'Prometheus & PromQL',
    'Grafana dashboards',
    'Logging (Loki / ELK)',
    'Tracing (OpenTelemetry)',
    'Alerting & SLOs',
    'Instrumenting apps (Micrometer)'
  ];
  kids    text[];
  i       int;
begin
  for i in 1 .. array_length(roots, 1) loop
    root_id := null;

    insert into topics (user_id, name, color, position)
    values (p_user_id, roots[i][1], roots[i][2], i - 1)
    on conflict do nothing
    returning id into root_id;

    -- already existed: reuse it so sub-topics still attach
    if root_id is null then
      select id into root_id
      from topics
      where user_id = p_user_id and parent_id is null and lower(name) = lower(roots[i][1]);
    end if;

    kids := case roots[i][1]
              when 'Kotlin'        then kids_kotlin
              when 'Kubernetes'    then kids_k8s
              when 'Terraform'     then kids_tf
              when 'CI/CD'         then kids_cicd
              when 'Observability' then kids_obs
            end;

    pos := 0;
    foreach child in array kids loop
      insert into topics (user_id, parent_id, name, color, position)
      values (p_user_id, root_id, child, roots[i][2], pos)
      on conflict do nothing;
      pos := pos + 1;
    end loop;
  end loop;

  return query
    select t.name::text,
           (select count(*) from topics c where c.parent_id = t.id)
    from topics t
    where t.user_id = p_user_id and t.parent_id is null
    order by t.position;
end $fn$;


-- =====================================================================
-- OPTIONAL - weekly targets per topic
-- ---------------------------------------------------------------------
-- goals.topic_id is now required (migration 001), so these are per-topic
-- only. The overall daily goal stays in profiles.daily_goal_minutes.
-- Adjust the minutes to whatever is honest for your week.
-- =====================================================================

create or replace function seed_my_goals(p_user_id uuid)
returns text language plpgsql security definer set search_path = public as $fn$
declare n int := 0;
begin
  insert into goals (user_id, topic_id, period, target_minutes)
  select p_user_id, t.id, 'weekly',
         case t.name
           when 'Kotlin'        then 240   -- 4h/week
           when 'Kubernetes'    then 240
           when 'Terraform'     then 120
           when 'CI/CD'         then 120
           when 'Observability' then 120
         end
  from topics t
  where t.user_id = p_user_id
    and t.parent_id is null
    and t.name in ('Kotlin','Kubernetes','Terraform','CI/CD','Observability')
  on conflict do nothing;

  get diagnostics n = row_count;
  return format('Set %s weekly topic goals', n);
end $fn$;


-- =====================================================================
-- Weekly progress against those goals (add to your dashboard)
-- =====================================================================

create or replace view v_weekly_goal_progress with (security_invoker = on) as
with week_actuals as (
  select f.user_id,
         coalesce(t.parent_id, t.id) as root_topic_id,
         sum(f.net_seconds) filter (where f.kind = 'focus') as focus_seconds
  from v_block_facts f
  join topics t on t.id = f.topic_id
  where f.local_week = date_trunc('week', current_date)::date
  group by f.user_id, coalesce(t.parent_id, t.id)
)
select g.user_id,
       g.topic_id,
       t.name                                             as topic_name,
       t.color                                            as topic_color,
       g.target_minutes,
       coalesce(round(w.focus_seconds / 60.0)::int, 0)    as actual_minutes,
       round(100 * coalesce(w.focus_seconds, 0)
             / nullif(g.target_minutes * 60.0, 0), 1)     as pct_of_goal,
       coalesce(w.focus_seconds, 0) >= g.target_minutes * 60 as goal_met
from goals g
join topics t on t.id = g.topic_id
left join week_actuals w
       on w.root_topic_id = g.topic_id and w.user_id = g.user_id
where g.active and g.period = 'weekly';
