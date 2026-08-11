<script setup lang="ts">
import type { FriendDay, FriendEdge, FriendStats } from '~/types/database'

/**
 * One friend as a table row — the 3b layout.
 *
 * Column widths are fixed rather than fractional so every row's numbers line up
 * with the header above them; a table whose columns shift per row is harder to
 * scan than a list.
 *
 * `stats` undefined means **no access**, not "a friend with nothing". The RPC
 * returns zero rows for a non-friend, which is indistinguishable from a friend
 * who never studied, so that case gets a sentence spanning the numeric columns
 * rather than a row of confident zeroes.
 *
 * Aggregates only, as ever: week total, seven day-squares, streak, goal days.
 * No topic, no title, no note — the RPCs do not return them.
 *
 * `remove` only asks — the page confirms before deleting anything. The button
 * is icon-only and sits at the end of every row, so a straight-through click
 * would unfriend someone on a mis-aim with no undo.
 */
const props = defineProps<{
  edge: FriendEdge
  stats?: FriendStats
  days?: FriendDay[]
  isNew?: boolean
  removing?: boolean
}>()

const emit = defineEmits<{ remove: [edge: FriendEdge] }>()

const name = computed(() => {
  const display = props.edge.display_name?.trim()
  if (display && display.length > 0) return display
  return props.edge.username ? `@${props.edge.username}` : 'Someone'
})

/** Only meaningful with a prior week to be a percentage of. */
const delta = computed(() => {
  const s = props.stats
  if (!s || s.prev_week_seconds <= 0) return null
  return (s.week_seconds - s.prev_week_seconds) / s.prev_week_seconds
})

const deltaLabel = computed(() => {
  if (delta.value === null) return null
  const pct = Math.round(delta.value * 100)
  if (pct === 0) return null
  return `${pct > 0 ? '+' : ''}${pct}%`
})

const deltaTone = computed(() =>
  (delta.value ?? 0) > 0 ? 'text-primary' : 'text-warning'
)

/**
 * Three states per square: goal met, studied but short, nothing.
 * `bg-primary/40` stands in for the design's blue-300 — a token rather than the
 * literal hex so the row survives dark mode.
 */
function squareClass(day: FriendDay): string {
  if (day.goal_met) return 'bg-primary'
  if (day.focus_seconds > 0) return 'bg-primary/40'
  return 'bg-accented'
}

function squareLabel(day: FriendDay): string {
  if (day.focus_seconds === 0) return `${day.local_day} — nothing`
  const suffix = day.goal_met ? ', goal met' : ''
  return `${day.local_day} — ${formatDuration(day.focus_seconds)}${suffix}`
}
</script>

<template>
  <div class="flex items-center gap-4 border-b border-muted px-5 py-3.5 transition last:border-b-0 hover:bg-muted/60">
    <!-- Friend -->
    <div class="flex w-[280px] min-w-0 items-center gap-2.5">
      <!-- `md` is 32px. The prototype's circle is 34, and `sm` — what this had —
           is 28, which made every row read a size lighter than the design. -->
      <UserAvatar
        :name="edge.display_name"
        :username="edge.username"
        :src="edge.avatar_url"
        size="md"
      />
      <div class="min-w-0">
        <p class="flex items-center gap-1.5 truncate text-[13px] font-semibold text-highlighted">
          <span class="truncate">{{ name }}</span>
          <!-- Pill, not the badge default's rounded rectangle: at this size the
               square corners read as a second, competing label. -->
          <UBadge
            v-if="isNew"
            color="primary"
            variant="subtle"
            size="sm"
            class="rounded-full"
          >
            New
          </UBadge>
        </p>
        <p
          v-if="edge.username"
          class="mt-px truncate text-[11px] text-dimmed"
        >
          @{{ edge.username }}
        </p>
      </div>
    </div>

    <template v-if="stats">
      <!-- This week -->
      <span class="w-[110px] shrink-0 text-[13px] font-semibold tabular-nums text-highlighted">
        {{ formatDuration(stats.week_seconds) }}
        <span
          v-if="deltaLabel"
          class="text-[11px] font-semibold"
          :class="deltaTone"
        >{{ deltaLabel }}</span>
      </span>

      <!-- Last 7 days -->
      <div class="flex w-[130px] shrink-0 gap-1">
        <span
          v-for="day in days ?? []"
          :key="day.local_day"
          class="size-3 rounded-[3px]"
          :class="squareClass(day)"
          role="img"
          :title="squareLabel(day)"
          :aria-label="squareLabel(day)"
        />
      </div>

      <span class="w-[70px] shrink-0 text-center text-[13px] font-semibold tabular-nums text-highlighted">
        {{ stats.current_streak }}
      </span>
      <span class="w-[80px] shrink-0 text-center text-[13px] font-semibold tabular-nums text-highlighted">
        {{ stats.goal_days_hit }}
      </span>
    </template>

    <!-- No access: one sentence across the numeric columns, never zeroes. -->
    <span
      v-else
      class="flex-1 text-xs text-dimmed"
    >
      Their progress isn't available right now.
    </span>

    <div
      class="flex justify-end"
      :class="stats ? 'flex-1' : 'shrink-0'"
    >
      <UButton
        icon="i-lucide-user-round-minus"
        color="neutral"
        variant="ghost"
        size="xs"
        :loading="removing"
        :disabled="removing"
        :aria-label="`Remove ${name}`"
        @click="emit('remove', edge)"
      />
    </div>
  </div>
</template>
