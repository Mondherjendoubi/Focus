import type { BlockFact } from '~/types/database'

/**
 * Today's finished sessions, for the Focus page's "Earlier today" rail card
 * (FA-020).
 *
 * The handoff called this layout-only work. It is not: nothing on the Focus
 * page queried past sessions before, so this composable is the new part.
 *
 * `v_session_summary` would be the obvious source — it has the title and the
 * totals — but it exposes no `local_day`, so filtering it to "today" would mean
 * bucketing `started_at` in the browser, which is the one thing the schema
 * rules forbid. `v_block_facts` carries the server-stamped `local_day`, so the
 * day filter happens in Postgres; its rows are then grouped by session here and
 * titles fetched by id.
 */

export interface TodaySession {
  sessionId: string
  title: string | null
  topicName: string | null
  /** From `topics.color` — the one hex the theme allows to be inline. */
  topicColor: string | null
  focusSeconds: number
}

function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function useTodaySessions() {
  const supabase = useSupabase()
  const { profile, load: loadProfile } = useProfile()

  const sessions = ref<TodaySession[]>([])
  const pending = ref(true)
  const error = ref<string | null>(null)

  async function refresh() {
    pending.value = true
    error.value = null
    try {
      if (!profile.value) await loadProfile()
      const timezone = profile.value?.timezone
      // No timezone means no honest way to name today. Better to show nothing
      // than to fall back to the browser's idea of the date.
      if (!timezone) {
        sessions.value = []
        return
      }

      const today = todayLocalDay(timezone)

      const factRes = await supabase
        .from('v_block_facts')
        .select('session_id, topic_name, topic_color, kind, net_seconds')
        .eq('local_day', today)

      if (factRes.error !== null) throw factRes.error

      const rows = (factRes.data ?? []) as Array<
        Pick<BlockFact, 'session_id' | 'topic_name' | 'topic_color' | 'kind' | 'net_seconds'>
      >

      // Group blocks into their sessions. The first topic seen wins the swatch:
      // a session can span topics, and the rail row has space for one dot.
      const grouped = new Map<string, TodaySession>()
      for (const row of rows) {
        if (row.kind !== 'focus') continue
        const entry = grouped.get(row.session_id) ?? {
          sessionId: row.session_id,
          title: null,
          topicName: row.topic_name,
          topicColor: row.topic_color,
          focusSeconds: 0
        }
        entry.focusSeconds += num(row.net_seconds)
        if (entry.topicName === null && row.topic_name !== null) {
          entry.topicName = row.topic_name
          entry.topicColor = row.topic_color
        }
        grouped.set(row.session_id, entry)
      }

      const ids = [...grouped.keys()]
      if (ids.length > 0) {
        // Titles are not on `v_block_facts`. RLS scopes `sessions`, so the id
        // filter is the only one needed.
        const titleRes = await supabase
          .from('sessions')
          .select('id, title')
          .in('id', ids)

        if (titleRes.error !== null) throw titleRes.error

        for (const row of (titleRes.data ?? []) as Array<{ id: string, title: string | null }>) {
          const entry = grouped.get(row.id)
          if (entry) entry.title = row.title
        }
      }

      sessions.value = [...grouped.values()]
        .filter(entry => entry.focusSeconds > 0)
        .sort((a, b) => b.focusSeconds - a.focusSeconds)
    } catch (err) {
      // Surfaced, never swallowed into an empty list — the card must be able to
      // say "couldn't load" rather than imply the day was empty.
      error.value = toMessage(err as Error)
    } finally {
      pending.value = false
    }
  }

  return { sessions, pending, error, refresh }
}
