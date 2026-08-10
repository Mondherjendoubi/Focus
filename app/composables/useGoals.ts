import type { PostgrestError } from '@supabase/supabase-js'
import type { DailyTopicTotal, DailyTotal, Goal, GoalPeriod } from '~/types/database'

/**
 * Goals — the `goals` table finally gets a UI (FA-016).
 *
 * Three things about this table cause wrong numbers if you skim it:
 *
 *  1. `target_minutes` is MINUTES. It is the second deliberate exception in a
 *     schema that is otherwise seconds everywhere, alongside
 *     `profiles.daily_goal_minutes`. Everything it is compared against
 *     (`focus_seconds`) is seconds, so the conversion happens exactly once —
 *     in `targetSeconds` below — and nowhere else.
 *
 *  2. The unique index is PARTIAL: `where active`. So the rule is "one *active*
 *     goal per (topic, period)", and any number of switched-off ones may exist
 *     alongside it. Turning a goal off is an update, never a delete — the app's
 *     archive-never-delete rule applies here as much as it does to topics.
 *
 *  3. A null `topic_id` means "all topics". The index coalesces it to the zero
 *     UUID so two all-topics goals of the same period collide properly.
 *
 * There is no `v_goal_progress` view, so progress is summed here from
 * `v_daily_totals` (all-topics goals) and `v_daily_topic_totals` (per-topic),
 * over each goal's period window. Both are keyed on the server-stamped
 * `local_day`, so no day bucketing happens in the browser.
 */

/** Only the fields the form writes. `active` is toggled through `setActive`. */
export interface GoalInput {
  topic_id: string | null
  period: GoalPeriod
  target_minutes: number
}

export interface GoalProgress {
  goal: Goal
  /** Focused seconds inside the goal's current period window. */
  focusSeconds: number
  /** `target_minutes` in seconds — the one place the unit conversion happens. */
  targetSeconds: number
  /** focusSeconds / targetSeconds. Can exceed 1; the UI clamps the bar, not this. */
  ratio: number
  /** First `local_day` counted, for the "since…" label. */
  windowStart: string
}

export const GOAL_PERIODS: GoalPeriod[] = ['daily', 'weekly', 'monthly']

/** Sentence fragments for the period, used in labels and help text. */
export const PERIOD_LABELS: Record<GoalPeriod, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly'
}

