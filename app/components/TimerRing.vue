<script setup lang="ts">
import type { BlockKind } from '~/types/database'

/**
 * The running-block clock. Presentational only: never mutates state, never
 * derives elapsed itself — `useActiveSession` owns the number, this owns
 * how it reads.
 *
 * Three shapes it must handle:
 *  - Planned focus block on schedule: ring fills toward 100%.
 *  - Planned block overrunning: ring caps at 100%, stroke shifts to warning,
 *    a `+MM:SS` overshoot label appears below the clock. Never negative.
 *  - Open-ended block (`planned_seconds` is null): ring is a muted full
 *    circle with no progress indicator — the number is the whole message.
 *
 * Focus and break blocks read differently at a glance: focus uses the theme
 * primary, breaks use info/success tints. Colour never carries the identity
 * alone — the `kind` label above the ring says it explicitly for anyone
 * relying on a screen reader or colour-blind palette.
 *
 * `topicColor`, when present, is applied inline as a small swatch on the
 * ring — it comes from `topics.color` and is the one hex the theme allows.
 */

const props = withDefaults(defineProps<{
  elapsedSeconds: number
  plannedSeconds: number | null
  kind: BlockKind
  topicColor?: string | null
  paused?: boolean
  /**
   * `lg` grows the ring to 320px for the FA-020 desktop workspace. The SVG
   * geometry is untouched — the viewBox is already 240 and scales — so this
   * only swaps the wrapper size and the clock's type scale.
   */
  size?: 'md' | 'lg'
}>(), {
  size: 'md'
})

const ringSizeClass = computed(() =>
  props.size === 'lg' ? 'size-64 sm:size-72 lg:size-80' : 'size-64 sm:size-72'
)

const clockSizeClass = computed(() =>
  props.size === 'lg'
    ? 'text-5xl sm:text-6xl lg:text-[62px] lg:leading-none'
    : 'text-5xl sm:text-6xl'
)

// Standard SVG progress-ring geometry. Radius picked so the SVG box is
// 240x240; the wrapping div grows the visual to `size-64` / `size-72`
// via CSS so the timer remains legible at 375px.
const RADIUS = 108
const CIRC = 2 * Math.PI * RADIUS

const ratio = computed(() => {
  if (props.plannedSeconds === null || props.plannedSeconds <= 0) return 0
  return props.elapsedSeconds / props.plannedSeconds
})

const overtime = computed(() => {
  if (props.plannedSeconds === null) return false
  return props.elapsedSeconds > props.plannedSeconds
})

const overshootSeconds = computed(() => {
  if (props.plannedSeconds === null) return 0
  return Math.max(0, props.elapsedSeconds - props.plannedSeconds)
})

const dashOffset = computed(() => {
  // Open-ended: no progress; leave the offset at zero visually via
  // dasharray=0 (see template) so this branch never renders anyway.
  if (props.plannedSeconds === null) return 0
  return CIRC * (1 - Math.min(1, Math.max(0, ratio.value)))
})

// Focus reads as primary. Breaks read as info (short) and neutral-tinted
// (long) — different enough from focus that a glance can't confuse them.
// Overtime overrides everything: a focus block running long earns a
// warning tint that says "you're past the plan".
const strokeClass = computed(() => {
  if (overtime.value) return 'text-warning'
  if (props.kind === 'focus') return 'text-primary'
  if (props.kind === 'short_break') return 'text-info'
  return 'text-success'
})

const kindLabel = computed(() => {
  if (props.kind === 'focus') return 'Focus'
  if (props.kind === 'short_break') return 'Short break'
  return 'Long break'
})

const kindIcon = computed(() => {
  if (props.kind === 'focus') return 'i-lucide-brain'
  if (props.kind === 'short_break') return 'i-lucide-coffee'
  return 'i-lucide-bed'
})

const percent = computed(() => Math.round(Math.min(1, ratio.value) * 100))

const ariaLabel = computed(() => {
  const clock = formatClock(props.elapsedSeconds)
  if (props.plannedSeconds === null) return `${kindLabel.value}, ${clock} elapsed`
  if (overtime.value) return `${kindLabel.value}, ${clock} elapsed, past target`
  return `${kindLabel.value}, ${clock} elapsed, ${percent.value}% of target`
})
</script>

<template>
  <div class="flex flex-col items-center gap-4">
    <div class="flex items-center gap-2 text-sm font-medium uppercase tracking-wide">
      <UIcon
        :name="kindIcon"
        class="size-4"
        :class="kind === 'focus' ? 'text-primary' : kind === 'short_break' ? 'text-info' : 'text-success'"
        aria-hidden="true"
      />
      <span
        :class="kind === 'focus' ? 'text-primary' : kind === 'short_break' ? 'text-info' : 'text-success'"
      >
        {{ kindLabel }}
      </span>
      <span
        v-if="topicColor"
        class="ml-1 inline-block size-3 rounded-full ring-1 ring-inset ring-black/5 dark:ring-white/10"
        :style="{ backgroundColor: topicColor }"
        aria-hidden="true"
      />
    </div>

    <div
      class="relative"
      :class="ringSizeClass"
      role="img"
      :aria-label="ariaLabel"
    >
      <svg
        viewBox="0 0 240 240"
        class="size-full -rotate-90"
        :class="kind === 'focus' && !paused ? 'animate-breathe' : ''"
      >
        <!-- Track. Muted always; the ring above sits on top of it. -->
        <circle
          cx="120"
          cy="120"
          :r="RADIUS"
          fill="none"
          stroke="currentColor"
          stroke-width="12"
          class="text-muted opacity-20"
        />
        <!-- Progress ring. Skipped entirely for open-ended blocks. -->
        <circle
          v-if="plannedSeconds !== null"
          cx="120"
          cy="120"
          :r="RADIUS"
          fill="none"
          stroke="currentColor"
          stroke-width="12"
          stroke-linecap="round"
          :stroke-dasharray="CIRC"
          :stroke-dashoffset="dashOffset"
          class="transition-[stroke-dashoffset] duration-500"
          :class="[strokeClass, paused ? 'opacity-60' : '']"
        />
      </svg>

      <div class="absolute inset-0 flex flex-col items-center justify-center gap-1">
        <span
          class="font-semibold tabular-nums text-highlighted"
          :class="[clockSizeClass, paused ? 'opacity-70' : '']"
        >
          {{ formatClock(elapsedSeconds) }}
        </span>
        <span
          v-if="plannedSeconds !== null && !overtime"
          class="text-xs text-muted tabular-nums"
        >
          / {{ formatClock(plannedSeconds) }}
        </span>
        <span
          v-else-if="overtime"
          class="text-sm font-medium text-warning tabular-nums"
        >
          +{{ formatClock(overshootSeconds) }} over
        </span>
        <span
          v-else
          class="text-xs text-muted"
        >
          Open-ended
        </span>
        <span
          v-if="paused"
          class="mt-1 inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-xs font-medium text-muted"
        >
          <UIcon
            name="i-lucide-pause"
            class="size-3"
            aria-hidden="true"
          />
          Paused
        </span>
      </div>
    </div>
  </div>
</template>
