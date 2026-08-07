import type { PostgrestError } from '@supabase/supabase-js'
import type { Topic, TopicRollup } from '~/types/database'

/**
 * Topic tree state — active + archived rows, plus the all-time rollup that
 * each row renders as "hours studied".
 *
 * RLS scopes every query by `auth.uid()`, so we never filter by user_id.
 * Mutations pass `user_id` on insert because the column is `not null` and
 * has no default; the `with check (user_id = auth.uid())` policy still
 * enforces ownership.
 */

/** Only the fields the form ever writes. `id` and timestamps stay server-owned. */
export interface TopicInput {
  name: string
  color: string
  icon: string | null
  parent_id: string | null
  description: string | null
  position?: number
}

const EMPTY_ROLLUPS: ReadonlyMap<string, TopicRollup> = new Map()

export function useTopics() {
  const supabase = useSupabase()
  const { user } = useAuth()

  const active = useState<Topic[]>('topics:active', () => [])
  const archived = useState<Topic[]>('topics:archived', () => [])
  const rollups = useState<ReadonlyMap<string, TopicRollup>>('topics:rollups', () => EMPTY_ROLLUPS)
  const loading = useState<boolean>('topics:loading', () => false)
  const error = useState<string | null>('topics:error', () => null)
  const loaded = useState<boolean>('topics:loaded', () => false)

  function fail(err: PostgrestError | Error | unknown): never {
    const message = toMessage(err as PostgrestError | Error)
    error.value = message
    throw new Error(message)
  }

  async function load() {
    loading.value = true
    error.value = null
    try {
      const [activeRes, archivedRes, rollupRes] = await Promise.all([
        supabase.from('topics').select('*').is('archived_at', null).order('position'),
        supabase.from('topics').select('*').not('archived_at', 'is', null).order('archived_at', { ascending: false }),
        supabase.from('v_topic_rollup').select('*')
      ])

      if (activeRes.error) throw activeRes.error
      if (archivedRes.error) throw archivedRes.error
      if (rollupRes.error) throw rollupRes.error

      active.value = (activeRes.data ?? []) as Topic[]
      archived.value = (archivedRes.data ?? []) as Topic[]

      const map = new Map<string, TopicRollup>()
      for (const row of (rollupRes.data ?? []) as TopicRollup[]) {
        map.set(row.topic_id, row)
      }
      rollups.value = map
      loaded.value = true
    } catch (err) {
      // Surface the failure to the UI instead of pretending "no data".
      error.value = toMessage(err as PostgrestError | Error)
    } finally {
      loading.value = false
    }
  }

  async function refresh() {
    await load()
  }

  /**
   * Next `position` for a sibling group. Positions are per-parent and only
   * used for ordering, so a monotonic append is enough.
   */
  function nextPosition(parentId: string | null): number {
    let max = -1
    for (const topic of active.value) {
      if (topic.parent_id === parentId && topic.position > max) max = topic.position
    }
    return max + 1
  }

  async function create(input: TopicInput): Promise<Topic> {
    if (!user.value) fail(new Error('You must be signed in.'))

    const payload = {
      user_id: user.value!.id,
      name: input.name.trim(),
      color: input.color,
      icon: input.icon,
      parent_id: input.parent_id,
      description: input.description,
      position: input.position ?? nextPosition(input.parent_id)
    }

    const { data, error: err } = await supabase
      .from('topics')
      .insert(payload)
      .select()
      .single()

    if (err || !data) fail(err ?? new Error('Insert returned no row.'))

    await refresh()
    return data as Topic
  }

  async function update(id: string, input: TopicInput): Promise<Topic> {
    const patch = {
      name: input.name.trim(),
      color: input.color,
      icon: input.icon,
      parent_id: input.parent_id,
      description: input.description,
      ...(input.position !== undefined ? { position: input.position } : {})
    }

    const { data, error: err } = await supabase
      .from('topics')
      .update(patch)
      .eq('id', id)
      .select()
      .single()

    if (err || !data) fail(err ?? new Error('Update returned no row.'))

    await refresh()
    return data as Topic
  }

  async function archive(id: string): Promise<void> {
    const { error: err } = await supabase
      .from('topics')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id)
    if (err) fail(err)
    await refresh()
  }

  async function restore(id: string): Promise<void> {
    const { error: err } = await supabase
      .from('topics')
      .update({ archived_at: null })
      .eq('id', id)
    if (err) fail(err)
    await refresh()
  }

  /**
   * Swap `position` with the adjacent visible sibling. If already at the edge,
   * this is a no-op — the button is disabled in that case anyway.
   */
  async function move(id: string, direction: 'up' | 'down'): Promise<void> {
    const target = active.value.find(t => t.id === id)
    if (!target) return

    const siblings = active.value
      .filter(t => t.parent_id === target.parent_id)
      .sort((a, b) => a.position - b.position)

    const index = siblings.findIndex(t => t.id === id)
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= siblings.length) return

    const other = siblings[swapIndex]!
    // Two writes; if the second fails the first has already landed and the
    // next refresh reflects reality. Not atomic but good enough for a manual
    // reorder that stays visible.
    const first = await supabase.from('topics').update({ position: other.position }).eq('id', target.id)
    if (first.error) fail(first.error)
    const second = await supabase.from('topics').update({ position: target.position }).eq('id', other.id)
    if (second.error) fail(second.error)

    await refresh()
  }

  /**
   * IDs of every topic beneath `id` in the active tree, plus `id` itself.
   * Used to filter the parent picker: a topic can't be reparented under
   * itself or any of its descendants without triggering `check_topic_cycle`.
   */
  function descendantsOf(id: string): Set<string> {
    const result = new Set<string>([id])
    const byParent = new Map<string | null, Topic[]>()
    for (const topic of active.value) {
      const list = byParent.get(topic.parent_id) ?? []
      list.push(topic)
      byParent.set(topic.parent_id, list)
    }

    const queue: string[] = [id]
    while (queue.length > 0) {
      const current = queue.shift()!
      const children = byParent.get(current) ?? []
      for (const child of children) {
        if (!result.has(child.id)) {
          result.add(child.id)
          queue.push(child.id)
        }
      }
    }
    return result
  }

  return {
    active,
    archived,
    rollups,
    loading,
    error,
    loaded,
    load,
    refresh,
    create,
    update,
    archive,
    restore,
    move,
    descendantsOf,
    nextPosition
  }
}
