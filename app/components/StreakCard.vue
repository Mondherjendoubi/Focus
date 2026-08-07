<script setup lang="ts">
import type { LocalDay } from '~/types/database'

/**
 * Streak surface. `current` comes straight from `v_streaks.current_streak`,
 * which already returns 0 when the last active day is older than yesterday —
 * so this component never recomputes staleness, it just shows what the view
 * reported.
 */
const props = defineProps<{
  current: number
  longest: number
  lastActiveDay: LocalDay | null
}>()

const active = computed(() => props.current > 0)

const status = computed(() => {
  if (props.current === 0 && props.longest === 0) return 'Start your first streak today'
  if (props.current === 0) return 'Streak broken — start a new one'
  if (props.current === 1) return 'Day one — keep it going tomorrow'
  return `${props.current} days in a row`
})
</script>

<template>
  <UCard>
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium uppercase tracking-wide text-muted">
          Streak
        </h3>
        <UIcon
          :name="active ? 'i-lucide-flame' : 'i-lucide-flame-kindling'"
          :class="[active ? 'text-primary' : 'text-muted', 'size-5']"
        />
      </div>

      <div class="flex items-baseline gap-2">
        <span class="font-display text-4xl font-semibold tracking-tight tabular-nums text-highlighted">
          {{ current }}
        </span>
        <span class="text-sm text-muted">
          {{ current === 1 ? 'day' : 'days' }}
        </span>
      </div>

      <p class="text-sm text-default">
        {{ status }}
      </p>

      <div class="flex items-center justify-between border-t border-default pt-3 text-xs text-muted">
        <span>
          Longest:
          <span class="font-medium tabular-nums text-default">{{ longest }}</span>
          {{ longest === 1 ? 'day' : 'days' }}
        </span>
        <span v-if="lastActiveDay">
          Last: {{ lastActiveDay }}
        </span>
      </div>
    </div>
  </UCard>
</template>