/** PostgREST hands back `numeric`/nullable sums as strings or null. */
function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function useGoals() {
  const supabase = useSupabase()
  const { user } = useAuth()
  const { profile, load: loadProfile } = useProfile()
  const topics = useTopics()

  const goals = useState<Goal[]>('goals:list', () => [])
  const progress = useState<GoalProgress[]>('goals:progress', () => [])
  const loading = useState<boolean>('goals:loading', () => false)
  const error = useState<string | null>('goals:error', () => null)
  const loaded = useState<boolean>('goals:loaded', () => false)

  function fail(err: PostgrestError | Error | unknown): never {
    const message = toMessage(err as PostgrestError | Error)
    error.value = message
    throw new Error(message)
  }

  /** The first `local_day` a goal of `period` counts, in the profile's zone. */
  function windowStartFor(period: GoalPeriod, timezone: string, weekStartsOn: number): string {
    if (period === 'weekly') return weekStartDay(timezone, weekStartsOn)
    if (period === 'monthly') return monthStartDay(timezone)
    return todayLocalDay(timezone)
  }

  async function load() {
    loading.value = true
    error.value = null
    try {
      if (!profile.value) await loadProfile()
      // Progress on a parent topic has to include its sub-topics, and the tree
      // is the only thing that knows which those are.
      if (!topics.loaded.value) await topics.load()

      const timezone = profile.value?.timezone ?? 'UTC'
      const weekStartsOn = profile.value?.week_starts_on ?? 1
      const today = todayLocalDay(timezone)

      const goalRes = await supabase
        .from('goals')
        .select('*')
        .eq('active', true)
        .order('period')

      if (goalRes.error) throw goalRes.error

      const rows = (goalRes.data ?? []) as Goal[]
      goals.value = rows

      if (rows.length === 0) {
        progress.value = []
        loaded.value = true
        return
      }

      // Fetch once from the earliest boundary any active goal needs, then slice
      // per goal in memory. On the 1st of a month the week can start in the
      // previous month, so this is a min, not "whichever is the month".
      const starts = rows.map(goal => windowStartFor(goal.period, timezone, weekStartsOn))
      const earliest = starts.reduce((min, day) => (day < min ? day : min), today)

      const needsTopicTotals = rows.some(goal => goal.topic_id !== null)
      const needsOverallTotals = rows.some(goal => goal.topic_id === null)

      const [totalsRes, topicTotalsRes] = await Promise.all([
        needsOverallTotals
          ? supabase
              .from('v_daily_totals')
              .select('local_day, focus_seconds')
              .gte('local_day', earliest)
              .lte('local_day', today)
          : Promise.resolve({ data: [], error: null }),
        needsTopicTotals
          ? supabase
              .from('v_daily_topic_totals')
              .select('local_day, topic_id, focus_seconds')
              .gte('local_day', earliest)
              .lte('local_day', today)
          : Promise.resolve({ data: [], error: null })
      ])

      if (totalsRes.error) throw totalsRes.error
      if (topicTotalsRes.error) throw topicTotalsRes.error

      const dailyRows = (totalsRes.data ?? []) as Array<Pick<DailyTotal, 'local_day' | 'focus_seconds'>>
      const topicRows = (topicTotalsRes.data ?? []) as Array<Pick<DailyTopicTotal, 'local_day' | 'topic_id' | 'focus_seconds'>>

      progress.value = rows.map((goal) => {
        const windowStart = windowStartFor(goal.period, timezone, weekStartsOn)

        let focusSeconds = 0
        if (goal.topic_id === null) {
          for (const row of dailyRows) {
            if (row.local_day >= windowStart) focusSeconds += num(row.focus_seconds)
          }
        } else {
          // `v_daily_topic_totals` keys on the exact topic, so a goal on a
          // parent would read zero while all the time sat on its children.
          // `descendantsOf` includes the topic itself.
          const counted = topics.descendantsOf(goal.topic_id)
          for (const row of topicRows) {
            if (row.local_day < windowStart) continue
            if (row.topic_id === null || !counted.has(row.topic_id)) continue
            focusSeconds += num(row.focus_seconds)
          }
        }

        // The single minutes -> seconds conversion in this feature.
        const targetSeconds = goal.target_minutes * 60

        return {
          goal,
          focusSeconds,
          targetSeconds,
          ratio: targetSeconds > 0 ? focusSeconds / targetSeconds : 0,
          windowStart
        }
      })

      loaded.value = true
    } catch (err) {
      // Never blank the list on a read failure — surface why instead.
      error.value = toMessage(err as PostgrestError | Error)
    } finally {
      loading.value = false
    }
  }

  async function refresh() {
    await load()
  }

  /**
   * The active goal already occupying a (topic, period) slot, if any. The form
   * checks this before submit so the user gets a sentence instead of a raw
   * unique-violation from Postgres.
   */
  function conflictFor(topicId: string | null, period: GoalPeriod, ignoreId?: string): Goal | null {
    return goals.value.find(goal =>
      goal.id !== ignoreId
      && goal.period === period
      && goal.topic_id === topicId
    ) ?? null
  }

  async function create(input: GoalInput): Promise<Goal> {
    if (!user.value) fail(new Error('You must be signed in.'))

    const { data, error: err } = await supabase
      .from('goals')
      .insert({
        user_id: user.value!.id,
        topic_id: input.topic_id,
        period: input.period,
        target_minutes: input.target_minutes,
        active: true
      })
      .select()
      .single()

    if (err || !data) fail(err ?? new Error('Insert returned no row.'))

    await refresh()
    return data as Goal
  }

  async function update(id: string, input: GoalInput): Promise<Goal> {
    const { data, error: err } = await supabase
      .from('goals')
      .update({
        topic_id: input.topic_id,
        period: input.period,
        target_minutes: input.target_minutes
      })
      .eq('id', id)
      .select()
      .single()

    if (err || !data) fail(err ?? new Error('Update returned no row.'))

    await refresh()
    return data as Goal
  }

  /**
   * Switch a goal off rather than delete it. The unique index only counts
   * active rows, so this frees the (topic, period) slot while keeping the
   * record that the user once held this target.
   */
  async function deactivate(id: string): Promise<void> {
    const { error: err } = await supabase
      .from('goals')
      .update({ active: false })
      .eq('id', id)

    if (err) fail(err)
    await refresh()
  }

  return {
    goals,
    progress,
    loading,
    error,
    loaded,
    load,
    refresh,
    conflictFor,
    create,
    update,
    deactivate
  }
}
