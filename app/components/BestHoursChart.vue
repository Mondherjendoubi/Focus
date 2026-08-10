<script setup lang="ts">
import type { BestHours } from '~/composables/useAnalytics'

/**
 * "When am I actually good at this?" — focus time collapsed to hour-of-day.
 *
 * `FocusHeatmap` already renders the dow × hour grid, but a grid answers
 * "Tuesday at 9" and this answers "mornings". Reading the peak hour off the
 * heatmap by eye is exactly the re-aggregation CLAUDE.md warns about, so the
 * collapse happens once in `useAnalytics`, from `v_block_facts` rather than
 * `v_focus_heatmap` — the heatmap view is all-time and would ignore the range
 * picker driving every other card in this section.
 *
 * `hour_of_day` is stamped by the view in the profile's timezone, so these bars
 * are the user's mornings, not UTC's.
 */
const props = defineProps<{
  bestHours: BestHours | null
  pending?: boolean
}>()

const HOURS = Array.from({ length: 24 }, (_v, i) => i)
/** Every third label, matching FocusHeatmap's axis so the two read as a pair. */
const HOUR_LABEL_STEP = 3

const peakSeconds = computed(() => {
  const seconds = props.bestHours?.seconds ?? []
  return seconds.reduce((max, value) => (value > max ? value : max), 0)
})

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

function barHeight(hour: number): string {
  const value = props.bestHours?.seconds[hour] ?? 0
  if (peakSeconds.value === 0 || value === 0) return '0%'
  // Same floor as the rating spread: a nonzero hour must not render as nothing.
  return `${Math.max((value / peakSeconds.value) * 100, 6)}%`
}

function barTitle(hour: number): string {
  const value = props.bestHours?.seconds[hour] ?? 0
  if (value === 0) return `${hourLabel(hour)} — no focus time`
  return `${hourLabel(hour)} — ${formatDuration(value)}`
}

const peakLabel = computed(() => {
  const peak = props.bestHours?.peakHour
  if (peak === null || peak === undefined) return null
  return hourLabel(peak)
})

const hasData = computed(() => peakSeconds.value > 0)
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-sunrise"
            class="size-4 text-muted"
          />
          <h3 class="text-sm font-medium text-highlighted">
            Best hours
          </h3>
        </div>
        <span
          v-if="peakLabel"
          class="text-xs text-muted"
        >
          peak at <span class="font-medium text-default tabular-nums">{{ peakLabel }}</span>
        </span>
      </div>
    </template>

    <USkeleton
      v-if="pending"
      class="h-40 w-full"
    />

    <div
      v-else-if="!hasData"
      class="flex h-40 items-center justify-center"
    >
      <p class="text-sm text-muted">
        No focus blocks in this range yet.
      </p>
    </div>

    <div
      v-else
      class="overflow-x-auto"
    >
      <div class="min-w-[420px]">
        <div class="flex h-32 items-end gap-[3px]">
          <div
            v-for="hour in HOURS"
            :key="hour"
            class="flex h-full flex-1 items-end"
          >
            <div
              class="w-full rounded-t"
              :class="hour === bestHours?.peakHour ? 'bg-primary' : 'bg-primary/50'"
              :style="{ height: barHeight(hour) }"
              role="img"
              :title="barTitle(hour)"
              :aria-label="barTitle(hour)"
            />
          </div>
        </div>
        <div class="mt-1.5 flex gap-[3px]">
          <div
            v-for="hour in HOURS"
            :key="`label-${hour}`"
            class="flex-1 text-center text-[10px] leading-none text-muted"
          >
            <span v-if="hour % HOUR_LABEL_STEP === 0">{{ String(hour).padStart(2, '0') }}</span>
          </div>
        </div>
      </div>
    </div>
  </UCard>
</template>
