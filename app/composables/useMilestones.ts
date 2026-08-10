import type { DailyTotal, SessionSummary, Streaks, TopicRollup } from '~/types/database'

/**
 * Records worth a confetti burst (FA-017).
 *
 * `SessionConfetti` used to fire on every completed session, which made it
 * wallpaper. Rarity is the whole mechanism: a reward that arrives every time
 * stops reading as a reward. This decides when something genuinely happened.
 *
 * Everything here is best-effort. The session has already ended successfully by
 * the time this runs, and a failed victory-lap query is not the user's problem —
 * `detectForSession` swallows its own errors and returns an empty list rather
 * than surfacing anything. Never let this block or complicate the end flow.
 */

export type MilestoneKind = 'longest_session' | 'best_day' | 'topic_hours' | 'longest_streak'

export interface Milestone {
  kind: MilestoneKind
  title: string
  detail: string
  icon: string
}

/** Topic totals worth marking, in hours. Sparse on purpose — see rarity above. */
const TOPIC_HOUR_THRESHOLDS = [10, 25, 50, 100, 250, 500]

function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function useMilestones() {
  const supabase = useSupabase()

  /**
   * What `sessionId` just broke, if anything.
   *
   * Call AFTER the `end_session` RPC has returned — the views only include
   * closed rows, so the session has to be finished to appear in them. Capture
   * the id before ending, though: `useActiveSession` nulls its `session` ref.
   */
  async function detectForSession(sessionId: string, topicId: string | null): Promise<Milestone[]> {
    try {
      const timezoneRes = await supabase.from('profiles').select('timezone').single()
      if (timezoneRes.error) return []
      const today = todayLocalDay(timezoneRes.data.timezone)

      const [sessionRes, dayRes, todayRes, streakRes, topicRes] = await Promise.all([
        // Top two by focus time: if row one is this session, row two is the
        // record it beat. One row total means this is the user's first closed
        // session, which is not a record worth celebrating.
        supabase
          .from('v_session_summary')
          .select('session_id, actual_focus_seconds, status')
          .not('ended_at', 'is', null)
          .order('actual_focus_seconds', { ascending: false })
          .limit(2),
        supabase
          .from('v_daily_totals')
          .select('local_day, focus_seconds')
          .order('focus_seconds', { ascending: false, nullsFirst: false })
          .limit(2),
        // Today's own row, so day-level milestones can tell "this session is
        // what crossed the line" from "the line was already crossed earlier".
        supabase
          .from('v_daily_totals')
          .select('local_day, focus_seconds')
          .eq('local_day', today)
          .maybeSingle(),
        supabase.from('v_streaks').select('*').maybeSingle(),
        topicId === null
          ? Promise.resolve({ data: null, error: null })
          : supabase
              .from('v_topic_rollup')
              .select('*')
              .eq('topic_id', topicId)
              .maybeSingle()
      ])

      const found: Milestone[] = []

      const sessions = (sessionRes.data ?? []) as Array<Pick<SessionSummary, 'session_id' | 'actual_focus_seconds' | 'status'>>
      const thisSession = sessions.find(row => row.session_id === sessionId)
      const thisSessionSeconds = num(thisSession?.actual_focus_seconds)

      // A first-ever session tops the list by default. That is not a record.
      // Strictly greater, so tying the record does not claim to have beaten it.
      const previousBestSession = num(sessions[1]?.actual_focus_seconds)
      if (
        sessions.length >= 2
        && sessions[0]?.session_id === sessionId
        && thisSessionSeconds > previousBestSession
      ) {
        found.push({
          kind: 'longest_session',
          title: 'Longest session yet',
          detail: `${formatDuration(thisSessionSeconds)} — past your previous best of ${formatDuration(previousBestSession)}.`,
          icon: 'i-lucide-trophy'
        })
      }

      // Day-level milestones are facts about TODAY, not about this session, so
      // they must fire on the session that crossed the line and not on every
      // session after it. Three sessions on a record day is one celebration.
      const todayTotal = num((todayRes.data as Pick<DailyTotal, 'focus_seconds'> | null)?.focus_seconds)
      const beforeThisSession = todayTotal - thisSessionSeconds

      const days = (dayRes.data ?? []) as Array<Pick<DailyTotal, 'local_day' | 'focus_seconds'>>
      // Best day that is not today. If today is not in the top two at all, this
      // is a day that beats today and the crossing test below correctly fails.
      const bestOtherDay = days.find(row => row.local_day !== today)
      if (bestOtherDay) {
        const previousBestDay = num(bestOtherDay.focus_seconds)
        if (beforeThisSession < previousBestDay && todayTotal >= previousBestDay) {
          found.push({
            kind: 'best_day',
            title: 'Best day on record',
            detail: `${formatDuration(todayTotal)} today — more than any day before it.`,
            icon: 'i-lucide-flame'
          })
        }
      }

      const streak = (streakRes.data ?? null) as Streaks | null
      // Equal, not greater: the view recomputes `longest` to include the run in
      // progress, so a record-setting streak reads as current === longest.
      // `beforeThisSession < 1` means today had no focus until now, which is
      // what makes this the session that extended the streak.
      if (
        streak
        && streak.current_streak > 1
        && streak.current_streak === streak.longest_streak
        && beforeThisSession < 1
      ) {
        found.push({
          kind: 'longest_streak',
          title: `${streak.current_streak}-day streak`,
          detail: 'Your longest run so far. Same again tomorrow.',
          icon: 'i-lucide-calendar-check'
        })
      }

      const rollup = (topicRes.data ?? null) as TopicRollup | null
      if (rollup) {
        const totalSeconds = num(rollup.total_focus_seconds)
        // Compare against the total BEFORE this session, so the threshold fires
        // once at the crossing instead of on every session from here on.
        const beforeSeconds = totalSeconds - thisSessionSeconds
        const crossed = TOPIC_HOUR_THRESHOLDS.find((hours) => {
          const mark = hours * 3600
          return beforeSeconds < mark && totalSeconds >= mark
        })
        if (crossed !== undefined) {
          found.push({
            kind: 'topic_hours',
            title: `${crossed} hours of ${rollup.topic_name}`,
            detail: `You have now put ${crossed} hours into ${rollup.topic_name}.`,
            icon: 'i-lucide-medal'
          })
        }
      }

      return found
    } catch {
      // Best-effort by design — the session ended fine, and no celebration is a
      // far better outcome than an error toast on top of a finished session.
      return []
    }
  }

  return { detectForSession }
}
