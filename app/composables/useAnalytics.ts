import type { BlockFact, DailyTotal, SessionSummary } from '~/types/database'

/**
 * The deep-analytics layer behind the dashboard's lower section (FA-015).
 *
 * Unlike FA-010/FA-011, whose components each fetch their own slice, this is one
 * composable feeding four cards by props. The reason is the range picker: four
 * self-fetching components would fire four refetches every time the user moves
 * between 7 / 30 / 90 days, for data that all comes from the same three tables.
 *
 * Everything is read from analytics views. `session_blocks` is never
 * re-aggregated here — `v_block_facts` already applies the timezone, the
 * closed-blocks filter (`ended_at is not null`) and the topic join, and getting
 * any of those subtly wrong is how a study tracker starts lying to people.
 *
 * ONE deliberate compromise, called out because it looks like a bug otherwise:
 * `v_session_summary` exposes no `local_day`, so its range predicate is a
 * rolling instant window (`now - n×24h`) rather than a calendar-day window. No
 * day bucketing happens in the browser, so the "never bucket days client-side"
 * rule holds; the cards fed from it say "last 30 days" and never "this month".
 * The day-bucketed cards read `local_day` and stay server-stamped.
 */

/** Ranges the picker offers. Days, because every window here is day-based. */
export const ANALYTICS_RANGES = [7, 30, 90] as const

export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number]

/** Mean focus rating plus the sample it is drawn from, and template adherence. */
export interface FocusQuality {
  /** null when no session in range carried a rating — not 0, which is not a valid rating. */
  meanRating: number | null
  /** How many sessions the mean is drawn from. A mean of one is not a mean. */
  ratedCount: number
  /** Counts for ratings 1..5, index 0 = rating 1. Always length 5. */
  distribution: number[]
  /** Mean of `adherence_ratio` over template sessions. null when none had a template. */
  meanAdherence: number | null
  adherenceCount: number
}

/** Goal hit-rate, the day strip behind it, and the two period-over-period deltas. */
export interface Consistency {
  /** One entry per day in range, oldest first. */
  days: ConsistencyDay[]
  /** Days where `goal_met` came back true. */
  hitCount: number
  /** Days with focus time but no goal met. */
  missedCount: number
  /** Focus seconds in the most recent 7 days vs the 7 before that. */
  weekOverWeek: PeriodDelta
  /** Focus seconds in the most recent 30 days vs the 30 before that. */
  monthOverMonth: PeriodDelta
}

export interface ConsistencyDay {
  localDay: string
  focusSeconds: number
  /** false when the day has rows but missed the goal; null when the day has no rows. */
  goalMet: boolean | null
}

export interface PeriodDelta {
  current: number
  previous: number
  /** Fractional change vs `previous`. null when `previous` is 0 — not Infinity. */
  ratio: number | null
}

/** Where the time actually goes, and how long a block really runs. */
export interface Efficiency {
  focusSeconds: number
  breakSeconds: number
  pausedSeconds: number
  /** paused / (focused + paused). null when neither happened. */
  pauseShare: number | null
  /** Mean `net_seconds` of a focus block. null when no focus block closed in range. */
  meanFocusBlockSeconds: number | null
  focusBlockCount: number
  completedSessions: number
  abandonedSessions: number
  /** completed / (completed + abandoned). Excludes still-running sessions. null when none closed. */
  completionRate: number | null
}

/** 24 buckets, index = hour of day in the profile's timezone. */
export interface BestHours {
  seconds: number[]
  /** Hour with the most focus time, or null when there is none. */
  peakHour: number | null
}

export interface AnalyticsData {
  range: Ref<AnalyticsRange>
  quality: Ref<FocusQuality | null>
  consistency: Ref<Consistency | null>
  efficiency: Ref<Efficiency | null>
  bestHours: Ref<BestHours | null>
  timezone: Ref<string>
  pending: Ref<boolean>
  /** Message from `toMessage()` when any read fails, else null. */
  error: Ref<string | null>
  setRange: (next: AnalyticsRange) => void
  refresh: () => Promise<void>
}

/**
 * PostgREST serialises `numeric` as a string to protect precision, so every
 * `numeric` column in these views (`adherence_ratio`, `net_minutes`,
 * `avg_block_minutes`) arrives as text. `Number('')` is 0 and `Number(null)` is
 * 0, both of which would read as a real measurement, so those return the
 * fallback instead.
 */
function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

/** Guards every denominator in this file. A new account divides by zero a lot. */
function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return numerator / denominator
}

