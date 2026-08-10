<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { GoalInput } from '~/composables/useGoals'
import type { Goal } from '~/types/database'

definePageMeta({ middleware: 'auth' })

useSeoMeta({ title: 'Settings' })

const { profile, loading, error, load, update } = useProfile()
const toast = useToast()

// Form state — mirrors the four editable columns on `profiles`.
// `daily_goal_minutes` really is minutes (the one column in the schema that
// isn't seconds), so no unit conversion happens here or on save.
const state = reactive({
  display_name: '',
  // Empty string in the form, null in the database. Null is meaningful here —
  // it means "not discoverable", which is the correct default for anyone who
  // has not deliberately opted into being findable.
  username: '',
  timezone: 'Europe/Berlin',
  daily_goal_minutes: 120,
  week_starts_on: 1 as 1 | 7
})

const saving = ref(false)
const formError = ref<string | null>(null)

// ---------------------------------------------------------------------------
// FA-019 — avatar. Deliberately OUTSIDE the profile form: an upload commits
// immediately, so burying it behind "Save changes" would mean the picture had
// already changed while the button still implied it hadn't.
// ---------------------------------------------------------------------------

const { uploading, error: avatarError, uploadAvatar, removeAvatar } = useAvatar()
const fileInput = ref<HTMLInputElement | null>(null)

function pickAvatar() {
  fileInput.value?.click()
}

async function onAvatarPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Reset immediately: without this, re-picking the SAME file after a failed
  // attempt fires no change event and looks like the button is dead.
  input.value = ''
  if (!file) return

  const url = await uploadAvatar(file)
  if (url !== null) {
    toast.add({ title: 'Picture updated', icon: 'i-lucide-check', color: 'success' })
  }
}

async function onAvatarRemove() {
  if (await removeAvatar()) {
    toast.add({ title: 'Picture removed', icon: 'i-lucide-check', color: 'neutral' })
  }
}

// Timezone catalogue — `Intl.supportedValuesOf` is available in every browser
// that runs Nuxt UI 4. Fall back defensively so a very old browser still
// gets the current value as an option instead of an empty picker.
const timezones = computed<string[]>(() => {
  const supported = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : []
  if (supported.length > 0) return supported
  return state.timezone ? [state.timezone] : ['UTC']
})

// A ticking `now` so the "current local time" display doesn't lie for long.
// One-minute cadence is plenty — we're showing HH:mm, not seconds.
const now = ref(new Date())
let clockTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  clockTimer = setInterval(() => {
    now.value = new Date()
  }, 60_000)
})

onUnmounted(() => {
  if (clockTimer !== null) {
    clearInterval(clockTimer)
    clockTimer = null
  }
})

const currentLocalTime = computed(() => {
  if (!state.timezone) return ''
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: state.timezone,
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short'
    }).format(now.value)
  } catch {
    // Bad zone strings throw; show nothing rather than a red banner.
    return ''
  }
})

const weekOptions = [
  { label: 'Monday', value: 1 as const },
  { label: 'Sunday', value: 7 as const }
]

// Load once, and re-load if the user reference flips (sign-out / sign-in).
watch(
  () => profile.value,
  (p) => {
    if (!p) return
    state.display_name = p.display_name ?? ''
    state.username = p.username ?? ''
    state.timezone = p.timezone
    state.daily_goal_minutes = p.daily_goal_minutes
    state.week_starts_on = (p.week_starts_on === 7 ? 7 : 1)
  },
  { immediate: true }
)

// Trigger the initial fetch. If it fails, `error` shows the reason instead
// of a blank form pretending everything is fine.
await load()

function detectTimezone() {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (detected) state.timezone = detected
}

