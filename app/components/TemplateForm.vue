<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import type { Topic } from '~/types/database'
import type { BlockDraft, TemplateInput, TemplateWithBlocks } from '~/composables/useTemplates'

/**
 * Create / edit a session template.
 *
 * The form is the conversion boundary for durations: users enter MINUTES,
 * the composable stores `planned_seconds`. Zero-minute blocks are rejected
 * here so the database never has to raise `planned_seconds > 0` as a raw
 * error the user has to decode.
 *
 * Name uniqueness (`unique (user_id, name)`) is checked client-side against
 * the sibling set the page passes in; the composable still handles the
 * 23505 race on write.
 */

const props = defineProps<{
  /** Existing template + its blocks when editing; `null` when creating. */
  template: TemplateWithBlocks | null
  topics: Topic[]
  /** Lowercased template names already in use, excluding this one. */
  existingNames: ReadonlySet<string>
  submitting: boolean
}>()

const emit = defineEmits<{
  submit: [payload: { template: TemplateInput, blocks: BlockDraft[] }]
  cancel: []
}>()

const NO_TOPIC = '__none__'

function toTopicValue(id: string | null): string {
  return id ?? NO_TOPIC
}

function fromTopicValue(value: string): string | null {
  return value === NO_TOPIC ? null : value
}

/**
 * Seed the block editor from the existing template if editing, converting
 * `planned_seconds` back to minutes. Round to nearest — legacy data with
 * odd second counts renders as the closest whole minute rather than a
 * decimal that would confuse the input.
 */
function seedBlocks(): BlockDraft[] {
  if (!props.template) return []
  return props.template.session_template_blocks.map(block => ({
    kind: block.kind,
    minutes: Math.max(1, Math.round(block.planned_seconds / 60)),
    topic_id: block.topic_id,
    label: block.label
  }))
}

const state = reactive({
  name: props.template?.name ?? '',
  description: props.template?.description ?? '',
  defaultTopicValue: toTopicValue(props.template?.default_topic_id ?? null),
  isFavorite: props.template?.is_favorite ?? false
})

const blocks = ref<BlockDraft[]>(seedBlocks())

const topicOptions = computed(() => [
  { label: 'No default topic', value: NO_TOPIC },
  ...props.topics.map(t => ({ label: t.name, value: t.id }))
])

/**
 * Live totals mirrored from `v_template_totals`:
 *   block_count            = length
 *   planned_seconds        = sum of every block
 *   planned_focus_seconds  = sum of focus blocks only (what the user cares about)
 */
const totals = computed(() => {
  let count = 0
  let totalSeconds = 0
  let focusSeconds = 0
  for (const block of blocks.value) {
    const seconds = Math.max(0, Math.round(block.minutes * 60))
    count += 1
    totalSeconds += seconds
    if (block.kind === 'focus') focusSeconds += seconds
  }
  return { count, totalSeconds, focusSeconds }
})

function validate(data: typeof state): FormError[] {
  const errors: FormError[] = []
  const trimmed = data.name.trim()

  if (trimmed.length === 0) {
    errors.push({ name: 'name', message: 'Name is required.' })
  } else if (props.existingNames.has(trimmed.toLowerCase())) {
    errors.push({ name: 'name', message: 'You already have a template with that name.' })
  }

  if (blocks.value.length === 0) {
    errors.push({ name: 'blocks', message: 'Add at least one block.' })
  } else if (blocks.value.some(b => !Number.isFinite(b.minutes) || b.minutes < 1)) {
    // The DB enforces planned_seconds > 0 — catching it here means the user
    // sees a form-level message instead of a raw constraint violation.
    errors.push({ name: 'blocks', message: 'Every block must be at least 1 minute.' })
  }

  return errors
}

function onSubmit(_event: FormSubmitEvent<typeof state>) {
  const description = state.description.trim()
  emit('submit', {
    template: {
      name: state.name.trim(),
      description: description.length > 0 ? description : null,
      default_topic_id: fromTopicValue(state.defaultTopicValue),
      is_favorite: state.isFavorite
    },
    blocks: blocks.value.map(b => ({
      kind: b.kind,
      minutes: Math.max(1, Math.round(b.minutes)),
      topic_id: b.topic_id,
      label: b.label && b.label.trim().length > 0 ? b.label.trim() : null
    }))
  })
}
</script>

<template>
  <UForm
    :state="state"
    :validate="validate"
    class="flex flex-col gap-5"
    @submit="onSubmit"
  >
    <UFormField
      label="Name"
      name="name"
      required
    >
      <UInput
        v-model="state.name"
        placeholder='e.g. Pomodoro ×4, Deep Work 90'
        :disabled="submitting"
        class="w-full"
        autofocus
      />
    </UFormField>

    <UFormField
      label="Description"
      name="description"
      help="Optional. Reminders about how this template is meant to be used."
    >
      <UTextarea
        v-model="state.description"
        :rows="2"
        :disabled="submitting"
        class="w-full"
      />
    </UFormField>

    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField
        label="Default topic"
        name="defaultTopicValue"
        help="Pre-selected when starting a session from this template."
      >
        <USelect
          v-model="state.defaultTopicValue"
          :items="topicOptions"
          value-key="value"
          :disabled="submitting"
          class="w-full"
        />
      </UFormField>

      <UFormField
        label="Favourite"
        name="isFavorite"
        help="Favourites appear at the top of the picker."
      >
        <div class="flex h-9 items-center">
          <USwitch
            v-model="state.isFavorite"
            :disabled="submitting"
          />
        </div>
      </UFormField>
    </div>

    <div>
      <div class="mb-2 flex items-baseline justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold text-highlighted">
            Blocks
          </h3>
          <p class="text-xs text-muted">
            The ordered steps the timer walks through.
          </p>
        </div>
        <div class="text-xs text-muted tabular-nums text-right">
          <div>{{ totals.count }} {{ totals.count === 1 ? 'block' : 'blocks' }}</div>
          <div>
            <span class="text-highlighted font-medium">{{ formatDuration(totals.focusSeconds) }}</span>
            <span class="text-muted"> focus / {{ formatDuration(totals.totalSeconds) }} total</span>
          </div>
        </div>
      </div>

      <UFormField
        name="blocks"
      >
        <TemplateBlockEditor
          v-model="blocks"
          :topics="topics"
          :disabled="submitting"
        />
      </UFormField>
    </div>

    <div class="flex justify-end gap-2 pt-2">
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        :disabled="submitting"
        @click="emit('cancel')"
      >
        Cancel
      </UButton>
      <UButton
        type="submit"
        :loading="submitting"
        :disabled="submitting"
        icon="i-lucide-check"
      >
        {{ template ? 'Save changes' : 'Create template' }}
      </UButton>
    </div>
  </UForm>
</template>
