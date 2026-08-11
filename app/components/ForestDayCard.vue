<script setup lang="ts">
import type { ForestDay } from '~/composables/useForest'

/**
 * What one day actually was (FA-023).
 *
 * The `<title>` this replaces was a native browser tooltip: a second's delay,
 * no styling, one line. A day that earned a tree deserves the reason it did.
 *
 * The percentage is the point. "2h 53m" is a number you have to weigh against a
 * goal you may not remember setting; "144% of goal" is the same fact already
 * weighed. Seedlings get it too — "68%" is a much kinder way to say a day fell
 * short than an empty patch of ground would be.
 */
const props = defineProps<{ day: ForestDay }>()

/** Enough to see the shape of the day; the rest collapses into a count. */
const TOP_TOPICS = 3

const percent = computed(() => Math.round(props.day.ratio * 100))

const shown = computed(() => props.day.topics.slice(0, TOP_TOPICS))
const hidden = computed(() => Math.max(0, props.day.topics.length - TOP_TOPICS))

/** `'2026-06-01'` as `'Monday, 1 June'`. Parsed in UTC like every other label. */
const heading = computed(() => {
  const [y, m, d] = props.day.localDay.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(y!, m! - 1, d!)))
})

/** Sessions, and interruptions only when there were any. Zero is not news. */
const summary = computed(() => {
  const parts = [`${props.day.sessionCount} ${props.day.sessionCount === 1 ? 'session' : 'sessions'}`]
  if (props.day.interruptions > 0) {
    parts.push(`${props.day.interruptions} ${props.day.interruptions === 1 ? 'interruption' : 'interruptions'}`)
  }
  return parts.join(' · ')
})
</script>

<template>
  <div class="pointer-events-none w-[232px] rounded-xl border border-default bg-default p-3 shadow-lg">
    <p class="text-[11px] font-medium uppercase tracking-wider text-dimmed">
      {{ heading }}
    </p>

    <div class="mt-1.5 flex items-baseline justify-between gap-2">
      <span class="font-display text-lg font-semibold tabular-nums text-highlighted">
        {{ formatDuration(day.focusSeconds) }}
      </span>
      <span
        class="text-[13px] font-semibold tabular-nums"
        :class="day.kind === 'tree' ? 'text-success' : 'text-muted'"
      >
        {{ percent }}% of goal
      </span>
    </div>

    <ul
      v-if="shown.length > 0"
      class="mt-2.5 flex flex-col gap-1 border-t border-muted pt-2.5"
    >
      <li
        v-for="topic in shown"
        :key="topic.name"
        class="flex items-center gap-2 text-[13px]"
      >
        <!-- `topics.color` is database-owned, so inline — the one sanctioned hex. -->
        <span
          class="size-2 shrink-0 rounded-full"
          :style="topic.color ? { backgroundColor: topic.color } : undefined"
          :class="topic.color ? '' : 'bg-accented'"
        />
        <span class="min-w-0 flex-1 truncate text-toned">{{ topic.name }}</span>
        <span class="shrink-0 tabular-nums text-muted">{{ formatDuration(topic.seconds) }}</span>
      </li>
      <li
        v-if="hidden > 0"
        class="pl-4 text-xs text-dimmed"
      >
        and {{ hidden }} more
      </li>
    </ul>

    <p class="mt-2 text-xs text-dimmed">
      {{ summary }}
    </p>
  </div>
</template>
