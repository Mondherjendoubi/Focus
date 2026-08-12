<script setup lang="ts">
/**
 * Welcome wizard (FA-025) — the first screen after signup.
 *
 * Three steps, not five, because it only asks for what the app gets *wrong*
 * without an answer. Everything else it can infer, already has, or does not
 * need until later.
 *
 * `layout: false` puts it in `app.vue`'s chromeless branch alongside login and
 * signup: no sidebar, no header. It reads as the last page of signing up rather
 * than the first page of the app, which is what it is.
 */

definePageMeta({ layout: false })

useSeoMeta({ title: 'Welcome' })

const { profile, load: loadProfile, update } = useProfile()
const { active: topics, load: loadTopics, create } = useTopics()
const { markDone } = useOnboarding()
const toast = useToast()

const step = ref(0)
const saving = ref(false)
const formError = ref<string | null>(null)

const STEPS = [
  { key: 'day', label: 'Your day' },
  { key: 'topics', label: 'What you study' },
  { key: 'tour', label: 'Where things live' }
] as const

// ---------------------------------------------------------------------------
// Step 1 — your day
// ---------------------------------------------------------------------------

/**
 * The browser already knows the timezone, so this is stated rather than asked.
 *
 * It matters more than any other field here: `profiles.timezone` defaults to
 * `Europe/Berlin`, and every daily total in the app is stamped with it — the
 * `local_day` on every block, the streaks, the forest, the history tape. A user
 * in Tunis who never opens settings would get quietly wrong days forever.
 */
function detectTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof tz === 'string' && tz.length > 0 ? tz : 'UTC'
  } catch {
    return 'UTC'
  }
}

const timezone = ref(detectTimezone())
const editingZone = ref(false)

/** Every zone the runtime knows, for the correction path. */
const zoneOptions = computed<string[]>(() => {
  const withValues = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  try {
    return withValues.supportedValuesOf?.('timeZone') ?? [timezone.value, 'UTC']
  } catch {
    return [timezone.value, 'UTC']
  }
})

/** Minutes. The floor is 15, never 0 — see `goalNote`. */
const goalMinutes = ref(120)
const GOAL_PRESETS = [30, 60, 90, 120, 180, 240]

const goalLabel = computed(() => formatDuration(goalMinutes.value * 60))

const localTimeNow = computed(() => {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone.value,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).format(new Date())
  } catch {
    return null
  }
})

// ---------------------------------------------------------------------------
// Step 2 — topics
// ---------------------------------------------------------------------------

/**
 * Colours are handed out in order from the app's own palette rather than picked
 * by the user. Choosing five colours is not a thing anyone wants to do in their
 * first minute, and the topic form on `/topics` can change any of them later.
 */
const PALETTE = ['#3565F5', '#10B981', '#8B5CF6', '#F59E0B', '#EC4899', '#06B6D4']

const draft = ref('')
const pending = ref<Array<{ name: string, color: string }>>([])

function addTopic() {
  const name = draft.value.trim()
  if (name.length === 0) return
  if (pending.value.some(t => t.name.toLowerCase() === name.toLowerCase())) {
    draft.value = ''
    return
  }
  pending.value.push({ name, color: PALETTE[pending.value.length % PALETTE.length]! })
  draft.value = ''
}

