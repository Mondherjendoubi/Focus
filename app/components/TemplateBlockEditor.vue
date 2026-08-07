<script setup lang="ts">
import type { BlockKind } from '~/types/database'
import type { BlockDraft } from '~/composables/useTemplates'

/**
 * Editable list of template blocks — one row per step.
 *
 * Durations are entered in MINUTES here and everywhere in the form; the
 * composable converts to `planned_seconds` once at write time. The unique
 * `(template_id, position)` index means positions must always be a
 * contiguous 0..N-1 sequence: reorders swap array items, never persist
 * intermediate values.
 *
 * The parent decides whether a zero-minute row is valid before it lets
 * this component submit; this component treats `minutes = 0` as invalid
 * for visual feedback but does not block the model — that keeps the form
 * validator the single source of truth.
 */

const props = defineProps<{
  modelValue: BlockDraft[]
  topics: { id: string, name: string, color: string }[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [blocks: BlockDraft[]]
}>()

/**
 * Reka Select rejects `null` values; represent "inherit from session" as
 * a sentinel string and translate at the read/write boundaries.
 */
const INHERIT = '__inherit__'

const KIND_OPTIONS: { label: string, value: BlockKind }[] = [
  { label: 'Focus', value: 'focus' },
  { label: 'Short break', value: 'short_break' },
  { label: 'Long break', value: 'long_break' }
]

const topicOptions = computed(() => [
  { label: 'Inherit from session', value: INHERIT },
  ...props.topics.map(t => ({ label: t.name, value: t.id }))
])

function toTopicValue(id: string | null): string {
  return id ?? INHERIT
}

function fromTopicValue(value: string): string | null {
  return value === INHERIT ? null : value
}

/** Emit a fresh array so the parent's watchers see a new reference. */
function commit(next: BlockDraft[]) {
  emit('update:modelValue', [...next])
}

function updateBlock(index: number, patch: Partial<BlockDraft>) {
  const next = props.modelValue.map((block, i) => i === index ? { ...block, ...patch } : block)
  commit(next)
}

function removeBlock(index: number) {
  const next = props.modelValue.filter((_, i) => i !== index)
  commit(next)
}

function moveBlock(index: number, direction: 'up' | 'down') {
  const swapIndex = direction === 'up' ? index - 1 : index + 1
  if (swapIndex < 0 || swapIndex >= props.modelValue.length) return
  const next = [...props.modelValue]
  const a = next[index]!
  const b = next[swapIndex]!
  next[index] = b
  next[swapIndex] = a
  commit(next)
}

function addBlock(kind: BlockKind = 'focus', minutes = 25) {
  commit([
    ...props.modelValue,
    { kind, minutes, topic_id: null, label: null }
  ])
}

/**
 * "Pomodoro ×4": focus 25 → short 5 → focus 25 → short 5 → focus 25 →
 * short 5 → focus 25 → long 15. The shape most users reach for; hand-
 * assembling it is tedious enough that it earns a button.
 */
function addPomodoroFour() {
  const blocks: BlockDraft[] = []
  for (let i = 0; i < 4; i++) {
    blocks.push({ kind: 'focus', minutes: 25, topic_id: null, label: null })
    if (i < 3) {
      blocks.push({ kind: 'short_break', minutes: 5, topic_id: null, label: null })
    }
  }
  blocks.push({ kind: 'long_break', minutes: 15, topic_id: null, label: null })
  commit([...props.modelValue, ...blocks])
}

function kindIcon(kind: BlockKind): string {
  if (kind === 'focus') return 'i-lucide-target'
  if (kind === 'short_break') return 'i-lucide-coffee'
  return 'i-lucide-bed'
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      v-if="modelValue.length === 0"
      class="rounded-lg border border-dashed border-default px-4 py-6 text-sm text-muted text-center"
    >
      No blocks yet. Add a focus block to get started, or use the Pomodoro preset.
    </div>

    <ul
      v-else
      class="flex flex-col gap-2"
    >
      <li
        v-for="(block, index) in modelValue"
        :key="index"
        class="rounded-lg border border-default bg-elevated/40 p-3"
      >
        <div class="flex flex-wrap items-start gap-2">
          <span class="inline-flex items-center justify-center size-8 rounded-md bg-elevated text-xs font-mono text-muted tabular-nums shrink-0">
            {{ index + 1 }}
          </span>

          <UFormField
            :label="'Kind'"
            :ui="{ label: 'sr-only' }"
            class="w-32 shrink-0"
          >
            <USelect
              :model-value="block.kind"
              :items="KIND_OPTIONS"
              value-key="value"
              :icon="kindIcon(block.kind)"
              :disabled="disabled"
              class="w-full"
              @update:model-value="(v: BlockKind) => updateBlock(index, { kind: v })"
            />
          </UFormField>

          <UFormField
            :label="'Minutes'"
            :ui="{ label: 'sr-only' }"
            class="w-24 shrink-0"
            :error="block.minutes < 1 ? 'Min 1' : undefined"
          >
            <UInput
              :model-value="block.minutes"
              type="number"
              :min="1"
              :max="600"
              :step="1"
              :disabled="disabled"
              class="w-full"
              trailing
              @update:model-value="(v: string | number) => updateBlock(index, { minutes: Number(v) || 0 })"
            >
              <template #trailing>
                <span class="text-xs text-muted">min</span>
              </template>
            </UInput>
          </UFormField>

          <UFormField
            :label="'Topic'"
            :ui="{ label: 'sr-only' }"
            class="flex-1 min-w-40"
          >
            <USelect
              :model-value="toTopicValue(block.topic_id)"
              :items="topicOptions"
              value-key="value"
              :disabled="disabled"
              class="w-full"
              @update:model-value="(v: string) => updateBlock(index, { topic_id: fromTopicValue(v) })"
            />
          </UFormField>

          <div class="flex items-center gap-0.5 shrink-0">
            <UButton
              icon="i-lucide-chevron-up"
              color="neutral"
              variant="ghost"
              size="sm"
              aria-label="Move up"
              :disabled="disabled || index === 0"
              @click="moveBlock(index, 'up')"
            />
            <UButton
              icon="i-lucide-chevron-down"
              color="neutral"
              variant="ghost"
              size="sm"
              aria-label="Move down"
              :disabled="disabled || index === modelValue.length - 1"
              @click="moveBlock(index, 'down')"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="sm"
              aria-label="Remove block"
              :disabled="disabled"
              @click="removeBlock(index)"
            />
          </div>
        </div>

        <UFormField
          :label="'Label'"
          :ui="{ label: 'sr-only' }"
          class="mt-2"
        >
          <UInput
            :model-value="block.label ?? ''"
            placeholder="Optional label — shown during the block"
            :disabled="disabled"
            class="w-full"
            size="sm"
            @update:model-value="(v: string | number) => updateBlock(index, { label: String(v).trim().length > 0 ? String(v) : null })"
          />
        </UFormField>
      </li>
    </ul>

    <div class="flex flex-wrap gap-2 pt-1">
      <UButton
        icon="i-lucide-plus"
        color="neutral"
        variant="outline"
        size="sm"
        :disabled="disabled"
        @click="addBlock('focus', 25)"
      >
        Add focus
      </UButton>
      <UButton
        icon="i-lucide-plus"
        color="neutral"
        variant="outline"
        size="sm"
        :disabled="disabled"
        @click="addBlock('short_break', 5)"
      >
        Add short break
      </UButton>
      <UButton
        icon="i-lucide-plus"
        color="neutral"
        variant="outline"
        size="sm"
        :disabled="disabled"
        @click="addBlock('long_break', 15)"
      >
        Add long break
      </UButton>
      <UButton
        icon="i-lucide-sparkles"
        color="primary"
        variant="soft"
        size="sm"
        :disabled="disabled"
        @click="addPomodoroFour"
      >
        Pomodoro ×4
      </UButton>
    </div>
  </div>
</template>
