<script setup lang="ts">
import { VisXYContainer, VisStackedBar, VisStackedBarSelectors, VisAxis, VisTooltip, VisBulletLegend } from '@unovis/vue'
import type { DailyTopicTotal, LocalDay } from '~/types/database'

/**
 * Daily focus, last 30 days — stacked bar per topic.
 *
 * Data source: `v_daily_topic_totals` (one row per day x topic, seconds).
 * Missing days are absent from the view and MUST be filled with zeros;
 * otherwise the x axis silently compresses and a quiet week disappears.
 * Untagged blocks (topic_id null) render as an "Untagged" segment — not dropped.
 *
 * Y axis is minutes or hours (whichever keeps labels short), never seconds.
 * Segment fills use `topic_color` from the DB — the one sanctioned inline hex.
 *
 * Untagged has no DB colour, so its swatch is resolved from the current
 * theme's `--ui-text-muted` custom property at runtime. Reactive to color
 * mode so the light / dark toggle keeps the neutral bucket legible in either
 * theme, with no hardcoded hex outside the DB in this file.
 */

interface Datum {
  local_day: LocalDay
  /** Index in the fixed 30-day window; used as the X accessor. */
  index: number
  /** topic_id (or 'untagged' sentinel) -> focus seconds for that day. */
  seconds: Record<string, number>
  /** Sum across topics for this day, in seconds — for tooltip totals. */
  total: number
}

interface TopicSeries {
  key: string
  name: string
  color: string
}

/** Sentinel key for `topic_id is null`. UUIDs never collide with this. */
const UNTAGGED_KEY = 'untagged'
/**
 * Last-resort fallback for the untagged swatch when the DOM is not queryable
 * (SSR-hydration edge, or before mount). A mid-slate rgb that reads on both
 * themes; the runtime resolver below wins whenever it can.
 */
const UNTAGGED_FALLBACK = 'rgb(100, 116, 139)'

const supabase = useSupabase()
const { profile, load: loadProfile } = useProfile()
const colorMode = useColorMode()

const rows = ref<DailyTopicTotal[]>([])
const pending = ref(true)
const error = ref<string | null>(null)

/**
 * Reads the current theme's `--ui-text-muted` off the document root so the
 * untagged bucket adapts to the active colour mode. Falls back to a slate
 * rgb when the DOM is not queryable.
 */
const untaggedColor = ref<string>(UNTAGGED_FALLBACK)

function resolveUntaggedColor() {
  if (typeof window === 'undefined') return
  const value = getComputedStyle(document.documentElement).getPropertyValue('--ui-text-muted').trim()
  if (value.length > 0) untaggedColor.value = value
}

onMounted(() => {
  resolveUntaggedColor()
})

watch(() => colorMode.value, () => {
  // `useColorMode` flips synchronously; wait a tick so the CSS variable
  // update has actually landed on <html> before we read it back.
  nextTick(resolveUntaggedColor)
})

async function refresh() {
  pending.value = true
  error.value = null

  // Timezone lives on the profile, and lastNDays needs it to name the right days.
  if (!profile.value) await loadProfile()
  const timezone = profile.value?.timezone ?? 'UTC'

  const days = lastNDays(30, timezone)
  const firstDay = days[0]
  if (!firstDay) {
    pending.value = false
    return
  }

  const res = await supabase
    .from('v_daily_topic_totals')
    .select('*')
    .gte('local_day', firstDay)
    .order('local_day')

  if (res.error) {
    error.value = toMessage(res.error)
    pending.value = false
    return
  }

  rows.value = (res.data ?? []) as DailyTopicTotal[]
  pending.value = false
}

void refresh()

/** Timezone-safe day window; recomputes only when the profile timezone changes. */
const days = computed<LocalDay[]>(() => lastNDays(30, profile.value?.timezone ?? 'UTC'))

/**
 * Distinct topics appearing in the window, in DB-name order. Untagged rows
 * collapse into a single synthetic series so they render as one segment.
 */
const series = computed<TopicSeries[]>(() => {
  const map = new Map<string, TopicSeries>()
  for (const row of rows.value) {
    const key = row.topic_id ?? UNTAGGED_KEY
    if (map.has(key)) continue
    map.set(key, {
      key,
      name: row.topic_id ? (row.topic_name ?? 'Unnamed') : 'Untagged',
      color: row.topic_id ? (row.topic_color ?? untaggedColor.value) : untaggedColor.value
    })
  }
  // Stable order: untagged last, others alphabetical by name.
  return Array.from(map.values()).sort((a, b) => {
    if (a.key === UNTAGGED_KEY) return 1
    if (b.key === UNTAGGED_KEY) return -1
    return a.name.localeCompare(b.name)
  })
})

/**
 * A record per day in the 30-day window. Missing days keep their zero row,
 * so the axis stays evenly spaced and a study gap reads as a gap.
 */
