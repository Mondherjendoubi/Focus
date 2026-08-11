<script setup lang="ts">
import type { HistoryDay, HistorySession } from '~/composables/useHistory'

/**
 * One day as a stack of cards — `claude-design/history-mobile-6b.html`.
 *
 * The tape does not survive a phone: 16 hours across 358px puts a 45-minute
 * session at 20px wide, which is neither readable nor tappable. So the same
 * segmented bar is kept, stretched to the full card width, and the time of day
 * moves into the meta line where it stays legible.
 *
 * Tapping a card opens the same tooltip the desktop tape shows on hover.
 */
const props = defineProps<{
  day: HistoryDay
  timeLabel: (instant: string) => string
}>()

const openId = ref<string | null>(null)
const open = computed(() => props.day.sessions.find(s => s.id === openId.value) ?? null)

function toggle(session: HistorySession) {
  openId.value = openId.value === session.id ? null : session.id
}

function badgeOf(session: HistorySession) {
  switch (session.status) {
    case 'completed': return { label: 'Completed', color: 'success' as const }
    case 'active': return { label: 'Running', color: 'primary' as const }
    case 'abandoned': return { label: 'Abandoned', color: 'warning' as const }
  }
  return { label: session.status, color: 'neutral' as const }
}
</script>

<template>
  <section class="flex flex-col gap-2">
    <div class="flex items-baseline gap-2">
      <h2 class="text-[11px] font-semibold uppercase tracking-[.06em] text-muted">
        {{ day.label }}
      </h2>
      <span class="ml-auto text-[11px] tabular-nums text-dimmed">
        {{ formatDuration(day.focusSeconds) }} focus
      </span>
    </div>

    <div
      v-for="session in day.sessions"
      :key="session.key"
      class="flex cursor-pointer flex-col gap-[7px] rounded-xl border border-default bg-default px-3.5 py-3 shadow-sm"
      @click="toggle(session)"
    >
      <div class="flex items-center gap-2">
        <span class="min-w-0 flex-1 truncate text-[13px] font-semibold text-highlighted">
          {{ session.title }}
        </span>
        <UBadge
          :color="badgeOf(session).color"
          variant="subtle"
          size="sm"
          class="shrink-0 rounded-full"
        >
          {{ badgeOf(session).label }}
        </UBadge>
      </div>

      <HistoryBar
        :session="session"
        height-class="h-2.5"
        rounded-class="rounded-[5px]"
      />

      <div class="flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] text-muted">
        <span class="tabular-nums">
          {{ timeLabel(session.startedAt) }} – {{ session.endedAt === null ? 'now' : timeLabel(session.endedAt) }}
        </span>
        <span>
          <span class="font-semibold text-highlighted">{{ formatDuration(session.focusSeconds) }}</span> focus
        </span>
        <span v-if="session.focusRating !== null">★ {{ session.focusRating }}/5</span>
        <span v-if="session.interruptions > 0">{{ session.interruptions }} interr.</span>
        <!-- Otherwise a session that ran past midnight reads as a short one. -->
        <span
          v-if="session.spansDays"
          class="text-dimmed"
        >this day only</span>
      </div>

      <!-- Inline rather than floating: on a phone there is nowhere for a
           tooltip to go that is not already covered by a thumb. -->
      <HistoryTip
        v-if="open?.id === session.id"
        :session="session"
        :time-label="timeLabel"
        class="w-full max-w-none"
      />
    </div>
  </section>
</template>
