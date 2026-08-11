<script setup lang="ts">
import type { HistorySession } from '~/composables/useHistory'

/**
 * A session as a segmented bar (FA-024).
 *
 * One slice per block, widths in wall-clock proportion — so the breaks are
 * visible as gaps in the colour rather than hidden inside a single block of it.
 * That is the whole point of the shape: "what you planned, what actually
 * happened" is legible only when the pauses are drawn.
 *
 * Identical in both handoffs apart from height and radius, so it lives here once
 * and the two scenes pass their own.
 */
const props = defineProps<{
  session: HistorySession
  /** Tailwind height class — `h-[26px]` on the tape, `h-2.5` on the card. */
  heightClass: string
  roundedClass: string
}>()

/**
 * A running block is hatched, in its own topic colour striped with the primary.
 * `topics.color` is database-owned — the one sanctioned inline colour — so the
 * gradient has to be built as a string rather than named by a class.
 */
function segmentStyle(segment: HistorySession['segments'][number]) {
  const width = { width: `${segment.width}%` }
  if (segment.kind !== 'focus') return width

  const color = segment.color ?? 'var(--ui-bg-accented)'
  if (!segment.running) return { ...width, backgroundColor: color }

  return {
    ...width,
    backgroundImage:
      `repeating-linear-gradient(45deg, ${color}, ${color} 5px, var(--ui-color-primary-300) 5px, var(--ui-color-primary-300) 9px)`
  }
}

/** Abandoned sessions get a dashed outline instead of a hairline. */
const outline = computed(() =>
  props.session.status === 'abandoned'
    ? 'border-[1.5px] border-dashed border-warning'
    : 'border border-default/60'
)
</script>

<template>
  <div
    class="flex overflow-hidden"
    :class="[heightClass, roundedClass, outline]"
  >
    <span
      v-for="(segment, i) in session.segments"
      :key="i"
      class="block"
      :class="segment.kind === 'focus' ? '' : 'bg-accented'"
      :style="segmentStyle(segment)"
    />
  </div>
</template>
