import type { DailyTotal, LocalDay } from '~/types/database'

/**
 * The forest (FA-023): one tree per day the daily goal was cleared.
 *
 * No new SQL. `v_daily_totals` already reports `goal_met` per server-stamped
 * `local_day`, is `security_invoker`, and RLS scopes it to the caller — so this
 * is one query over all time.
 *
 * Days come back sparse: a day nobody studied has no row at all. Layout is
 * therefore built from the CALENDAR and the rows are joined onto it, never the
 * other way round, or a month would silently close up its gaps and every forest
 * would look consistent.
 */

/** What one day contributes to the forest floor. */
export type DayKind = 'tree' | 'sprout' | 'bare'

export interface ForestDay {
  localDay: LocalDay
  /** Day of the month, 1-based — this is the column the mark sits in. */
  dayOfMonth: number
  kind: DayKind
  focusSeconds: number
  /**
   * Focus over goal, so 1 is exactly on target and 2 is double. 0 on a day with
   * no goal to be a ratio of. Drives how deep a tree's green goes.
   */
  ratio: number
}

export interface ForestMonth {
  /** `'YYYY-MM'` — stable key, and what the bands are grouped by. */
  key: string
  label: string
  /** Every day of the month up to today, oldest first. Never sparse. */
  days: ForestDay[]
  treeCount: number
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

type ForestRow = Pick<DailyTotal, 'local_day' | 'focus_seconds' | 'goal_minutes' | 'goal_met'>

/**
 * Whether a day earned a tree.
 *
 * **The `goal_minutes > 0` half is the entire correctness of this feature.**
 * `v_daily_totals` computes `goal_met` as `focus_seconds / 60.0 >=
 * daily_goal_minutes` with no guard on a zero goal, and `daily_goal_minutes` is
 * `check (>= 0)` — so for a user who switched their goal off, every day with a
 * single logged minute comes back `goal_met = true`. `friend_days` guards this
 * server-side and says why; this view does not, so the client must.
 *
 * Exported because the page needs the same rule to decide whether a forest is
 * even possible, and two copies of it would be one copy too many.
 */
export function earnedTree(row: Pick<ForestRow, 'goal_minutes' | 'goal_met'>): boolean {
  return num(row.goal_minutes) > 0 && row.goal_met === true
}

export function useForest() {
  const supabase = useSupabase()

  const months = ref<ForestMonth[]>([])
  const treeCount = ref(0)
  /** The profile's daily goal. 0 means no tree can ever be earned. */
  const goalMinutes = ref(0)
  /** Today in the PROFILE's zone — the one tree allowed to animate. */
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

    const { data, error: err } = await supabase
      .from('v_daily_totals')
      .select('local_day, focus_seconds, goal_minutes, goal_met')
      .order('local_day', { ascending: true })

    if (err) {
      // Surfaced, never swallowed. RLS hands back `[]` for a failed query, which
      // is indistinguishable from a new account — and telling someone with a
      // year of history that their forest is empty is the worst thing this page
      // could do.
      error.value = toMessage(err)
      pending.value = false
      return
    }

    build((data ?? []) as ForestRow[])
    pending.value = false
  }

  function build(rows: ForestRow[]) {
    const byDay = new Map(rows.map(row => [row.local_day, row]))

    // Bands run from the first day that has any row to today. Starting at the
    // first row rather than at signup keeps a long-dormant account from opening
    // on a wall of empty months.
    const first = rows[0]?.local_day ?? null
    const last = today.value
    if (first === null || last === null) {
      months.value = []
      treeCount.value = 0
      return
    }

    const out: ForestMonth[] = []
    let total = 0
    let cursor = monthFirstDay(first)

    while (cursor <= last) {
      const length = daysInMonthOf(cursor)
      const days: ForestDay[] = []
      let trees = 0

      for (let d = 1; d <= length; d++) {
        const localDay = withDayOfMonth(cursor, d)
        // A month in progress stops at today rather than drawing a fortnight of
        // ground the user has not lived yet.
        if (localDay > last) break

        const row = byDay.get(localDay)
        const focusSeconds = num(row?.focus_seconds)
        const goal = num(row?.goal_minutes)
        const tree = row !== undefined && earnedTree(row)
        if (tree) trees++

        days.push({
          localDay,
          dayOfMonth: d,
          kind: tree ? 'tree' : focusSeconds > 0 ? 'sprout' : 'bare',
          focusSeconds,
          // Guarded: `goal` is 0 for a user with no daily goal, and that day is
          // never a tree anyway, so the ratio it would never use stays 0.
          ratio: goal > 0 ? focusSeconds / (goal * 60) : 0
        })
      }

      if (days.length > 0) {
        out.push({ key: cursor.slice(0, 7), label: monthLabel(cursor), days, treeCount: trees })
        total += trees
      }

      cursor = nextMonthFirstDay(cursor)
    }

    // Newest first: the month you are living in is the one you came to see.
    out.reverse()
    months.value = out
    treeCount.value = total
  }

  return { months, treeCount, goalMinutes, today, pending, error, refresh }
}

/** `'2026-08-06'` → `'2026-08-01'`. String work only: these labels carry no time. */
function monthFirstDay(localDay: LocalDay): LocalDay {
  return `${localDay.slice(0, 7)}-01`
}

function withDayOfMonth(monthStart: LocalDay, day: number): LocalDay {
  return `${monthStart.slice(0, 7)}-${String(day).padStart(2, '0')}`
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
