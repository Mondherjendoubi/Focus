import type { DailyTopicTotal, DailyTotal, LocalDay } from '~/types/database'

/**
 * The forest (FA-023): one tree per day the daily goal was cleared.
 *
 * No new SQL. `v_daily_totals` already reports `goal_met` per server-stamped
 * `local_day`, is `security_invoker`, and RLS scopes it to the caller — so this
 * is one query over all time.
 *
 * Days come back sparse: a day nobody studied has no row at all. The list below
 * is therefore built from the CALENDAR with the rows joined onto it, never the
 * other way round — otherwise a forest would silently close up its gaps and
 * every history would look like an unbroken run.
 *
 * Both scenes (`ForestPanorama`, `ForestTrail`) walk this one flat list and lay
 * it out their own way, so the two never disagree about what happened.
 */

/** What one day contributes to the scene. */
export type DayKind = 'tree' | 'seedling' | 'bare'

/** One topic's share of a day, for the hover card. */
export interface ForestDayTopic {
  name: string
  color: string | null
  seconds: number
}

export interface ForestDay {
  localDay: LocalDay
  kind: DayKind
  focusSeconds: number
  /** Focus over goal: 1 is exactly on target, 2 is double. 0 with no goal set. */
  ratio: number
  /** True on the first day of its month — where a scene draws the month marker. */
  monthStart: boolean
  monthName: string
  sessionCount: number
  interruptions: number
  /** Biggest share first. Empty until the topic rows land. */
  topics: ForestDayTopic[]
}

/** PostgREST sends bigint as a string, and `focus_seconds` is null on a break-only day. */
function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

type ForestRow = Pick<
  DailyTotal,
  'local_day' | 'focus_seconds' | 'goal_minutes' | 'goal_met' | 'session_count' | 'interruptions'
>

type TopicRow = Pick<DailyTopicTotal, 'local_day' | 'topic_name' | 'topic_color' | 'focus_seconds'>

/**
 * Whether a day earned a tree.
 *
 * **The `goal_minutes > 0` half is the entire correctness of this feature.**
 * `v_daily_totals` computes `goal_met` as `focus_seconds / 60.0 >=
 * daily_goal_minutes` with no guard on a zero goal, and `daily_goal_minutes` is
 * `check (>= 0)` — so for a user who switched their goal off, every day with a
 * single logged minute comes back `goal_met = true`. `friend_days` guards this
 * server-side and says why; this view does not, so the client must.
 */
export function earnedTree(row: Pick<ForestRow, 'goal_minutes' | 'goal_met'>): boolean {
  return num(row.goal_minutes) > 0 && row.goal_met === true
}

