<script setup lang="ts">
import type { Efficiency } from '~/composables/useAnalytics'

/**
 * "Where does the time actually go?" — the cost side of the ledger.
 *
 * The dashboard already counts interruptions. A count is not a cost: fifteen
 * interruptions that each lasted twenty seconds is a very different day from
 * three that each lasted twenty minutes. This card is the minutes.
 *
 * `pauseShare` is deliberately computed against session focus time, not the
 * day-bucketed `focus_seconds` above it — both numerator and denominator come
 * from `v_session_summary` so the ratio compares like with like even though
 * the two views use different range predicates.
 */
const props = defineProps<{
  efficiency: Efficiency | null
  pending?: boolean
}>()

function pct(value: number | null): string {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '—'
}

const pauseShareLabel = computed(() => pct(props.efficiency?.pauseShare ?? null))
const completionLabel = computed(() => pct(props.efficiency?.completionRate ?? null))

const meanBlockLabel = computed(() => {
  const seconds = props.efficiency?.meanFocusBlockSeconds
  return typeof seconds === 'number' ? formatDuration(seconds) : '—'
})

/**
 * Focus:break as a single share of focus, which is the readable direction —
 * "82% of your logged time was focus" beats "4.5:1". Null when neither
 * happened, so a fresh account reads '—' rather than a confident 0%.
 */
const focusShare = computed(() => {
  const e = props.efficiency
  if (!e) return null
  const total = e.focusSeconds + e.breakSeconds
  if (total <= 0) return null
  return e.focusSeconds / total
})

const hasAnything = computed(() => {
  const e = props.efficiency
  if (!e) return false
  return e.focusSeconds > 0 || e.focusBlockCount > 0 || e.completedSessions + e.abandonedSessions > 0
})
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-activity"
          class="size-4 text-muted"
        />
        <h3 class="text-sm font-medium text-highlighted">
          Where the time goes
        </h3>
      </div>
    </template>

    <USkeleton
      v-if="pending"
      class="h-48 w-full"
    />

    <div
      v-else-if="!hasAnything"
      class="flex h-48 items-center justify-center"
    >
      <p class="text-sm text-muted">
        No finished blocks in this range.
      </p>
    </div>

    <div
      v-else
      class="flex flex-col gap-5"
    >
      <div class="grid grid-cols-2 gap-x-4 gap-y-5">
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-muted">
            Avg block
          </p>
          <p class="mt-1 font-display text-2xl font-semibold tabular-nums text-highlighted">
            {{ meanBlockLabel }}
          </p>
          <p class="mt-1 text-xs text-muted">
            over {{ efficiency?.focusBlockCount ?? 0 }}
            {{ efficiency?.focusBlockCount === 1 ? 'block' : 'blocks' }}
          </p>
        </div>

        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-muted">
            Lost to pauses
          </p>
          <p class="mt-1 font-display text-2xl font-semibold tabular-nums text-highlighted">
            {{ pauseShareLabel }}
          </p>
          <p class="mt-1 text-xs text-muted">
            {{ formatDuration(efficiency?.pausedSeconds ?? 0) }} paused
          </p>
        </div>

        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-muted">
            Sessions finished
          </p>
          <p class="mt-1 font-display text-2xl font-semibold tabular-nums text-highlighted">
            {{ completionLabel }}
          </p>
          <p class="mt-1 text-xs text-muted">
            {{ efficiency?.completedSessions ?? 0 }} done ·
            {{ efficiency?.abandonedSessions ?? 0 }} dropped
          </p>
        </div>

        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-muted">
            Break time
          </p>
          <p class="mt-1 font-display text-2xl font-semibold tabular-nums text-highlighted">
            {{ formatDuration(efficiency?.breakSeconds ?? 0) }}
          </p>
          <p class="mt-1 text-xs text-muted">
            vs {{ formatDuration(efficiency?.focusSeconds ?? 0) }} focused
          </p>
        </div>
      </div>

      <div v-if="focusShare !== null">
        <div class="mb-1.5 flex items-center justify-between text-xs text-muted">
          <span>Focus vs break</span>
          <span class="tabular-nums">{{ Math.round(focusShare * 100) }}% focus</span>
        </div>
        <div
          class="flex h-2.5 overflow-hidden rounded-full bg-elevated"
          role="img"
          :aria-label="`${Math.round(focusShare * 100)} percent of logged time was focus`"
        >
          <div
            class="bg-primary"
            :style="{ width: `${focusShare * 100}%` }"
          />
          <div class="flex-1 bg-primary/25" />
        </div>
      </div>
    </div>
  </UCard>
</template>
