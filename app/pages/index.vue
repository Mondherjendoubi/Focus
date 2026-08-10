<script setup lang="ts">
import type { Milestone } from '~/composables/useMilestones'
import type { BlockKind, SessionStatus, SessionTemplateBlock, Topic } from '~/types/database'

/**
 * The focus page - the screen the user actually looks at while working.
 * The root route is the timer, not the dashboard, because starting a
 * session is the primary action of the app.
 *
 * State comes from useActiveSession, which owns the three open rows
 * (session / block / pause), the derived elapsed clock, and every RPC
 * that mutates them. This page never inserts into sessions,
 * session_blocks, or block_pauses directly - the RPCs enforce the
 * database invariants (one active session, no overlapping blocks, one
 * open pause per block) and any direct write would eventually violate
 * one of them.
 *
 * Three rendered states:
 *   1. No session         -> SessionStarter (idle)
 *   2. Session, no block  -> Ready between blocks (also the freshly-
 *                            started state before block 1)
 *   3. Session + block    -> TimerRing + SessionControls + progress rail
 *
 * End of session opens a modal for focus rating (1-5) and notes; both
 * skippable, because a forced rating produces garbage data and the notes
 * field is meaningless once the moment has passed.
 *
 * Template advance on end_block: if the session has a template, we look
 * up the next block by position and either auto-start it (breaks - a
 * break that starts itself is almost always right) or prompt (focus -
 * a focus block that starts itself is almost always wrong).
 */

definePageMeta({ middleware: 'auth' })

useSeoMeta({ title: 'Focus' })

const supabase = useSupabase()
const toast = useToast()

const active = useActiveSession()
const {
  session,
  block,
  blocksStarted,
  elapsedSeconds,
  isPaused,
  isStale,
  loading: activeLoading,
  error: activeError,
  refresh,
  startSession,
  startBlock,
  endBlock,
  pauseBlock,
  resumeBlock,
  endSession
} = active

const { active: topics, loaded: topicsLoaded, load: loadTopics } = useTopics()

interface TemplateListItem {
  id: string
  name: string
  description: string | null
  is_favorite: boolean
  default_topic_id: string | null
  planned_focus_seconds: number
  block_count: number
}

const templates = ref<TemplateListItem[]>([])
const templatesError = ref<string | null>(null)

async function loadTemplates() {
  const { data, error } = await supabase
    .from('session_templates')
    .select('id, name, description, is_favorite, default_topic_id, session_template_blocks(planned_seconds, kind)')
    .is('archived_at', null)
    .order('is_favorite', { ascending: false })
    .order('name')

  if (error) {
    templatesError.value = toMessage(error)
    templates.value = []
    return
  }

  const rows = (data ?? []) as Array<{
    id: string
    name: string
    description: string | null
    is_favorite: boolean
    default_topic_id: string | null
    session_template_blocks: Array<{ planned_seconds: number, kind: BlockKind }>
  }>

  templates.value = rows.map((r) => {
    const focus = r.session_template_blocks
      .filter(b => b.kind === 'focus')
      .reduce((acc, b) => acc + b.planned_seconds, 0)
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      is_favorite: r.is_favorite,
      default_topic_id: r.default_topic_id,
      planned_focus_seconds: focus,
      block_count: r.session_template_blocks.length
    }
  })
}

const sessionTemplateBlocks = ref<SessionTemplateBlock[]>([])

