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
          class="h-2 overflow-hidden rounded-full bg-elevated"
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
        </div>
      </li>
    </ul>
  </UCard>
</template>