export function useAnalytics(initialRange: AnalyticsRange = 30): AnalyticsData {
  const supabase = useSupabase()

  const range = ref<AnalyticsRange>(initialRange)
  const quality = ref<FocusQuality | null>(null)
  const consistency = ref<Consistency | null>(null)
  const efficiency = ref<Efficiency | null>(null)
  const bestHours = ref<BestHours | null>(null)
  const timezone = ref('UTC')
  const pending = ref(true)
  const error = ref<string | null>(null)

  async function refresh() {
    pending.value = true
    error.value = null

    // Timezone first — every day boundary below is named in the profile's zone,
    // never the browser's, so there is nothing to fetch until this lands.
    const profileRes = await supabase
      .from('profiles')
      .select('timezone')
      .single()

    if (profileRes.error) {
      error.value = toMessage(profileRes.error)
      pending.value = false
      return
    }

    timezone.value = profileRes.data.timezone

    const days = range.value
    // Two windows wide, so the period-over-period deltas have a prior period to
    // compare against without a second round trip.
    const spanDays = lastNDays(days * 2, timezone.value)
    const windowStart = spanDays[days] ?? spanDays[0]!
    const priorStart = spanDays[0]!
    const today = todayLocalDay(timezone.value)

    // Rolling instant window for the session view — see the header note.
    const sessionsSince = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    const [dailyRes, sessionRes, factRes] = await Promise.all([
      supabase
        .from('v_daily_totals')
        .select('local_day, focus_seconds, break_seconds, goal_met')
        .gte('local_day', priorStart)
        .lte('local_day', today),
      supabase
        .from('v_session_summary')
        .select('status, focus_rating, adherence_ratio, actual_focus_seconds, paused_seconds')
        .gte('started_at', sessionsSince),
      supabase
        .from('v_block_facts')
        .select('kind, net_seconds, hour_of_day')
        .gte('local_day', windowStart)
        .lte('local_day', today)
    ])

    // One failure fails the whole section. Rendering three of four cards as zero
    // while the fourth silently errored is exactly the "empty is not failed"
    // trap — a user with months of history would read it as having none.
    const firstError = dailyRes.error ?? sessionRes.error ?? factRes.error
    if (firstError) {
      error.value = toMessage(firstError)
      pending.value = false
      return
    }

    const dailyRows = (dailyRes.data ?? []) as Array<Pick<DailyTotal, 'local_day' | 'focus_seconds' | 'break_seconds' | 'goal_met'>>
    const sessionRows = (sessionRes.data ?? []) as Array<Pick<SessionSummary, 'status' | 'focus_rating' | 'adherence_ratio' | 'actual_focus_seconds' | 'paused_seconds'>>
    const factRows = (factRes.data ?? []) as Array<Pick<BlockFact, 'kind' | 'net_seconds' | 'hour_of_day'>>

    const byDay = new Map(dailyRows.map(row => [row.local_day, row]))

    quality.value = buildQuality(sessionRows)
    consistency.value = buildConsistency(spanDays, days, byDay)
    efficiency.value = buildEfficiency(spanDays.slice(days), byDay, sessionRows, factRows)
    bestHours.value = buildBestHours(factRows)

    pending.value = false
  }

  function setRange(next: AnalyticsRange) {
    if (next === range.value) return
    range.value = next
    void refresh()
  }

  return {
    range,
    quality,
    consistency,
    efficiency,
    bestHours,
    timezone,
    pending,
    error,
    setRange,
    refresh
  }
}

// ---------------------------------------------------------------------------
// Builders — pure functions over rows, so each is readable on its own
// ---------------------------------------------------------------------------

function buildQuality(
  rows: Array<Pick<SessionSummary, 'status' | 'focus_rating' | 'adherence_ratio' | 'actual_focus_seconds' | 'paused_seconds'>>
): FocusQuality {
  const distribution = [0, 0, 0, 0, 0]
  let ratingTotal = 0
  let ratedCount = 0
  let adherenceTotal = 0
  let adherenceCount = 0

  for (const row of rows) {
    const rating = row.focus_rating
    // Ratings are 1..5 integers. Anything else is not a rating we can bucket,
    // and indexing the array with it would corrupt the distribution.
    if (typeof rating === 'number' && Number.isInteger(rating) && rating >= 1 && rating <= 5) {
      distribution[rating - 1] = (distribution[rating - 1] ?? 0) + 1
      ratingTotal += rating
      ratedCount++
    }

    // A null ratio means "this session had no template", which is not 0%.
    if (row.adherence_ratio !== null) {
      adherenceTotal += num(row.adherence_ratio)
      adherenceCount++
    }
  }

  return {
    meanRating: ratio(ratingTotal, ratedCount),
    ratedCount,
    distribution,
    meanAdherence: ratio(adherenceTotal, adherenceCount),
    adherenceCount
  }
}

