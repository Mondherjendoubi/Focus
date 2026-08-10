import type { Profile } from '~/types/database'

/**
 * The single source of truth for the current user's profile row.
 *
 * `profiles` is RLS-scoped, so `.select('*').single()` returns the caller's
 * own row — no `user_id` filter needed. The row itself is created by the
 * `handle_new_user` trigger at sign-up; we never `.insert()`.
 *
 * `updated_at` is maintained by a trigger — do NOT send it in patches.
 */
export function useProfile() {
  const supabase = useSupabase()
  const { user } = useAuth()

  const profile = useState<Profile | null>('profile:current', () => null)
  const loading = useState<boolean>('profile:loading', () => false)
  const error = useState<string | null>('profile:error', () => null)

  async function load() {
    if (!user.value) {
      error.value = 'Not signed in.'
      profile.value = null
      return
    }
    loading.value = true
    error.value = null
    const { data, error: err } = await supabase
      .from('profiles')
      .select('*')
      .single()
    loading.value = false
    if (err) {
      // Surface the error rather than pretending we have no profile.
      // An empty state and a failed query must not look the same.
      error.value = toMessage(err)
      profile.value = null
      return
    }
    profile.value = data as Profile
  }

  /**
   * Persist a partial change. Only the caller-supplied fields are written;
   * `id` and `updated_at` are never sent — the trigger owns `updated_at`,
   * and the row is scoped by primary key.
   *
   * Returns the fresh row on success; throws with a rendered message otherwise
   * so the caller can bind it to a form error.
   */
  async function update(patch: Partial<Pick<Profile, 'display_name' | 'username' | 'timezone' | 'daily_goal_minutes' | 'week_starts_on'>>) {
    if (!user.value) throw new Error('Not signed in.')
    const { data, error: err } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', user.value.id)
      .select('*')
      .single()
    if (err) throw new Error(toMessage(err))
    profile.value = data as Profile
    return profile.value
  }

  return { profile, loading, error, load, update }
}
