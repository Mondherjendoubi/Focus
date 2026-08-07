-- =====================================================================
-- CREATE MY TOPICS  (diagnosing version)
-- ---------------------------------------------------------------------
-- STEP 1 first. It tells you exactly what to do next.
-- =====================================================================


-- ---------------------------------------------------------------------
-- STEP 1 - WHO EXISTS?  Run this block ALONE first and read the result.
-- ---------------------------------------------------------------------
select
  (select count(*) from auth.users) as auth_users,
  (select count(*) from profiles)   as profiles,
  (select count(*) from topics)     as topics;

select u.id, u.email, (p.id is not null) as has_profile
from auth.users u
left join profiles p on p.id = u.id
order by u.email;

--  auth_users = 0  -> you have no account yet. Supabase Dashboard ->
--                     Authentication -> Users -> "Add user" (email +
--                     password, tick auto-confirm). Then come back.
--  auth_users = 1  -> just run STEP 2. It picks that user automatically.
--  auth_users > 1  -> copy your id from the list and paste it into
--                     force_id in STEP 2.


-- ---------------------------------------------------------------------
-- STEP 2 - CREATE THE TOPICS
-- Nothing to edit if you have exactly one user.
-- ---------------------------------------------------------------------
do $$
declare
  force_id  uuid := null;   -- optional: paste your uuid here, e.g. '0f8c...'::uuid
  my_id     uuid;
  n_users   int;
begin
  select count(*) into n_users from auth.users;

  if force_id is not null then
    my_id := force_id;
    if not exists (select 1 from auth.users where id = my_id) then
      raise exception 'No auth.users row with id %. Re-check STEP 1.', my_id;
    end if;

  elsif n_users = 0 then
    raise exception
      'No users exist yet. Create one: Supabase Dashboard -> Authentication -> Users -> Add user (tick auto-confirm), then re-run this.';

  elsif n_users = 1 then
    select id into my_id from auth.users;

  else
    raise exception
      '% users found. Run STEP 1, copy your uuid, and paste it into force_id above.', n_users;
  end if;

  -- Older accounts may predate the signup trigger - make sure a profile exists.
  insert into profiles (id, display_name)
  select my_id, split_part(u.email, '@', 1) from auth.users u where u.id = my_id
  on conflict (id) do nothing;

  perform seed_my_topics(my_id);
  perform seed_my_goals(my_id);

  raise notice 'Topics created for user %', my_id;
end $$;


-- ---------------------------------------------------------------------
-- STEP 3 - VERIFY.  Expect 5 parents / 32 sub-topics / 37 total.
-- ---------------------------------------------------------------------
select count(*) filter (where parent_id is null)     as parent_topics,
       count(*) filter (where parent_id is not null) as sub_topics,
       count(*)                                      as total
from topics;

select coalesce(p.name, '— TOP LEVEL —') as parent, t.name as topic, t.color
from topics t
left join topics p on p.id = t.parent_id
order by coalesce(p.position, t.position), p.name nulls first, t.position;
