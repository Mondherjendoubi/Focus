import type { BlockKind, SessionStatus, SessionSummary } from '~/types/database'

/**
 * Session history as a tape (FA-024), for `history-desktop-6a` / `-mobile-6b`.
 *
 * Both scenes render from the one view model below, so the desktop tape and the
 * mobile card can never disagree about what a session was.
 *
 * ## Days come from the BLOCKS, not the session
 *
 * `session_blocks.local_day` is stamped by a trigger from each block's own
 * `started_at` in the profile's zone (`set_block_local_day`). Every view in this
 * app — and therefore the dashboard, the streaks and the forest — buckets on
 * that column.
 *
 * So a session started at 15:42 and ended at 10:05 the next morning has blocks
 * on **two** days, and grouping it by `sessions.started_at` would file the whole
 * thing under the first one. History would then disagree with the forest about
 * the same hours, which is exactly the bug this replaced.
 *
 * A session that spans midnight is therefore SPLIT: it appears on each day it
 * has blocks on, showing only that day's blocks and only that day's focus. The
 * day totals here now equal `v_daily_totals.focus_seconds` by construction.
 */

/** One block as a slice of its session's bar. */
export interface HistorySegment {
  /** Percent of the day-slice's wall-clock span. */
  width: number
  /** Topic colour, or null for a break. Database-owned, so rendered inline. */
  color: string | null
  kind: BlockKind
  /** Still open — drawn hatched rather than solid. */
  running: boolean
}

export interface HistoryBlock {
  id: string
  kind: BlockKind
  topicName: string | null
  topicColor: string | null
  startedAt: string
  /** Wall-clock length, for the bar. Resolved against `now` while open. */
  seconds: number
  /** Paused time excluded — this is "time studied", and what totals use. */
  netSeconds: number
  running: boolean
}

export interface HistoryTopicShare {
  name: string
  color: string | null
  seconds: number
}

export interface HistorySession {
  /** Unique per day-slice: a split session appears twice with different keys. */
  key: string
  id: string
  title: string
  status: SessionStatus
  /** Fractional hours in the profile's zone — what the tape positions against. */
  startHour: number
  endHour: number
  /** First and last block ON THIS DAY. */
  startedAt: string
  endedAt: string | null
  /** This day's focus only. */
  focusSeconds: number
  breakSeconds: number
  plannedFocusSeconds: number | null
  adherenceRatio: number | null
  focusRating: number | null
  interruptions: number
  segments: HistorySegment[]
  /** Focus topics biggest-first; breaks are reported separately. */
  topics: HistoryTopicShare[]
  blocks: HistoryBlock[]
  /** The session crossed midnight, so this is one day's slice of it. */
  spansDays: boolean
}

export interface HistoryDay {
  day: string
  /** `Today` / `Yesterday` / `Sat · 8 Aug 2026`. */
  label: string
  /** The full date, shown beside `Today`/`Yesterday` only. */
  dateLabel: string | null
  sessions: HistorySession[]
  focusSeconds: number
}

/** The handoff's axis. Widened, never narrowed, to cover what actually happened. */
const DEFAULT_START_HOUR = 7
const DEFAULT_END_HOUR = 23

const PAGE_SIZE = 20

function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/** As loaded, before `now` is applied to whatever is still open. */
interface RawBlock {
  id: string
  sessionId: string
  kind: BlockKind
  topicName: string | null
  topicColor: string | null
  startedAt: string
  endedAt: string | null
  localDay: string
  netSeconds: number | null
  pausedSeconds: number
}