function buildConsistency(
  spanDays: string[],
  days: number,
  byDay: Map<string, Pick<DailyTotal, 'local_day' | 'focus_seconds' | 'break_seconds' | 'goal_met'>>
): Consistency {
  const windowDays = spanDays.slice(days)
  const priorDays = spanDays.slice(0, days)

  const entries: ConsistencyDay[] = windowDays.map((localDay) => {
    const row = byDay.get(localDay)
    return {
      localDay,
      // Null on a day whose blocks were all breaks; absent entirely on a day
      // with no blocks at all. Both mean "no focus time", so both coerce to 0.
      focusSeconds: num(row?.focus_seconds),
      goalMet: row === undefined ? null : row.goal_met
    }
  })

  const hitCount = entries.filter(day => day.goalMet === true).length
  const missedCount = entries.filter(day => day.goalMet !== true && day.focusSeconds > 0).length

  const sumFocus = (list: string[]) =>
    list.reduce((total, day) => total + num(byDay.get(day)?.focus_seconds), 0)

  // Week deltas index off the FULL two-window span, not `windowDays`. On the
  // 7-day range `windowDays` is only 7 long, so `windowDays.slice(-14, -7)`
  // would be empty and every user would be told their week was "new" — the
  // prior week is already fetched, it just lives in the first half of the span.
  const currentWeek = sumFocus(spanDays.slice(-7))
  const previousWeek = sumFocus(spanDays.slice(-14, -7))
  const currentMonth = sumFocus(windowDays)
  const previousMonth = sumFocus(priorDays)

  return {
    days: entries,
    hitCount,
    missedCount,
    weekOverWeek: {
      current: currentWeek,
      previous: previousWeek,
      ratio: ratio(currentWeek - previousWeek, previousWeek)
    },
    monthOverMonth: {
      current: currentMonth,
      previous: previousMonth,
      ratio: ratio(currentMonth - previousMonth, previousMonth)
    }
  }
}

function buildEfficiency(
  windowDays: string[],
  byDay: Map<string, Pick<DailyTotal, 'local_day' | 'focus_seconds' | 'break_seconds' | 'goal_met'>>,
  sessionRows: Array<Pick<SessionSummary, 'status' | 'focus_rating' | 'adherence_ratio' | 'actual_focus_seconds' | 'paused_seconds'>>,
  factRows: Array<Pick<BlockFact, 'kind' | 'net_seconds' | 'hour_of_day'>>
): Efficiency {
  let focusSeconds = 0
  let breakSeconds = 0
  for (const day of windowDays) {
    const row = byDay.get(day)
    focusSeconds += num(row?.focus_seconds)
    breakSeconds += num(row?.break_seconds)
  }

  let pausedSeconds = 0
  let sessionFocusSeconds = 0
  let completedSessions = 0
  let abandonedSessions = 0
  for (const row of sessionRows) {
    pausedSeconds += num(row.paused_seconds)
    sessionFocusSeconds += num(row.actual_focus_seconds)
    // 'active' is neither outcome — a session running right now has not been
    // abandoned, and counting it as such would penalise the user for the
    // session they are in the middle of.
    if (row.status === 'completed') completedSessions++
    if (row.status === 'abandoned') abandonedSessions++
  }

  // Mean block length is computed from block rows on purpose. Averaging
  // `v_focus_heatmap.avg_block_minutes` would weight a cell holding one block
  // the same as a cell holding fifty.
  let focusBlockTotal = 0
  let focusBlockCount = 0
  for (const row of factRows) {
    if (row.kind !== 'focus') continue
    focusBlockTotal += num(row.net_seconds)
    focusBlockCount++
  }

  const closedSessions = completedSessions + abandonedSessions

  return {
    focusSeconds,
    breakSeconds,
    pausedSeconds,
    pauseShare: ratio(pausedSeconds, sessionFocusSeconds + pausedSeconds),
    meanFocusBlockSeconds: ratio(focusBlockTotal, focusBlockCount),
    focusBlockCount,
    completedSessions,
    abandonedSessions,
    completionRate: ratio(completedSessions, closedSessions)
  }
}

function buildBestHours(
  factRows: Array<Pick<BlockFact, 'kind' | 'net_seconds' | 'hour_of_day'>>
): BestHours {
  const seconds = Array.from({ length: 24 }, () => 0)

  for (const row of factRows) {
    if (row.kind !== 'focus') continue
    const hour = row.hour_of_day
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue
    seconds[hour] = (seconds[hour] ?? 0) + num(row.net_seconds)
  }

  let peakHour: number | null = null
  let peakSeconds = 0
  for (let hour = 0; hour < 24; hour++) {
    const value = seconds[hour] ?? 0
    if (value > peakSeconds) {
      peakSeconds = value
      peakHour = hour
    }
  }

  return { seconds, peakHour }
}
