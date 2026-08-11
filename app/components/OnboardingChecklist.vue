<script setup lang="ts">
/**
 * Onboarding checklist — the three-step path a new account has to walk
 * before the app does anything useful: pick a timezone, create a topic,
 * start a session. Renders on the dashboard only; the parent gates it
 * to the "never-any-activity" case.
 *
 * Dismissal is permanent and per-user, stored in localStorage under
 * `tutorex:onboarding:${userId}:dismissed`. Once all three steps
 * complete, the key is written automatically and the component hides
 * for good. The user can also dismiss early with the X button.
 *
 * The empty-vs-failed distinction matters here: if the topic or session
 * probe queries error, we do NOT render the checklist as-if the user has
 * nothing — the parent surfaces the real error state for the dashboard,
 * and this component silently opts out. Telling a returning user with
 * months of history that they need to "create their first topic" would
 * be the app's worst failure mode.
 *
 * Timezone completion is a judgement call: the schema default is
 * `Europe/Berlin`, so we treat step 1 as done if the profile timezone
 * differs from that default. Users who legitimately live in Berlin and
 * never change the value will see the step stay marked incomplete until
 * they dismiss — that is acceptable; a nag once is cheap, wrong stats
 * for months is not.
 */

const supabase = useSupabase()
const { user } = useAuth()
const { profile, load: loadProfile, error: profileError } = useProfile()
const { active: topics, loaded: topicsLoaded, load: loadTopics, error: topicsError } = useTopics()

const DEFAULT_TZ = 'Europe/Berlin'

const dismissed = ref(false)
const probeReady = ref(false)
const hasSession = ref(false)
/** Nonzero when any probe query failed. When true, we render nothing. */
const probeErrored = ref(false)

const storageKey = computed(() => {
  const id = user.value?.id
  return id ? `tutorex:onboarding:${id}:dismissed` : null
})

function readDismissed(): boolean {
  const key = storageKey.value
  if (key === null) return false
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeDismissed() {
  const key = storageKey.value
  if (key === null) return
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    // Storage disabled — the checklist just reappears next visit.
    // Not worth surfacing to the user.
  }
}

async function probeSession() {
  const { data, error } = await supabase
    .from('sessions')
    .select('id')
    .limit(1)
    .maybeSingle()
  if (error) {
    probeErrored.value = true
    return
  }
  hasSession.value = data !== null
}

onMounted(async () => {
  dismissed.value = readDismissed()
  if (dismissed.value) {
    probeReady.value = true
    return
  }

  const jobs: Array<Promise<unknown>> = []
  if (!profile.value) jobs.push(loadProfile())
  if (!topicsLoaded.value) jobs.push(loadTopics())
  jobs.push(probeSession())

  await Promise.all(jobs)
  probeReady.value = true
})

const timezoneDone = computed(() => {
  const tz = profile.value?.timezone
  return typeof tz === 'string' && tz.length > 0 && tz !== DEFAULT_TZ
})

const topicDone = computed(() => topicsLoaded.value && topics.value.length > 0)

const sessionDone = computed(() => hasSession.value)

const allDone = computed(() => timezoneDone.value && topicDone.value && sessionDone.value)

// Auto-dismiss the moment the user finishes all three — the checklist has
// done its job and should not linger. The watch fires once per fresh check.
watch(allDone, (done) => {
  if (done && !dismissed.value) {
    writeDismissed()
    dismissed.value = true
  }
})

function dismiss() {
  writeDismissed()
  dismissed.value = true
}

interface Step {
  key: 'timezone' | 'topic' | 'session'
  label: string
  hint: string
  actionLabel: string
  to: string
  icon: string
  done: boolean
}

