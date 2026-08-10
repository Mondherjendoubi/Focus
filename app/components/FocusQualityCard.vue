<script setup lang="ts">
import type { FocusQuality } from '~/composables/useAnalytics'

/**
 * "How well did it go?" — the self-reported side of the data.
 *
 * The app asks for a 1–5 focus rating at the end of every session and, before
 * FA-015, showed it back only as one number on one history row. This is where
 * it becomes a trend.
 *
 * Two honesty rules drive the markup:
 *   - A mean is shown WITH its sample size. A 5.0 drawn from one session is
 *     not the same claim as a 4.2 drawn from forty, and rendering them
 *     identically invites the user to trust the wrong one.
 *   - `adherence_ratio` is null when a session had no template. Null is not
 *     0% — a user who never uses templates has no adherence, not bad adherence.
 */
const props = defineProps<{
  quality: FocusQuality | null
  pending?: boolean
}>()

/** Ratings run 1..5; index 0 of the distribution is rating 1. */
const RATINGS = [1, 2, 3, 4, 5]

const meanRatingLabel = computed(() => {
  const mean = props.quality?.meanRating
  return typeof mean === 'number' ? mean.toFixed(1) : '—'
})

const adherenceLabel = computed(() => {
  const mean = props.quality?.meanAdherence
  return typeof mean === 'number' ? `${Math.round(mean * 100)}%` : '—'
})

/** Tallest bar in the distribution — every bar is a fraction of this. */
const peakCount = computed(() => {
  const distribution = props.quality?.distribution ?? []
  return distribution.reduce((max, count) => (count > max ? count : max), 0)
})

function barHeight(rating: number): string {
  const count = props.quality?.distribution[rating - 1] ?? 0
  if (peakCount.value === 0) return '0%'
  // Floor a nonzero bar at 8% so "one session rated 2" stays visible rather
  // than collapsing to a line indistinguishable from zero.
  const pct = (count / peakCount.value) * 100
  return `${count > 0 ? Math.max(pct, 8) : 0}%`
}

function barLabel(rating: number): string {
  const count = props.quality?.distribution[rating - 1] ?? 0
  return `${count} ${count === 1 ? 'session' : 'sessions'} rated ${rating} of 5`
}

const hasRatings = computed(() => (props.quality?.ratedCount ?? 0) > 0)
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-gauge"
          class="size-4 text-muted"
        />
        <h3 class="text-sm font-medium text-highlighted">
          Focus quality
        </h3>
      </div>
    </template>

    <USkeleton
      v-if="pending"
      class="h-48 w-full"
    />

    <div
      v-else-if="!hasRatings"
      class="flex h-48 flex-col items-center justify-center gap-2 text-center"
    >
      <UIcon
        name="i-lucide-star"
        class="size-6 text-muted"
      />
      <p class="text-sm text-muted">
        No rated sessions in this range.
      </p>
      <p class="text-xs text-muted">
        Rate a session when you finish it and it shows up here.
      </p>
    </div>

    <div
      v-else
      class="flex flex-col gap-5"
    >
      <div class="grid grid-cols-2 gap-4">
        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-muted">
            Avg rating
          </p>
          <p class="mt-1 flex items-baseline gap-1">
            <span class="font-display text-2xl font-semibold tabular-nums text-highlighted">
              {{ meanRatingLabel }}
            </span>
            <span class="text-sm text-muted">/ 5</span>
          </p>
          <!-- The sample size is not decoration: it is what makes the mean
               above readable as strong or weak evidence. -->
          <p class="mt-1 text-xs text-muted">
            from {{ quality?.ratedCount }}
            {{ quality?.ratedCount === 1 ? 'session' : 'sessions' }}
          </p>
        </div>

        <div>
          <p class="text-xs font-medium uppercase tracking-wide text-muted">
            Plan adherence
          </p>
          <p class="mt-1 font-display text-2xl font-semibold tabular-nums text-highlighted">
            {{ adherenceLabel }}
          </p>
          <p class="mt-1 text-xs text-muted">
            <template v-if="(quality?.adherenceCount ?? 0) > 0">
              across {{ quality?.adherenceCount }} template
              {{ quality?.adherenceCount === 1 ? 'session' : 'sessions' }}
            </template>
            <template v-else>
              no template sessions yet
            </template>
          </p>
        </div>
      </div>

      <div>
        <p class="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
          Rating spread
        </p>
        <div class="flex h-24 items-end gap-2">
          <div
            v-for="rating in RATINGS"
            :key="rating"
            class="flex flex-1 flex-col items-center gap-1"
          >
            <div class="flex h-full w-full items-end">
              <div
                class="w-full rounded-t bg-primary/70"
                :style="{ height: barHeight(rating) }"
                role="img"
                :aria-label="barLabel(rating)"
                :title="barLabel(rating)"
              />
            </div>
            <span class="text-[11px] tabular-nums text-muted">{{ rating }}</span>
          </div>
        </div>
      </div>
    </div>
  </UCard>
</template>