function validate(data: typeof state) {
  const errs: Array<{ name: string, message: string }> = []
  // Mirrors the DB check constraint, so the user hears about it before a round
  // trip. Blank is valid — it means "leave me undiscoverable". Normalised
  // through the same helper the search box uses, so `@Yosr` here and `@Yosr`
  // there cannot disagree about what handle that is.
  const handle = normaliseHandle(data.username)
  if (handle.length > 0 && !USERNAME_PATTERN.test(handle)) {
    errs.push({
      name: 'username',
      message: '3–20 characters: lowercase letters, numbers and underscores'
    })
  }
  if (!data.timezone) errs.push({ name: 'timezone', message: 'Pick a timezone' })
  if (!Number.isInteger(data.daily_goal_minutes) || data.daily_goal_minutes < 0) {
    errs.push({ name: 'daily_goal_minutes', message: 'Must be a whole number of minutes, 0 or more' })
  }
  if (data.week_starts_on !== 1 && data.week_starts_on !== 7) {
    errs.push({ name: 'week_starts_on', message: 'Pick Monday or Sunday' })
  }
  return errs
}

// ---------------------------------------------------------------------------
// FA-016 — goals. Separate failure domain from the profile form above: a failed
// goals read must not hide the timezone field, which is the setting everything
// else in the app depends on.
// ---------------------------------------------------------------------------

const {
  goals,
  progress: goalProgress,
  loading: goalsLoading,
  error: goalsError,
  loaded: goalsLoaded,
  load: loadGoals,
  create: createGoal,
  update: updateGoal,
  deactivate: deactivateGoal
} = useGoals()

const { active: activeTopics } = useTopics()

const goalModalOpen = ref(false)
const editingGoal = ref<Goal | null>(null)
const goalSaving = ref(false)

if (!goalsLoaded.value) void loadGoals()

function openCreateGoal() {
  editingGoal.value = null
  goalModalOpen.value = true
}

function openEditGoal(goal: Goal) {
  editingGoal.value = goal
  goalModalOpen.value = true
}

function goalTopicLabel(goal: Goal): string {
  if (goal.topic_id === null) return 'All topics'
  return activeTopics.value.find(topic => topic.id === goal.topic_id)?.name ?? 'Archived topic'
}

async function onGoalSubmit(input: GoalInput) {
  if (goalSaving.value) return
  goalSaving.value = true
  try {
    if (editingGoal.value) {
      await updateGoal(editingGoal.value.id, input)
      toast.add({ title: 'Goal updated', icon: 'i-lucide-check', color: 'success' })
    } else {
      await createGoal(input)
      toast.add({ title: 'Goal added', icon: 'i-lucide-check', color: 'success' })
    }
    goalModalOpen.value = false
    editingGoal.value = null
  } catch (err) {
    toast.add({
      title: 'Could not save goal',
      description: (err as Error).message,
      icon: 'i-lucide-triangle-alert',
      color: 'error'
    })
  } finally {
    goalSaving.value = false
  }
}

async function onGoalDeactivate(goal: Goal) {
  try {
    await deactivateGoal(goal.id)
    toast.add({ title: 'Goal switched off', icon: 'i-lucide-power', color: 'success' })
  } catch (err) {
    toast.add({
      title: 'Could not switch off goal',
      description: (err as Error).message,
      icon: 'i-lucide-triangle-alert',
      color: 'error'
    })
  }
}

/** Progress lookup so each row can show where it currently stands. */
const progressByGoal = computed(() => new Map(goalProgress.value.map(entry => [entry.goal.id, entry])))

