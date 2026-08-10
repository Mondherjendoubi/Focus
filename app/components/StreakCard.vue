<script setup lang="ts">
import type { LocalDay } from '~/types/database'

/**
 * Streak surface. `current` comes straight from `v_streaks.current_streak`,
 * which already returns 0 when the last active day is older than yesterday —
 * so this component never recomputes staleness, it just shows what the view
 * reported.
 */
const props = defineProps<{
  current: number
  longest: number
  lastActiveDay: LocalDay | null
  /**
   * Whether any focus time landed today, decided from `profiles.timezone` by
   * the caller. The view's grace period means a live streak and an untouched
   * today can coexist — that gap is exactly the state worth surfacing.
   */
  focusedToday?: boolean
}>()

const active = computed(() => props.current > 0)

/**
 * At risk = the streak is alive only because of the view's one-day grace, and
 * today is still empty. This is not recomputed staleness: `current_streak` is
 * already 0 once the last active day is older than yesterday, so a positive
 * count plus an empty today can only mean "today is the day it gets decided".
 */
const atRisk = computed(() => props.current > 0 && props.focusedToday !== true)

/** A streak that ties the record turns tonight into a personal best attempt. */
const recordOnTheLine = computed(() => atRisk.value && props.current >= props.longest)

const status = computed(() => {
  if (props.current === 0 && props.longest === 0) return 'Start your first streak today'
  if (props.current === 0) return 'Streak broken — start a new one'
  if (recordOnTheLine.value) {
    return `Study today and it's a personal best — ${props.current + 1} days`
  }
  if (atRisk.value) {
    return `Study today to keep your ${props.current}-day streak`
  }
  if (props.current === 1) return 'Day one — keep it going tomorrow'
  return `${props.current} days in a row`
})
</script>

<template>
  <UCard>
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium uppercase tracking-wide text-muted">
          Streak
        </h3>
        <UIcon
          :name="active ? 'i-lucide-flame' : 'i-lucide-flame-kindling'"
          :class="[atRisk ? 'text-warning' : active ? 'text-primary' : 'text-muted', 'size-5']"
        />
      </div>

      <div class="flex items-baseline gap-2">
        <span class="font-display text-4xl font-semibold tracking-tight tabular-nums text-highlighted">
          {{ current }}
        </span>
        <span class="text-sm text-muted">
          {{ current === 1 ? 'day' : 'days' }}
        </span>
      </div>

      <p
        class="flex items-start gap-1.5 text-sm"
        :class="atRisk ? 'font-medium text-warning' : 'text-default'"
      >
        <UIcon
          v-if="atRisk"
          :name="recordOnTheLine ? 'i-lucide-trophy' : 'i-lucide-alarm-clock'"
          class="mt-0.5 size-4 shrink-0"
        />
        <span>{{ status }}</span>
      </p>

      <div class="flex items-center justify-between border-t border-default pt-3 text-xs text-muted">
        <span>
          Longest:
          <span class="font-medium tabular-nums text-default">{{ longest }}</span>
          {{ longest === 1 ? 'day' : 'days' }}
        </span>
        <span v-if="lastActiveDay">
          Last: {{ lastActiveDay }}
        </span>
      </div>
    </div>
  </UCard>
</template>
