<script setup lang="ts">
/**
 * Compact daily-goal card for the FA-020 right rail: 72px ring, then the
 * numbers beside it.
 *
 * Deliberately NOT a variant of `GoalRing`. That component is the dashboard's
 * hero element and carries the goal-reached flash animation and its own
 * lifecycle state; bending it into a 72px horizontal layout would put both
 * shapes at risk of each other's regressions for the sake of sharing one
 * `stroke-dasharray`. This is the smaller, duller half of it.
 *
 * Self-fetching so the Focus page does not have to thread three more values
 * through its already-long setup.
 */
const { today, streak, goalMinutes, pending, error, refresh } = useStats()

void refresh()

const RADIUS = 30
const CIRC = 2 * Math.PI * RADIUS

const focusMinutes = computed(() => today.value?.focus_minutes ?? 0)

// Prefer today's row — the profile may have been edited after the DB
// aggregated it — and fall back to the profile value.
const goal = computed(() => today.value?.goal_minutes ?? goalMinutes.value)

/** A zero goal is "no goal set", not "instantly complete". */
const ratio = computed(() => {
  if (goal.value <= 0) return 0
  return Math.min(focusMinutes.value / goal.value, 1)
})

const percent = computed(() => Math.round(ratio.value * 100))

const offset = computed(() => CIRC * (1 - ratio.value))

const goalLabel = computed(() =>
  goal.value > 0 ? `of ${formatDuration(goal.value * 60)}` : 'no goal set'
)
</script>

<template>
  <UCard :ui="{ body: 'p-5' }">
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="Couldn't load your goal"
      :description="error"
      :actions="[{ label: 'Retry', onClick: () => refresh(), color: 'neutral', variant: 'outline' }]"
    />

    <USkeleton
      v-else-if="pending"
      class="h-[72px] w-full"
    />

    <div
      v-else
      class="flex items-center gap-4"
    >
      <div class="relative size-[72px] shrink-0">
        <svg
          viewBox="0 0 72 72"
          class="size-full -rotate-90"
          aria-hidden="true"
        >
          <circle
            cx="36"
            cy="36"
            :r="RADIUS"
            fill="none"
            stroke-width="7"
            class="stroke-accented"
          />
          <circle
            cx="36"
            cy="36"
            :r="RADIUS"
            fill="none"
            stroke-width="7"
            stroke-linecap="round"
            class="stroke-primary transition-[stroke-dashoffset] duration-500"
            :stroke-dasharray="CIRC"
            :stroke-dashoffset="offset"
          />
        </svg>
        <span
          class="absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums text-highlighted"
        >
          {{ percent }}%
        </span>
      </div>

      <div class="min-w-0">
        <p class="text-[11px] font-medium uppercase tracking-wider text-muted">
          Daily goal
        </p>
        <p class="mt-1 font-display text-xl font-semibold tabular-nums text-highlighted">
          {{ formatDuration(focusMinutes * 60) }}
          <span class="text-sm font-medium text-muted">{{ goalLabel }}</span>
        </p>
        <p class="mt-1 text-xs text-muted">
          Streak: {{ streak?.current_streak ?? 0 }}
          {{ (streak?.current_streak ?? 0) === 1 ? 'day' : 'days' }}
        </p>
      </div>
    </div>
  </UCard>
</template>
