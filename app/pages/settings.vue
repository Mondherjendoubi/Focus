<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ middleware: 'auth' })

useSeoMeta({ title: 'Settings' })

const { profile, loading, error, load, update } = useProfile()
const toast = useToast()

// Form state — mirrors the four editable columns on `profiles`.
// `daily_goal_minutes` really is minutes (the one column in the schema that
// isn't seconds), so no unit conversion happens here or on save.
const state = reactive({
  display_name: '',
  timezone: 'Europe/Berlin',
  daily_goal_minutes: 120,
  week_starts_on: 1 as 1 | 7
})

const saving = ref(false)
const formError = ref<string | null>(null)

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
  if (!data.timezone) errs.push({ name: 'timezone', message: 'Pick a timezone' })
  if (!Number.isInteger(data.daily_goal_minutes) || data.daily_goal_minutes < 0) {
    errs.push({ name: 'daily_goal_minutes', message: 'Must be a whole number of minutes, 0 or more' })
  }
  if (data.week_starts_on !== 1 && data.week_starts_on !== 7) {
    errs.push({ name: 'week_starts_on', message: 'Pick Monday or Sunday' })
  }
  return errs
}

async function onSubmit(event: FormSubmitEvent<typeof state>) {
  if (saving.value) return
  saving.value = true
  formError.value = null

  // Normalize empty display name to null — the column is nullable and an
  // empty string reads as "the user set it to empty", which isn't the intent.
  const trimmed = event.data.display_name.trim()
  const patch = {
    display_name: trimmed.length > 0 ? trimmed : null,
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

      <UCard v-else-if="profile">
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
    </div>
  </UContainer>
</template>
