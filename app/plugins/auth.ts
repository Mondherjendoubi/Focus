/**
 * Resolves the stored session before the app renders, then keeps `user` in
 * sync. Named after `supabase` alphabetically so it runs second — Nuxt loads
 * plugins in filename order and this one needs `$supabase` to exist.
 */
export default defineNuxtPlugin({
  name: 'auth',
  dependsOn: ['supabase'],
  async setup() {
    const supabase = useSupabase()
    const user = useState<import('@supabase/supabase-js').User | null>('auth:user', () => null)
    const ready = useState<boolean>('auth:ready', () => false)

    const { data } = await supabase.auth.getSession()
    user.value = data.session?.user ?? null
    ready.value = true

    supabase.auth.onAuthStateChange((_event, session) => {
      user.value = session?.user ?? null
    })
  }
})
