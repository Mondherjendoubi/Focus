<script setup lang="ts">
import type { FriendEdge, FriendStats } from '~/types/database'

/**
 * One accepted friend and their week.
 *
 * `stats` is undefined when `friend_stats` returned no rows, which means
 * **no access** — not "a friend with zero hours". Those two must not render the
 * same way: zeros would be a confident claim about someone's week that we have
 * no right to make.
 *
 * Aggregates only, on purpose. No topic names, no session titles, no notes —
 * the RPC does not return them and this component must never grow a query that
 * does. Topic names are free text and people write things in them they would
 * not choose to publish.
 */
const props = defineProps<{
  edge: FriendEdge
  stats?: FriendStats
  removing?: boolean
}>()

const emit = defineEmits<{
  remove: [edge: FriendEdge]
  view: [edge: FriendEdge]
}>()

/**
 * Only an actual picture is worth enlarging. Making the initials badge
 * clickable would promise a bigger version of a letter.
 */
const canEnlarge = computed(() => (props.edge.avatar_url ?? null) !== null)

const name = computed(() => {
  const display = props.edge.display_name?.trim()
  if (display && display.length > 0) return display
  return props.edge.username ? `@${props.edge.username}` : 'Someone'
})

/** Only shown when there is a prior week to be a percentage of. */
const delta = computed(() => {
  const s = props.stats
  if (!s || s.prev_week_seconds <= 0) return null
  return (s.week_seconds - s.prev_week_seconds) / s.prev_week_seconds
})

const deltaLabel = computed(() => {
  if (delta.value === null) return null
  const pct = Math.round(delta.value * 100)
  if (pct === 0) return 'flat'
  return `${pct > 0 ? '+' : ''}${pct}%`
})

const deltaTone = computed(() => {
  if (delta.value === null) return 'text-muted'
  if (delta.value > 0) return 'text-primary'
  if (delta.value < 0) return 'text-warning'
  return 'text-muted'
})
</script>

<template>
  <UCard :ui="{ body: 'p-4 sm:p-5' }">
    <div class="flex flex-col gap-4">
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <!-- A real <button> when it does something, a plain div when it
               doesn't — so keyboard focus never lands on a dead target. -->
          <button
            v-if="canEnlarge"
            type="button"
            class="shrink-0 rounded-full transition hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :aria-label="`View ${name}'s picture`"
            @click="emit('view', edge)"
          >
            <UserAvatar
              :name="edge.display_name"
              :username="edge.username"
              :src="edge.avatar_url"
            />
          </button>
          <UserAvatar
            v-else
            :name="edge.display_name"
            :username="edge.username"
            :src="edge.avatar_url"
          />
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-highlighted">
              {{ name }}
            </p>
            <p
              v-if="edge.username && edge.display_name"
              class="truncate text-xs text-muted"
            >
              @{{ edge.username }}
            </p>
          </div>
        </div>
        <UButton
          icon="i-lucide-user-minus"
          color="neutral"
          variant="ghost"
          size="xs"
          :loading="removing"
          :disabled="removing"
          :aria-label="`Remove ${name}`"
          @click="emit('remove', edge)"
        />
      </div>

      <!-- No stats row means the RPC declined, not that the week was empty. -->
      <p
        v-if="!stats"
        class="text-sm text-muted"
      >
        Their progress isn't available right now.
      </p>

      <template v-else>
        <div class="flex items-baseline gap-2">
          <span class="font-display text-2xl font-semibold tracking-tight tabular-nums text-highlighted">
            {{ formatDuration(stats.week_seconds) }}
          </span>
          <span
            v-if="deltaLabel"
            class="text-xs font-medium tabular-nums"
            :class="deltaTone"
          >
            {{ deltaLabel }}
          </span>
        </div>
        <p class="-mt-3 text-xs text-muted">
          this week
        </p>

        <div class="grid grid-cols-3 gap-2 border-t border-default pt-3 text-center">
          <div>
            <p class="text-sm font-medium tabular-nums text-highlighted">
              {{ stats.current_streak }}
            </p>
            <p class="text-[11px] text-muted">
              streak
            </p>
          </div>
          <div>
            <p class="text-sm font-medium tabular-nums text-highlighted">
              {{ stats.goal_days_hit }}
            </p>
            <p class="text-[11px] text-muted">
              goal days
            </p>
          </div>
          <div>
            <p class="text-sm font-medium tabular-nums text-highlighted">
              {{ stats.active_days }}/7
            </p>
            <p class="text-[11px] text-muted">
              active
            </p>
          </div>
        </div>
      </template>
    </div>
  </UCard>
</template>
