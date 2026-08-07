<script setup lang="ts">
import type { SessionSummary } from '~/types/database'

/**
 * Session history — paginated, reverse-chronological, grouped by the user's
 * local day. Row detail (per-block breakdown) is lazy and lives in
 * `SessionDetail`, mounted only when the row is expanded.
 *
 * Data comes from `v_session_summary`: one row per session, already joined
 * to the template and aggregated over its blocks. RLS scopes it to the
 * signed-in user — we never `.eq('user_id', ...)`.
 *
 * Nulls handled explicitly here so nothing silently reads as zero:
 *   - `ended_at` null → session is still running
 *   - `adherence_ratio` null → no template
 *   - `focus_rating` null → user skipped it
 *
 * Day-grouping note: `v_session_summary` does not expose `local_day`, so we
 * compute the calendar date of `started_at` in the *profile timezone* — the
 * same timezone the server uses to stamp `session_blocks.local_day`. This is
 * not "the browser bucketing days"; the browser is only asking a timezone
 * database to name the day for a specific instant in a specific zone.
 */

definePageMeta({ middleware: 'auth' })

useSeoMeta({ title: 'History' })

const supabase = useSupabase()

const PAGE_SIZE = 20

const sessions = ref<SessionSummary[]>([])
const timezone = ref<string>('UTC')
const pending = ref(true)
const loadingMore = ref(false)
const errorMessage = ref<string | null>(null)
const hasMore = ref(true)
const page = ref(0)

const expandedId = ref<string | null>(null)

// Same technique as `app/utils/dates.ts::toLocalDay` — assemble the date from
// `Intl.DateTimeFormat` parts so DST and half-hour zones are correct and the
// locale can never reorder the fields.
const dayFormatters = new Map<string, Intl.DateTimeFormat>()
function dayFormatter(tz: string): Intl.DateTimeFormat {
  let f = dayFormatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    dayFormatters.set(tz, f)
  }
  return f
}
function toLocalDay(iso: string, tz: string): string {
  const parts = dayFormatter(tz).formatToParts(new Date(iso))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

// Nicer header per group. "Today", "Yesterday", else "Thu · 6 Aug 2026".
const headerFormatter = computed(() => new Intl.DateTimeFormat('en-GB', {
  timeZone: timezone.value,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric'
}))
function dayHeader(day: string): string {
  const today = toLocalDay(new Date().toISOString(), timezone.value)
  if (day === today) return 'Today'
  const yesterdayInstant = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const yesterday = toLocalDay(yesterdayInstant, timezone.value)
  if (day === yesterday) return 'Yesterday'
  // Build a stable UTC instant from the YYYY-MM-DD label so the header uses
  // the same calendar date it names, in the profile timezone for weekday.
  return headerFormatter.value.format(new Date(`${day}T12:00:00Z`))
}

interface Group { day: string, sessions: SessionSummary[] }

const groups = computed<Group[]>(() => {
  const map = new Map<string, SessionSummary[]>()
  for (const session of sessions.value) {
    const day = toLocalDay(session.started_at, timezone.value)
    const bucket = map.get(day)
    if (bucket) {
      bucket.push(session)
    } else {
      map.set(day, [session])
    }
  }
  // Preserve descending order: sessions arrive newest-first, so the first
  // time a day appears sets its position in the group list.
  return Array.from(map, ([day, list]) => ({ day, sessions: list }))
})

async function loadTimezone() {
  const { data } = await supabase
    .from('profiles')
    .select('timezone')
    .maybeSingle()
  if (data && typeof (data as { timezone?: unknown }).timezone === 'string') {
    timezone.value = (data as { timezone: string }).timezone
  }
}

async function loadPage(nextPage: number) {
  const from = nextPage * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const { data, error } = await supabase
    .from('v_session_summary')
    .select('*')
    .order('started_at', { ascending: false })
    .range(from, to)

  if (error) {
    errorMessage.value = toMessage(error)
    hasMore.value = false
    return
  }

  const rows = (data ?? []) as SessionSummary[]
  if (nextPage === 0) {
    sessions.value = rows
  } else {
    sessions.value = [...sessions.value, ...rows]
  }
  hasMore.value = rows.length === PAGE_SIZE
  page.value = nextPage
}

async function loadInitial() {
  pending.value = true
  errorMessage.value = null
  // Timezone first (cheap), then the first page. Running them in parallel is
  // fine — grouping recomputes when `timezone` updates.
  await Promise.all([loadTimezone(), loadPage(0)])
  pending.value = false
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  await loadPage(page.value + 1)
  loadingMore.value = false
}

async function retry() {
  await loadInitial()
}

function toggle(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

onMounted(loadInitial)
</script>

<template>
  <div class="min-h-[calc(100vh-8rem)] bg-default">
    <UContainer class="py-8 md:py-12">
      <header class="mb-8 flex flex-col gap-2">
        <h1 class="text-2xl md:text-3xl font-semibold text-highlighted">
          Session history
        </h1>
        <p class="text-sm text-muted">
          What you planned, what actually happened.
        </p>
      </header>

      <!-- Loading -->
      <div
        v-if="pending"
        class="flex flex-col gap-3"
        aria-busy="true"
        aria-live="polite"
      >
        <USkeleton
          v-for="i in 5"
          :key="i"
          class="h-24 rounded-lg"
        />
      </div>

      <!-- Error (distinct from empty!) -->
      <UAlert
        v-else-if="errorMessage && sessions.length === 0"
        color="error"
        variant="soft"
        icon="i-lucide-triangle-alert"
        title="Could not load your history"
        :description="errorMessage"
        :actions="[{
          label: 'Try again',
          color: 'error',
          variant: 'solid',
          onClick: retry
        }]"
      />

      <!-- Empty -->
      <EmptyState
        v-else-if="sessions.length === 0"
        icon="i-lucide-history"
        title="No sessions yet"
        description="Finished sessions land here — with what you studied, for how long, and how it went."
        :action="{ label: 'Start focusing', icon: 'i-lucide-play', to: '/' }"
      />

      <!-- Populated -->
      <div
        v-else
        class="flex flex-col gap-8"
      >
        <section
          v-for="group in groups"
          :key="group.day"
          class="flex flex-col gap-3"
        >
          <div class="flex items-baseline gap-3">
            <h2 class="text-sm font-semibold uppercase tracking-wide text-muted">
              {{ dayHeader(group.day) }}
            </h2>
            <span class="text-xs text-muted">
              {{ group.sessions.length }} session{{ group.sessions.length === 1 ? '' : 's' }}
            </span>
          </div>

          <div class="flex flex-col gap-3">
            <SessionRow
              v-for="session in group.sessions"
              :key="session.session_id"
              :session="session"
              :expanded="expandedId === session.session_id"
              @toggle="toggle(session.session_id)"
            />
          </div>
        </section>

        <!-- A page failed partway through: keep what we have, but say so. -->
        <UAlert
          v-if="errorMessage && sessions.length > 0"
          color="error"
          variant="soft"
          icon="i-lucide-triangle-alert"
          title="Could not load more sessions"
          :description="errorMessage"
        />

        <div
          v-if="hasMore"
          class="flex justify-center pt-2"
        >
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-plus"
            :loading="loadingMore"
            :disabled="loadingMore"
            @click="loadMore"
          >
            Load more
          </UButton>
        </div>
        <p
          v-else
          class="text-center text-xs text-muted pt-2"
        >
          You have reached the end.
        </p>
      </div>
    </UContainer>
  </div>
</template>
