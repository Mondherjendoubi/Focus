<script setup lang="ts">
import type { Topic, TopicRollup } from '~/types/database'

/**
 * One top-level topic as a card — the FA-021 "2a Topic cards" layout.
 *
 * Sub-topics are listed inside their parent's card rather than as a nested
 * tree. That works because `v_topic_rollup` already walks the hierarchy
 * recursively: the parent's `total_focus_seconds` INCLUDES every descendant.
 * So the big number is the group's total and the rows beneath it are the
 * breakdown — they are deliberately not summed to reach it, and adding them up
 * will not match when a parent has time logged directly against it.
 *
 * The colour strip and dots come from `topics.color`, the one value in this app
 * allowed to be an inline hex. Everything else is a theme token, so the card
 * survives dark mode — which the light-only prototype does not cover.
 */
const props = defineProps<{
  topic: Topic
  children: Topic[]
  rollups: ReadonlyMap<string, TopicRollup>
}>()

const emit = defineEmits<{
  edit: [topic: Topic]
  archive: [topic: Topic]
}>()

/** PostgREST sends `bigint` as a string. */
function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/**
 * Hours the way the design reads them: `34 h` once it is double digits, `9.4 h`
 * below that. A blanket one-decimal would render `34.0 h`, which looks like
 * false precision on a number nobody measures that finely.
 */
function hoursLabel(seconds: number): string {
  const hours = seconds / 3600
  if (hours >= 10) return `${Math.round(hours)} h`
  return `${Math.round(hours * 10) / 10} h`
}

const totalLabel = computed(() =>
  hoursLabel(num(props.rollups.get(props.topic.id)?.total_focus_seconds))
)

/** Children with their own rollup totals, biggest first. */
const childRows = computed(() =>
  props.children
    .map(child => ({
      topic: child,
      seconds: num(props.rollups.get(child.id)?.total_focus_seconds)
    }))
    .sort((a, b) => b.seconds - a.seconds)
)
</script>

<template>
  <div class="overflow-hidden rounded-xl border border-default bg-default shadow-sm transition hover:border-accented">
    <!-- 4px identity strip. `topics.color` is database-owned, so inline. -->
    <div
      class="h-1"
      :style="{ backgroundColor: topic.color }"
    />

    <div class="flex flex-col gap-3.5 px-5 py-[18px]">
      <div class="flex items-start justify-between gap-2.5">
        <div class="flex min-w-0 items-center gap-2.5">
          <span
            class="size-3.5 shrink-0 rounded-full ring-1 ring-inset ring-black/5 dark:ring-white/10"
            :style="{ backgroundColor: topic.color }"
          />
          <div class="min-w-0">
            <p class="truncate text-[15px] font-semibold text-highlighted">
              {{ topic.name }}
            </p>
            <p
              v-if="topic.description"
              class="mt-0.5 truncate text-xs text-muted"
            >
              {{ topic.description }}
            </p>
          </div>
        </div>

        <div class="flex shrink-0 gap-0.5">
          <UButton
            icon="i-lucide-pencil"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="`Edit ${topic.name}`"
            @click="emit('edit', topic)"
          />
          <UButton
            icon="i-lucide-archive"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="`Archive ${topic.name}`"
            @click="emit('archive', topic)"
          />
        </div>
      </div>

      <p class="font-display text-[28px] font-semibold tracking-tight tabular-nums text-highlighted">
        {{ totalLabel }}
        <span class="font-sans text-xs font-medium tracking-normal text-dimmed">all time</span>
      </p>

      <div class="border-t border-muted pt-3">
        <div
          v-if="childRows.length > 0"
          class="flex flex-col gap-1.5"
        >
          <!-- Rows are buttons: the design gives sub-topics no controls of
               their own, but they still need to be editable, and a whole-row
               target adds no visual weight. -->
          <button
            v-for="row in childRows"
            :key="row.topic.id"
            type="button"
            class="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-[13px] text-toned transition hover:bg-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :aria-label="`Edit ${row.topic.name}`"
            @click="emit('edit', row.topic)"
          >
            <span
              class="size-2 shrink-0 rounded-full opacity-70"
              :style="{ backgroundColor: row.topic.color }"
            />
            <span class="truncate">{{ row.topic.name }}</span>
            <span class="ml-auto shrink-0 tabular-nums text-muted">
              {{ hoursLabel(row.seconds) }}
            </span>
          </button>
        </div>

        <p
          v-else
          class="text-[13px] text-dimmed"
        >
          No sub-topics
        </p>
      </div>
    </div>
  </div>
</template>