async function onSubmit(event: FormSubmitEvent<typeof state>) {
  if (saving.value) return
  saving.value = true
  formError.value = null

  // Normalize empty display name to null — the column is nullable and an
  // empty string reads as "the user set it to empty", which isn't the intent.
  const trimmed = event.data.display_name.trim()
  const handle = normaliseHandle(event.data.username)
  const patch = {
    display_name: trimmed.length > 0 ? trimmed : null,
    // Blank clears the handle back to null — i.e. removes you from search.
    username: handle.length > 0 ? handle : null,
    timezone: event.data.timezone,
    daily_goal_minutes: event.data.daily_goal_minutes,
    week_starts_on: event.data.week_starts_on
  }

  try {
    await update(patch)
    toast.add({
      title: 'Settings saved',
      icon: 'i-lucide-check',
      color: 'success'
    })
  } catch (err) {
    formError.value = (err as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UContainer class="py-8 md:py-12">
    <div class="max-w-2xl mx-auto flex flex-col gap-6">
      <header class="flex flex-col gap-1">
        <h1 class="text-2xl md:text-3xl font-semibold text-highlighted">
          Settings
        </h1>
        <p class="text-sm text-muted">
          These three fields quietly control every number in the app.
        </p>
      </header>

      <UCard v-if="loading && !profile">
        <div class="flex flex-col gap-4">
          <USkeleton class="h-4 w-1/3" />
          <USkeleton class="h-10 w-full" />
          <USkeleton class="h-4 w-1/3" />
          <USkeleton class="h-10 w-full" />
          <USkeleton class="h-4 w-1/3" />
          <USkeleton class="h-10 w-full" />
        </div>
      </UCard>

      <UAlert
        v-else-if="error"
        color="error"
        variant="soft"
        icon="i-lucide-triangle-alert"
        title="Couldn't load your profile"
        :description="error"
        :actions="[{ label: 'Retry', color: 'error', variant: 'solid', onClick: () => load() }]"
      />

      <!-- Its own card because it saves on pick, not on submit. -->
      <UCard v-if="profile">
        <div class="flex flex-wrap items-center gap-4">
          <UserAvatar
            :name="profile.display_name"
            :username="profile.username"
            :src="profile.avatar_url"
            size="xl"
          />
          <div class="flex min-w-0 flex-col gap-2">
            <div>
              <p class="text-sm font-medium text-highlighted">
                Profile picture
              </p>
              <p class="text-xs text-muted">
                Shown to friends. Saves as soon as you pick one.
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <UButton
                icon="i-lucide-upload"
                size="sm"
                color="neutral"
                variant="outline"
                :loading="uploading"
                :disabled="uploading"
                @click="pickAvatar"
              >
                {{ profile.avatar_url ? 'Change' : 'Upload' }}
              </UButton>
              <UButton
                v-if="profile.avatar_url"
                icon="i-lucide-trash-2"
                size="sm"
                color="neutral"
                variant="ghost"
                :disabled="uploading"
                @click="onAvatarRemove"
              >
                Remove
              </UButton>
            </div>
          </div>
        </div>

        <!-- Hidden native input: UButton above is the visible control, so the
             file picker keeps the app's styling without a custom widget. -->
        <input
          ref="fileInput"
          type="file"
          :accept="AVATAR_ACCEPT"
          class="hidden"
          @change="onAvatarPicked"
        >

        <UAlert
          v-if="avatarError"
          class="mt-4"
          color="error"
          variant="soft"
          icon="i-lucide-triangle-alert"
          :title="avatarError"
        />
      </UCard>

      <UCard v-if="profile">
        <UForm
          :state="state"
          :validate="validate"
          class="flex flex-col gap-6"
          @submit="onSubmit"
        >
          <UFormField
            label="Display name"
            name="display_name"
            help="Shown in the account menu. Leave blank to use your email."
          >
            <UInput
              v-model="state.display_name"
              placeholder="Your name"
              :disabled="saving"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Handle"
            name="username"
            help="How friends find you. Leave blank and nobody can search for you."
          >
            <UInput
              v-model="state.username"
              placeholder="yourname"
              icon="i-lucide-at-sign"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              :disabled="saving"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Timezone"
            name="timezone"
            required
          >
            <template #help>
              <span class="text-xs text-muted">
                Changing timezone only affects new sessions. Existing entries keep the day they were recorded on.
              </span>
            </template>

            <div class="flex flex-col sm:flex-row sm:items-center gap-2">
              <USelectMenu
                v-model="state.timezone"
                :items="timezones"
                :search-input="{ placeholder: 'Search timezones…' }"
                :disabled="saving"
                class="w-full sm:flex-1"
              />
              <UButton
                type="button"
                color="neutral"
                variant="outline"
                icon="i-lucide-locate-fixed"
                :disabled="saving"
                @click="detectTimezone"
              >
                Detect
              </UButton>
            </div>

            <p
              v-if="currentLocalTime"
              class="mt-2 text-xs text-muted"
            >
              Current local time here: <span class="font-medium text-default">{{ currentLocalTime }}</span>
            </p>
          </UFormField>

          <UFormField
            label="Daily goal"
            name="daily_goal_minutes"
            help="Minutes of focused study per day. Set to 0 to disable the goal ring."
            required
          >
            <UInputNumber
              v-model="state.daily_goal_minutes"
              :min="0"
              :step="5"
              :disabled="saving"
              class="w-40"
            />
            <template #hint>
              <span class="text-xs text-muted">minutes</span>
            </template>
          </UFormField>

          <UFormField
            label="Week starts on"
            name="week_starts_on"
            help="How weekly totals are grouped."
            required
          >
            <URadioGroup
              v-model="state.week_starts_on"
              :items="weekOptions"
              orientation="horizontal"
              :disabled="saving"
            />
          </UFormField>

          <UAlert
            v-if="formError"
            color="error"
            variant="soft"
            icon="i-lucide-triangle-alert"
            :title="formError"
          />

          <div class="flex items-center justify-end gap-2 pt-2 border-t border-default">
            <UButton
              type="submit"
              :loading="saving"
              :disabled="saving"
              icon="i-lucide-save"
            >
              Save changes
            </UButton>
          </div>
        </UForm>
      </UCard>

      <!-- FA-016 — goals. `daily_goal_minutes` above and this list are two
           different mechanisms, and users will assume they are one. The help
           text below says outright which one drives the dashboard ring, because
           silently having two daily targets is a genuinely confusing state. -->
      <UCard>
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-col gap-1">
              <h2 class="text-base font-semibold text-highlighted">
                Goals
              </h2>
              <p class="text-sm text-muted">
                Targets per topic, per period. The daily goal above is what the
                dashboard ring follows.
              </p>
            </div>
            <UButton
              icon="i-lucide-plus"
              size="sm"
              :disabled="goalsLoading"
              @click="openCreateGoal"
            >
              Add goal
            </UButton>
          </div>
        </template>

        <UAlert
          v-if="goalsError"
          color="error"
          variant="soft"
          icon="i-lucide-triangle-alert"
          title="Couldn't load your goals"
          :description="goalsError"
          :actions="[{ label: 'Retry', color: 'neutral', variant: 'outline', onClick: () => loadGoals() }]"
        />

        <div
          v-else-if="goalsLoading && goals.length === 0"
          class="flex flex-col gap-3"
        >
          <USkeleton class="h-12 w-full" />
          <USkeleton class="h-12 w-full" />
        </div>

        <div
          v-else-if="goals.length === 0"
          class="flex flex-col items-center gap-2 py-6 text-center"
        >
          <UIcon
            name="i-lucide-target"
            class="size-6 text-muted"
          />
          <p class="text-sm text-muted">
            No goals yet. Add one to track a topic weekly or monthly.
          </p>
        </div>

        <ul
          v-else
          class="flex flex-col divide-y divide-default"
        >
          <li
            v-for="goal in goals"
            :key="goal.id"
            class="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-highlighted">
                {{ goalTopicLabel(goal) }}
              </p>
              <p class="text-xs text-muted">
                {{ PERIOD_LABELS[goal.period] }} · {{ goal.target_minutes }} min
                <template v-if="progressByGoal.get(goal.id)">
                  · {{ formatDuration(progressByGoal.get(goal.id)!.focusSeconds) }} so far
                </template>
              </p>
            </div>
            <div class="flex items-center gap-1">
              <UButton
                icon="i-lucide-pencil"
                color="neutral"
                variant="ghost"
                size="sm"
                :aria-label="`Edit ${goalTopicLabel(goal)} goal`"
                @click="openEditGoal(goal)"
              />
              <!-- Switch off, never delete: the partial unique index only
                   counts active rows, so this frees the slot and keeps the
                   record. -->
              <UButton
                icon="i-lucide-power"
                color="neutral"
                variant="ghost"
                size="sm"
                :aria-label="`Switch off ${goalTopicLabel(goal)} goal`"
                @click="onGoalDeactivate(goal)"
              />
            </div>
          </li>
        </ul>
      </UCard>

      <UModal
        v-model:open="goalModalOpen"
        :title="editingGoal ? 'Edit goal' : 'Add goal'"
      >
        <template #body>
          <GoalForm
            :key="editingGoal?.id ?? 'new'"
            :goal="editingGoal"
            :topics="activeTopics"
            :saving="goalSaving"
            @submit="onGoalSubmit"
            @cancel="goalModalOpen = false"
            @edit-conflict="openEditGoal"
          />
        </template>
      </UModal>
    </div>
  </UContainer>
</template>
