import type { DailyTotal, Streaks } from '~/types/database'

/**
 * The dashboard's data layer. Everything is loaded from analytics views —
 * `session_blocks` is never re-aggregated in the browser, because the views
 * already do it correctly (timezone handling, kind filters, streak islands).
 *
 * Three questions get answered here: how much today, did I hit the goal, am
 * I on a streak. Nothing else lives in this composable — charts and the
 * leaderboard get their own.
 */

export interface DashboardStats {
  /** null when no row exists for today — the normal state every morning. */
  today: Ref<DailyTotal | null>
  /** Sum of `focus_seconds` across the last 7 local days, treating null as 0. */
  weekSeconds: Ref<number>
  /** null when the user has no focus history yet. */
  streak: Ref<Streaks | null>
  /** The profile's timezone; used to compute today's `local_day` and never the browser's. */
  timezone: Ref<string>
  /** Cached from `profiles.daily_goal_minutes` — used for the zero-state goal ring. */
  goalMinutes: Ref<number>
  pending: Ref<boolean>
  /** Message from `toMessage()` when any of the three queries fails, else null. */
  error: Ref<string | null>
  refresh: () => Promise<void>
}

export function useStats(): DashboardStats {
  const supabase = useSupabase()

  const today = ref<DailyTotal | null>(null)
  const weekSeconds = ref(0)
  const streak = ref<Streaks | null>(null)
  const timezone = ref('UTC')
  const goalMinutes = ref(0)
  const pending = ref(true)
  const error = ref<string | null>(null)

  async function refresh() {
    pending.value = true
    error.value = null

    // Profile first: `today` needs its timezone, and there is no honest way
    // to bucket a day without it. FA-004 will land `useProfile` in parallel,
    // but this ticket cannot depend on it, so read the row directly.
    const profileRes = await supabase
      .from('profiles')
      .select('timezone, daily_goal_minutes')
      .single()

    if (profileRes.error) {
      error.value = toMessage(profileRes.error)
      pending.value = false
      return
    }

    timezone.value = profileRes.data.timezone
    goalMinutes.value = profileRes.data.daily_goal_minutes

    const todayDay = todayLocalDay(timezone.value)
    const weekStart = lastNDays(7, timezone.value)[0]!

    // Fan the three view reads out in parallel — they are independent.
    const [todayRes, weekRes, streakRes] = await Promise.all([
      supabase
        .from('v_daily_totals')
        .select('*')
        .eq('local_day', todayDay)
        .maybeSingle(),
      supabase
        .from('v_daily_totals')
        .select('focus_seconds')
        .gte('local_day', weekStart)
        .lte('local_day', todayDay),
      supabase
        .from('v_streaks')
        .select('*')
        .maybeSingle()
    ])

    // A single failure blocks the whole dashboard: rendering three tiles as
    // zero while one query silently errored would show wrong numbers, which
    // is worse than showing an error state.
    const firstError = todayRes.error ?? weekRes.error ?? streakRes.error
    if (firstError) {
      error.value = toMessage(firstError)
      pending.value = false
      return
    }

    today.value = (todayRes.data as DailyTotal | null) ?? null
    streak.value = (streakRes.data as Streaks | null) ?? null

    const rows = (weekRes.data ?? []) as Array<{ focus_seconds: number | null }>
    weekSeconds.value = rows.reduce((sum, row) => sum + (row.focus_seconds ?? 0), 0)

    pending.value = false
  }

  return {
    today,
    weekSeconds,
    streak,
    timezone,
    goalMinutes,
    pending,
    error,
    refresh
  }
}
