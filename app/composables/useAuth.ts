import type { User } from '@supabase/supabase-js'

/**
 * Shared auth state. Populated by plugins/auth.ts before the first route
 * renders, so middleware can trust `user` and `ready` synchronously.
 */
export function useAuth() {
  const supabase = useSupabase()
  const user = useState<User | null>('auth:user', () => null)
  const ready = useState<boolean>('auth:ready', () => false)

  const isLoggedIn = computed(() => user.value !== null)

  async function signInWithPassword(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    user.value = data.user
    return data.user
  }

  async function signUp(email: string, password: string, displayName?: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: displayName ? { full_name: displayName } : undefined }
    })
    if (error) throw error
    // With email confirmation on, `session` is null and the user must confirm
    // before a profile row is reachable. Let the caller tell them.
    user.value = data.user
    return { user: data.user, needsConfirmation: data.session === null }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    user.value = null
    await navigateTo('/login')
  }

  return { user, ready, isLoggedIn, signInWithPassword, signUp, signOut }
}
