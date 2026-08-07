<script setup lang="ts">
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
  elapsedSeconds,
  isPaused,
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

const currentTemplateBlock = computed<SessionTemplateBlock | null>(() => {
  const b = block.value
  if (b === null || b.template_block_id === null) return null
  return sessionTemplateBlocks.value.find(tb => tb.id === b.template_block_id) ?? null
})

const nextTemplateBlock = computed<SessionTemplateBlock | null>(() => {
  if (sessionTemplateBlocks.value.length === 0) return null
  const nextIndex = block.value === null ? 0 : block.value.position + 1
  return sessionTemplateBlocks.value[nextIndex] ?? null
})

const templateProgress = computed(() => {
  if (sessionTemplateBlocks.value.length === 0) return null
  const total = sessionTemplateBlocks.value.length
  const done = block.value === null ? 0 : block.value.position + 1
  return { done, total }
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

async function onEndBlock() {
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
  await maybeAdvanceToNextBlock()
}

const endPromptOpen = ref(false)
const endRating = ref<number | null>(null)
const endNotes = ref('')
const endSubmitting = ref(false)
const showConfetti = ref(false)

function openEndPrompt() {
  endRating.value = null
  endNotes.value = ''
  endPromptOpen.value = true
}

async function finishSession(status: SessionStatus) {
  endSubmitting.value = true
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
    if (status === 'completed') {
      showConfetti.value = true
    }
    toast.add({
      title: status === 'completed' ? 'Session completed' : 'Session ended',
      color: status === 'completed' ? 'success' : 'neutral',
      icon: status === 'completed' ? 'i-lucide-circle-check' : 'i-lucide-log-out'
    })
  } finally {
    endSubmitting.value = false
  }
}

const ratingOptions = [1, 2, 3, 4, 5]

const renderState = computed<'idle' | 'ready' | 'running'>(() => {
  if (session.value === null) return 'idle'
  if (block.value === null) return 'ready'
  return 'running'
})

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
  <UContainer class="py-6 sm:py-10">
    <div class="mx-auto flex max-w-2xl flex-col gap-6">
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

      <UCard
        v-else-if="renderState === 'running' && block"
        :ui="{ body: 'sm:p-8' }"
        :class="block.kind !== 'focus' ? 'bg-elevated/30' : ''"
      >
        <div class="flex flex-col items-center gap-6">
          <div class="flex flex-col items-center gap-1 text-center">
            <h1 class="text-lg font-semibold text-highlighted sm:text-xl">
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
              <span
                v-if="templateProgress"
                aria-hidden="true"
              >-</span>
              <span v-if="templateProgress">
                Step {{ Math.min((block.position + 1), templateProgress.total) }}
                of {{ templateProgress.total }}
              </span>
            </div>
          </div>

          <TimerRing
            :elapsed-seconds="Math.floor(elapsedSeconds)"
            :planned-seconds="block.planned_seconds"
            :kind="block.kind"
            :topic-color="currentTopic?.color ?? null"
            :paused="isPaused"
          />

          <SessionControls
            :paused="isPaused"
            :loading="activeLoading"
            @pause="onPause"
            @resume="onResume"
            @end-block="onEndBlock"
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
    </div>

    <div
      v-if="showConfetti"
      class="pointer-events-none fixed inset-x-0 top-1/3 z-50 mx-auto size-0"
      aria-hidden="true"
    >
      <SessionConfetti @done="showConfetti = false" />
    </div>

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
