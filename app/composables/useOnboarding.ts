/**
 * Is this account brand new? (FA-025)
 *
 * Derived rather than stored: no topics and no sessions means nothing has
 * happened yet. That covers every case except "same user, second device, still
 * an empty account", which a localStorage key handles — the same mechanism
 * `OnboardingChecklist` already uses for its own dismissal, so the app has one
 * precedent for this rather than two.
 *
 * The probe runs **once per app load**, cached in `useState`. A global
 * middleware that re-queried on every navigation would tax every page in the
 * app to serve one screen.
 */
export function useOnboarding() {
  const supabase = useSupabase()
  const { user } = useAuth()

  /** null = not probed yet. */
  const isNew = useState<boolean | null>('onboarding:isNew', () => null)
  const probing = useState<boolean>('onboarding:probing', () => false)

  const storageKey = computed(() => {
    const id = user.value?.id
    return id === undefined ? null : `tutorex:welcome:${id}:done`
  })

  function markDone() {
    isNew.value = false
    const key = storageKey.value
    if (key === null) return
    try {
      window.localStorage.setItem(key, '1')
    } catch {
      // Storage disabled. The derivation still hides the wizard the moment the
      // user creates a topic, so the worst case is seeing it once more.
    }
  }

  function alreadyDone(): boolean {
    const key = storageKey.value
    if (key === null) return false
    try {
      return window.localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  }

  /**
   * Resolves `isNew`. Returns it too, so the middleware does not have to read
   * the ref back out.
   *
   * **A failed probe resolves to `false`, never `true`.** RLS returns `[]` for
   * an errored read, which is indistinguishable from an empty account — and
   * showing a welcome wizard to someone with a year of history because a query
   * blipped is this app's worst failure mode wearing its loudest shirt.
   */
  async function probe(): Promise<boolean> {
    if (isNew.value !== null) return isNew.value
    if (probing.value) return false
    if (!user.value) return false

    if (alreadyDone()) {
      isNew.value = false
      return false
    }

    probing.value = true
    try {
      const [topicsRes, sessionsRes] = await Promise.all([
        supabase.from('topics').select('id').limit(1),
        supabase.from('sessions').select('id').limit(1)
      ])

      if (topicsRes.error || sessionsRes.error) {
        isNew.value = false
        return false
      }

      isNew.value = (topicsRes.data ?? []).length === 0 && (sessionsRes.data ?? []).length === 0
      return isNew.value
    } catch {
      isNew.value = false
      return false
    } finally {
      probing.value = false
    }
  }

  return { isNew, probe, markDone }
}
