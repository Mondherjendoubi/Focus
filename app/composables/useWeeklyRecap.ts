import type { DailyTopicTotal, DailyTotal } from '~/types/database'

/**
 * Last seven days, told as a story rather than a chart (FA-017).
 *
 * Deliberately NOT wired to FA-015's range picker: a recap is seven days by
 * definition, and a "weekly recap" that silently became a 90-day recap when the
 * user moved a control elsewhere on the page would be a lie.
 *
 * Windows are rolling 7-day spans of server-stamped `local_day` values, not
 * calendar weeks. That is intentional — a recap the user sees on a Thursday
 * should cover the seven days they just lived, not the three since Monday.
 */

export interface WeeklyRecap {
  /** Focus seconds across the last 7 local days. */
  totalSeconds: number
  /** The 7 days before those, for the delta. */
  priorSeconds: number
  /** Fractional change vs `priorSeconds`. null when the prior week was empty. */
  deltaRatio: number | null
  /** Best single day in the window, or null when nothing was studied. */
  bestDay: { localDay: string, seconds: number } | null
  /** Days in the window where `goal_met` came back true. */
  goalDaysHit: number
  /** Days in the window with any focus time. */
  activeDays: number
  /** Most-studied topic in the window, or null. */
  topTopic: { name: string, color: string | null, seconds: number } | null
}

/** PostgREST nulls and numeric-as-string, in one place. */
function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function useWeeklyRecap() {
  const supabase = useSupabase()

  const recap = ref<WeeklyRecap | null>(null)
  const pending = ref(true)
  const error = ref<string | null>(null)

  async function refresh() {
    pending.value = true
    error.value = null

    const profileRes = await supabase
      .from('profiles')
      .select('timezone')
      .single()

    if (profileRes.error) {
      error.value = toMessage(profileRes.error)
      pending.value = false
      return
    }

    const timezone = profileRes.data.timezone
    // 14 days so the prior week comes back in the same round trip.
    const span = lastNDays(14, timezone)
    const windowDays = span.slice(7)
    const priorDays = span.slice(0, 7)
    const windowStart = windowDays[0]!
    const today = todayLocalDay(timezone)

    const [dailyRes, topicRes] = await Promise.all([
      supabase
        .from('v_daily_totals')
        .select('local_day, focus_seconds, goal_met')
        .gte('local_day', span[0]!)
        .lte('local_day', today),
      supabase
        .from('v_daily_topic_totals')
        .select('local_day, topic_name, topic_color, focus_seconds')
        .gte('local_day', windowStart)
        .lte('local_day', today)
    ])

    if (dailyRes.error ?? topicRes.error) {
      error.value = toMessage(dailyRes.error ?? topicRes.error)
      pending.value = false
      return
    }

    const dailyRows = (dailyRes.data ?? []) as Array<Pick<DailyTotal, 'local_day' | 'focus_seconds' | 'goal_met'>>
    const topicRows = (topicRes.data ?? []) as Array<Pick<DailyTopicTotal, 'local_day' | 'topic_name' | 'topic_color' | 'focus_seconds'>>

    const byDay = new Map(dailyRows.map(row => [row.local_day, row]))

    let totalSeconds = 0
    let goalDaysHit = 0
    let activeDays = 0
    let bestDay: WeeklyRecap['bestDay'] = null

    for (const day of windowDays) {
      const row = byDay.get(day)
      // Null on a break-only day, absent on an untouched day. Both are 0 focus.
      const seconds = num(row?.focus_seconds)
      totalSeconds += seconds
      if (seconds > 0) activeDays++
      if (row?.goal_met === true) goalDaysHit++
      if (seconds > 0 && (bestDay === null || seconds > bestDay.seconds)) {
        bestDay = { localDay: day, seconds }
      }
    }

    const priorSeconds = priorDays.reduce(
      (sum, day) => sum + num(byDay.get(day)?.focus_seconds),
      0
    )

    // Topic totals arrive per day; collapse to one row per topic name. Grouping
    // on the name rather than the id keeps the label and colour together and is
    // enough for a "top topic" callout.
    const topicTotals = new Map<string, { name: string, color: string | null, seconds: number }>()
    for (const row of topicRows) {
      const name = row.topic_name ?? 'No topic'
      const entry = topicTotals.get(name) ?? { name, color: row.topic_color, seconds: 0 }
      entry.seconds += num(row.focus_seconds)
      topicTotals.set(name, entry)
    }

    let topTopic: WeeklyRecap['topTopic'] = null
    for (const entry of topicTotals.values()) {
      if (entry.seconds > 0 && (topTopic === null || entry.seconds > topTopic.seconds)) {
        topTopic = entry
      }
    }

    recap.value = {
      totalSeconds,
      priorSeconds,
      // A percentage needs something to be a percentage OF. Coming back from a
      // zero week is "new", not an infinite improvement.
      deltaRatio: priorSeconds > 0 ? (totalSeconds - priorSeconds) / priorSeconds : null,
      bestDay,
      goalDaysHit,
      activeDays,
      topTopic
    }

    pending.value = false
  }

  return { recap, pending, error, refresh }
}