const steps = computed<Step[]>(() => [
  {
    key: 'timezone',
    label: 'Set your timezone',
    hint: 'Every daily total is stamped with it — get this right first.',
    actionLabel: 'Open settings',
    to: '/settings',
    icon: 'i-lucide-globe',
    done: timezoneDone.value
  },
  {
    key: 'topic',
    label: 'Create your first topic',
    hint: 'Something you already study — a class, a project, a book.',
    actionLabel: 'Create a topic',
    to: '/topics',
    icon: 'i-lucide-tags',
    done: topicDone.value
  },
  {
    key: 'session',
    label: 'Start your first session',
    hint: 'Pick a topic and press start. That is the whole app.',
    actionLabel: 'Start focusing',
    to: '/',
    icon: 'i-lucide-play',
    done: sessionDone.value
  }
])

const completedCount = computed(() => steps.value.filter(s => s.done).length)

/**
 * Index of the first incomplete step — the "current" step that gets the
 * outer ring. Null when everything is done (the checklist is about to
 * auto-dismiss anyway, so no highlight is needed).
 */
const currentStepIndex = computed(() => {
  const idx = steps.value.findIndex(s => !s.done)
  return idx === -1 ? null : idx
})

function tokenRotation(index: number): string {
  // Odd-indexed (1, 3 in human terms → index 0, 2) lean left; even lean right.
  // Kept tiny — hand-placed, not chaotic.
  return index % 2 === 0 ? '-rotate-3' : 'rotate-2'
}

const shouldRender = computed(() => {
  if (!user.value) return false
  if (dismissed.value) return false
  // A failed fetch anywhere in the checklist's inputs means we cannot
  // honestly decide what is done. Hide rather than nag — the dashboard
  // shell already surfaces its own error state.
  if (probeErrored.value) return false
  if (profileError.value !== null) return false
  if (topicsError.value !== null) return false
  if (!probeReady.value) return false
  return true
})
</script>

<template>
  <UCard v-if="shouldRender">
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-sparkles"
            class="size-4 text-primary"
          />
          <h2 class="text-sm font-semibold text-highlighted">
            Get started
          </h2>
          <span class="text-xs text-muted tabular-nums">
            {{ completedCount }} / {{ steps.length }}
          </span>
        </div>
        <UButton
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-x"
          aria-label="Dismiss onboarding checklist"
          @click="dismiss"
        />
      </div>
    </template>

    <ul class="flex flex-col divide-y divide-default">
      <li
        v-for="(step, index) in steps"
        :key="step.key"
        class="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
      >
        <div
          class="shrink-0"
          :class="index === currentStepIndex ? 'rounded-lg ring-2 ring-primary/30 ring-offset-2 ring-offset-[color:var(--ui-bg)]' : ''"
        >
          <div
            :key="step.done ? 'done' : 'todo'"
            class="animate-pop"
          >
            <div
              v-if="step.done"
              class="flex size-8 items-center justify-center rounded-lg bg-primary text-white"
              :class="tokenRotation(index)"
              :aria-label="'Step ' + (index + 1) + ' completed'"
            >
              <UIcon
                name="i-lucide-check"
                class="size-4"
              />
            </div>
            <div
              v-else
              class="flex size-8 items-center justify-center rounded-lg border border-default bg-elevated font-display text-sm font-semibold text-primary"
              :class="tokenRotation(index)"
              :aria-label="'Step ' + (index + 1) + ' not started'"
            >
              {{ index + 1 }}
            </div>
          </div>
        </div>
        <div class="min-w-0 flex-1">
          <p
            class="text-sm font-medium"
            :class="step.done ? 'text-muted line-through' : 'text-highlighted'"
          >
            {{ step.label }}
          </p>
          <p
            v-if="!step.done"
            class="mt-0.5 text-xs text-muted"
          >
            {{ step.hint }}
          </p>
        </div>
        <UButton
          v-if="!step.done"
          :to="step.to"
          :icon="step.icon"
          size="sm"
          color="primary"
          variant="soft"
        >
          {{ step.actionLabel }}
        </UButton>
      </li>
    </ul>
  </UCard>
</template>
