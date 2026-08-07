<script setup lang="ts">
import type { TopicRollup } from '~/types/database'

/**
 * All-time focus by top-level topic. Answers "what am I actually spending
 * my time on?".
 *
 * Data source: `v_topic_rollup`. The view walks the topic tree recursively,
 * so a parent row's `total_focus_seconds` already includes its descendants.
 * Filtering to `parent_id is null` is what stops the leaderboard from
 * double-counting a child's time against its parent's — listing both would
 * push the total past 100%.
 *
 * Share is `total_focus_seconds / sum(total_focus_seconds)` computed here.
 * A brand-new account has a zero sum, so the divisor is guarded to keep
 * the empty state from rendering `NaN%`.
 *
 * `total_focus_hours` is numeric in Postgres and can arrive as a string
 * through PostgREST; it is coerced to a number before any arithmetic or
 * formatting.
 *
 * Colour is decoration — every row is fully identifiable from its label
 * (topic name plus its numeric stats) so a colour-blind user loses nothing.
 */

/** How many rows to show inline before linking to the full topics page. */
const VISIBLE_LIMIT = 6

const supabase = useSupabase()

const rows = ref<TopicRollup[]>([])
const pending = ref(true)
const error = ref<string | null>(null)

async function refresh() {
  pending.value = true
  error.value = null

  // `parent_id is null` yields top-level topics only; their totals already
  // include descendants. Ordering by seconds (not hours) keeps the sort
  // exact — the hours column is rounded to two decimals in the view.
  const res = await supabase
    .from('v_topic_rollup')
    .select('*')
    .is('parent_id', null)
    .order('total_focus_seconds', { ascending: false })

  if (res.error) {
    error.value = toMessage(res.error)
    pending.value = false
    return
  }

  rows.value = (res.data ?? []) as TopicRollup[]
  pending.value = false
}

void refresh()

/** PostgREST returns numeric as string; coerce before arithmetic. */
function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/** Sum of focus seconds across every returned row — the share denominator. */
const totalSeconds = computed(() =>
  rows.value.reduce((sum, row) => sum + toNumber(row.total_focus_seconds), 0)
)

/** True only when at least one topic has recorded focus time. */
const hasAnyData = computed(() => totalSeconds.value > 0)

/**
 * A row is worth showing only if it actually has time recorded — a topic
 * created and never used should not occupy a leaderboard slot. Zero-time
 * rows drop out before the visual cap is applied.
 */
const rankedRows = computed(() =>
  rows.value
    .filter(row => toNumber(row.total_focus_seconds) > 0)
    .slice(0, VISIBLE_LIMIT)
)

const hiddenCount = computed(() =>
  Math.max(0, rows.value.filter(row => toNumber(row.total_focus_seconds) > 0).length - rankedRows.value.length)
)

/**
 * Percent share, guarded against a zero denominator. Returns a small
 * number (not a string) so the caller can format it however it renders.
 */
function sharePercent(seconds: number): number {
  if (totalSeconds.value <= 0) return 0
  return (seconds / totalSeconds.value) * 100
}

/**
 * A share is meaningful even at 0.3% — rounding to the nearest integer
 * would collapse the long tail to "0%". Keep one decimal below 10%.
 */
function formatShare(percent: number): string {
  if (percent <= 0) return '0%'
  if (percent < 10) return `${percent.toFixed(1)}%`
  return `${Math.round(percent)}%`
}

/** `2026-08-06T12:34:56Z` reads as `2026-08-06`. */
function formatLastStudied(iso: string | null): string {
  if (!iso) return 'Never studied'
  const day = iso.slice(0, 10)
  return `Last studied ${day}`
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-trophy"
          class="size-4 text-muted"
        />
        <h3 class="text-sm font-medium text-highlighted">
          Topic leaderboard
        </h3>
      </div>
    </template>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="Couldn't load leaderboard"
      :description="error"
      :actions="[{ label: 'Retry', onClick: () => refresh(), color: 'neutral', variant: 'outline' }]"
    />

    <div
      v-else-if="pending"
      class="flex flex-col gap-3"
    >
      <USkeleton
        v-for="i in 4"
        :key="i"
        class="h-10"
      />
    </div>

    <div
      v-else-if="!hasAnyData"
      class="flex flex-col items-center gap-2 py-6 text-center"
    >
      <UIcon
        name="i-lucide-sparkles"
        class="size-6 text-muted"
      />
      <p class="text-sm text-muted">
        No topic time yet — tag a session's blocks to see your split here.
      </p>
      <UButton
        to="/topics"
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-tags"
        label="Manage topics"
      />
    </div>

    <div
      v-else
      class="flex flex-col gap-3"
    >
      <ol class="flex flex-col gap-3">
        <li
          v-for="(row, index) in rankedRows"
          :key="row.topic_id"
          class="flex flex-col gap-1"
        >
          <div class="flex items-center gap-3">
            <span class="w-4 shrink-0 text-xs font-medium tabular-nums text-muted">
              {{ index + 1 }}
            </span>
            <span
              class="size-3 shrink-0 rounded-full ring-1 ring-inset ring-black/5 dark:ring-white/10"
              :style="{ backgroundColor: row.topic_color }"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">
              {{ row.topic_name }}
            </span>
            <span class="shrink-0 text-sm tabular-nums text-default">
              {{ formatDuration(toNumber(row.total_focus_seconds)) }}
            </span>
            <span class="w-12 shrink-0 text-right text-xs tabular-nums text-muted">
              {{ formatShare(sharePercent(toNumber(row.total_focus_seconds))) }}
            </span>
          </div>

          <!-- Share bar: colour is decoration; the numeric % just above is the
               source of truth. Track uses `bg-elevated` so an empty bar is
               still visible against the card. -->
          <div
            class="ml-7 h-1.5 overflow-hidden rounded-full bg-elevated"
            role="presentation"
          >
            <div
              class="h-full rounded-full"
              :style="{
                width: `${Math.max(2, sharePercent(toNumber(row.total_focus_seconds)))}%`,
                backgroundColor: row.topic_color
              }"
            />
          </div>

          <div class="ml-7 flex items-center gap-3 text-xs text-muted">
            <span class="tabular-nums">
              {{ row.active_days }} {{ row.active_days === 1 ? 'day' : 'days' }} active
            </span>
            <span aria-hidden="true">·</span>
            <span>{{ formatLastStudied(row.last_studied_at) }}</span>
          </div>
        </li>
      </ol>

      <div
        v-if="hiddenCount > 0"
        class="flex justify-end border-t border-default pt-3"
      >
        <UButton
          to="/topics"
          color="neutral"
          variant="ghost"
          size="sm"
          trailing-icon="i-lucide-arrow-right"
          :label="`See ${hiddenCount} more`"
        />
      </div>
    </div>
  </UCard>
</template>
