<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import type { Topic } from '~/types/database'
import type { TopicInput } from '~/composables/useTopics'

/**
 * Create / edit a topic. Validates every DB constraint the user can trip:
 *   - name is required and non-whitespace, unique within the sibling group
 *   - color matches `#rrggbb` (native <input type="color"> already does)
 *   - icon, if given, starts with `i-lucide-` (any other prefix renders blank)
 *   - parent cannot be self or any descendant (would violate check_topic_cycle)
 *
 * The parent list is passed pre-filtered by the page. The sibling-name lookup
 * is a function rather than a fixed set because the answer depends on the
 * parent the user is picking *right now* in this form, which the page cannot
 * know without leaking the form state upward.
 */

const props = defineProps<{
  /** Existing topic when editing; `null` when creating. */
  topic: Topic | null
  /** Candidate parents, already filtered to exclude self + descendants. */
  parents: Topic[]
  /** Lowercased sibling names for the given parent, excluding this topic. */
  siblingNamesFor: (parentId: string | null) => ReadonlySet<string>
  /** Bubbles pending state from the page so buttons disable during save. */
  submitting: boolean
}>()

const emit = defineEmits<{
  submit: [payload: TopicInput]
  cancel: []
}>()

const PRESET_COLORS = [
  '#00c16a',
  '#0ea5e9',
  '#8b5cf6',
  '#ec4899',
  '#f97316',
  '#eab308',
  '#14b8a6',
  '#6366f1',
  '#ef4444',
  '#64748b'
]

/**
 * Reka Select (the primitive under USelect) rejects `null` as an option value —
 * every item must be a string. Represent "no parent" as an internal sentinel
 * and translate at the read/write boundaries.
 */
const NO_PARENT = '__none__'

function toParentValue(id: string | null): string {
  return id ?? NO_PARENT
}

function fromParentValue(value: string): string | null {
  return value === NO_PARENT ? null : value
}

const state = reactive({
  name: props.topic?.name ?? '',
  color: props.topic?.color ?? PRESET_COLORS[0]!,
  icon: props.topic?.icon ?? '',
  parentValue: toParentValue(props.topic?.parent_id ?? null),
  description: props.topic?.description ?? ''
})

const parentOptions = computed(() => [
  { label: 'No parent (top level)', value: NO_PARENT },
  ...props.parents.map(p => ({ label: p.name, value: p.id }))
])

/** Same test the DB check constraint uses; case-insensitive. */
const COLOR_RE = /^#[0-9a-f]{6}$/i
/** Blank square in the UI when this fails, hence the guard. */
const ICON_RE = /^i-lucide-[a-z0-9-]+$/

function validate(data: typeof state): FormError[] {
  const errors: FormError[] = []
  const trimmed = data.name.trim()

  if (trimmed.length === 0) {
    errors.push({ name: 'name', message: 'Name is required.' })
  } else if (props.siblingNamesFor(fromParentValue(data.parentValue)).has(trimmed.toLowerCase())) {
    errors.push({ name: 'name', message: 'A topic with that name already exists under this parent.' })
  }

  if (!COLOR_RE.test(data.color)) {
    errors.push({ name: 'color', message: 'Colour must be a #rrggbb value.' })
  }

  const icon = data.icon.trim()
  if (icon.length > 0 && !ICON_RE.test(icon)) {
    errors.push({ name: 'icon', message: 'Icon must start with "i-lucide-" (only Lucide icons are installed).' })
  }

  return errors
}

function onSubmit(event: FormSubmitEvent<typeof state>) {
  const data = event.data
  const icon = data.icon.trim()
  const description = data.description.trim()
  emit('submit', {
    name: data.name.trim(),
    color: data.color.toLowerCase(),
    icon: icon.length > 0 ? icon : null,
    parent_id: fromParentValue(data.parentValue),
    description: description.length > 0 ? description : null
  })
}

const previewTopic = computed(() => ({
  name: state.name.trim().length > 0 ? state.name.trim() : 'New topic',
  color: COLOR_RE.test(state.color) ? state.color : PRESET_COLORS[0]!,
  icon: ICON_RE.test(state.icon.trim()) ? state.icon.trim() : null
}))
</script>

<template>
  <UForm
    :state="state"
    :validate="validate"
    class="flex flex-col gap-5"
    @submit="onSubmit"
  >
    <div class="rounded-lg border border-default bg-elevated/50 px-3 py-2">
      <TopicBadge :topic="previewTopic" />
    </div>

    <UFormField
      label="Name"
      name="name"
      required
    >
      <UInput
        v-model="state.name"
        placeholder="e.g. Data Structures"
        :disabled="submitting"
        class="w-full"
        autofocus
      />
    </UFormField>

    <UFormField
      label="Parent"
      name="parentValue"
      help="Group this topic under an existing one, or leave at top level."
    >
      <USelect
        v-model="state.parentValue"
        :items="parentOptions"
        value-key="value"
        :disabled="submitting"
        class="w-full"
      />
    </UFormField>

    <UFormField
      label="Colour"
      name="color"
      help="Used as a tag next to sessions attributed to this topic."
    >
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="preset in PRESET_COLORS"
          :key="preset"
          type="button"
          class="size-7 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15 transition hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="state.color.toLowerCase() === preset ? 'ring-2 ring-primary' : ''"
          :style="{ backgroundColor: preset }"
          :aria-label="`Use colour ${preset}`"
          :disabled="submitting"
          @click="state.color = preset"
        />
        <label class="inline-flex items-center gap-2 rounded-md border border-default bg-default px-2 py-1 text-sm text-muted cursor-pointer">
          <input
            v-model="state.color"
            type="color"
            class="size-6 cursor-pointer bg-transparent p-0 border-0"
            :disabled="submitting"
            aria-label="Custom colour"
          >
          <span class="font-mono uppercase">{{ state.color }}</span>
        </label>
      </div>
    </UFormField>

    <UFormField
      label="Icon"
      name="icon"
      help='Optional. Lucide icon name, e.g. "i-lucide-book-open".'
    >
      <UInput
        v-model="state.icon"
        placeholder="i-lucide-book-open"
        :disabled="submitting"
        class="w-full"
      />
    </UFormField>

    <UFormField
      label="Description"
      name="description"
      help="Optional notes for yourself."
    >
      <UTextarea
        v-model="state.description"
        :rows="3"
        :disabled="submitting"
        class="w-full"
      />
    </UFormField>

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
        {{ topic ? 'Save changes' : 'Create topic' }}
      </UButton>
    </div>
  </UForm>
</template>

