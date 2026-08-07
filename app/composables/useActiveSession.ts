import type { ComputedRef } from 'vue'
import type { BlockKind, BlockPause, Session, SessionBlock, SessionStatus } from '~/types/database'

/**
 * The live-timer state machine. One trip through the RPCs, one restore path
 * for reloads, and a derived clock that never accumulates.
 *
 * Truth lives in Postgres. Every mutation goes through a `security invoker`
 * RPC that guards the invariants — `sessions_one_active`, `blocks_no_overlap`,
 * `pauses_one_open` — so this composable is a thin client over them, not a
 * second copy of the rules. On any RPC failure we re-read the three open rows
 * rather than trust the optimistic update: an inconsistent UI showing a
 * running timer that isn't is worse than a re-render.
 *
 * `elapsedSeconds` is derived from `Date.now()` and the row timestamps. The
 * interval only bumps `now`; it never adds a second to a counter, because
 * browsers throttle background tabs to roughly one tick a minute and any
 * accumulator would drift. Rendering is a UI concern (FA-008); this file
 * returns numbers.
 *
 * Shared state: session / block / pause / now live in `useState`, so any
 * component that calls `useActiveSession` reads the same live values. This
 * lets the app shell surface the timer (browser tab title, page badge) even
 * while the user is on a page other than the Focus page. Each caller still
 * runs its own tick interval — cheap, and cleanup is per-instance.
 */
