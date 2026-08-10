<script setup lang="ts">
import type { FriendEdge } from '~/types/database'

/**
 * A pending request, in the compact row shape the 3b table uses.
 *
 * Incoming requests are banners on the page itself now, so in practice this
 * renders the **sent** list. The incoming branch stays for the case where the
 * banners are not on screen.
 *
 * Kept to two lines on purpose. The earlier version stacked name, "waiting for
 * them to accept", and "sent 3h ago" — three lines where the middle one repeats
 * the section heading above it. Identity on top, timing underneath, state as a
 * badge, action on the right.
 *
 * Decline and Cancel are the same operation: delete the edge. There is no soft
 * state between them, and a kept-but-declined row would keep granting the
 * access it was meant to end.
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

/** `@handle · sent 3h ago`, collapsing to just the timing when unset. */
const subtitle = computed(() => {
  const sent = `sent ${relativeTime(props.edge.created_at)}`
  return props.edge.username ? `@${props.edge.username} · ${sent}` : sent
})
</script>

<template>
  <li class="flex items-center gap-3 px-4 py-3">
    <UserAvatar
      :name="edge.display_name"
      :username="edge.username"
      :src="edge.avatar_url"
      size="sm"
    />

    <div class="min-w-0 flex-1">
      <p class="truncate text-[13px] font-semibold text-highlighted">
        {{ name }}
      </p>
      <p class="truncate text-[11px] text-dimmed">
        {{ subtitle }}
      </p>
    </div>

    <UBadge
      v-if="!isIncoming"
      color="neutral"
      variant="subtle"
      size="sm"
      class="shrink-0"
    >
      Pending
    </UBadge>

    <div class="flex shrink-0 items-center gap-1">
      <UButton
        v-if="isIncoming"
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
