import type { PostgrestError } from '@supabase/supabase-js'
import type { FriendDay, FriendEdge, FriendStats, ProfileLookup } from '~/types/database'

/**
 * Friends (FA-018). Requires `Schema/02_social.sql` to have been run.
 *
 * Everything about someone else goes through a `security definer` RPC, never
 * through a table or a `v_*` view. That is not stylistic — every policy in
 * `01_schema.sql` is `for all using (user_id = auth.uid())`, and all 59 queries
 * in this app depend on RLS being the only filter. Widening those policies to
 * admit friends would fold their rows into every total the app renders, and
 * because the policies are `for all` rather than `for select`, would grant
 * friends write access as well. So: no policy changes, one narrow read path.
 *
 * The three RPCs are the entire surface:
 *   find_profile_by_username  exact handle lookup
 *   my_friends                all edges, both directions, with names
 *   friend_stats              aggregates for ONE accepted friend
 *
 * Requests, accepts and removals are plain writes against `friendships`, whose
 * own policies are split by command so the requester cannot self-accept.
 */

/** Mirrors the DB check constraint so the user hears about it before a round trip. */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/

/**
 * The one way a typed handle becomes a stored one.
 *
 * Handles are lowercase by constraint — `^[a-z0-9_]{3,20}$` rejects anything
 * else — so search is case-insensitive for free: both ends of the comparison
 * are lowered. Every entry point must normalise identically, which is why this
 * is shared rather than inlined; the settings field and the search box had
 * drifted apart on the leading `@` alone.
 *
 * The `@` is stripped because both fields render an at-sign icon, so typing it
 * is the natural thing to do.
 */
export function normaliseHandle(input: string): string {
  return input.trim().replace(/^@+/, '').trim().toLowerCase()
}

/** PostgREST serialises `bigint` as a string to protect precision. */
function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function normaliseStats(row: Record<string, unknown>): FriendStats {
  return {
    week_seconds: num(row.week_seconds),
    prev_week_seconds: num(row.prev_week_seconds),
    current_streak: num(row.current_streak),
    longest_streak: num(row.longest_streak),
    goal_days_hit: num(row.goal_days_hit),
    active_days: num(row.active_days)
  }
}

