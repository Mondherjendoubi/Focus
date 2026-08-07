<script setup lang="ts">
import type { FocusHeatmapCell } from '~/types/database'

/**
 * Focus heatmap — day-of-week x hour-of-day grid.
 *
 * Data source: `v_focus_heatmap`, one row per (day_of_week, hour_of_day).
 * `day_of_week` is ISO (1 = Monday, 7 = Sunday). Rows are re-ordered to
 * respect the profile's `week_starts_on`.
 *
 * Cells absent from the view are TRULY missing — rendered as a hatched empty
 * cell so the eye distinguishes them from low-but-nonzero cells. Every cell
 * carries a `title` for screen readers; intensity alone is not readable.
 */

/** Row order lookup: ISO 1..7 for each display row, given `week_starts_on`. */
function orderedIsoDays(weekStartsOn: number): number[] {
  const start = Math.min(7, Math.max(1, Math.round(weekStartsOn) || 1))
  const days: number[] = []
  for (let i = 0; i < 7; i++) {
    days.push(((start - 1 + i) % 7) + 1)
  }
  return days
}

const HOURS = Array.from({ length: 24 }, (_v, i) => i)
/** Only show every third hour label to keep the axis legible at 375px. */
const HOUR_LABEL_STEP = 3

const supabase = useSupabase()
const { profile, load: loadProfile } = useProfile()

const cells = ref<FocusHeatmapCell[]>([])
const pending = ref(true)
const error = ref<string | null>(null)

async function refresh() {
  pending.value = true
  error.value = null

  if (!profile.value) await loadProfile()

  const res = await supabase
    .from('v_focus_heatmap')
    .select('*')

  if (res.error) {
    error.value = toMessage(res.error)
    pending.value = false
    return
  }

  cells.value = (res.data ?? []) as FocusHeatmapCell[]
  pending.value = false
}

void refresh()

/** `Map<dow, Map<hour, cell>>` for O(1) lookup while building the grid. */
const cellsByPosition = computed(() => {
  const grid = new Map<number, Map<number, FocusHeatmapCell>>()
  for (const c of cells.value) {
    const row = grid.get(c.day_of_week) ?? new Map<number, FocusHeatmapCell>()
    row.set(c.hour_of_day, c)
    grid.set(c.day_of_week, row)
  }
  return grid
})

/** Peak cell in the returned set — every intensity is a fraction of this. */
const maxMinutes = computed(() => {
  let max = 0
  for (const c of cells.value) if (c.focus_minutes > max) max = c.focus_minutes
  return max
})

const rows = computed(() => orderedIsoDays(profile.value?.week_starts_on ?? 1))

const hasAnyData = computed(() => cells.value.length > 0)

/**
 * Intensity -> Tailwind primary opacity ramp. A nonzero cell never drops
 * below 20% opacity — otherwise "a little" reads indistinguishably from
 * "nothing", which is the whole visual contract of this component.
 */
function intensityClass(minutes: number): string {
  if (maxMinutes.value === 0) return 'bg-primary/20'
  const ratio = minutes / maxMinutes.value
  if (ratio >= 0.8) return 'bg-primary'
  if (ratio >= 0.6) return 'bg-primary/80'
  if (ratio >= 0.4) return 'bg-primary/60'
  if (ratio >= 0.2) return 'bg-primary/40'
  return 'bg-primary/20'
}

/** Human-readable label for a cell — the same text a screen reader reads out. */
function cellLabel(dow: number, hour: number, minutes: number | null): string {
  const day = weekdayName(dow)
  const hourLabel = `${String(hour).padStart(2, '0')}:00`
  if (minutes === null) return `${day} at ${hourLabel} — no data`
  return `${day} at ${hourLabel} — ${formatDuration(minutes * 60)}`
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-calendar-clock"
          class="size-4 text-muted"
        />
        <h3 class="text-sm font-medium text-highlighted">
          When you focus
        </h3>
      </div>
    </template>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="Couldn't load heatmap"
      :description="error"
      :actions="[{ label: 'Retry', onClick: () => refresh(), color: 'neutral', variant: 'outline' }]"
    />

    <USkeleton
      v-else-if="pending"
      class="h-64 w-full"
    />

    <div
      v-else-if="!hasAnyData"
      class="flex h-64 flex-col items-center justify-center gap-2 text-center"
    >
      <UIcon
        name="i-lucide-sparkles"
        class="size-6 text-muted"
      />
      <p class="text-sm text-muted">
        No focus history to plot yet.
      </p>
    </div>

    <div
      v-else
      class="overflow-x-auto"
    >
      <div class="flex flex-col gap-1 min-w-[560px]">
        <!-- Header row: hour labels, spaced so 375px still reads. -->
        <div class="grid grid-cols-[3rem_repeat(24,minmax(1rem,1fr))] gap-[2px]">
          <div />
          <div
            v-for="hour in HOURS"
            :key="`h-${hour}`"
            class="text-[10px] leading-none text-muted text-center"
          >
            <span v-if="hour % HOUR_LABEL_STEP === 0">{{ String(hour).padStart(2, '0') }}</span>
          </div>
        </div>

        <div
          v-for="dow in rows"
          :key="`row-${dow}`"
          class="grid grid-cols-[3rem_repeat(24,minmax(1rem,1fr))] gap-[2px] items-center"
        >
          <div class="text-xs text-muted pr-2 text-right">
            {{ weekdayName(dow).slice(0, 3) }}
          </div>
          <template
            v-for="hour in HOURS"
            :key="`c-${dow}-${hour}`"
          >
            <div
              v-if="cellsByPosition.get(dow)?.get(hour)"
              :class="[
                'h-5 rounded-sm',
                intensityClass(cellsByPosition.get(dow)?.get(hour)?.focus_minutes ?? 0)
              ]"
              :title="cellLabel(dow, hour, cellsByPosition.get(dow)?.get(hour)?.focus_minutes ?? 0)"
              :aria-label="cellLabel(dow, hour, cellsByPosition.get(dow)?.get(hour)?.focus_minutes ?? 0)"
              role="img"
            />
            <div
              v-else
              class="h-5 rounded-sm bg-elevated/60 border border-dashed border-default/60"
              :title="cellLabel(dow, hour, null)"
              :aria-label="cellLabel(dow, hour, null)"
              role="img"
            />
          </template>
        </div>

        <!-- Legend: gradient ramp + the empty-cell swatch, so users see the
             two are different visual states rather than shades of the same one. -->
        <div class="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted">
          <div class="flex items-center gap-1">
            <span>Less</span>
            <span class="h-3 w-3 rounded-sm bg-primary/20" />
            <span class="h-3 w-3 rounded-sm bg-primary/40" />
            <span class="h-3 w-3 rounded-sm bg-primary/60" />
            <span class="h-3 w-3 rounded-sm bg-primary/80" />
            <span class="h-3 w-3 rounded-sm bg-primary" />
            <span>More</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="h-3 w-3 rounded-sm bg-elevated/60 border border-dashed border-default/60" />
            <span>No data</span>
          </div>
        </div>
      </div>
    </div>
  </UCard>
</template>
