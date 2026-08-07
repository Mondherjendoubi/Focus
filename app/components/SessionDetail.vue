<script setup lang="ts">
import type { BlockFact } from '~/types/database'

/**
 * Per-session block breakdown. Rendered inside `SessionRow` only when the
 * user expands the row, so the block query is lazy — history stays cheap
 * for users with hundreds of sessions.
 *
 * IMPORTANT: `v_block_facts` only contains CLOSED blocks (`where b.ended_at
 * is not null`). For an active session the current running block will NOT
 * appear here. We surface that explicitly with a note so a user does not
 * read this list as "all my blocks".
 */

const props = defineProps<{
  sessionId: string
  isRunning: boolean
}>()

const supabase = useSupabase()

const blocks = ref<BlockFact[]>([])
const pending = ref(true)
const errorMessage = ref<string | null>(null)

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit'
})

async function load() {
  pending.value = true
  errorMessage.value = null
  const { data, error } = await supabase
    .from('v_block_facts')
    .select('*')
    .eq('session_id', props.sessionId)
    .order('started_at', { ascending: true })

  if (error) {
    // Surface the failure. An empty list here would be indistinguishable
    // from "no completed blocks yet", which is a real, distinct state.
    errorMessage.value = toMessage(error)
    blocks.value = []
  } else {
    blocks.value = (data ?? []) as BlockFact[]
  }
  pending.value = false
}

// Refetch when the row for a different session gets expanded in the same slot.
watch(() => props.sessionId, load, { immediate: true })

function kindLabel(kind: BlockFact['kind']): string {
  switch (kind) {
    case 'focus': return 'Focus'
    case 'short_break': return 'Short break'
    case 'long_break': return 'Long break'
  }
}

function kindIcon(kind: BlockFact['kind']): string {
  switch (kind) {
    case 'focus': return 'i-lucide-brain'
    case 'short_break': return 'i-lucide-coffee'
    case 'long_break': return 'i-lucide-tent-tree'
  }
}
</script>

<template>
  <div class="p-4 bg-default">
    <p
      v-if="isRunning"
      class="mb-3 flex items-start gap-2 text-xs text-muted"
    >
      <UIcon
        name="i-lucide-info"
        class="mt-0.5 size-3.5 text-primary shrink-0"
      />
      <span>This session is still running. The current block will appear here once it ends.</span>
    </p>

    <div
      v-if="pending"
      class="flex flex-col gap-2"
    >
      <USkeleton
        v-for="i in 3"
        :key="i"
        class="h-10"
      />
    </div>

    <UAlert
      v-else-if="errorMessage"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="Could not load blocks"
      :description="errorMessage"
    />

    <p
      v-else-if="blocks.length === 0"
      class="text-sm text-muted italic"
    >
      {{ isRunning ? 'No blocks have finished yet.' : 'This session recorded no blocks.' }}
    </p>

    <ul
      v-else
      class="flex flex-col gap-2"
    >
      <li
        v-for="block in blocks"
        :key="block.block_id"
        class="flex items-center gap-3 p-2.5 rounded-md bg-elevated border border-default"
      >
        <!-- topic_color is decoration only; the topic name below carries the meaning. -->
        <span
          class="size-2.5 rounded-full shrink-0"
          :style="{ backgroundColor: block.topic_color ?? 'transparent' }"
          :class="{ 'border border-default': !block.topic_color }"
          aria-hidden="true"
        />

        <UIcon
          :name="kindIcon(block.kind)"
          class="size-4 text-muted shrink-0"
        />

        <div class="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span class="text-sm font-medium text-highlighted">{{ kindLabel(block.kind) }}</span>
          <span class="text-sm text-muted truncate">
            {{ block.topic_name ?? 'No topic' }}
          </span>
        </div>

        <div class="flex items-center gap-3 text-xs text-muted shrink-0">
          <span>{{ timeFormatter.format(new Date(block.started_at)) }}</span>
          <span class="font-medium text-highlighted">{{ formatDuration(block.net_seconds) }}</span>
          <span
            v-if="block.interruptions > 0"
            class="inline-flex items-center gap-1"
            :title="`${block.interruptions} interruption${block.interruptions === 1 ? '' : 's'}`"
          >
            <UIcon
              name="i-lucide-bell-off"
              class="size-3"
            />
            {{ block.interruptions }}
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>
