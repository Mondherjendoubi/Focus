<script setup lang="ts">
import type { Topic } from '~/types/database'

/**
 * The idle state of the focus page. Because `sessions_one_active` allows
 * exactly one live session per user, there is exactly one Start affordance
 * on the whole screen - this component owns it, and the page never renders
 * it while a session is running.
 *
 * The topic picker is required in practice (a session without a topic
 * still records fine, but the whole app is organised around per-topic
 * time), so the field is present but non-blocking: an empty topic is
 * allowed and start_session accepts null. Archived topics never appear -
 * `useTopics.active` already excludes them.
 *
 * The template picker is optional and hides entirely when the user has
 * no templates yet, rather than showing an empty dropdown that looks
 * broken. When picked, the template's `default_topic_id` seeds the topic
 * field so the user doesn't have to pick both.
 *
 * Nothing here talks to Supabase for mutations. `start` emits and the
 * page calls `useActiveSession.startSession` - one path in, one place
 * that handles errors.
 *
 * v-model refs are `string | undefined` (not null) because that's what
 * USelectMenu expects. We coerce to null on emit — start_session on the
 * server treats null as "no topic / no template", which is what we want.
 */

interface TemplateOption {
  id: string
  name: string
  description: string | null
  is_favorite: boolean
  default_topic_id: string | null
  planned_focus_seconds: number
  block_count: number
}

interface TopicItem {
  label: string
  value: string
  color: string
  depth: number
  parentPath: string
}

interface TemplateItem {
  label: string
  value: string
  focusSeconds: number
  blocks: number
}

const props = defineProps<{
  topics: Topic[]
  templates: TemplateOption[]
  submitting?: boolean
}>()

const emit = defineEmits<{
  start: [payload: { topicId: string | null, templateId: string | null, title: string | null }]
}>()

const topicId = ref<string | undefined>(undefined)
const templateId = ref<string | undefined>(undefined)
const title = ref('')

// Order the flat topic list so each parent is immediately followed by its
// descendants. `depth` drives visual indentation and `parentPath` gives
// screen readers the hierarchy that colour indent alone would hide.
const topicItems = computed<TopicItem[]>(() => {
  const byParent = new Map<string | null, Topic[]>()
  for (const t of props.topics) {
    const list = byParent.get(t.parent_id) ?? []
    list.push(t)
    byParent.set(t.parent_id, list)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.position - b.position)
  }
  const out: TopicItem[] = []
  function walk(parentId: string | null, depth: number, path: string) {
    for (const t of byParent.get(parentId) ?? []) {
      out.push({ label: t.name, value: t.id, color: t.color, depth, parentPath: path })
      walk(t.id, depth + 1, path.length > 0 ? `${path} / ${t.name}` : t.name)
    }
  }
  walk(null, 0, '')
  return out
})

const templateItems = computed<TemplateItem[]>(() =>
  props.templates.map(t => ({
    label: t.name,
    value: t.id,
    focusSeconds: t.planned_focus_seconds,
    blocks: t.block_count
  }))
)

// Seed topic from the chosen template so a user doesn't have to pick both.
// Explicit change to the topic afterwards wins - we only auto-fill when
// the topic is still empty.
watch(templateId, (id) => {
  if (id === undefined) return
  const chosen = props.templates.find(t => t.id === id)
  if (chosen?.default_topic_id && topicId.value === undefined) {
    topicId.value = chosen.default_topic_id
  }
})

function selectedTopicColor(): string | null {
  const t = props.topics.find(t => t.id === topicId.value)
  return t?.color ?? null
}

function onSubmit() {
  emit('start', {
    topicId: topicId.value ?? null,
    templateId: templateId.value ?? null,
    title: title.value.trim().length > 0 ? title.value.trim() : null
  })
}
</script>

<template>
  <UCard :ui="{ body: 'sm:p-8' }">
    <form
      class="flex flex-col gap-6"
      @submit.prevent="onSubmit"
    >
      <div class="flex flex-col items-center gap-2 text-center">
        <div class="rounded-full bg-primary/10 p-3">
          <UIcon
            name="i-lucide-timer"
            class="size-8 text-primary"
          />
        </div>
        <h1 class="text-2xl font-semibold text-highlighted sm:text-3xl">
          Ready to focus?
        </h1>
        <p class="text-sm text-muted max-w-md">
          Pick a topic and start. You can add breaks or a title as you go -
          none of it is required to begin.
        </p>
      </div>

      <div class="flex flex-col gap-4">
        <UFormField
          label="Topic"
          name="topic"
          :hint="topics.length === 0 ? 'You have no topics yet' : 'Optional - leave empty to attribute later'"
        >
          <USelectMenu
            v-model="topicId"
            :items="topicItems"
            value-key="value"
            placeholder="No topic"
            searchable
            :disabled="topics.length === 0"
            class="w-full"
          >
            <template #leading>
              <span
                v-if="selectedTopicColor()"
                class="inline-block size-3 rounded-full ring-1 ring-inset ring-black/5 dark:ring-white/10"
                :style="{ backgroundColor: selectedTopicColor()! }"
                aria-hidden="true"
              />
              <UIcon
                v-else
                name="i-lucide-tag"
                class="size-4 text-muted"
              />
            </template>
            <template #item="{ item }">
              <div
                class="flex items-center gap-2"
                :style="{ paddingInlineStart: `${(item as TopicItem).depth * 14}px` }"
                :aria-label="(item as TopicItem).parentPath.length > 0
                  ? `${(item as TopicItem).label}, under ${(item as TopicItem).parentPath}`
                  : (item as TopicItem).label"
              >
                <span
                  v-if="(item as TopicItem).depth > 0"
                  class="text-muted text-xs leading-none"
                  aria-hidden="true"
                >↳</span>
                <span
                  class="inline-block size-3 rounded-full ring-1 ring-inset ring-black/5 dark:ring-white/10"
                  :style="{ backgroundColor: (item as TopicItem).color }"
                  aria-hidden="true"
                />
                <span>{{ (item as TopicItem).label }}</span>
              </div>
            </template>
          </USelectMenu>
        </UFormField>

        <UFormField
          v-if="templates.length > 0"
          label="Template"
          name="template"
          hint="Optional - reuse a saved plan"
        >
          <USelectMenu
            v-model="templateId"
            :items="templateItems"
            value-key="value"
            placeholder="No template"
            class="w-full"
          >
            <template #leading>
              <UIcon
                name="i-lucide-list-checks"
                class="size-4 text-muted"
              />
            </template>
            <template #item="{ item }">
              <div class="flex w-full items-center justify-between gap-3">
                <span class="truncate">{{ (item as TemplateItem).label }}</span>
                <span class="text-xs text-muted tabular-nums shrink-0">
                  {{ formatDuration((item as TemplateItem).focusSeconds) }}
                  &middot; {{ (item as TemplateItem).blocks }} blocks
                </span>
              </div>
            </template>
          </USelectMenu>
        </UFormField>

        <UFormField
          label="Title"
          name="title"
          hint="Optional - a note about what you are working on"
        >
          <UInput
            v-model="title"
            placeholder="e.g. Rewrite chapter 3"
            :maxlength="200"
            class="w-full"
          />
        </UFormField>
      </div>

      <UButton
        type="submit"
        size="xl"
        icon="i-lucide-play"
        :loading="submitting"
        :disabled="submitting"
        block
        :ui="{ base: 'rounded-full transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0' }"
      >
        Start focusing
      </UButton>
    </form>
  </UCard>
</template>
