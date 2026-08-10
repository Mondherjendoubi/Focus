<script setup lang="ts">
import type { Consistency, PeriodDelta } from '~/composables/useAnalytics'

/**
 * "Did I show up?" — goal hit-rate, a day strip, and period-over-period change.
 *
 * The strip has THREE states, not two, and the distinction carries the whole
 * meaning of the component:
 *
 *   hit      — studied and met the daily goal
 *   missed   — studied, fell short of the goal
 *   no data  — did not study at all
 *
 * Collapsing "missed" into "no data" would tell a user who studied every single
 * day but set an ambitious goal that they did not show up. That is the opposite
 * of true, so missed days get their own filled-but-muted treatment and empty
 * days get a dashed outline, matching `FocusHeatmap`'s no-data cell.
 */
const props = defineProps<{
  consistency: Consistency | null
  pending?: boolean
}>()

const dayCount = computed(() => props.consistency?.days.length ?? 0)

const hitRateLabel = computed(() => {
  const c = props.consistency
  if (!c || c.days.length === 0) return '—'
  return `${c.hitCount} of ${c.days.length}`
})

/** Filled ring share, guarded so a zero-length range cannot divide by zero. */
const hitPct = computed(() => {
  const c = props.consistency
  if (!c || c.days.length === 0) return 0
  return Math.round((c.hitCount / c.days.length) * 100)
})

function dayClass(goalMet: boolean | null, focusSeconds: number): string {
  if (goalMet === true) return 'bg-primary'
  if (focusSeconds > 0) return 'bg-primary/30'
  return 'bg-elevated border border-dashed border-default/60'
}

function dayTitle(localDay: string, goalMet: boolean | null, focusSeconds: number): string {
  if (goalMet === true) return `${localDay} — goal met, ${formatDuration(focusSeconds)}`
  if (focusSeconds > 0) return `${localDay} — ${formatDuration(focusSeconds)}, goal missed`
  return `${localDay} — no focus time`
}

/**
 * A delta is only a percentage when there is a prior period to be a percentage
 * OF. `ratio` is null when the previous window was zero, and "up ∞%" from
 * nothing is meaningless — that case reads as "new" instead.
 */
function deltaLabel(delta: PeriodDelta | undefined): string {
  if (!delta) return '—'
  if (delta.ratio === null) return delta.current > 0 ? 'new' : '—'
  const pct = Math.round(delta.ratio * 100)
  if (pct === 0) return 'flat'
  return `${pct > 0 ? '+' : ''}${pct}%`
}

function deltaClass(delta: PeriodDelta | undefined): string {
  if (!delta || delta.ratio === null) return 'text-muted'
  if (delta.ratio > 0) return 'text-primary'
  if (delta.ratio < 0) return 'text-warning'
  return 'text-muted'
}

function deltaIcon(delta: PeriodDelta | undefined): string {
  if (!delta || delta.ratio === null) return 'i-lucide-minus'
  if (delta.ratio > 0) return 'i-lucide-trending-up'
  if (delta.ratio < 0) return 'i-lucide-trending-down'
  return 'i-lucide-minus'
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-calendar-check"
          class="size-4 text-muted"
        />
        <h3 class="text-sm font-medium text-highlighted">
          Consistency
        </h3>
      </div>
    </template>

    <USkeleton
      v-if="pending"
      class="h-48 w-full"
    />

    <div
      v-else-if="dayCount === 0"
      class="flex h-48 items-center justify-center"
    >
      <p class="text-sm text-muted">
        No days to summarise yet.
      </p>
    </div>

    <div
      v-else
      class="flex flex-col gap-5"
    >
      <div class="grid grid-cols-2 gap-4">
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-muted">
            Goal hit
          </p>
          <p class="mt-1 font-display text-2xl font-semibold tabular-nums text-highlighted">
            {{ hitRateLabel }}
          </p>
          <p class="mt-1 text-xs text-muted">
            {{ hitPct }}% of days
          </p>
        </div>
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-muted">
            Studied
          </p>
          <p class="mt-1 font-display text-2xl font-semibold tabular-nums text-highlighted">
            {{ (consistency?.hitCount ?? 0) + (consistency?.missedCount ?? 0) }}
          </p>
          <p class="mt-1 text-xs text-muted">
            days with focus time
          </p>
        </div>
      </div>

      <div>
        <p class="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
          Day by day
        </p>
        <div class="flex flex-wrap gap-1">
          <div
            v-for="day in consistency?.days ?? []"
            :key="day.localDay"
            class="size-3.5 rounded-sm"
            :class="dayClass(day.goalMet, day.focusSeconds)"
            role="img"
            :title="dayTitle(day.localDay, day.goalMet, day.focusSeconds)"
            :aria-label="dayTitle(day.localDay, day.goalMet, day.focusSeconds)"
          />
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted">
          <div class="flex items-center gap-1">
            <span class="size-3 rounded-sm bg-primary" />
            <span>Goal met</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="size-3 rounded-sm bg-primary/30" />
            <span>Studied, missed</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="size-3 rounded-sm bg-elevated border border-dashed border-default/60" />
            <span>No data</span>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4 border-t border-default pt-4">
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-muted">
            vs last week
          </p>
          <p
            class="mt-1 flex items-center gap-1 font-medium tabular-nums"
            :class="deltaClass(consistency?.weekOverWeek)"
          >
            <UIcon
              :name="deltaIcon(consistency?.weekOverWeek)"
              class="size-4"
            />
            {{ deltaLabel(consistency?.weekOverWeek) }}
          </p>
          <p class="mt-1 text-xs text-muted">
            {{ formatDuration(consistency?.weekOverWeek.current ?? 0) }} this week
          </p>
        </div>
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-muted">
            vs prior period
          </p>
          <p
            class="mt-1 flex items-center gap-1 font-medium tabular-nums"
            :class="deltaClass(consistency?.monthOverMonth)"
          >
            <UIcon
              :name="deltaIcon(consistency?.monthOverMonth)"
              class="size-4"
            />
            {{ deltaLabel(consistency?.monthOverMonth) }}
          </p>
          <p class="mt-1 text-xs text-muted">
            {{ formatDuration(consistency?.monthOverMonth.current ?? 0) }} in range
          </p>
        </div>
      </div>
    </div>
  </UCard>
</template>
