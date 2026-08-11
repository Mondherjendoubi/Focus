<script setup lang="ts">
import type { HistorySession } from '~/composables/useHistory'

/**
 * The full story of one session (FA-024).
 *
 * Both handoffs mount the identical tooltip — the desktop tape and the mobile
 * card differ in how you reach it, not in what it says — so it is one component.
 *
 * The subtitle is the interesting line: start–end, then adherence *as a
 * percentage of what was planned*, then the rating, then interruptions. Each
 * clause is dropped rather than faked when its source is null, which is why
 * "no plan" appears instead of a 0%.
 */
const props = defineProps<{
  session: HistorySession
  /** From `useHistory`, so times read in the profile's zone. */
  timeLabel: (instant: string) => string
}>()

const badge = computed(() => {
  switch (props.session.status) {
    case 'completed': return { label: 'Completed', color: 'success' as const }
    case 'active': return { label: 'Running', color: 'primary' as const }
    case 'abandoned': return { label: 'Abandoned', color: 'warning' as const }
  }

  // `status` is a three-value enum, so TypeScript sees this as unreachable —
  // but it comes from Postgres, and a fourth value added there must not render
  // an empty badge.
  return { label: props.session.status, color: 'neutral' as const }
})

const subtitle = computed(() => {
  const s = props.session
  const parts: string[] = [
    `${props.timeLabel(s.startedAt)} – ${s.endedAt === null ? 'now' : props.timeLabel(s.endedAt)}`
  ]

  if (s.spansDays) {
    // Adherence is nulled for a split session upstream, because it compares a
    // WHOLE session against its plan and this is one day of one.
    parts.push('this day only')
  } else if (s.endedAt === null) {
    parts.push('in progress')
  } else if (s.adherenceRatio !== null && s.plannedFocusSeconds !== null) {
    parts.push(`${Math.round(s.adherenceRatio * 100)}% of ${formatDuration(s.plannedFocusSeconds)} planned`)
  } else {
    // No template, so there is nothing to be a percentage of. Said plainly
    // rather than shown as 0%, which would read as a failure.
    parts.push('no plan')
  }

  if (s.focusRating !== null) parts.push(`${s.focusRating}/5`)
  if (s.interruptions > 0) {
    parts.push(`${s.interruptions} interruption${s.interruptions === 1 ? '' : 's'}`)
  }

  return parts.join(' · ')
})

/** Focus topics, then a single breaks row — the handoff's own ordering. */
const rows = computed(() => {
  const out = props.session.topics.map(topic => ({ ...topic, muted: false }))
  if (props.session.breakSeconds > 0) {
    out.push({ name: 'Breaks', color: null, seconds: props.session.breakSeconds, muted: true })
  }
  return out
})
</script>

<template>
  <div class="pointer-events-none w-[236px] max-w-[calc(100vw-2rem)] rounded-[10px] border border-default bg-default p-3 shadow-lg">
    <div class="flex items-center justify-between gap-3">
      <span class="min-w-0 truncate text-xs font-semibold text-highlighted">{{ session.title }}</span>
      <UBadge
        :color="badge.color"
        variant="subtle"
        size="sm"
        class="shrink-0 rounded-full"
      >
        {{ badge.label }}
      </UBadge>
    </div>

    <p class="mt-1 font-display text-[17px] font-semibold tabular-nums text-highlighted">
      {{ formatDuration(session.focusSeconds) }} <span class="text-xs font-medium text-muted">focus</span>
    </p>

    <p class="mt-0.5 text-[11px] text-dimmed">
      {{ subtitle }}
    </p>

    <ul
      v-if="rows.length > 0"
      class="mt-2 flex flex-col gap-1 border-t border-muted pt-2"
    >
      <li
        v-for="row in rows"
        :key="row.name"
        class="flex items-center gap-1.5 text-xs"
      >
        <span
          class="size-2 shrink-0 rounded-full"
          :style="row.color ? { backgroundColor: row.color } : undefined"
          :class="row.color ? '' : 'bg-dimmed'"
        />
        <span class="min-w-0 flex-1 truncate text-toned">{{ row.name }}</span>
        <span class="shrink-0 tabular-nums text-muted">{{ formatDuration(row.seconds) }}</span>
      </li>
    </ul>
  </div>
</template>
