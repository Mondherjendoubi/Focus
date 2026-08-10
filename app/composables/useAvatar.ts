/**
 * Avatar upload (FA-019). Requires `Schema/03_avatars.sql` and a bucket
 * named `avatars`.
 *
 * Three things this handles that a bare `storage.upload()` would not:
 *
 *  1. **Re-encoding.** A phone photo is 3–8 MB and 4000px wide. Storing that
 *     means every friend card pulls megabytes to render a 40px circle.
 *     `AvatarCropper` re-encodes to a 512px JPEG before this ever sees it, so
 *     what lands in the bucket is tens of kilobytes.
 *  2. **Cache busting by filename.** Uploading to a fixed path leaves the old
 *     image cached in every browser and CDN that already fetched it — the user
 *     changes their picture and nothing appears to happen. Each upload gets a
 *     fresh filename instead, which sidesteps caching entirely.
 *  3. **Cleanup.** Because names are unique, old files would accumulate
 *     forever. Superseded objects in the user's own folder are removed after a
 *     successful swap.
 *
 * Writes are confined to `<uid>/…` by the storage policies. That path shape is
 * not a convention here — it is what the policy checks, so changing it breaks
 * uploads.
 */

const BUCKET = 'avatars'

/** Rejected before any decoding. The bucket enforces its own limit too. */
const MAX_INPUT_BYTES = 8 * 1024 * 1024
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export const AVATAR_ACCEPT = ACCEPTED_TYPES.join(',')

/**
 * Checked before the cropper opens, so a bad file is refused with a sentence
 * rather than an empty editor. Returns null when the file is acceptable.
 */
export function validateAvatarFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) return 'Pick a JPEG, PNG or WebP image.'
  if (file.size > MAX_INPUT_BYTES) return 'That image is too large. Pick one under 8 MB.'
  return null
}

export function useAvatar() {
  const supabase = useSupabase()
  const { user } = useAuth()
  const { profile, update: updateProfile } = useProfile()

  const uploading = ref(false)
  const error = ref<string | null>(null)

  /** Everything in the user's folder except `keepPath`. Best-effort. */
  async function pruneOld(uid: string, keepPath: string) {
    const { data, error: listError } = await supabase.storage.from(BUCKET).list(uid)
    if (listError !== null || data === null) return

    const stale = data
      .map(item => `${uid}/${item.name}`)
      .filter(path => path !== keepPath)

    if (stale.length > 0) {
      // Ignore failures: the new avatar is already live and the profile row
      // points at it. Orphaned bytes are a housekeeping problem, not a reason
      // to tell the user their upload failed.
      await supabase.storage.from(BUCKET).remove(stale)
    }
  }

  /**
   * Store an already-cropped, already-encoded JPEG. Takes a Blob rather than a
   * File because the bytes come from `AvatarCropper`'s canvas, not from disk —
   * framing is the user's decision and belongs in the UI, not in here.
   */
  async function uploadBlob(blob: Blob): Promise<string | null> {
    if (uploading.value) return null
    const uid = user.value?.id
    if (!uid) {
      error.value = 'You must be signed in.'
      return null
    }

    uploading.value = true
    error.value = null
    try {
      // Unique per upload — see the cache-busting note in the header.
      const path = `${uid}/${Date.now()}.jpg`

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: 'image/jpeg', upsert: false })

      if (uploadError !== null) throw uploadError

      const { data: publicUrl } = supabase.storage.from(BUCKET).getPublicUrl(path)
      const url = publicUrl.publicUrl

      // Point the profile at the new object BEFORE pruning, so a failure here
      // leaves the old avatar intact rather than pointing at a deleted file.
      await updateProfile({ avatar_url: url })
      await pruneOld(uid, path)

      return url
    } catch (err) {
      error.value = toMessage(err as Error)
      return null
    } finally {
      uploading.value = false
    }
  }

  async function removeAvatar(): Promise<boolean> {
    const uid = user.value?.id
    if (!uid) return false

    uploading.value = true
    error.value = null
    try {
      // Clear the pointer first. If the delete then fails, the user still sees
      // the avatar gone, which is what they asked for; a stray object is a
      // smaller problem than a profile pointing at nothing.
      await updateProfile({ avatar_url: null })

      const { data } = await supabase.storage.from(BUCKET).list(uid)
      const paths = (data ?? []).map(item => `${uid}/${item.name}`)
      if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths)

      return true
    } catch (err) {
      error.value = toMessage(err as Error)
      return false
    } finally {
      uploading.value = false
    }
  }

  return { profile, uploading, error, uploadBlob, removeAvatar }
}