async function loadSessionTemplateBlocks(templateId: string | null) {
  if (templateId === null) {
    sessionTemplateBlocks.value = []
    return
  }
  const { data, error } = await supabase
    .from('session_template_blocks')
    .select('*')
    .eq('template_id', templateId)
    .order('position')

  if (error) {
    toast.add({
      title: 'Could not load template steps',
      description: toMessage(error),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
    sessionTemplateBlocks.value = []
    return
  }
  sessionTemplateBlocks.value = (data ?? []) as SessionTemplateBlock[]
}

onMounted(async () => {
  if (!topicsLoaded.value) await loadTopics()
  await loadTemplates()
})

watch(() => session.value?.template_id ?? null, async (templateId) => {
  await loadSessionTemplateBlocks(templateId)
}, { immediate: true })

/**
 * Name of the template driving this session, for the meta row under the title
 * ("Mathematics · Pomodoro ×4" in the 1c design). Null for an ad-hoc session,
 * which then shows the topic alone rather than a dangling separator.
 */
const currentTemplateName = computed<string | null>(() => {
  const id = session.value?.template_id ?? null
  if (id === null) return null
  return templates.value.find(item => item.id === id)?.name ?? null
})

const currentTemplateBlock = computed<SessionTemplateBlock | null>(() => {
  const b = block.value
  if (b === null || b.template_block_id === null) return null
  return sessionTemplateBlocks.value.find(tb => tb.id === b.template_block_id) ?? null
})

/**
 * How far into the template this session is, whether or not a block is open.
 *
 * `block` is null BETWEEN blocks — which is exactly when "what's next?" gets
 * asked. Falling back to 0 there rewound a session sitting at step 7 back to
 * step 1, and had `maybeAdvanceToNextBlock` offer to restart the template from
 * the top with the first block's duration. `blocksStarted` is `max(position)+1`
 * read from the server, so it stays right across a reload too.
 */
const templatePosition = computed(() =>
  block.value === null ? blocksStarted.value : block.value.position + 1
)

const nextTemplateBlock = computed<SessionTemplateBlock | null>(() => {
  if (sessionTemplateBlocks.value.length === 0) return null
  return sessionTemplateBlocks.value[templatePosition.value] ?? null
})

const templateProgress = computed(() => {
  if (sessionTemplateBlocks.value.length === 0) return null
  return { done: templatePosition.value, total: sessionTemplateBlocks.value.length }
})

const currentTopic = computed<Topic | null>(() => {
  const b = block.value
  const s = session.value
  const targetId = b?.topic_id ?? s?.topic_id ?? null
  if (targetId === null) return null
  return topics.value.find(t => t.id === targetId) ?? null
})

const starterSubmitting = ref(false)

async function onStart(payload: {
  topicId: string | null
  templateId: string | null
  title: string | null
}) {
  starterSubmitting.value = true
  try {
    await startSession({
      templateId: payload.templateId,
      topicId: payload.topicId,
      title: payload.title
    })
    if (activeError.value) {
      toast.add({
        title: 'Could not start session',
        description: activeError.value,
        color: 'error',
        icon: 'i-lucide-triangle-alert'
      })
      return
    }
    if (session.value?.template_id) {
      await loadSessionTemplateBlocks(session.value.template_id)
    }
    await maybeAdvanceToNextBlock()
  } finally {
    starterSubmitting.value = false
  }
}

const advancePromptOpen = ref(false)
const advanceTarget = ref<SessionTemplateBlock | null>(null)

async function maybeAdvanceToNextBlock() {
  const next = nextTemplateBlock.value
  if (next === null) return

  if (next.kind === 'focus') {
    advanceTarget.value = next
    advancePromptOpen.value = true
    return
  }

  await runStartBlock(next)
}

async function runStartBlock(templateBlock: SessionTemplateBlock | null, kind: BlockKind = 'focus') {
  if (session.value === null) return
  const args = templateBlock !== null
    ? {
        kind: templateBlock.kind,
        plannedSeconds: templateBlock.planned_seconds,
        topicId: templateBlock.topic_id,
        templateBlockId: templateBlock.id
      }
    : { kind, plannedSeconds: null }

  await startBlock(args)
  if (activeError.value) {
    toast.add({
      title: 'Could not start block',
      description: activeError.value,
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  }
}

async function onConfirmAdvance() {
  const next = advanceTarget.value
  advancePromptOpen.value = false
  advanceTarget.value = null
  if (next) await runStartBlock(next)
}

function onSkipAdvance() {
  advancePromptOpen.value = false
  advanceTarget.value = null
}

async function onManualStartFocus() {
  await runStartBlock(null, 'focus')
}

async function onPause() {
  await pauseBlock()
  if (activeError.value) {
    toast.add({
      title: 'Could not pause',
      description: activeError.value,
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  }
}

async function onResume() {
  await resumeBlock()
  if (activeError.value) {
    toast.add({
      title: 'Could not resume',
      description: activeError.value,
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  }
}

/**
 * Ending a block is not undoable — `end_block` stamps `ended_at` and there is
 * no reopen RPC — so it asks first. It used to fire on the click, which put a
 * destructive action one stray tap away from a running timer.
 */
const endBlockPromptOpen = ref(false)
const endingBlock = ref(false)

function openEndBlockPrompt() {
  endBlockPromptOpen.value = true
}

async function onEndBlock() {
  if (endingBlock.value) return
  endingBlock.value = true
  try {
    await endBlock()
    if (activeError.value) {
      toast.add({
        title: 'Could not end block',
        description: activeError.value,
        color: 'error',
        icon: 'i-lucide-triangle-alert'
      })
      return
    }
    endBlockPromptOpen.value = false
    await maybeAdvanceToNextBlock()
  } finally {
    endingBlock.value = false
  }
}

const endPromptOpen = ref(false)
const endRating = ref<number | null>(null)
const endNotes = ref('')
const endSubmitting = ref(false)
const showConfetti = ref(false)

// FA-017 — records broken by the session that just ended. Empty for an ordinary
// session, which is the common case and gets no celebration at all.
const { detectForSession } = useMilestones()
const milestones = ref<Milestone[]>([])

function openEndPrompt() {
  endRating.value = null
  endNotes.value = ''
  // Ending the session answers "start the next block?" by itself. Leaving that
  // prompt open would stack it behind this one, and behind the milestone modal
  // that may follow — three dialogs deep for one action.
  advancePromptOpen.value = false
  endPromptOpen.value = true
}

async function finishSession(status: SessionStatus) {
  endSubmitting.value = true
  // Captured before the RPC: `endSession` nulls the shared session ref, and the
  // milestone queries need to know which session just closed.
  const finishedId = session.value?.id ?? null
  const finishedTopicId = session.value?.topic_id ?? null
  try {
    await endSession({
      status,
      focusRating: endRating.value,
      notes: endNotes.value.trim().length > 0 ? endNotes.value.trim() : null
    })
    if (activeError.value) {
      toast.add({
        title: 'Could not end session',
        description: activeError.value,
        color: 'error',
        icon: 'i-lucide-triangle-alert'
      })
      return
    }
    endPromptOpen.value = false
    toast.add({
      title: status === 'completed' ? 'Session completed' : 'Session ended',
      color: status === 'completed' ? 'success' : 'neutral',
      icon: status === 'completed' ? 'i-lucide-circle-check' : 'i-lucide-log-out'
    })

    // Confetti is now gated on an actual record rather than firing for every
    // completed session — a reward that arrives every time stops being one.
    // Detection is best-effort and never surfaces an error: the session has
    // already ended successfully and a failed victory lap is not the user's
    // problem.
    if (status === 'completed' && finishedId !== null) {
      const found = await detectForSession(finishedId, finishedTopicId)
      if (found.length > 0) {
        milestones.value = found
        showConfetti.value = true
      }
    }
  } finally {
    endSubmitting.value = false
  }
}

const ratingOptions = [1, 2, 3, 4, 5]

const renderState = computed<'idle' | 'ready' | 'running' | 'stale'>(() => {
  if (session.value === null) return 'idle'
  if (block.value === null) return 'ready'
  // A block carried over from a previous day is an abandoned one, not a live
  // timer. Rendering it as running would show a clock counting since whenever
  // the tab was closed, and invite the user to "resume" meaningless time.
  if (isStale.value) return 'stale'
  return 'running'
})

/** Discard an abandoned session rather than pretending its clock is real. */
const discarding = ref(false)

async function discardStaleSession() {
  if (discarding.value) return
  discarding.value = true
  try {
    // `end_session` closes the open block and its pause server-side, so this
    // one call is enough — no need to end the block first.
    await endSession({ status: 'abandoned' })
    if (activeError.value) {
      toast.add({
        title: 'Could not close that session',
        description: activeError.value,
        color: 'error',
        icon: 'i-lucide-triangle-alert'
      })
      return
    }
    toast.add({
      title: 'Old session closed',
      color: 'neutral',
      icon: 'i-lucide-check'
    })
  } finally {
    discarding.value = false
  }
}

const runningTitle = computed(() => {
  const t = session.value?.title?.trim()
  return t !== undefined && t.length > 0 ? t : 'Focus session'
})

/**
 * Screen-reader announcement for the timer's transitional states. The visible
 * clock updates every second and would drown out anything read from its aria
 * label; this string is only rewritten on real state changes (start / pause /
 * resume / end) and lives in a polite `role="status"` region so assistive tech
 * announces the transition without interrupting anything the user is doing.
 *
 * Empty string when nothing to announce — screen readers speak the diff, so a
 * stable empty value stays silent.
 */
const timerAnnouncement = computed(() => {
  if (session.value === null) return ''
  const b = block.value
  if (b === null) return `${runningTitle.value}: ready to start a block.`
  const kindLabel = b.kind === 'focus' ? 'Focus' : b.kind === 'short_break' ? 'Short break' : 'Long break'
  if (isPaused.value) return `${kindLabel} paused.`
  return `${kindLabel} block running.`
})
</script>

<template>
  <UContainer class="py-6 sm:py-8 lg:px-10">
    <!-- The workspace needs the full main column: `1fr 380px` inside a 672px
         `max-w-2xl` leaves the timer pane under 270px, which is narrower than
         the 320px ring it has to hold. Every OTHER state here is a single
         centred card and still wants the narrow measure. -->
    <div
      class="flex flex-col gap-6"
      :class="renderState === 'running' ? 'w-full' : 'mx-auto max-w-2xl'"
    >
      <!--
        Screen-reader-only live region for timer state transitions. Polite so
        the announcement never interrupts anything the user is doing, and only
        rewrites on real state changes (start / pause / resume / end) — the
        visible clock ticks every second, which would flood a screen reader
        if it were the announced surface.
      -->
      <p
        role="status"
        aria-live="polite"
        class="sr-only"
      >
        {{ timerAnnouncement }}
      </p>

      <UAlert
        v-if="activeError && !endPromptOpen && !advancePromptOpen"
        color="error"
        variant="soft"
        icon="i-lucide-triangle-alert"
        title="Something went wrong"
        :description="activeError"
        :actions="[{ label: 'Reload state', onClick: () => refresh(), color: 'neutral', variant: 'outline' }]"
      />

      <UAlert
        v-if="templatesError"
        color="warning"
        variant="soft"
        icon="i-lucide-info"
        title="Templates unavailable"
        :description="templatesError"
      />

      <EmptyState
        v-if="renderState === 'idle' && topicsLoaded && topics.length === 0"
        icon="i-lucide-tags"
        title="Pick a topic to focus on"
        description="Every session attaches to a topic. Add one and come back."
        :action="{ label: 'Add a topic', icon: 'i-lucide-plus', to: '/topics' }"
      />

      <SessionStarter
        v-else-if="renderState === 'idle'"
        :topics="topics"
        :templates="templates"
        :submitting="starterSubmitting || activeLoading"
        @start="onStart"
      />

      <!-- Recovery state: a block left open on an earlier day. Deliberately
           shows no clock — the elapsed time since the tab was closed is not
           study time, and rendering it would be the exact lie this state
           exists to prevent. -->
      <UCard
        v-else-if="renderState === 'stale'"
        :ui="{ body: 'sm:p-8' }"
      >
        <div class="flex flex-col items-center gap-5 text-center">
          <div class="rounded-full bg-warning/10 p-3">
            <UIcon
              name="i-lucide-clock-alert"
              class="size-7 text-warning"
            />
          </div>
          <div class="flex flex-col gap-2">
            <h2 class="font-display text-xl font-semibold tracking-tight text-highlighted">
              You left a session open
            </h2>
            <p class="max-w-sm text-sm text-muted">
              A block from
              <span class="font-medium text-default">{{ block?.local_day }}</span>
              is still running. Close it and its time will be recorded up to
              when it was last active, then you can start fresh.
            </p>
          </div>
          <UButton
            icon="i-lucide-check"
            :loading="discarding"
            :disabled="discarding"
            @click="discardStaleSession"
          >
            Close it
          </UButton>
        </div>
      </UCard>

      <UCard
        v-else-if="renderState === 'ready'"
        :ui="{ body: 'sm:p-8' }"
      >
        <div class="flex flex-col items-center gap-5 text-center">
          <div class="rounded-full bg-primary/10 p-3">
            <UIcon
              name="i-lucide-flag"
              class="size-7 text-primary"
            />
          </div>
          <div>
            <h1 class="text-xl font-semibold text-highlighted sm:text-2xl">
              {{ runningTitle }}
            </h1>
            <p
              v-if="templateProgress"
              class="mt-1 text-sm text-muted"
            >
              Step {{ Math.min(templateProgress.done + 1, templateProgress.total) }}
              of {{ templateProgress.total }}
            </p>
            <p
              v-else
              class="mt-1 text-sm text-muted"
            >
              Ready when you are.
            </p>
          </div>

          <div class="flex flex-wrap items-center justify-center gap-3">
            <UButton
              v-if="nextTemplateBlock"
              size="lg"
              icon="i-lucide-play"
              :disabled="activeLoading"
              @click="runStartBlock(nextTemplateBlock)"
            >
              Start {{ nextTemplateBlock.kind === 'focus' ? 'focus' : nextTemplateBlock.kind === 'short_break' ? 'short break' : 'long break' }}
              ({{ formatDuration(nextTemplateBlock.planned_seconds) }})
            </UButton>
            <UButton
              v-else
              size="lg"
              icon="i-lucide-play"
              :disabled="activeLoading"
              @click="onManualStartFocus"
            >
              Start focus block
            </UButton>
            <UButton
              color="error"
              variant="soft"
              size="lg"
              icon="i-lucide-log-out"
              :disabled="activeLoading"
              @click="openEndPrompt"
            >
              End session
            </UButton>
          </div>
        </div>
      </UCard>

      <!-- FA-020 — desktop workspace. Below `lg` this collapses to the single
           centred column it has always been; the rail stacks underneath. -->
      <div
        v-else-if="renderState === 'running' && block"
        class="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]"
      >
        <UCard
          :ui="{ body: 'sm:p-8 lg:h-full lg:flex lg:items-center lg:justify-center' }"
          :class="block.kind !== 'focus' ? 'bg-elevated/30' : ''"
        >
          <div class="flex flex-col items-center gap-6">
            <div class="flex flex-col items-center gap-1 text-center">
              <h1 class="text-lg font-semibold text-highlighted sm:text-xl lg:text-[22px]">
                {{ runningTitle }}
              </h1>
              <div class="flex flex-wrap items-center justify-center gap-2 text-sm text-muted">
                <TopicBadge
                  v-if="currentTopic"
                  :topic="currentTopic"
                  size="sm"
                  muted
                />
                <span v-else>No topic</span>

                <!-- Template name, per the design's "Mathematics · Pomodoro ×4". -->
                <template v-if="currentTemplateName">
                  <span aria-hidden="true">·</span>
                  <span>{{ currentTemplateName }}</span>
                </template>

                <!-- The step counter only appears below `lg`. On desktop the
                     rail's plan card carries it, beside the steps it counts. -->
                <template v-if="templateProgress">
                  <span
                    aria-hidden="true"
                    class="lg:hidden"
                  >·</span>
                  <span class="lg:hidden">
                    Step {{ Math.min((block.position + 1), templateProgress.total) }}
                    of {{ templateProgress.total }}
                  </span>
                </template>
              </div>
            </div>

            <TimerRing
              :elapsed-seconds="Math.floor(elapsedSeconds)"
              :planned-seconds="block.planned_seconds"
              :kind="block.kind"
              :topic-color="currentTopic?.color ?? null"
              :paused="isPaused"
              size="lg"
            />

            <SessionControls
              :paused="isPaused"
              :loading="activeLoading"
              @pause="onPause"
              @resume="onResume"
              @end-block="openEndBlockPrompt"
              @end-session="openEndPrompt"
            />

            <div
              v-if="currentTemplateBlock?.label"
              class="text-center text-sm text-muted"
            >
              {{ currentTemplateBlock.label }}
            </div>
          </div>
        </UCard>

        <!-- Right rail. Each card hides itself when it has nothing to say, so a
             session with no template and no earlier work leaves just the goal. -->
        <div class="flex min-h-0 flex-col gap-5">
          <DailyGoalRailCard />

          <SessionPlanCard
            :blocks="sessionTemplateBlocks"
            :position="templatePosition"
            :elapsed-seconds="Math.floor(elapsedSeconds)"
          />

          <EarlierTodayCard :exclude-session-id="session?.id ?? null" />
        </div>
      </div>
    </div>

    <div
      v-if="showConfetti"
      class="pointer-events-none fixed inset-x-0 top-1/3 z-50 mx-auto size-0"
      aria-hidden="true"
    >
      <SessionConfetti @done="showConfetti = false" />
    </div>

    <!-- FA-017 — the named record behind the confetti. Only opens when
         `detectForSession` actually found something, so an ordinary session
         still closes straight back to the idle screen. -->
    <UModal
      :open="milestones.length > 0"
      title="New record"
      :ui="{ content: 'sm:max-w-md' }"
      @update:open="(open) => { if (!open) milestones = [] }"
    >
      <template #body>
        <ul class="flex flex-col gap-4">
          <li
            v-for="milestone in milestones"
            :key="milestone.kind"
            class="flex items-start gap-3"
          >
            <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <UIcon
                :name="milestone.icon"
                class="size-5 text-primary"
              />
            </div>
            <div class="min-w-0">
              <p class="text-sm font-medium text-highlighted">
                {{ milestone.title }}
              </p>
              <p class="mt-0.5 text-sm text-muted">
                {{ milestone.detail }}
              </p>
            </div>
          </li>
        </ul>
      </template>

      <template #footer>
        <div class="flex w-full justify-end">
          <UButton
            color="neutral"
            variant="ghost"
            @click="milestones = []"
          >
            Nice
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Confirm before ending a block. `end_block` stamps `ended_at` and there
         is no reopen RPC, so this is a one-way door sitting next to Pause. -->
    <UModal
      v-model:open="endBlockPromptOpen"
      title="End this block?"
      :ui="{ content: 'sm:max-w-md' }"
    >
      <template #body>
        <p class="text-sm text-default">
          The time you've focused so far is kept. This block closes now and
          can't be reopened.
        </p>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="endingBlock"
            @click="endBlockPromptOpen = false"
          >
            Keep going
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-square"
            :loading="endingBlock"
            :disabled="endingBlock"
            @click="onEndBlock"
          >
            End block
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="advancePromptOpen"
      title="Start the next focus block?"
      :ui="{ content: 'sm:max-w-md' }"
    >
      <template #body>
        <p
          v-if="advanceTarget"
          class="text-sm text-default"
        >
          Up next: <strong>{{ formatDuration(advanceTarget.planned_seconds) }}</strong>
          of focused work. Start it now, or take a moment first.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="onSkipAdvance"
          >
            Not yet
          </UButton>
          <UButton
            icon="i-lucide-play"
            @click="onConfirmAdvance"
          >
            Start now
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="endPromptOpen"
      title="How did this session go?"
      :ui="{ content: 'sm:max-w-md' }"
    >
      <template #body>
        <div class="flex flex-col gap-5">
          <div>
            <p class="text-sm font-medium text-highlighted">
              Focus rating
            </p>
            <p class="mt-1 text-xs text-muted">
              Optional - skip if you are not sure.
            </p>
            <div
              class="mt-3 flex items-center gap-2"
              role="radiogroup"
              aria-label="Focus rating from 1 to 5"
            >
              <button
                v-for="n in ratingOptions"
                :key="n"
                type="button"
                role="radio"
                :aria-checked="endRating === n"
                :aria-label="`${n} out of 5`"
                class="flex size-10 items-center justify-center rounded-full border transition"
                :class="endRating === n
                  ? 'border-primary bg-primary text-inverted'
                  : 'border-default text-muted hover:border-primary hover:text-primary'"
                @click="endRating = endRating === n ? null : n"
              >
                <UIcon
                  name="i-lucide-star"
                  class="size-5"
                  :class="endRating !== null && endRating >= n ? 'fill-current' : ''"
                />
              </button>
            </div>
          </div>

          <UFormField
            label="Notes"
            name="notes"
            hint="Optional - a line or two for future you."
          >
            <UTextarea
              v-model="endNotes"
              :rows="3"
              :maxlength="1000"
              placeholder="What worked? What got in the way?"
              class="w-full"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="endSubmitting"
            @click="endPromptOpen = false"
          >
            Keep going
          </UButton>
          <UButton
            color="error"
            variant="soft"
            icon="i-lucide-x"
            :disabled="endSubmitting"
            @click="finishSession('abandoned')"
          >
            Abandon
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-check"
            :loading="endSubmitting"
            :disabled="endSubmitting"
            @click="finishSession('completed')"
          >
            Complete
          </UButton>
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