const data = computed<Datum[]>(() => {
  const byDay = new Map<LocalDay, Map<string, number>>()
  for (const row of rows.value) {
    const key = row.topic_id ?? UNTAGGED_KEY
    const seconds = row.focus_seconds ?? 0
    if (seconds <= 0) continue
    const bucket = byDay.get(row.local_day) ?? new Map<string, number>()
    bucket.set(key, (bucket.get(key) ?? 0) + seconds)
    byDay.set(row.local_day, bucket)
  }

  return days.value.map((day, index) => {
    const bucket = byDay.get(day)
    const seconds: Record<string, number> = {}
    let total = 0
    for (const s of series.value) {
      const value = bucket?.get(s.key) ?? 0
      seconds[s.key] = value
      total += value
    }
    return { local_day: day, index, seconds, total }
  })
})

const hasAnyData = computed(() => data.value.some(d => d.total > 0))

/** Max daily total in the window — decides whether Y reads in hours or minutes. */
const maxTotalSeconds = computed(() => data.value.reduce((max, d) => Math.max(max, d.total), 0))
const useHours = computed(() => maxTotalSeconds.value >= 2 * 3600)

const x = (d: Datum) => d.index
/** One accessor per series — Unovis stacks them in the order supplied. */
const y = computed(() => series.value.map(s => (d: Datum) => d.seconds[s.key] ?? 0))
/**
 * Segment fill: DB hex per topic, resolved theme token for untagged. Bound
 * as a computed so a color-mode toggle re-emits a new function reference
 * and Unovis repaints with the fresh swatch.
 */
const color = computed(() => {
  const swatches = series.value.map(s => s.color)
  const fallback = untaggedColor.value
  return (_d: Datum, i: number) => swatches[i] ?? fallback
})

/**
 * X ticks: show ~6 evenly spaced dates so labels never overlap at 375px.
 */
const xTickFormat = (tick: number) => {
  const day = days.value[Math.round(tick)]
  return day ? dayLabel(day) : ''
}
const xTickValues = computed(() => {
  const total = days.value.length
  if (total === 0) return []
  const step = Math.max(1, Math.floor(total / 6))
  const values: number[] = []
  for (let i = 0; i < total; i += step) values.push(i)
  if (values[values.length - 1] !== total - 1) values.push(total - 1)
  return values
})

const yTickFormat = (tick: number) => {
  if (useHours.value) {
    const hours = tick / 3600
    return hours >= 1 ? `${hours.toFixed(hours < 10 ? 1 : 0)}h` : `${Math.round(tick / 60)}m`
  }
  return `${Math.round(tick / 60)}m`
}

/**
 * Rich tooltip: day, total, then per-topic minutes. Untagged shows only when
 * it contributed. Sorted descending so the biggest slice reads first.
 */
const triggers = {
  [VisStackedBarSelectors.bar]: (d: Datum) => {
    const parts = series.value
      .map(s => ({ name: s.name, color: s.color, seconds: d.seconds[s.key] ?? 0 }))
      .filter(p => p.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds)

    const header = `<div style="font-weight:600;margin-bottom:4px">${d.local_day} — ${formatDuration(d.total)}</div>`
    if (parts.length === 0) {
      return `${header}<div style="opacity:0.7">No focus time</div>`
    }
    const body = parts.map(p => `
      <div style="display:flex;align-items:center;gap:8px;font-size:12px;line-height:1.4">
        <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${p.color}"></span>
        <span style="flex:1">${p.name}</span>
        <span style="font-variant-numeric:tabular-nums">${formatDuration(p.seconds)}</span>
      </div>
    `).join('')
    return header + body
  }
}

const legendItems = computed(() => series.value.map(s => ({ name: s.name, color: s.color })))
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-chart-column"
          class="size-4 text-muted"
        />
        <h3 class="text-sm font-medium text-highlighted">
          Focus, last 30 days
        </h3>
      </div>
    </template>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="Couldn't load chart"
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
        No focus time in the last 30 days yet.
      </p>
    </div>

    <div
      v-else
      class="flex flex-col gap-3"
    >
      <VisBulletLegend
        :items="legendItems"
        class="text-xs text-muted"
      />

      <div class="h-64 w-full">
        <VisXYContainer
          :data="data"
          :height="256"
          :margin="{ top: 8, right: 12, bottom: 24, left: 40 }"
        >
          <VisStackedBar
            :x="x"
            :y="y"
            :color="color"
            :rounded-corners="2"
            :bar-padding="0.15"
          />
          <VisAxis
            type="x"
            :tick-format="xTickFormat"
            :tick-values="xTickValues"
            :grid-line="false"
          />
          <VisAxis
            type="y"
            :tick-format="yTickFormat"
            :num-ticks="4"
          />
          <VisTooltip :triggers="triggers" />
        </VisXYContainer>
      </div>
    </div>
  </UCard>
</template>