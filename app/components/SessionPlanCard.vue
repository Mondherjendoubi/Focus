<script setup lang="ts">
import type { SessionTemplateBlock } from '~/types/database'

/**
 * The template laid out as a checklist — middle card of the FA-020 right rail.
 *
 * Three row states, and the distinction between them is the whole point:
 * done (struck through, elapsed shown), current (tinted, live clock), upcoming
 * (muted, no time). A plan where the current step is not obvious is just a list.
 *
 * `position` is passed in rather than derived from the open block, because
 * between blocks there IS no open block — deriving it here would reintroduce
 * the FA-017 bug where ending step 7 rewound the display to step 1.
 */
const props = defineProps<{
  blocks: SessionTemplateBlock[]
  /** How many blocks are done — `templatePosition` from the Focus page. */
  position: number
  /** Live clock for the current row, in seconds. */
  elapsedSeconds: number
}>()

const KIND_LABELS: Record<string, string> = {
  focus: 'Focus',
  short_break: 'Short break',
  long_break: 'Long break'
}

function rowLabel(block: SessionTemplateBlock): string {
  const kind = KIND_LABELS[block.kind] ?? 'Block'
  const minutes = Math.round(block.planned_seconds / 60)
  const base = `${kind} · ${minutes} min`
  return block.label && block.label.trim().length > 0
    ? `${block.label.trim()} · ${minutes} min`
    : base
}

function state(index: number): 'done' | 'current' | 'upcoming' {
  if (index < props.position - 1) return 'done'
  if (index === props.position - 1) return 'current'
  return 'upcoming'
}

const stepLabel = computed(() => {
  const total = props.blocks.length
  if (total === 0) return ''
  return `Step ${Math.min(Math.max(props.position, 1), total)} of ${total}`
})
</script>

<template>
  <UCard
    v-if="blocks.length > 0"
    class="flex-1"
    :ui="{ body: 'p-5' }"
  >
    <div class="flex flex-col gap-3">
      <div class="flex items-baseline justify-between gap-2">
        <p class="text-sm font-semibold text-highlighted">
          Session plan
        </p>
        <span class="text-xs tabular-nums text-muted">{{ stepLabel }}</span>
      </div>

      <ol class="flex flex-col gap-1.5">
        <li
          v-for="(block, index) in blocks"
          :key="block.id"
          class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm"
          :class="{
            'text-dimmed': state(index) === 'done',
            'border border-primary/40 bg-primary/10 font-semibold text-primary': state(index) === 'current',
            'text-toned': state(index) === 'upcoming'
          }"
        >
          <UIcon
            v-if="state(index) === 'done'"
            name="i-lucide-check"
            class="size-4 shrink-0 text-success"
          />
          <span
            v-else
            class="size-2 shrink-0 rounded-full"
            :class="state(index) === 'current' ? 'bg-primary' : 'bg-accented'"
          />

          <span
            class="truncate"
            :class="state(index) === 'done' ? 'line-through' : ''"
          >
            {{ rowLabel(block) }}
          </span>

          <!-- Only the running row gets a live clock. A finished row shows what
               it was planned for; an upcoming one shows nothing, because it has
               not happened and a time there would read as a prediction. -->
          <span
            v-if="state(index) === 'current'"
            class="ml-auto shrink-0 tabular-nums"
          >
            {{ formatClock(elapsedSeconds) }}
          </span>
          <span
            v-else-if="state(index) === 'done'"
            class="ml-auto shrink-0 tabular-nums"
          >
            {{ formatClock(block.planned_seconds) }}
          </span>
        </li>
      </ol>
    </div>
  </UCard>
</template>
