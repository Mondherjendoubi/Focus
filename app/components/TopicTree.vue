<script setup lang="ts">
import type { Topic, TopicRollup } from '~/types/database'

/**
 * Renders the active topic tree nested by `parent_id`, ordered by `position`.
 * Two levels is the common case but it will render deeper without breaking —
 * the schema caps depth at 20.
 *
 * Each row shows the all-time focus hours from `v_topic_rollup`, so this list
 * answers "what am I actually spending time on" without a separate stats page.
 * The rollup already includes descendant sub-topics.
 */

const props = defineProps<{
  topics: Topic[]
  rollups: ReadonlyMap<string, TopicRollup>
}>()

const emit = defineEmits<{
  'edit': [topic: Topic]
  'archive': [topic: Topic]
  'move-up': [topic: Topic]
  'move-down': [topic: Topic]
}>()

interface TreeNode {
  topic: Topic
  children: TreeNode[]
}

/** Build the tree from a flat, position-ordered list — one pass. */
const tree = computed<TreeNode[]>(() => {
  const byId = new Map<string, TreeNode>()
  for (const topic of props.topics) {
    byId.set(topic.id, { topic, children: [] })
  }

  const roots: TreeNode[] = []
  for (const topic of props.topics) {
    const node = byId.get(topic.id)!
    if (topic.parent_id && byId.has(topic.parent_id)) {
      byId.get(topic.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.topic.position - b.topic.position)
    for (const node of nodes) sort(node.children)
  }
  sort(roots)

  return roots
})

/** True when `topic` is the first among its visible siblings. */
function isFirst(topic: Topic): boolean {
  const siblings = props.topics
    .filter(t => t.parent_id === topic.parent_id)
    .sort((a, b) => a.position - b.position)
  return siblings[0]?.id === topic.id
}

function isLast(topic: Topic): boolean {
  const siblings = props.topics
    .filter(t => t.parent_id === topic.parent_id)
    .sort((a, b) => a.position - b.position)
  return siblings[siblings.length - 1]?.id === topic.id
}

function hoursLabel(id: string): string {
  const row = props.rollups.get(id)
  const hours = row?.total_focus_hours ?? 0
  if (hours === 0) return 'No focus time yet'
  if (hours < 1) return `${Math.round(hours * 60)} min`
  // One decimal for short totals, whole numbers past ten hours.
  if (hours < 10) return `${hours.toFixed(1)} h`
  return `${Math.round(hours)} h`
}
</script>

<template>
  <ul
    class="flex flex-col gap-2"
    role="tree"
  >
    <li
      v-for="node in tree"
      :key="node.topic.id"
      role="treeitem"
    >
      <div class="group flex items-center gap-3 rounded-lg border border-default bg-elevated/40 px-3 py-2.5 transition hover:bg-elevated">
        <div class="min-w-0 flex-1">
          <TopicBadge :topic="node.topic" />
          <p
            v-if="node.topic.description"
            class="mt-0.5 text-xs text-muted truncate"
          >
            {{ node.topic.description }}
          </p>
        </div>

        <span class="hidden sm:inline text-sm text-muted tabular-nums shrink-0">
          {{ hoursLabel(node.topic.id) }}
        </span>

        <div class="flex items-center gap-0.5 shrink-0">
          <UButton
            icon="i-lucide-chevron-up"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Move up"
            :disabled="isFirst(node.topic)"
            @click="emit('move-up', node.topic)"
          />
          <UButton
            icon="i-lucide-chevron-down"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Move down"
            :disabled="isLast(node.topic)"
            @click="emit('move-down', node.topic)"
          />
          <UButton
            icon="i-lucide-pencil"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Edit topic"
            @click="emit('edit', node.topic)"
          />
          <UButton
            icon="i-lucide-archive"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Archive topic"
            @click="emit('archive', node.topic)"
          />
        </div>
      </div>

      <div
        v-if="node.children.length > 0"
        class="mt-2 ml-4 border-l border-default pl-3"
      >
        <TopicTree
          :topics="node.children.map(c => c.topic)"
          :rollups="rollups"
          @edit="(t) => emit('edit', t)"
          @archive="(t) => emit('archive', t)"
          @move-up="(t) => emit('move-up', t)"
          @move-down="(t) => emit('move-down', t)"
        />
      </div>
    </li>
  </ul>
</template>