export function useFriends() {
  const supabase = useSupabase()
  const { user } = useAuth()

  const edges = useState<FriendEdge[]>('friends:edges', () => [])
  /** Keyed by `friend_id`. Absent = not loaded yet or no access. */
  const stats = useState<Record<string, FriendStats>>('friends:stats', () => ({}))
  /** Keyed by `friend_id`. Seven entries when present, oldest first. */
  const days = useState<Record<string, FriendDay[]>>('friends:days', () => ({}))
  const loading = useState<boolean>('friends:loading', () => false)
  const error = useState<string | null>('friends:error', () => null)
  const loaded = useState<boolean>('friends:loaded', () => false)

  const accepted = computed(() => edges.value.filter(edge => edge.direction === 'friend'))
  const incoming = computed(() => edges.value.filter(edge => edge.direction === 'incoming'))
  const outgoing = computed(() => edges.value.filter(edge => edge.direction === 'outgoing'))

  /** Drives the nav badge — requests waiting on YOU are the actionable ones. */
  const incomingCount = computed(() => incoming.value.length)

  /**
   * When this browser last opened the friends page.
   *
   * A friendship accepted after this is "new to you". Without it, a request you
   * sent just quietly appears among your friends one day with nothing marking
   * that it changed — you would have to remember who you had asked.
   *
   * localStorage rather than a column: it is per-device UI state, not
   * something another user should be able to observe, and it needs no migration.
   */
  const SEEN_KEY = 'focus:friends:seen'
  const lastSeen = useState<string | null>('friends:lastSeen', () => null)

  function readLastSeen() {
    if (import.meta.server) return
    lastSeen.value = window.localStorage.getItem(SEEN_KEY)
  }

  /** Newly accepted since the last visit, most recent first. */
  const newlyAccepted = computed(() => {
    const since = lastSeen.value
    if (since === null) return []
    return accepted.value.filter(edge =>
      edge.responded_at !== null && edge.responded_at > since
    )
  })

  function isNewlyAccepted(edge: FriendEdge): boolean {
    return newlyAccepted.value.some(item => item.friendship_id === edge.friendship_id)
  }

  /**
   * Stamp the visit. Called on leaving the page rather than entering it, so the
   * "New" chips stay visible for the whole visit that surfaced them instead of
   * vanishing as the list paints.
   */
  function markSeen() {
    if (import.meta.server) return
    window.localStorage.setItem(SEEN_KEY, new Date().toISOString())
  }

  function fail(err: PostgrestError | Error | unknown): never {
    const message = toMessage(err as PostgrestError | Error)
    error.value = message
    throw new Error(message)
  }

  /**
   * Edges only — one RPC, no per-friend stats.
   *
   * Split out because the nav badge needs the incoming count on every page, and
   * `load()` fires an extra `friend_stats` call per accepted friend. Making the
   * whole app pay N+1 round trips to render a number would be absurd.
   */
  async function loadEdges() {
    loading.value = true
    error.value = null
    try {
      const { data, error: err } = await supabase.rpc('my_friends')
      if (err) throw err

      edges.value = (data ?? []) as FriendEdge[]
      loaded.value = true
      readLastSeen()
    } catch (err) {
      // Surface it. An empty friends list and a failed query must not look the
      // same, least of all on a page whose whole point is other people.
      error.value = toMessage(err as PostgrestError | Error)
    } finally {
      loading.value = false
    }
  }

  /**
   * Everything the friends page needs. One call returns all three groups; the
   * computeds above split them. Three separate round trips for what the RPC
   * already hands over in one would be three chances to render an inconsistent
   * page.
   */
  async function load() {
    await loadEdges()
    if (error.value !== null) return

    // Aggregates only for accepted friends — the RPCs return nothing for
    // anyone else, so asking would be a wasted round trip per pending row.
    // Both calls for one friend go together, so a row never renders its totals
    // with somebody else's sparkline still filling in beside it.
    await Promise.all(
      accepted.value.map(edge =>
        Promise.all([loadStats(edge.friend_id), loadDays(edge.friend_id)])
      )
    )
  }

  /** Seven daily squares for one friend. Silent on failure, like `loadStats`. */
  async function loadDays(friendId: string) {
    const { data, error: err } = await supabase.rpc('friend_days', { p_friend_id: friendId })
    if (err) return

    const rows = (data ?? []) as Array<Record<string, unknown>>
    if (rows.length === 0) return

    days.value = {
      ...days.value,
      [friendId]: rows.map(row => ({
        local_day: String(row.local_day ?? ''),
        focus_seconds: num(row.focus_seconds),
        goal_met: row.goal_met === true
      }))
    }
  }

  /**
   * Aggregates for one friend. **Zero rows means no access** — the RPC returns
   * an empty set for a non-friend, which is indistinguishable from a friend who
   * has never studied. Neither is written into `stats`, so the UI can tell
   * "nothing to show" from "0h this week" and render accordingly.
   */
  async function loadStats(friendId: string) {
    const { data, error: err } = await supabase.rpc('friend_stats', { p_friend_id: friendId })
    if (err) return

    const rows = (data ?? []) as Array<Record<string, unknown>>
    const row = rows[0]
    if (!row) return

    stats.value = { ...stats.value, [friendId]: normaliseStats(row) }
  }

  /** Exact match only — the RPC does no prefix search, by design. */
  async function findByUsername(username: string): Promise<ProfileLookup | null> {
    const handle = normaliseHandle(username)
    if (!USERNAME_PATTERN.test(handle)) {
      fail(new Error('Handles are 3–20 characters: letters, numbers and underscores.'))
    }

    const { data, error: err } = await supabase.rpc('find_profile_by_username', {
      p_username: handle
    })
    if (err) fail(err)

    const rows = (data ?? []) as ProfileLookup[]
    return rows[0] ?? null
  }

  /**
   * The unique index is on the PAIR, so a request from someone who has already
   * requested you is a constraint violation rather than a second row. Checking
   * the loaded edges first turns that into "accept theirs instead".
   */
  function existingEdgeWith(friendId: string): FriendEdge | null {
    return edges.value.find(edge => edge.friend_id === friendId) ?? null
  }

  async function sendRequest(addresseeId: string) {
    if (!user.value) fail(new Error('You must be signed in.'))

    const { error: err } = await supabase
      .from('friendships')
      .insert({
        requester_id: user.value!.id,
        addressee_id: addresseeId,
        status: 'pending'
      })

    if (err) fail(err)
    await load()
  }

  /**
   * Only the addressee can do this — the policy and the guard trigger agree.
   *
   * `.select()` is not decoration. When RLS filters the target row out,
   * PostgREST reports **success with zero rows affected** and no error, so
   * checking `error` alone lets a refused accept look like a completed one:
   * the click does nothing, says nothing, and the request sits there still
   * reading "waiting for them to accept". Requiring a returned row turns that
   * silence into a sentence.
   */
  async function accept(friendshipId: string) {
    const { data, error: err } = await supabase
      .from('friendships')
      .update({ status: 'accepted' })
      .eq('id', friendshipId)
      .select()

    if (err) fail(err)
    if (!data || data.length === 0) {
      fail(new Error('That request could not be accepted — it may have been withdrawn. Reload and try again.'))
    }

    await load()
  }

  /**
   * Decline, cancel and unfriend are the same operation: drop the edge. There
   * is no soft-delete here deliberately — an archived friendship would keep
   * granting the aggregate access it was meant to end.
   */
  async function remove(friendshipId: string) {
    // Same trap as `accept`: a delete filtered out by RLS succeeds with zero
    // rows and no error, so the row would stay on screen with nothing said.
    const { data, error: err } = await supabase
      .from('friendships')
      .delete()
      .eq('id', friendshipId)
      .select()

    if (err) fail(err)
    if (!data || data.length === 0) {
      fail(new Error('That request could not be removed. Reload and try again.'))
    }

    await load()
  }

  return {
    edges,
    accepted,
    incoming,
    outgoing,
    incomingCount,
    newlyAccepted,
    isNewlyAccepted,
    markSeen,
    stats,
    days,
    loading,
    error,
    loaded,
    load,
    loadEdges,
    loadStats,
    loadDays,
    findByUsername,
    existingEdgeWith,
    sendRequest,
    accept,
    remove
  }
}
