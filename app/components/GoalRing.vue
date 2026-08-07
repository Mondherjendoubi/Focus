<script setup lang="ts">
/**
 * The daily goal as a ring. Inputs are minutes because the DB view
 * (`v_daily_totals.focus_minutes` and `profiles.daily_goal_minutes`)
 * already exposes them in minutes — no seconds coercion needed here.
 *
 * The ring caps visually at a full circle at 100%, but the copy below
 * announces overshoot ("Goal reached", "N% over") because a full circle
 * alone reads identically to "just barely there".
 */
const props = defineProps<{
  focusMinutes: number
  goalMinutes: number
}>()

// Guard against a zero goal — the DB check allows it (>= 0) and the ratio
// would divide by zero. Treat "no goal set" as "already met".
const ratio = computed(() => {
  if (props.goalMinutes <= 0) return 1
  return props.focusMinutes / props.goalMinutes
})

const percent = computed(() => Math.round(ratio.value * 100))
const met = computed(() => ratio.value >= 1)

// Semantic guard for the celebration state: an explicit zero goal shouldn't
// masquerade as "goal met" for the yellow accent, even though `ratio` returns
// 1 in that case (so the ring visually fills).
const goalMet = computed(() => props.goalMinutes > 0 && props.focusMinutes >= props.goalMinutes)

// Persistent state across the component's lifetime. `wasMet` is seeded from
// the current status in onMounted so a dashboard visit into an already-met
// state does not trigger the flash — only a live false → true transition does.
const wasMet = ref(false)
const flashing = ref(false)

onMounted(() => {
  wasMet.value = goalMet.value
})

watch(goalMet, (now) => {
  if (now && !wasMet.value) {
    flashing.value = true
    setTimeout(() => {
      flashing.value = false
    }, 800)
  }
  wasMet.value = now
})

// Standard SVG progress-ring math: circumference = 2πr, dashoffset shrinks
// as progress grows. Clamp the visual to [0, 1] so overshoot doesn't wrap.
const RADIUS = 56
const CIRC = 2 * Math.PI * RADIUS
const dashOffset = computed(() => CIRC * (1 - Math.min(1, Math.max(0, ratio.value))))

const focusSeconds = computed(() => props.focusMinutes * 60)
const remainingSeconds = computed(() => Math.max(0, (props.goalMinutes - props.focusMinutes) * 60))
const overSeconds = computed(() => Math.max(0, (props.focusMinutes - props.goalMinutes) * 60))
</script>

<template>
  <UCard>
    <div class="flex flex-col items-center gap-4 py-2">
      <h3 class="text-sm font-medium uppercase tracking-wide text-muted">
        Today's goal
      </h3>

      <div
        class="relative rounded-full"
        :class="{ 'goal-flash': flashing }"
      >
        <svg
          width="140"
          height="140"
          viewBox="0 0 140 140"
          role="img"
          :aria-label="`${percent}% of daily goal${goalMet ? ' — goal met' : ''}`"
        >
          <circle
            cx="70"
            cy="70"
            :r="RADIUS"
            fill="none"
            stroke="currentColor"
            stroke-width="10"
            class="text-muted opacity-30"
          />
          <circle
            cx="70"
            cy="70"
            :r="RADIUS"
            fill="none"
            :stroke="goalMet ? 'var(--tutorex-highlight)' : 'currentColor'"
            stroke-width="10"
            stroke-linecap="round"
            :stroke-dasharray="CIRC"
            :stroke-dashoffset="dashOffset"
            transform="rotate(-90 70 70)"
            class="text-primary transition-[stroke-dashoffset,stroke] duration-500"
          />
        </svg>
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <span class="font-display text-3xl font-semibold tracking-tight tabular-nums text-highlighted">
            {{ percent }}%
          </span>
          <span class="text-xs text-muted">
            of {{ goalMinutes }}m
          </span>
        </div>
      </div>

      <div class="text-center">
        <p class="text-sm text-default">
          <span class="font-display font-semibold tabular-nums text-highlighted">{{ formatDuration(focusSeconds) }}</span>
          studied
        </p>
        <p
          v-if="met && overSeconds > 0"
          class="mt-1 text-sm font-medium text-primary"
        >
          Goal reached — {{ formatDuration(overSeconds) }} over
        </p>
        <p
          v-else-if="met"
          class="mt-1 text-sm font-medium text-primary"
        >
          Goal reached
        </p>
        <p
          v-else
          class="mt-1 text-sm text-muted"
        >
          {{ formatDuration(remainingSeconds) }} to go
        </p>
      </div>
    </div>
  </UCard>
</template>

<style scoped>
.goal-flash {
  animation: goal-flash 800ms ease-out;
}

@keyframes goal-flash {
  0% {
    box-shadow: 0 0 0 0 var(--tutorex-highlight);
  }
  40% {
    box-shadow: 0 0 0 6px var(--tutorex-highlight);
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

@media (prefers-reduced-motion: reduce) {
  .goal-flash {
    animation: none;
  }
}
</style>