export function useForest() {
  const supabase = useSupabase()

  /** Oldest first. The panorama reads it forwards, the trail backwards. */
  const days = ref<ForestDay[]>([])
  const treeCount = ref(0)
  const seedlingCount = ref(0)
  /** Month with the most trees, as the handoff's third stat card. */
  const bestMonth = ref<string | null>(null)
  /** The profile's daily goal. 0 means no tree can ever be earned. */
  const goalMinutes = ref(0)
  const today = ref<LocalDay | null>(null)
  const pending = ref(true)
  const error = ref<string | null>(null)

  async function refresh() {
    pending.value = true
    error.value = null

    const profileRes = await supabase
      .from('profiles')
      .select('timezone, daily_goal_minutes')
      .single()

    if (profileRes.error) {
      error.value = toMessage(profileRes.error)
      pending.value = false
      return
    }

    goalMinutes.value = num(profileRes.data.daily_goal_minutes)
    today.value = todayLocalDay(profileRes.data.timezone)

    // Both in one trip. The topic split only exists for days with focus — which
    // is exactly the set of days that draw a mark you can hover — so this adds
    // no rows for the rest days that make up most of a long history.
    const [dailyRes, topicRes] = await Promise.all([
      supabase
        .from('v_daily_totals')
        .select('local_day, focus_seconds, goal_minutes, goal_met, session_count, interruptions')
        .order('local_day', { ascending: true }),
      supabase
        .from('v_daily_topic_totals')
        .select('local_day, topic_name, topic_color, focus_seconds')
    ])

    if (dailyRes.error ?? topicRes.error) {
      // Surfaced, never swallowed. RLS hands back `[]` for a failed query, which
      // is indistinguishable from a new account — and telling someone with a
      // year of history that their forest is empty is the worst thing this page
      // could do.
      error.value = toMessage(dailyRes.error ?? topicRes.error)
      pending.value = false
      return
    }

    build((dailyRes.data ?? []) as ForestRow[], (topicRes.data ?? []) as TopicRow[])
    pending.value = false
  }

  function build(rows: ForestRow[], topicRows: TopicRow[]) {
    const byDay = new Map(rows.map(row => [row.local_day, row]))

    // Topic rows arrive one per (day, topic). Collapse to a per-day list,
    // biggest share first, so the card can render its top few without sorting
    // on every hover.
    const topicsByDay = new Map<string, ForestDayTopic[]>()
    for (const row of topicRows) {
      const seconds = num(row.focus_seconds)
      if (seconds <= 0) continue
      const list = topicsByDay.get(row.local_day) ?? []
      list.push({ name: row.topic_name ?? 'No topic', color: row.topic_color, seconds })
      topicsByDay.set(row.local_day, list)
    }
    for (const list of topicsByDay.values()) list.sort((a, b) => b.seconds - a.seconds)

    // The forest starts at the first day with any row, not at signup: a
    // long-dormant account should not open on a wall of empty months.
    const first = rows[0]?.local_day ?? null
    const last = today.value
    if (first === null || last === null) {
      days.value = []
      treeCount.value = 0
      seedlingCount.value = 0
      bestMonth.value = null
      return
    }

    // Month names alone read better under the trees, but they stop being unique
    // the moment a forest spans a new year — so the year joins them only then.
    const spansYears = first.slice(0, 4) !== last.slice(0, 4)

    const out: ForestDay[] = []
    const treesPerMonth = new Map<string, { name: string, trees: number }>()
    let trees = 0
    let seedlings = 0
    let cursor = `${first.slice(0, 7)}-01`

    while (cursor <= last) {
      const length = daysInMonthOf(cursor)
      const key = cursor.slice(0, 7)
      const name = spansYears ? monthLabel(cursor) : monthName(cursor)

      for (let d = 1; d <= length; d++) {
        const localDay = `${key}-${String(d).padStart(2, '0')}`
        // A month in progress stops at today rather than drawing a fortnight of
        // ground the user has not lived yet.
        if (localDay > last) break
        if (localDay < first) continue

        const row = byDay.get(localDay)
        const focusSeconds = num(row?.focus_seconds)
        const goal = num(row?.goal_minutes)
        const tree = row !== undefined && earnedTree(row)

        let kind: DayKind = 'bare'
        if (tree) {
          kind = 'tree'
          trees++
          const bucket = treesPerMonth.get(key) ?? { name, trees: 0 }
          bucket.trees++
          treesPerMonth.set(key, bucket)
        } else if (focusSeconds > 0) {
          kind = 'seedling'
          seedlings++
        }

        out.push({
          localDay,
          kind,
          focusSeconds,
          // Guarded: `goal` is 0 for a user with no daily goal, and such a day
          // is never a tree anyway, so the ratio it would never use stays 0.
          ratio: goal > 0 ? focusSeconds / (goal * 60) : 0,
          monthStart: out.length === 0 || out[out.length - 1]!.localDay.slice(0, 7) !== key,
          monthName: name,
          sessionCount: num(row?.session_count),
          interruptions: num(row?.interruptions),
          topics: topicsByDay.get(localDay) ?? []
        })
      }

      cursor = nextMonthFirstDay(cursor)
    }

    let best: { name: string, trees: number } | null = null
    for (const bucket of treesPerMonth.values()) {
      if (best === null || bucket.trees > best.trees) best = bucket
    }

    days.value = out
    treeCount.value = trees
    seedlingCount.value = seedlings
    bestMonth.value = best?.name ?? null
  }

  return {
    days,
    treeCount,
    seedlingCount,
    bestMonth,
    goalMinutes,
    today,
    pending,
    error,
    refresh
  }
}

function nextMonthFirstDay(monthStart: LocalDay): LocalDay {
  const year = Number(monthStart.slice(0, 4))
  const month = Number(monthStart.slice(5, 7))
  // December rolls to January of the next year; `padStart` keeps the label
  // sortable, which is what every comparison in `build` relies on.
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`
}