function removeTopic(index: number) {
  pending.value.splice(index, 1)
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

const canAdvance = computed(() => {
  if (step.value === 1) return pending.value.length > 0 || topics.value.length > 0
  return true
})

async function saveDay() {
  await update({ timezone: timezone.value, daily_goal_minutes: goalMinutes.value })
}

async function saveTopics() {
  for (const [index, topic] of pending.value.entries()) {
    await create({
      name: topic.name,
      color: topic.color,
      icon: null,
      parent_id: null,
      description: null,
      position: index
    })
  }
  pending.value = []
}

async function next() {
  if (saving.value) return
  formError.value = null
  saving.value = true
  try {
    if (step.value === 0) await saveDay()
    if (step.value === 1) await saveTopics()
    step.value += 1
  } catch (err) {
    // Said here rather than toasted: the user cannot act on a toast that
    // disappears while they are still looking at the field that caused it.
    formError.value = (err as Error).message
  } finally {
    saving.value = false
  }
}

async function finish() {
  markDone()
  await navigateTo('/', { replace: true })
  toast.add({ title: 'You are set up', icon: 'i-lucide-check', color: 'success' })
}

async function skip() {
  markDone()
  await navigateTo('/', { replace: true })
}

const TOUR = [
  { icon: 'i-lucide-timer', to: '/', name: 'Focus', line: 'Start a session, run the timer, take breaks.' },
  { icon: 'i-lucide-chart-column', to: '/dashboard', name: 'Dashboard', line: 'Totals, streaks and when you focus best.' },
  { icon: 'i-lucide-tags', to: '/topics', name: 'Topics', line: 'Everything you track time against.' },
  { icon: 'i-lucide-history', to: '/history', name: 'History', line: 'Every session laid on the hours of its day.' },
  { icon: 'i-lucide-trees', to: '/forest', name: 'Forest', line: 'A tree for every day you clear your goal.' }
] as const

onMounted(async () => {
  await Promise.all([loadProfile(), loadTopics()])
  // Signup may already have collected a timezone; only override the schema
  // default, never a value the user has actually chosen.
  const stored = profile.value?.timezone
  if (typeof stored === 'string' && stored !== 'Europe/Berlin') timezone.value = stored
  if (typeof profile.value?.daily_goal_minutes === 'number' && profile.value.daily_goal_minutes > 0) {
    goalMinutes.value = profile.value.daily_goal_minutes
  }
})
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-default px-4 py-12">
    <div class="flex w-full max-w-lg flex-col items-center">
      <div class="mb-6 flex flex-col items-center gap-3">
        <AppLogo />
      </div>

      <UCard
        class="w-full"
        :ui="{ body: 'p-6 sm:p-8' }"
      >
        <template #header>
          <!-- Named steps, not dots. The names are information; dots are
               decoration that tells you a count you did not ask for. -->
          <div class="flex flex-col gap-3">
            <ol class="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider">
              <li
                v-for="(entry, index) in STEPS"
                :key="entry.key"
                class="flex items-center gap-2"
              >
                <span :class="index === step ? 'text-primary' : index < step ? 'text-muted' : 'text-dimmed'">
                  {{ entry.label }}
                </span>
                <span
                  v-if="index < STEPS.length - 1"
                  class="h-px w-4 bg-accented"
                />
              </li>
            </ol>

            <div>
              <h1 class="font-display text-2xl font-semibold tracking-tight text-highlighted">
                <template v-if="step === 0">
                  Let's get your days right
                </template>
                <template v-else-if="step === 1">
                  What are you studying?
                </template>
                <template v-else>
                  That's everything
                </template>
              </h1>
              <p class="mt-1 text-sm text-muted">
                <template v-if="step === 0">
                  These two settings decide every number the app will ever show you.
                </template>
                <template v-else-if="step === 1">
                  A subject, a project, a book — whatever you'd want the hours counted against.
                </template>
                <template v-else>
                  Here's where things live. You can change any of this in settings.
                </template>
              </p>
            </div>
          </div>
        </template>

        <!-- Step 1 — your day -->
        <div
          v-if="step === 0"
          class="flex flex-col gap-6"
        >
          <div>
            <p class="text-sm font-medium text-highlighted">
              Your timezone
            </p>
            <p class="mt-0.5 text-xs text-muted">
              Every day's total is stamped with this, so it has to be right.
            </p>

            <div
              v-if="!editingZone"
              class="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-default bg-elevated/40 px-3 py-2.5"
            >
              <UIcon
                name="i-lucide-globe"
                class="size-4 shrink-0 text-primary"
              />
              <span class="text-sm font-medium text-highlighted">{{ timezone }}</span>
              <span
                v-if="localTimeNow"
                class="text-xs text-muted"
              >· {{ localTimeNow }} for you now</span>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                class="ml-auto"
                @click="editingZone = true"
              >
                Change
              </UButton>
            </div>

            <!-- `USelectMenu` filters as you type by default in Nuxt UI 4 —
                 there is no `searchable` prop to pass. -->
            <USelectMenu
              v-else
              v-model="timezone"
              :items="zoneOptions"
              class="mt-2 w-full"
            />
          </div>

          <div>
            <p class="text-sm font-medium text-highlighted">
              Daily goal
            </p>
            <p class="mt-0.5 text-xs text-muted">
              Clear it and the day plants a tree in your forest. Pick something you'd
              hit on an ordinary day, not a good one.
            </p>

            <div class="mt-2 flex flex-wrap gap-1.5">
              <UButton
                v-for="preset in GOAL_PRESETS"
                :key="preset"
                :color="goalMinutes === preset ? 'primary' : 'neutral'"
                :variant="goalMinutes === preset ? 'solid' : 'outline'"
                size="sm"
                @click="goalMinutes = preset"
              >
                {{ formatDuration(preset * 60) }}
              </UButton>
            </div>

            <div class="mt-3 flex items-center gap-3">
              <!-- Floor of 15, never 0: a zero goal is legal in the schema and
                   silently disables the forest, because `earnedTree` requires
                   `goal_minutes > 0`. -->
              <USlider
                v-model="goalMinutes"
                :min="15"
                :max="480"
                :step="15"
                class="flex-1"
              />
              <span class="w-16 shrink-0 text-right font-display text-sm font-semibold tabular-nums text-highlighted">
                {{ goalLabel }}
              </span>
            </div>
          </div>
        </div>

        <!-- Step 2 — topics -->
        <div
          v-else-if="step === 1"
          class="flex flex-col gap-4"
        >
          <form
            class="flex gap-2"
            @submit.prevent="addTopic"
          >
            <UInput
              v-model="draft"
              placeholder="e.g. Calculus, Spanish, Thesis"
              autofocus
              class="flex-1"
            />
            <UButton
              type="submit"
              icon="i-lucide-plus"
              :disabled="draft.trim().length === 0"
            >
              Add
            </UButton>
          </form>

          <ul
            v-if="pending.length > 0"
            class="flex flex-wrap gap-2"
          >
            <li
              v-for="(topic, index) in pending"
              :key="topic.name"
              class="flex items-center gap-2 rounded-full border border-default py-1 pl-2.5 pr-1.5 text-sm"
            >
              <span
                class="size-2.5 rounded-full"
                :style="{ backgroundColor: topic.color }"
              />
              <span class="text-highlighted">{{ topic.name }}</span>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="`Remove ${topic.name}`"
                @click="removeTopic(index)"
              />
            </li>
          </ul>

          <p
            v-else-if="topics.length === 0"
            class="text-sm text-muted"
          >
            Add at least one. You can add the rest later, and nothing here is permanent.
          </p>

          <p
            v-if="topics.length > 0"
            class="text-xs text-dimmed"
          >
            You already have {{ topics.length }} {{ topics.length === 1 ? 'topic' : 'topics' }}.
          </p>
        </div>

        <!-- Step 3 — the map -->
        <ul
          v-else
          class="flex flex-col divide-y divide-muted"
        >
          <li
            v-for="entry in TOUR"
            :key="entry.to"
            class="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
          >
            <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <UIcon
                :name="entry.icon"
                class="size-4 text-primary"
              />
            </span>
            <div class="min-w-0">
              <p class="text-sm font-medium text-highlighted">
                {{ entry.name }}
              </p>
              <p class="text-xs text-muted">
                {{ entry.line }}
              </p>
            </div>
          </li>
        </ul>

        <UAlert
          v-if="formError"
          color="error"
          variant="soft"
          icon="i-lucide-triangle-alert"
          :title="formError"
          class="mt-5"
        />

        <template #footer>
          <div class="flex items-center gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              :disabled="saving"
              @click="step === 0 ? skip() : step -= 1"
            >
              {{ step === 0 ? 'Skip' : 'Back' }}
            </UButton>

            <UButton
              v-if="step < STEPS.length - 1"
              class="ml-auto"
              :loading="saving"
              :disabled="saving || !canAdvance"
              trailing-icon="i-lucide-arrow-right"
              @click="next"
            >
              Continue
            </UButton>
            <UButton
              v-else
              class="ml-auto"
              icon="i-lucide-timer"
              @click="finish"
            >
              Start my first session
            </UButton>
          </div>
        </template>
      </UCard>
    </div>
  </div>
</template>
