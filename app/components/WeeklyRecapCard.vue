<script setup lang="ts">
/**
 * The week, as a sentence. Sits directly under the dashboard header because it
 * is the one thing here meant to be *read* rather than scanned.
 *
 * Self-hiding: if neither this week nor last week has a single second in it,
 * this renders nothing. A recap of nothing is worse than no recap — it takes
 * the most prominent slot on the page to tell a new user they have done
 * nothing, which is exactly the wrong first impression.
 *
 * Errors are the one exception to the self-hiding rule, per the app's "empty is
 * not failed" rule: a query that failed must never look like a quiet week.
 */
const { recap, pending, error, refresh } = useWeeklyRecap()

void refresh()

const hasContent = computed(() => {
  const r = recap.value
  if (!r) return false
  return r.totalSeconds > 0 || r.priorSeconds > 0
})

const deltaLabel = computed(() => {
  const r = recap.value
  if (!r) return null
  if (r.deltaRatio === null) return r.totalSeconds > 0 ? 'first week with data' : null
  const pct = Math.round(r.deltaRatio * 100)
  if (pct === 0) return 'same as last week'
  return `${pct > 0 ? '+' : ''}${pct}% vs last week`
})

const deltaTone = computed(() => {
  const ratio = recap.value?.deltaRatio
  if (ratio === null || ratio === undefined) return 'text-muted'
  if (ratio > 0) return 'text-primary'
  if (ratio < 0) return 'text-warning'
  return 'text-muted'
})

const deltaIcon = computed(() => {
  const ratio = recap.value?.deltaRatio
  if (ratio === null || ratio === undefined) return 'i-lucide-sparkles'
  if (ratio > 0) return 'i-lucide-trending-up'
  if (ratio < 0) return 'i-lucide-trending-down'
  return 'i-lucide-minus'
})
</script>

<template>
  <UAlert
    v-if="error"
    color="error"
    variant="soft"
    icon="i-lucide-triangle-alert"
    title="Couldn't load your week"
    :description="error"
    :actions="[{ label: 'Retry', onClick: () => refresh(), color: 'neutral', variant: 'outline' }]"
  />

  <USkeleton
    v-else-if="pending"
    class="h-28 w-full"
  />

  <UCard
    v-else-if="hasContent && recap"
    :ui="{ body: 'p-5 sm:p-6' }"
  >
    <div class="flex flex-col gap-5">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="flex flex-col gap-1">
          <p class="text-xs font-medium uppercase tracking-wide text-muted">
            Your last 7 days
          </p>
          <p class="font-display text-3xl font-semibold tracking-tight tabular-nums text-highlighted">
            {{ formatDuration(recap.totalSeconds) }}
          </p>
        </div>

        <p
          v-if="deltaLabel"
          class="flex items-center gap-1.5 text-sm font-medium"
          :class="deltaTone"
        >
          <UIcon
            :name="deltaIcon"
            class="size-4"
          />
          {{ deltaLabel }}
        </p>
      </div>

      <div class="grid grid-cols-2 gap-4 border-t border-default pt-4 sm:grid-cols-4">
        <div>
          <p class="text-xs text-muted">
            Days studied
          </p>
          <p class="mt-0.5 text-sm font-medium tabular-nums text-highlighted">
            {{ recap.activeDays }} of 7
          </p>
        </div>
        <div>
          <p class="text-xs text-muted">
            Goal hit
          </p>
          <p class="mt-0.5 text-sm font-medium tabular-nums text-highlighted">
            {{ recap.goalDaysHit }} {{ recap.goalDaysHit === 1 ? 'day' : 'days' }}
          </p>
        </div>
        <div>
          <p class="text-xs text-muted">
            Best day
          </p>
          <p class="mt-0.5 text-sm font-medium text-highlighted">
            <template v-if="recap.bestDay">
              {{ dayLabel(recap.bestDay.localDay) }} ·
              <span class="tabular-nums">{{ formatDuration(recap.bestDay.seconds) }}</span>
            </template>
            <template v-else>
              —
            </template>
          </p>
        </div>
        <div>
          <p class="text-xs text-muted">
            Top topic
          </p>
          <p class="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-highlighted">
            <template v-if="recap.topTopic">
              <!-- `topics.color` is the one value in this app allowed to be an
                   inline hex: it comes from the database, not the theme. -->
              <span
                v-if="recap.topTopic.color"
                class="size-2.5 shrink-0 rounded-full"
                :style="{ backgroundColor: recap.topTopic.color }"
              />
              <span class="truncate">{{ recap.topTopic.name }}</span>
            </template>
            <template v-else>
              —
            </template>
          </p>
        </div>
      </div>
    </div>
  </UCard>
</template>