export function useActiveSession() {
  const supabase = useSupabase()

  const session = useState<Session | null>('active:session', () => null)
  const block = useState<SessionBlock | null>('active:block', () => null)
  const pause = useState<BlockPause | null>('active:pause', () => null)

  const loading = ref(false)
  const error = ref<string | null>(null)

  // Reactive "current time" — the interval writes here, computed reads here.
  const now = useState<number>('active:now', () => Date.now())
  let intervalId: ReturnType<typeof setInterval> | null = null

  function startTicking() {
    if (intervalId !== null) return
    now.value = Date.now()
    intervalId = setInterval(() => {
      now.value = Date.now()
    }, 250)
  }

  function stopTicking() {
    if (intervalId === null) return
    clearInterval(intervalId)
    intervalId = null
  }

  // Start/stop the interval strictly with the running block.
  watch(() => block.value?.id ?? null, (id) => {
    if (id !== null) {
      startTicking()
    } else {
      stopTicking()
    }
  })

  onUnmounted(stopTicking)

  // ---------------------------------------------------------------------
  // Derived timings
  // ---------------------------------------------------------------------

  /**
   * Wall clock since the block started, minus completed pauses (synced by
   * trigger into `paused_seconds`), minus the currently-open pause if any.
   * Clamped to zero — clock skew between browser and server would otherwise
   * briefly render as a negative "elapsed" right after `start_block`.
   */
  const elapsedSeconds: ComputedRef<number> = computed(() => {
    const b = block.value
    if (b === null) return 0

    const startedAtMs = Date.parse(b.started_at)
    if (Number.isNaN(startedAtMs)) return 0

    const paused = b.paused_seconds
    const openPause = pause.value
    const openPauseSeconds = openPause !== null
      ? Math.max(0, (now.value - Date.parse(openPause.started_at)) / 1000)
      : 0

    const raw = (now.value - startedAtMs) / 1000 - paused - openPauseSeconds
    return Math.max(0, raw)
  })

  /**
   * Null for an open-ended block — the UI must render that as "no target",
   * not as an infinite countdown. When a plan exists we clamp to zero, so an
   * overrunning block reads as zero here and FA-008 decides how to show
   * overtime; a negative number would render as `-00:03` and mislead.
   */
  const remainingSeconds: ComputedRef<number | null> = computed(() => {
    const b = block.value
    if (b === null || b.planned_seconds === null) return null
    return Math.max(0, b.planned_seconds - elapsedSeconds.value)
  })

  /** Open pause = paused. The `pause` ref is pre-filtered to open rows. */
  const isPaused: ComputedRef<boolean> = computed(() => pause.value !== null)

  // ---------------------------------------------------------------------
  // Restore — the truth-from-DB path, also used to reconcile after failures
  // ---------------------------------------------------------------------

  /**
   * Re-reads the three open rows. `maybeSingle()` because none of these is
   * required to exist — a user without a running session gets zero rows, not
   * an error. RLS scopes each query by `auth.uid()`, so no `user_id` filter
   * here; a stray one would be redundant and silently misleading.
   */
  async function refresh() {
    loading.value = true
    error.value = null
    try {
      const [sessionRes, blockRes, pauseRes] = await Promise.all([
        supabase.from('sessions').select('*').eq('status', 'active').maybeSingle(),
        supabase.from('session_blocks').select('*').is('ended_at', null).maybeSingle(),
        supabase.from('block_pauses').select('*').is('ended_at', null).maybeSingle()
      ])

      if (sessionRes.error !== null) throw sessionRes.error
      if (blockRes.error !== null) throw blockRes.error
      if (pauseRes.error !== null) throw pauseRes.error

      session.value = (sessionRes.data as Session | null) ?? null
      block.value = (blockRes.data as SessionBlock | null) ?? null
      pause.value = (pauseRes.data as BlockPause | null) ?? null
    } catch (err) {
      error.value = toMessage(err as Error)
      // Do not blank state on read failure — a transient network blip should
      // not wipe a running timer the user can still see counting.
    } finally {
      loading.value = false
    }
  }

  onMounted(() => {
    void refresh()
  })

  // ---------------------------------------------------------------------
  // Actions — one per RPC. Every one reconciles from DB on failure.
  // ---------------------------------------------------------------------

  async function startSession(args: {
    templateId?: string | null
    topicId?: string | null
    title?: string | null
  } = {}) {
    loading.value = true
    error.value = null
    const { data, error: rpcError } = await supabase.rpc('start_session', {
      p_template_id: args.templateId ?? null,
      p_topic_id: args.topicId ?? null,
      p_title: args.title ?? null
    })
    if (rpcError !== null) {
      error.value = toMessage(rpcError)
      await refresh()
      loading.value = false
      return
    }
    // The RPC also abandons any prior active session and its open block+pause,
    // so we clear those locally rather than trust stale refs.
    session.value = data as Session
    block.value = null
    pause.value = null
    loading.value = false
  }

  async function startBlock(args: {
    topicId?: string | null
    kind?: BlockKind
    plannedSeconds?: number | null
    templateBlockId?: string | null
  } = {}) {
    const current = session.value
    if (current === null) {
      error.value = 'Start a session first.'
      return
    }
    loading.value = true
    error.value = null
    const { data, error: rpcError } = await supabase.rpc('start_block', {
      p_session_id: current.id,
      p_topic_id: args.topicId ?? null,
      p_kind: args.kind ?? 'focus',
      p_planned_seconds: args.plannedSeconds ?? null,
      p_template_block_id: args.templateBlockId ?? null
    })
    if (rpcError !== null) {
      error.value = toMessage(rpcError)
      await refresh()
      loading.value = false
      return
    }
    // The RPC closes any prior open block and, by cascade, its open pause.
    block.value = data as SessionBlock
    pause.value = null
    loading.value = false
  }

  async function endBlock(args: { note?: string | null } = {}) {
    const current = block.value
    if (current === null) return
    loading.value = true
    error.value = null
    const { error: rpcError } = await supabase.rpc('end_block', {
      p_block_id: current.id,
      p_note: args.note ?? null
    })
    if (rpcError !== null) {
      error.value = toMessage(rpcError)
      await refresh()
      loading.value = false
      return
    }
    // The RPC also closes the open pause.
    block.value = null
    pause.value = null
    loading.value = false
  }

  async function pauseBlock(args: { reason?: string | null } = {}) {
    const current = block.value
    if (current === null) return
    loading.value = true
    error.value = null
    const { data, error: rpcError } = await supabase.rpc('pause_block', {
      p_block_id: current.id,
      p_reason: args.reason ?? null
    })
    if (rpcError !== null) {
      error.value = toMessage(rpcError)
      await refresh()
      loading.value = false
      return
    }
    pause.value = data as BlockPause
    // The RPC bumps interruptions on the block row; mirror it locally so the
    // count updates without a full refetch.
    block.value = { ...current, interruptions: current.interruptions + 1 }
    loading.value = false
  }

  async function resumeBlock() {
    const currentBlock = block.value
    const currentPause = pause.value
    if (currentBlock === null || currentPause === null) return
    loading.value = true
    error.value = null
    const { error: rpcError } = await supabase.rpc('resume_block', {
      p_block_id: currentBlock.id
    })
    if (rpcError !== null) {
      error.value = toMessage(rpcError)
      await refresh()
      loading.value = false
      return
    }
    pause.value = null
    // The `pauses_sync` trigger just wrote a new `paused_seconds`. Re-read the
    // block so the derived elapsed picks it up immediately; without this the
    // clock would double-count the pause we just closed.
    const { data: blockData, error: blockErr } = await supabase
      .from('session_blocks').select('*').eq('id', currentBlock.id).maybeSingle()
    if (blockErr !== null) {
      error.value = toMessage(blockErr)
      await refresh()
      loading.value = false
      return
    }
    block.value = (blockData as SessionBlock | null) ?? null
    loading.value = false
  }

  async function endSession(args: {
    status?: SessionStatus
    focusRating?: number | null
    notes?: string | null
  } = {}) {
    const current = session.value
    if (current === null) return
    loading.value = true
    error.value = null
    const { error: rpcError } = await supabase.rpc('end_session', {
      p_session_id: current.id,
      p_status: args.status ?? 'completed',
      p_focus_rating: args.focusRating ?? null,
      p_notes: args.notes ?? null
    })
    if (rpcError !== null) {
      error.value = toMessage(rpcError)
      await refresh()
      loading.value = false
      return
    }
    // Cascades to open blocks and pauses server-side.
    session.value = null
    block.value = null
    pause.value = null
    loading.value = false
  }

  return {
    session,
    block,
    pause,
    elapsedSeconds,
    remainingSeconds,
    isPaused,
    loading,
    error,
    refresh,
    startSession,
    startBlock,
    endBlock,
    pauseBlock,
    resumeBlock,
    endSession
  }
}