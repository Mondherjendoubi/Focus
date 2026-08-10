<script setup lang="ts">
import type { AnalyticsRange } from '~/composables/useAnalytics'

/**
 * Range control for the deep-analytics section (FA-015). Owns no data — it
 * emits a day count and `useAnalytics` does the rest.
 *
 * Scope is a real usability trap here: the cards ABOVE this control
 * (`DailyFocusChart`, `FocusHeatmap`, `TopicLeaderboard`) have their own fixed
 * windows and are not affected by it. The section header says so in words, and
 * this sits inside that header rather than at the top of the page so its reach
 * reads visually as well.
 */
defineProps<{
  modelValue: AnalyticsRange
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: AnalyticsRange] }>()

function label(days: AnalyticsRange): string {
  return `${days}d`
}
</script>

<template>
  <div
    class="flex items-center gap-1 rounded-lg bg-elevated p-1"
    role="group"
    aria-label="Analytics date range"
  >
    <UButton
      v-for="days in ANALYTICS_RANGES"
      :key="days"
      :color="days === modelValue ? 'primary' : 'neutral'"
      :variant="days === modelValue ? 'solid' : 'ghost'"
      size="xs"
      :disabled="disabled"
      :aria-pressed="days === modelValue"
      :aria-label="`Last ${days} days`"
      @click="emit('update:modelValue', days)"
    >
      {{ label(days) }}
    </UButton>
  </div>
</template>
