<script setup lang="ts">
import type { SessionSummary } from '~/types/database'

/**
 * One row in the session history list. The row is a summary line — pure
 * presentation, driven entirely by `v_session_summary`. The parent decides
 * when it is expanded and renders `SessionDetail` beneath it.
 *
 * Nulls that render badly if ignored:
 *   - `ended_at` null  → session is still running; do not compute a duration.
 *   - `adherence_ratio` null → no template; render '—', never '0%'.
 *   - `focus_rating` null → user skipped it; render '—', not '0'.
 * Adherence over 100% is real (overshot the plan); we display it honestly.
 */

const props = defineProps<{
  session: SessionSummary
  expanded: boolean
}>()

defineEmits<{
  (e: 'toggle'): void
}>()

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit'
})

const isRunning = computed(() => props.session.status === 'active' || props.session.ended_at === null)

const title = computed(() => {
  const t = props.session.title?.trim()
  if (t && t.length > 0) return t
  const name = props.session.template_name?.trim()
  if (name && name.length > 0) return name
  return 'Untitled session'
})

const startedLabel = computed(() => timeFormatter.format(new Date(props.session.started_at)))

// Wall-clock length of the sitting, for the "when" column. Uses `started_at`
// to `ended_at`; while the session is running we intentionally do not show a
// number here — the running badge carries that meaning.
const rangeLabel = computed(() => {
  if (isRunning.value || !props.session.ended_at) return startedLabel.value
  const end = timeFormatter.format(new Date(props.session.ended_at))
  return `${startedLabel.value} – ${end}`
})

// "Time studied" is `actual_focus_seconds` — already net of pauses in the view.
const focusLabel = computed(() => formatDuration(props.session.actual_focus_seconds))

// Adherence: null when there was no template. Over 100% is legitimate; we
// clamp only the width of the progress bar, never the numeric readout.
const adherencePct = computed(() => {
  if (props.session.adherence_ratio === null) return null
  return Math.round(props.session.adherence_ratio * 100)
})
const adherenceBarWidth = computed(() => {
  if (adherencePct.value === null) return '0%'
  return `${Math.min(adherencePct.value, 100)}%`
})
const adherenceOver = computed(() => adherencePct.value !== null && adherencePct.value > 100)

const plannedLabel = computed(() => formatDuration(props.session.planned_focus_seconds))

const ratingLabel = computed(() => {
  if (props.session.focus_rating === null) return '—'
  return `${props.session.focus_rating}/5`
})

// Status: colour AND text. Colour alone would fail low-vision users; the label
// text is always visible on the badge.
const statusMeta = computed<{ label: string, color: 'success' | 'primary' | 'warning', icon: string }>(() => {
  switch (props.session.status) {
    case 'completed':
      return { label: 'Completed', color: 'success', icon: 'i-lucide-circle-check' }
    case 'active':
      return { label: 'Running', color: 'primary', icon: 'i-lucide-play' }
    case 'abandoned':
      return { label: 'Abandoned', color: 'warning', icon: 'i-lucide-circle-x' }
  }

  // Unreachable while `status` holds a `SessionStatus`, which is why TypeScript
  // is happy without it. But the value comes from Postgres: add a fourth status
  // to the enum and this computed returns `undefined`, and the template reads
  // `.color` off it and takes the row down. Render the raw status instead.
  return { label: props.session.status, color: 'warning', icon: 'i-lucide-circle-help' }
})
</script>

<template>
  <div class="border border-default rounded-lg bg-elevated overflow-hidden">
    <button
      type="button"
      class="w-full flex items-start gap-4 p-4 text-left hover:bg-accented/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :aria-expanded="expanded"
      :aria-label="`${expanded ? 'Collapse' : 'Expand'} ${title}`"
      @click="$emit('toggle')"
    >
      <UIcon
        :name="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
        class="mt-1 shrink-0 text-muted size-4"
      />

      <div class="flex-1 min-w-0 flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-medium text-highlighted truncate">{{ title }}</span>
          <UBadge
            :label="statusMeta.label"
            :color="statusMeta.color"
            :icon="statusMeta.icon"
            variant="subtle"
            size="sm"
          />
          <span
            v-if="session.template_name && title !== session.template_name"
            class="text-xs text-muted truncate"
          >
            {{ session.template_name }}
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span class="inline-flex items-center gap-1">
            <UIcon
              name="i-lucide-clock"
              class="size-3.5"
            />
            {{ rangeLabel }}
          </span>
          <span class="inline-flex items-center gap-1">
            <UIcon
              name="i-lucide-target"
              class="size-3.5"
            />
            <span class="text-highlighted font-medium">{{ focusLabel }}</span>
            <span class="text-xs">focus</span>
          </span>
          <span
            v-if="session.block_count > 0"
            class="inline-flex items-center gap-1"
          >
            <UIcon
              name="i-lucide-layers"
              class="size-3.5"
            />
            {{ session.block_count }} block{{ session.block_count === 1 ? '' : 's' }}
          </span>
          <span
            v-if="session.interruptions > 0"
            class="inline-flex items-center gap-1"
          >
            <UIcon
              name="i-lucide-bell-off"
              class="size-3.5"
            />
            {{ session.interruptions }} interruption{{ session.interruptions === 1 ? '' : 's' }}
          </span>
          <span class="inline-flex items-center gap-1">
            <UIcon
              name="i-lucide-star"
              class="size-3.5"
            />
            {{ ratingLabel }}
          </span>
        </div>

        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2 text-xs text-muted">
            <span>Adherence</span>
            <span
              v-if="adherencePct !== null"
              class="font-medium"
              :class="adherenceOver ? 'text-primary' : 'text-highlighted'"
            >
              {{ adherencePct }}%
            </span>
            <span
              v-else
              class="text-highlighted font-medium"
              aria-label="No plan for this session"
            >—</span>
            <span
              v-if="session.planned_focus_seconds !== null"
              class="text-muted"
            >
              of {{ plannedLabel }} planned
            </span>
            <span
              v-if="adherenceOver"
              class="text-primary text-xs"
            >(overshot)</span>
          </div>
          <div
            v-if="adherencePct !== null"
            class="h-1.5 bg-accented rounded-full overflow-hidden"
            role="progressbar"
            :aria-valuenow="adherencePct"
            :aria-valuemin="0"
            aria-valuemax="100"
          >
            <div
              class="h-full transition-all"
              :class="adherenceOver ? 'bg-primary' : 'bg-primary/70'"
              :style="{ width: adherenceBarWidth }"
            />
          </div>
        </div>
      </div>
    </button>

    <div v-if="expanded">
      <div class="border-t border-default">
        <SessionDetail
          :session-id="session.session_id"
          :is-running="isRunning"
        />
      </div>
    </div>
  </div>
</template>
