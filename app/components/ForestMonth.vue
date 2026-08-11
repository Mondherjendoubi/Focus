<script setup lang="ts">
import type { ForestMonth } from '~/composables/useForest'

/**
 * One month of the forest floor (FA-023).
 *
 * Horizontal position is the day of the month, so the band is a small chart as
 * well as a picture: a month you were consistent through looks different from
 * one you faded out of, and a gap is visibly a gap.
 *
 * The grid always spans the month's REAL length, not the number of days
 * rendered. A month in progress therefore stops short with bare ground to its
 * right, instead of stretching five days across the full width and pretending
 * to be a finished month.
 *
 * Below ~820px the band scrolls sideways rather than reflowing — the same call
 * the friends table makes, and for the same reason: squeezing 31 columns into a
 * phone turns the trees into a smear.
 */
const props = defineProps<{
  month: ForestMonth
  /** Today in the profile's zone, so only a tree planted today animates. */
  today: string | null
}>()

const columns = computed(() => daysInMonthOf(`${props.month.key}-01`))

/** A near-miss still happened. Bare ground says nothing; this says "almost". */
const SPROUT = 'M12 34 L12 28 M12 30 C9.5 30 8.5 28 8.5 26.4 C10.8 26.4 11.8 27.8 12 29 '
  + 'C12.2 27.8 13.2 26.4 15.5 26.4 C15.5 28 14.5 30 12 30 Z'

function sproutLabel(localDay: string, seconds: number): string {
  return `${dayLabel(localDay)} ${localDay} — ${formatDuration(seconds)}, short of goal`
}
</script>

<template>
  <section class="overflow-x-auto rounded-xl border border-default bg-default shadow-sm">
    <div class="min-w-[820px] px-5 pb-4 pt-3.5">
      <div class="flex items-baseline justify-between gap-3">
        <h2 class="font-display text-[15px] font-semibold tracking-tight text-highlighted">
          {{ month.label }}
        </h2>
        <p class="text-xs text-muted">
          {{ month.treeCount }} {{ month.treeCount === 1 ? 'tree' : 'trees' }}
        </p>
      </div>

      <!-- Columns come from the calendar, so day 1 is always leftmost and a
           missed day holds its place instead of closing the gap. -->
      <div
        class="mt-2.5 grid items-end"
        :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }"
      >
        <div
          v-for="day in month.days"
          :key="day.localDay"
          class="flex justify-center"
        >
          <ForestTree
            v-if="day.kind === 'tree'"
            :day="day"
            :just-planted="day.localDay === today"
          />

          <svg
            v-else-if="day.kind === 'sprout'"
            viewBox="0 0 24 34"
            class="h-[34px] w-6 shrink-0 text-success-200 dark:text-success-800"
            role="img"
            :aria-label="sproutLabel(day.localDay, day.focusSeconds)"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          >
            <title>{{ sproutLabel(day.localDay, day.focusSeconds) }}</title>
            <path :d="SPROUT" />
          </svg>

          <!-- Nothing studied. Bare ground is the honest mark, and it is not a
               reproach — the ground line below carries it. -->
          <span
            v-else
            class="block h-[34px] w-6 shrink-0"
          />
        </div>
      </div>

      <div class="border-t border-accented" />
    </div>
  </section>
</template>
