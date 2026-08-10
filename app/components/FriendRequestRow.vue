<script setup lang="ts">
import type { FriendEdge } from '~/types/database'

/**
 * One pending request, in either direction.
 *
 * Incoming gets Accept / Decline; outgoing gets Cancel. Both "decline" and
 * "cancel" delete the same edge — there is no soft state between them, and
 * keeping a declined row around would keep granting the aggregate access it
 * was meant to end.
 */
const props = defineProps<{
  edge: FriendEdge
  busy?: boolean
}>()

const emit = defineEmits<{
  accept: [edge: FriendEdge]
  remove: [edge: FriendEdge]
}>()

const name = computed(() => {
  const display = props.edge.display_name?.trim()
  if (display && display.length > 0) return display
  return props.edge.username ? `@${props.edge.username}` : 'Someone'
})

const isIncoming = computed(() => props.edge.direction === 'incoming')
</script>

<template>
  <li class="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
    <div class="flex min-w-0 items-center gap-3">
      <UserAvatar
        :name="edge.display_name"
        :username="edge.username"
        :src="edge.avatar_url"
        size="sm"
      />
      <div class="min-w-0">
        <p class="truncate text-sm font-medium text-highlighted">
          {{ name }}
        </p>
        <p class="text-xs text-muted">
        <template v-if="isIncoming">
          wants to follow your progress
        </template>
        <template v-else>
          waiting for them to accept
        </template>
        </p>
        <!-- How long it has been pending. An outgoing request with no age reads
             as "just sent" forever, so you cannot tell a request from an hour
             ago from one they have been sitting on for a fortnight. -->
        <p class="text-xs text-dimmed">
          sent {{ relativeTime(edge.created_at) }}
        </p>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <UButton
        v-if="isIncoming"
        icon="i-lucide-check"
        size="xs"
        :loading="busy"
        :disabled="busy"
        @click="emit('accept', edge)"
      >
        Accept
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        :disabled="busy"
        @click="emit('remove', edge)"
      >
        {{ isIncoming ? 'Decline' : 'Cancel' }}
      </UButton>
    </div>
  </li>
</template>
