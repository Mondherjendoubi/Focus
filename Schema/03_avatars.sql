-- =====================================================================
-- 03_avatars.sql — profile pictures (FA-019)
--
-- RUN THIS IN THE SUPABASE SQL EDITOR. Requires a bucket named `avatars`
-- to already exist. Idempotent: safe to run more than once.
--
-- ---------------------------------------------------------------------
-- WHY "PUBLIC BUCKET" IS NOT ENOUGH ON ITS OWN
--
-- Ticking Public only affects READS: it exposes
-- /storage/v1/object/public/avatars/<path> without auth.
--
-- `storage.objects` still has RLS enabled, and WRITES stay denied until a
-- policy allows them — uploads fail with a policy violation otherwise.
--
-- And a permissive write policy is not the answer either. Without the folder
-- check below, any signed-in user could overwrite anyone else's avatar, or use
-- the bucket as free file hosting. Writes are pinned to a path whose FIRST
-- SEGMENT is the caller's own uid: `<uid>/<something>.jpg`.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Where the URL lives
-- ---------------------------------------------------------------------

alter table profiles add column if not exists avatar_url text;


-- ---------------------------------------------------------------------
-- 2. Bucket hardening
--
-- Server-side limits the client cannot talk its way past. The upload UI also
-- validates type and size, but that check lives in the browser and anyone can
-- skip it by calling the API directly — this is the one that actually binds.
-- ---------------------------------------------------------------------

update storage.buckets
   set public            = true,
       file_size_limit   = 2097152,  -- 2 MiB; the client re-encodes well under this
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'avatars';


-- ---------------------------------------------------------------------
-- 3. Storage policies
--
-- `storage.foldername(name)` splits an object path into segments, so for
-- `<uid>/1712345678.jpg` element 1 is the uid. Comparing it to
-- `auth.uid()::text` is what confines each user to their own folder.
-- ---------------------------------------------------------------------

drop policy if exists "avatars are readable"      on storage.objects;
drop policy if exists "avatars insert own folder" on storage.objects;
drop policy if exists "avatars update own folder" on storage.objects;
drop policy if exists "avatars delete own folder" on storage.objects;

-- Read. The bucket is public, so anonymous fetches of the object URL already
-- bypass this — but `list()` goes through the API and needs SELECT, and the
-- upload flow lists the user's own folder to clean up superseded files.
create policy "avatars are readable" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatars insert own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- `using` gates which existing rows you may touch; `with check` gates what they
-- may become. Both are needed, or an update could move a row out of your folder.
create policy "avatars update own folder" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars delete own folder" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ---------------------------------------------------------------------
-- 4. Re-issue the social RPCs to carry the avatar
--
-- `profiles` stays invisible to non-friends, so these functions remain the
-- only window onto anyone else's row. Adding a column to the table does not
-- expose it — it has to be returned here explicitly.
--
-- Signatures are unchanged, so `create or replace` is enough; the return type
-- gains a column, which Postgres accepts because the name and argument types
-- are identical.
-- ---------------------------------------------------------------------

drop function if exists find_profile_by_username(text);
create or replace function find_profile_by_username(p_username text)
returns table (id uuid, username text, display_name text, avatar_url text)
language sql security definer set search_path = public stable as $$
  select p.id, p.username, p.display_name, p.avatar_url
  from profiles p
  where auth.uid() is not null
    and lower(p.username) = lower(trim(p_username))
    and p.id <> auth.uid()
  limit 1
$$;

-- `responded_at` is stamped by `friendships_guard()` at the moment of
-- acceptance. Returning it is what lets the UI say "you became friends 2 days
-- ago" and flag ones accepted since your last visit — without it, a request you
-- sent simply appears in the friends list one day with nothing marking the
-- change, and you would never know it had been answered.
drop function if exists my_friends();
create or replace function my_friends()
returns table (
  friendship_id uuid,
  friend_id     uuid,
  username      text,
  display_name  text,
  avatar_url    text,
  status        friendship_status,
  direction     text,
  created_at    timestamptz,
  responded_at  timestamptz
)
language sql security definer set search_path = public stable as $$
  select f.id,
         other.id,
         other.username,
         other.display_name,
         other.avatar_url,
         f.status,
         case
           when f.status = 'accepted'       then 'friend'
           when f.requester_id = auth.uid() then 'outgoing'
           else 'incoming'
         end,
         f.created_at,
         f.responded_at
  from friendships f
  join profiles other
    on other.id = case when f.requester_id = auth.uid()
                       then f.addressee_id else f.requester_id end
  where auth.uid() in (f.requester_id, f.addressee_id)
  order by f.status, f.created_at desc
$$;

revoke all on function find_profile_by_username(text) from public;
revoke all on function my_friends()                   from public;

grant execute on function find_profile_by_username(text) to authenticated;
grant execute on function my_friends()                   to authenticated;
