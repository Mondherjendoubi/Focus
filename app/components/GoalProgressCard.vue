<script setup lang="ts">
import type { GoalProgress } from '~/composables/useGoals'

/**
 * Progress against every active goal, on the dashboard.
 *
 * Self-fetching, and renders NOTHING when the user has no active goals — an
 * empty "Goals" card is noise on a dashboard that already has plenty to read,
 * and the entry point for creating one is settings, not here.
 *
 * The bar clamps at 100% because a 300% bar would break the row, but the text
 * never clamps: overshooting a target is the good outcome and the user should
 * see by how much.
 */
const { progress, loading, error, loaded, load } = useGoals()
const topics = useTopics()

if (!loaded.value) void load()

function topicLabel(entry: GoalProgress): string {
  if (entry.goal.topic_id === null) return 'All topics'
  return topics.active.value.find(topic => topic.id === entry.goal.topic_id)?.name
    ?? topics.archived.value.find(topic => topic.id === entry.goal.topic_id)?.name
    ?? 'Unknown topic'
}

/** Bar width only. The percentage in the text is deliberately unclamped. */
function barWidth(ratio: number): string {
  return `${Math.min(Math.max(ratio, 0), 1) * 100}%`
}

function pctLabel(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

/** Remaining, or the overage once the target is passed. */
function remainderLabel(entry: GoalProgress): string {
  const delta = entry.targetSeconds - entry.focusSeconds
  if (delta <= 0) return `${formatDuration(-delta)} over`
  return `${formatDuration(delta)} to go`
}

function periodLabel(entry: GoalProgress): string {
  return PERIOD_LABELS[entry.goal.period]
}

/**
 * Ahead or behind where you should be by now — the number that turns a bar
 * into a verdict. Null for daily goals (no meaningful pace), and null once the
 * target is met, because "behind pace" on a goal you have already hit is
 * nonsense the user should never be shown.
 */
function paceLabel(entry: GoalProgress): string | null {
  if (entry.expectedRatio === null) return null
  if (entry.ratio >= 1) return null

  const delta = entry.ratio - entry.expectedRatio
  // Within a few points of pace is "on pace" — flapping between ahead and
  // behind on a rounding difference reads as noise.
  if (Math.abs(delta) < 0.05) return 'on pace'

  const shortfall = Math.abs(delta) * entry.targetSeconds
  return delta > 0
    ? `${formatDuration(shortfall)} ahead of pace`
    : `${formatDuration(shortfall)} behind pace`
}

function paceTone(entry: GoalProgress): string {
  if (entry.expectedRatio === null) return 'text-muted'
  const delta = entry.ratio - entry.expectedRatio
  if (Math.abs(delta) < 0.05) return 'text-muted'
  return delta > 0 ? 'text-primary' : 'text-warning'
}

/** Where "should be by now" sits on the bar, as a percentage from the left. */
function paceMarkerLeft(entry: GoalProgress): string {
  return `${Math.min(Math.max(entry.expectedRatio ?? 0, 0), 1) * 100}%`
}
</script>

<template>
  <UCard v-if="error || loading || progress.length > 0">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-target"
          class="size-4 text-muted"
        />
        <h3 class="text-sm font-medium text-highlighted">
          Goals
        </h3>
      </div>
    </template>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="Couldn't load your goals"
      :description="error"
      :actions="[{ label: 'Retry', onClick: () => load(), color: 'neutral', variant: 'outline' }]"
    />

    <div
      v-else-if="loading && progress.length === 0"
      class="flex flex-col gap-4"
    >
      <USkeleton class="h-12 w-full" />
      <USkeleton class="h-12 w-full" />
    </div>

    <ul
      v-else
      class="flex flex-col gap-4"
    >
      <li
        v-for="entry in progress"
        :key="entry.goal.id"
        class="flex flex-col gap-1.5"
      >
        <div class="flex items-baseline justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-highlighted">
              {{ topicLabel(entry) }}
            </p>
            <p class="text-xs text-muted">
              {{ periodLabel(entry) }} · since {{ entry.windowStart }}
            </p>
          </div>
          <div class="shrink-0 text-right">
            <p class="text-sm font-medium tabular-nums text-highlighted">
              {{ formatDuration(entry.focusSeconds) }}
              <span class="text-muted">/ {{ formatDuration(entry.targetSeconds) }}</span>
            </p>
            <p
              class="text-xs tabular-nums"
              :class="entry.ratio >= 1 ? 'text-primary' : 'text-muted'"
            >
              {{ pctLabel(entry.ratio) }} · {{ remainderLabel(entry) }}
            </p>
          </div>
        </div>

        <div
          class="relative h-2 overflow-hidden rounded-full bg-elevated"
          role="progressbar"
          :aria-valuenow="Math.round(entry.ratio * 100)"
          :aria-valuemin="0"
          :aria-valuemax="100"
          :aria-label="`${topicLabel(entry)} ${periodLabel(entry).toLowerCase()} goal`"
        >
          <div
            class="h-full rounded-full"
            :class="entry.ratio >= 1 ? 'bg-primary' : 'bg-primary/60'"
            :style="{ width: barWidth(entry.ratio) }"
          />
          <!-- Pace marker: where the bar would be if the period were spent
               evenly. Decorative — the sentence below carries the same fact for
               anyone who cannot see it. -->
          <span
            v-if="entry.expectedRatio !== null && entry.ratio < 1"
            class="absolute inset-y-0 w-0.5 bg-inverted/40"
            :style="{ left: paceMarkerLeft(entry) }"
            aria-hidden="true"
          />
        </div>

        <p
          v-if="paceLabel(entry)"
          class="text-xs"
          :class="paceTone(entry)"
        >
          {{ paceLabel(entry) }}
          <span class="text-muted">
            · day {{ entry.daysElapsed }} of {{ entry.daysInPeriod }}
          </span>
        </p>
      </li>
    </ul>
  </UCard>
</template>
