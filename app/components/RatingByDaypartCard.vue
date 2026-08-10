<script setup lang="ts">
import type { DaypartRating } from '~/composables/useAnalytics'

/**
 * When your focus is actually good — the payoff for the rating prompt.
 *
 * `BestHoursChart` answers "when do I study"; this answers "when do I study
 * *well*", which is the more actionable of the two and the reason answering the
 * end-of-session prompt is worth the user's time.
 *
 * Sample size is shown for every daypart and is not decoration: a 5.0 from one
 * session and a 4.1 from thirty are different claims, and a card that renders
 * them identically invites the user to reorganise their week around noise.
 * Dayparts with no ratings show '—', never 0.0.
 */
const props = defineProps<{
  dayparts: DaypartRating[]
  pending?: boolean
}>()

const rated = computed(() => props.dayparts.filter(part => part.count > 0))

const hasRatings = computed(() => rated.value.length > 0)

/** Best daypart, but only once there is more than one to compare against. */
const best = computed(() => {
  if (rated.value.length < 2) return null
  return rated.value.reduce((top, part) =>
    (part.meanRating ?? 0) > (top.meanRating ?? 0) ? part : top
  )
})

function ratingLabel(part: DaypartRating): string {
  return part.meanRating === null ? '—' : part.meanRating.toFixed(1)
}

/** Bar fills the 1–5 range, so a 3.0 sits at the midpoint rather than at 60%. */
function barWidth(part: DaypartRating): string {
  if (part.meanRating === null) return '0%'
  return `${Math.min(Math.max((part.meanRating - 1) / 4, 0), 1) * 100}%`
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-brain"
            class="size-4 text-muted"
          />
          <h3 class="text-sm font-medium text-highlighted">
            Focus by time of day
          </h3>
        </div>
        <span
          v-if="best"
          class="text-xs text-muted"
        >
          best in the <span class="font-medium text-default">{{ best.label.toLowerCase() }}</span>
        </span>
      </div>
    </template>

    <USkeleton
      v-if="pending"
      class="h-40 w-full"
    />

    <div
      v-else-if="!hasRatings"
      class="flex h-40 flex-col items-center justify-center gap-2 text-center"
    >
      <UIcon
        name="i-lucide-moon-star"
        class="size-6 text-muted"
      />
      <p class="text-sm text-muted">
        No rated sessions in this range.
      </p>
      <p class="text-xs text-muted">
        Rate a few and this shows when you focus best.
      </p>
    </div>

    <ul
      v-else
      class="flex flex-col gap-3"
    >
      <li
        v-for="part in dayparts"
        :key="part.key"
        class="flex flex-col gap-1"
      >
        <div class="flex items-baseline justify-between gap-3 text-sm">
          <span
            class="font-medium"
            :class="part.count > 0 ? 'text-highlighted' : 'text-muted'"
          >
            {{ part.label }}
          </span>
          <span class="flex items-baseline gap-2">
            <span class="tabular-nums text-highlighted">{{ ratingLabel(part) }}</span>
            <!-- The n behind the mean. Without it the number above is
                 unreadable as strong or weak evidence. -->
            <span class="text-xs tabular-nums text-muted">
              {{ part.count === 0 ? 'no ratings' : `n=${part.count}` }}
            </span>
          </span>
        </div>
        <div class="h-1.5 overflow-hidden rounded-full bg-elevated">
          <div
            class="h-full rounded-full"
            :class="best && part.key === best.key ? 'bg-primary' : 'bg-primary/50'"
            :style="{ width: barWidth(part) }"
          />
        </div>
      </li>
    </ul>
  </UCard>
</template>
