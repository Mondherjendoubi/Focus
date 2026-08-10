/**
 * Avatar upload (FA-019). Requires `Schema/03_avatars.sql` and a bucket
 * named `avatars`.
 *
 * Three things this handles that a bare `storage.upload()` would not:
 *
 *  1. **Re-encoding.** A phone photo is 3–8 MB and 4000px wide. Storing that
 *     means every friend card pulls megabytes to render a 40px circle. The
 *     file is drawn to a canvas at `MAX_EDGE` and re-encoded as JPEG first, so
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

/** Longest edge after downscaling. Avatars render at 40–96px; 512 is generous. */
const MAX_EDGE = 512

/** Rejected before any network call. The bucket enforces its own limit too. */
const MAX_INPUT_BYTES = 8 * 1024 * 1024
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export const AVATAR_ACCEPT = ACCEPTED_TYPES.join(',')

/**
 * Draw to a canvas at no more than `MAX_EDGE` on the longest side and re-encode
 * as JPEG. Returns a Blob; throws if the file is not a decodable image.
 */
async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('Could not process that image.')
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.85)
    })
    if (blob === null) throw new Error('Could not process that image.')
    return blob
  } finally {
    // Frees the decoded pixels immediately rather than waiting for GC — these
    // are large, and a user retrying a few times would otherwise pile them up.
    bitmap.close()
  }
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

  async function uploadAvatar(file: File): Promise<string | null> {
    if (uploading.value) return null
    const uid = user.value?.id
    if (!uid) {
      error.value = 'You must be signed in.'
      return null
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      error.value = 'Pick a JPEG, PNG or WebP image.'
      return null
    }
    if (file.size > MAX_INPUT_BYTES) {
      error.value = 'That image is too large. Pick one under 8 MB.'
      return null
    }

    uploading.value = true
    error.value = null
    try {
      const blob = await downscale(file)

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

  return { profile, uploading, error, uploadAvatar, removeAvatar }
}