export function useHistory() {
  const supabase = useSupabase()

  const days = ref<HistoryDay[]>([])
  const legend = ref<HistoryTopicShare[]>([])
  const timezone = ref('UTC')
  const startHour = ref(DEFAULT_START_HOUR)
  const endHour = ref(DEFAULT_END_HOUR)
  const pending = ref(true)
  const loadingMore = ref(false)
  const error = ref<string | null>(null)
  const hasMore = ref(true)

  const page = ref(0)
  const rawSessions = ref<SessionSummary[]>([])
  const rawBlocks = ref<RawBlock[]>([])

  // Formatters are as costly to build as they are in `app/utils/dates.ts`, and
  // for the same reason they are cached on the zone rather than rebuilt per row.
  const clock = computed(() => new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone.value,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }))

  const dayKey = computed(() => new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone.value,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }))

  const dayFull = computed(() => new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone.value,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }))

  /** `'08:40'`, in the PROFILE's zone — the same one the trigger stamps days in. */
  function timeLabel(instant: string): string {
    return clock.value.format(new Date(instant))
  }

  /** Hours since midnight as a float, so `08:40` is `8.667`. */
  function hourFraction(instant: string): number {
    const [h, m] = timeLabel(instant).split(':').map(Number)
    return (h ?? 0) + (m ?? 0) / 60
  }

  function localDayOf(instant: string): string {
    const parts = dayKey.value.formatToParts(new Date(instant))
    const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? ''
    return `${get('year')}-${get('month')}-${get('day')}`
  }

  async function loadTimezone() {
    const { data } = await supabase.from('profiles').select('timezone').maybeSingle()
    const tz = (data as { timezone?: unknown } | null)?.timezone
    if (typeof tz === 'string' && tz !== '') timezone.value = tz
  }

  /**
   * Blocks for a page of sessions.
   *
   * Two queries, because `v_block_facts` is `where ended_at is not null` — it
   * cannot see the block running right now, which is exactly the one the designs
   * draw hatched. The second picks that up from the base table and embeds its
   * topic, since the view's join is what leaving the view costs.
   */
  async function loadBlocks(ids: string[]) {
    if (ids.length === 0) return

    const [closedRes, openRes] = await Promise.all([
      supabase
        .from('v_block_facts')
        .select('block_id, session_id, kind, topic_name, topic_color, started_at, ended_at, local_day, net_seconds')
        .in('session_id', ids),
      supabase
        .from('session_blocks')
        .select('id, session_id, kind, started_at, local_day, paused_seconds, topics(name, color)')
        .in('session_id', ids)
        .is('ended_at', null)
    ])

    if (closedRes.error ?? openRes.error) throw closedRes.error ?? openRes.error

    type ClosedRow = {
      block_id: string
      session_id: string
      kind: BlockKind
      topic_name: string | null
      topic_color: string | null
      started_at: string
      ended_at: string
      local_day: string
      net_seconds: number
    }
    type OpenRow = {
      id: string
      session_id: string
      kind: BlockKind
      started_at: string
      local_day: string | null
      paused_seconds: number
      topics: { name: string | null, color: string | null } | null
    }

    const incoming: RawBlock[] = []

    for (const row of (closedRes.data ?? []) as unknown as ClosedRow[]) {
      incoming.push({
        id: row.block_id,
        sessionId: row.session_id,
        kind: row.kind,
        topicName: row.topic_name,
        topicColor: row.topic_color,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        localDay: row.local_day,
        netSeconds: num(row.net_seconds),
        pausedSeconds: 0
      })
    }

    for (const row of (openRes.data ?? []) as unknown as OpenRow[]) {
      incoming.push({
        id: row.id,
        sessionId: row.session_id,
        kind: row.kind,
        topicName: row.topics?.name ?? null,
        topicColor: row.topics?.color ?? null,
        startedAt: row.started_at,
        endedAt: null,
        // The trigger stamps this on insert, so it should always be present;
        // derive it rather than drop the block if it somehow is not.
        localDay: row.local_day ?? localDayOf(row.started_at),
        netSeconds: null,
        pausedSeconds: num(row.paused_seconds)
      })
    }

    const seen = new Set(rawBlocks.value.map(block => block.id))
    rawBlocks.value = [...rawBlocks.value, ...incoming.filter(block => !seen.has(block.id))]
  }

  async function loadPage(next: number) {
    const from = next * PAGE_SIZE
    const { data, error: err } = await supabase
      .from('v_session_summary')
      .select('*')
      .order('started_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)

    if (err) throw err

    const rows = (data ?? []) as SessionSummary[]
    rawSessions.value = next === 0 ? rows : [...rawSessions.value, ...rows]
    if (next === 0) rawBlocks.value = []
    hasMore.value = rows.length === PAGE_SIZE
    page.value = next

    await loadBlocks(rows.map(row => row.session_id))
    build()
  }

  async function load() {
    pending.value = true
    error.value = null
    try {
      await loadTimezone()
      await loadPage(0)
    } catch (err) {
      // Surfaced, never swallowed: RLS returns `[]` for a failed read, which is
      // identical to a new account.
      error.value = toMessage(err as Error)
    } finally {
      pending.value = false
    }
  }

  async function loadMore() {
    if (loadingMore.value || !hasMore.value) return
    loadingMore.value = true
    error.value = null
    try {
      await loadPage(page.value + 1)
    } catch (err) {
      error.value = toMessage(err as Error)
    } finally {
      loadingMore.value = false
    }
  }

  function build() {
    const now = Date.now()
    const byId = new Map(rawSessions.value.map(row => [row.session_id, row]))

    // (local_day → session id → its blocks on that day). Bucketing on the
    // block's own stamped day is what keeps this page in step with the forest.
    const grid = new Map<string, Map<string, HistoryBlock[]>>()
    /** How many distinct days each session touches, so a split one can say so. */
    const daysPerSession = new Map<string, Set<string>>()

    for (const raw of rawBlocks.value) {
      if (!byId.has(raw.sessionId)) continue

      const seconds = raw.endedAt === null
        ? Math.max(0, (now - new Date(raw.startedAt).getTime()) / 1000)
        : Math.max(0, (new Date(raw.endedAt).getTime() - new Date(raw.startedAt).getTime()) / 1000)

      const block: HistoryBlock = {
        id: raw.id,
        kind: raw.kind,
        topicName: raw.topicName,
        topicColor: raw.topicColor,
        startedAt: raw.startedAt,
        seconds,
        // An open block has no stored `net_seconds`; subtracting the pauses it
        // has accrued is closer than counting it as zero, which is what
        // `v_session_summary` does.
        netSeconds: raw.netSeconds ?? Math.max(0, seconds - raw.pausedSeconds),
        running: raw.endedAt === null
      }

      const day = grid.get(raw.localDay) ?? new Map<string, HistoryBlock[]>()
      const list = day.get(raw.sessionId) ?? []
      list.push(block)
      day.set(raw.sessionId, list)
      grid.set(raw.localDay, day)

      const touched = daysPerSession.get(raw.sessionId) ?? new Set<string>()
      touched.add(raw.localDay)
      daysPerSession.set(raw.sessionId, touched)
    }

    // A session that recorded no blocks at all would otherwise vanish. It has no
    // stamped day to use, so it falls back to where it started.
    for (const row of rawSessions.value) {
      if (daysPerSession.has(row.session_id)) continue
      const day = localDayOf(row.started_at)
      const bucket = grid.get(day) ?? new Map<string, HistoryBlock[]>()
      bucket.set(row.session_id, [])
      grid.set(day, bucket)
      daysPerSession.set(row.session_id, new Set([day]))
    }

    const legendMap = new Map<string, HistoryTopicShare>()
    let minHour = DEFAULT_START_HOUR
    let maxHour = DEFAULT_END_HOUR

    const built: HistoryDay[] = []

    for (const [day, sessionsOnDay] of grid) {
      const sessions: HistorySession[] = []
      let dayFocus = 0

      for (const [sessionId, blocks] of sessionsOnDay) {
        const row = byId.get(sessionId)
        if (!row) continue

        blocks.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        const first = blocks[0]
        const last = blocks[blocks.length - 1]

        const startedAt = first?.startedAt ?? row.started_at
        const lastEndMs = last === undefined
          ? new Date(row.ended_at ?? row.started_at).getTime()
          : new Date(last.startedAt).getTime() + last.seconds * 1000
        const endedAt = last?.running === true ? null : new Date(lastEndMs).toISOString()

        const startHourFrac = hourFraction(startedAt)
        // Blocks are stamped by their START, so the last one on a day can still
        // run past midnight. Pinned to 24 rather than wrapping to a negative bar.
        let endHourFrac = hourFraction(new Date(lastEndMs).toISOString())
        if (endHourFrac < startHourFrac) endHourFrac = 24

        const spanMs = Math.max(0, lastEndMs - new Date(startedAt).getTime())

        let focusSeconds = 0
        let breakSeconds = 0
        const topicMap = new Map<string, HistoryTopicShare>()
        const segments: HistorySegment[] = []

        for (const block of blocks) {
          segments.push({
            width: spanMs > 0 ? (block.seconds * 1000 * 100) / spanMs : 100 / blocks.length,
            color: block.kind === 'focus' ? block.topicColor : null,
            kind: block.kind,
            running: block.running
          })

          if (block.kind !== 'focus') {
            breakSeconds += block.netSeconds
            continue
          }

          focusSeconds += block.netSeconds
          const name = block.topicName ?? 'No topic'
          const share = topicMap.get(name) ?? { name, color: block.topicColor, seconds: 0 }
          share.seconds += block.netSeconds
          topicMap.set(name, share)
          if (!legendMap.has(name)) legendMap.set(name, { name, color: block.topicColor, seconds: 0 })
        }

        const spansDays = (daysPerSession.get(sessionId)?.size ?? 1) > 1

        sessions.push({
          key: `${day}:${sessionId}`,
          id: sessionId,
          title: row.title?.trim() || row.template_name?.trim() || 'Focus session',
          status: row.status,
          startHour: startHourFrac,
          endHour: endHourFrac,
          startedAt,
          endedAt,
          focusSeconds,
          breakSeconds,
          // Adherence compares a WHOLE session against its plan, so it means
          // nothing about one day's slice of a split one.
          plannedFocusSeconds: spansDays || row.planned_focus_seconds === null
            ? null
            : num(row.planned_focus_seconds),
          adherenceRatio: spansDays || row.adherence_ratio === null ? null : num(row.adherence_ratio),
          focusRating: row.focus_rating,
          interruptions: num(row.interruptions),
          segments,
          topics: [...topicMap.values()].sort((a, b) => b.seconds - a.seconds),
          blocks,
          spansDays
        })

        dayFocus += focusSeconds
        minHour = Math.min(minHour, Math.floor(startHourFrac))
        maxHour = Math.max(maxHour, Math.ceil(endHourFrac))
      }

      const full = dayFull.value.format(new Date(`${day}T12:00:00Z`))
      built.push({
        day,
        label: full,
        dateLabel: null,
        sessions: sessions.sort((a, b) => a.startHour - b.startHour),
        focusSeconds: dayFocus
      })
    }

    // Even hours only, so the 2-hour gridline spacing the handoff uses survives
    // a window that had to widen.
    startHour.value = Math.max(0, minHour - (minHour % 2))
    endHour.value = Math.min(24, maxHour % 2 === 0 ? maxHour : maxHour + 1)

    const today = localDayOf(new Date(now).toISOString())
    const yesterday = localDayOf(new Date(now - 86_400_000).toISOString())

    days.value = built
      .sort((a, b) => b.day.localeCompare(a.day))
      .map(entry => ({
        ...entry,
        label: entry.day === today ? 'Today' : entry.day === yesterday ? 'Yesterday' : entry.label,
        dateLabel: entry.day === today || entry.day === yesterday ? entry.label : null
      }))

    legend.value = [...legendMap.values()]
  }

  return {
    days,
    legend,
    startHour,
    endHour,
    pending,
    loadingMore,
    error,
    hasMore,
    load,
    loadMore,
    timeLabel
  }
}
