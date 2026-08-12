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

// ---------------------------------------------------------------------------
// The illustration
// ---------------------------------------------------------------------------

/**
 * What the scene plants on step 2. Just-typed topics come first so a name lands
 * on the ground as it is added; topics from a previous visit fill in behind them
 * rather than leaving a returning user looking at bare earth.
 */
const sceneTopics = computed(() => [
  ...pending.value,
  ...topics.value.map(topic => ({ name: topic.name, color: topic.color }))
])

const tourNames = computed(() => TOUR.map(entry => entry.name))

/** The handoff's dotted page ground. Inline because it is one rule, on one element. */
const PAGE_PATTERN = {
  backgroundImage: 'radial-gradient(var(--ui-border) 1px, transparent 1px)',
  backgroundSize: '26px 26px'
}

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
  <div
    class="min-h-screen bg-muted lg:flex lg:items-center lg:justify-center lg:p-6"
    :style="PAGE_PATTERN"
  >
    <div class="flex h-[100dvh] w-full flex-col overflow-hidden bg-default lg:h-auto lg:max-w-[1020px] lg:flex-row lg:rounded-[20px] lg:border lg:border-default lg:shadow-[0_24px_60px_-24px_rgba(15,23,42,0.18)]">
      <!-- The picture the wizard is promising. A band above the form on a
           phone, the right pane on a desktop — same scene, cropped by its
           frame, which is exactly how 7a and 7b differ. -->
      <!-- Two frames of one scene, not two scenes: a short full-width band above
           the form on a phone, the tall right pane on a desktop. They crop the
           same drawing differently, which is why each gets its own viewBox. -->
      <div class="relative h-60 flex-none lg:hidden">
        <WelcomeScene
          frame="band"
          :step="step"
          :goal-label="goalLabel"
          :timezone="timezone"
          :topics="sceneTopics"
          :places="tourNames"
        />
        <div class="absolute left-3.5 top-3.5">
          <AppLogo />
        </div>
      </div>

      <div class="relative order-2 hidden w-[400px] flex-none lg:block">
        <WelcomeScene
          frame="panel"
          :step="step"
          :goal-label="goalLabel"
          :timezone="timezone"
          :topics="sceneTopics"
          :places="tourNames"
        />
      </div>

      <div class="flex min-h-0 min-w-0 flex-1 flex-col lg:order-1">
        <div class="min-w-0 flex-1 overflow-y-auto px-5 pt-5 lg:overflow-visible lg:px-10 lg:pt-8">
          <div class="mb-6 hidden lg:block">
            <AppLogo />
          </div>

          <!-- Named steps, not dots. The names are information; dots are
               decoration that tells you a count you did not ask for. -->
          <ol class="flex flex-wrap items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.08em]">
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

          <div class="mt-4 lg:mt-[18px]">
            <h1 class="font-display text-[23px] font-semibold tracking-[-0.02em] text-highlighted">
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
            <p class="mt-1.5 text-[13.5px] text-muted">
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

          <div class="mt-[18px] lg:mt-[22px] lg:min-h-[300px]">
            <!-- Step 1 — your day -->
            <div
              v-if="step === 0"
              class="flex flex-col gap-[22px]"
            >
              <div>
                <p class="text-[13px] font-semibold text-highlighted">
                  Your timezone
                </p>
                <p class="mt-[3px] text-xs text-muted">
                  Every day's total is stamped with this, so it has to be right.
                </p>

                <div
                  v-if="!editingZone"
                  class="mt-2.5 flex flex-wrap items-center gap-2 rounded-[10px] border border-default bg-muted px-3 py-2"
                >
                  <UIcon
                    name="i-lucide-globe"
                    class="size-[15px] shrink-0 text-primary"
                  />
                  <span class="text-[13px] font-semibold text-highlighted">{{ timezone }}</span>
                  <span
                    v-if="localTimeNow"
                    class="text-xs text-muted"
                  >· {{ localTimeNow }} for you now</span>
                  <UButton
                    variant="link"
                    size="xs"
                    class="ml-auto p-0 font-semibold"
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
                  class="mt-2.5 w-full"
                />
              </div>

              <div>
                <p class="text-[13px] font-semibold text-highlighted">
                  Daily goal
                </p>
                <p class="mt-[3px] text-xs text-muted">
                  Clear it and the day plants a tree in your forest. Pick something you'd
                  hit on an ordinary day, not a good one.
                </p>

                <div class="mt-2.5 flex flex-wrap gap-1.5">
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

                <div class="mt-3.5 flex items-center gap-3">
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
              class="flex flex-col gap-3.5"
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
                  class="flex items-center gap-[7px] rounded-full border border-default py-[5px] pl-[11px] pr-[7px] text-[13px]"
                >
                  <span
                    class="size-[9px] shrink-0 rounded-full"
                    :style="{ backgroundColor: topic.color }"
                  />
                  <span class="text-highlighted">{{ topic.name }}</span>
                  <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="soft"
                    size="xs"
                    class="rounded-full p-0.5"
                    :aria-label="`Remove ${topic.name}`"
                    @click="removeTopic(index)"
                  />
                </li>
              </ul>

              <p
                v-else-if="topics.length === 0"
                class="text-[13px] text-muted"
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

            <!-- Step 3 — the map. Rows match the trail's five waypoints, in order. -->
            <ul
              v-else
              class="flex flex-col divide-y divide-muted"
            >
              <li
                v-for="entry in TOUR"
                :key="entry.to"
                class="flex items-center gap-3 py-[9px] first:pt-0 last:pb-0"
              >
                <span class="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-primary/10">
                  <UIcon
                    :name="entry.icon"
                    class="size-4 text-primary"
                  />
                </span>
                <div class="min-w-0">
                  <p class="text-[13.5px] font-semibold text-highlighted">
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
          </div>
        </div>

        <!-- Pinned under the scroll on a phone, sitting on the pane's own
             bottom edge on a desktop. -->
        <div class="flex flex-none items-center gap-2 border-t border-muted px-5 pb-5 pt-3 lg:border-t-0 lg:px-10 lg:pb-7 lg:pt-[22px]">
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
      </div>
    </div>
  </div>
</template>
