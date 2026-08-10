<script setup lang="ts">
/**
 * "Earlier today" — the bottom card of the FA-020 right rail.
 *
 * Self-fetching, and hides itself when the day has nothing in it yet: an empty
 * card sitting beside a running timer is dead weight, and the timer is the
 * thing the page exists for.
 *
 * Errors are the exception to that — "empty is not failed", so a load failure
 * says so rather than looking like a quiet morning.
 */
const props = defineProps<{
  /** The session running right now, excluded so "earlier" stays true. */
  excludeSessionId?: string | null
}>()

const { sessions, pending, error, refresh } = useTodaySessions()

void refresh()

// Re-read when the running session changes: ending one should move it into
// this list without a page reload.
watch(() => props.excludeSessionId, () => {
  void refresh()
})

const rows = computed(() =>
  sessions.value.filter(entry => entry.sessionId !== props.excludeSessionId)
)

function label(title: string | null, topicName: string | null): string {
  if (title && title.trim().length > 0) {
    return topicName ? `${topicName} — ${title.trim()}` : title.trim()
  }
  return topicName ?? 'Untitled session'
}
</script>

<template>
  <UCard
    v-if="error || (!pending && rows.length > 0)"
    :ui="{ body: 'p-5' }"
  >
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="Couldn't load today"
      :description="error"
      :actions="[{ label: 'Retry', onClick: () => refresh(), color: 'neutral', variant: 'outline' }]"
    />

    <div
      v-else
      class="flex flex-col gap-2.5"
    >
      <p class="text-sm font-semibold text-highlighted">
        Earlier today
      </p>

      <div
        v-for="entry in rows"
        :key="entry.sessionId"
        class="flex items-center gap-2.5 text-sm text-toned"
      >
        <!-- `topics.color` is the one value allowed to be an inline hex. -->
        <span
          class="size-2.5 shrink-0 rounded-full"
          :style="{ backgroundColor: entry.topicColor ?? 'var(--ui-bg-accented)' }"
        />
        <span class="truncate">{{ label(entry.title, entry.topicName) }}</span>
        <span class="ml-auto shrink-0 tabular-nums text-muted">
          {{ formatDuration(entry.focusSeconds) }}
        </span>
      </div>
    </div>
  </UCard>
</template>
