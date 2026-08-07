<script setup lang="ts">
import type { SessionTemplate, SessionTemplateBlock } from '~/types/database'
import type { TemplateWithBlocks } from '~/composables/useTemplates'

/**
 * Session templates: reusable focus plans the timer can walk through.
 *
 * The page hands the composable off to the form / editor components; its
 * job is to arrange states (loading / error / empty / list) and to keep
 * the list of existing names in sync with the current edit target for
 * the client-side uniqueness check.
 */

definePageMeta({ middleware: 'auth' })

useSeoMeta({ title: 'Templates' })

const {
  active,
  archived,
  totals,
  loading,
  error,
  loaded,
  load,
  create,
  update,
  archive,
  restore,
  toggleFavorite
} = useTemplates()

const {
  active: topics,
  loaded: topicsLoaded,
  load: loadTopics
} = useTopics()

const toast = useToast()

const modalOpen = ref(false)
const editing = ref<TemplateWithBlocks | null>(null)
const submitting = ref(false)
const showArchived = ref(false)
const archiveTarget = ref<SessionTemplate | null>(null)

onMounted(() => {
  if (!loaded.value) load()
  if (!topicsLoaded.value) loadTopics()
})

function openCreate() {
  editing.value = null
  modalOpen.value = true
}

function openEdit(template: TemplateWithBlocks) {
  editing.value = template
  modalOpen.value = true
}

/** Case-insensitive name set, minus the template being edited. */
const existingNames = computed<ReadonlySet<string>>(() => {
  const excludeId = editing.value?.id ?? null
  const names = new Set<string>()
  for (const template of active.value) {
    if (template.id !== excludeId) names.add(template.name.toLowerCase())
  }
  for (const template of archived.value) {
    if (template.id !== excludeId) names.add(template.name.toLowerCase())
  }
  return names
})

async function onSubmit(payload: { template: Parameters<typeof create>[0], blocks: Parameters<typeof create>[1] }) {
  submitting.value = true
  try {
    if (editing.value) {
      await update(editing.value.id, payload.template, payload.blocks)
      toast.add({ title: 'Template updated', color: 'success', icon: 'i-lucide-check' })
    } else {
      await create(payload.template, payload.blocks)
      toast.add({ title: 'Template created', color: 'success', icon: 'i-lucide-check' })
    }
    modalOpen.value = false
    editing.value = null
  } catch (err) {
    toast.add({
      title: 'Could not save template',
      description: (err as Error).message,
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    submitting.value = false
  }
}

function confirmArchive(template: SessionTemplate) {
  archiveTarget.value = template
}

async function doArchive() {
  const template = archiveTarget.value
  if (!template) return
  try {
    await archive(template.id)
    toast.add({ title: `Archived ${template.name}`, color: 'success', icon: 'i-lucide-archive' })
  } catch (err) {
    toast.add({
      title: 'Could not archive',
      description: (err as Error).message,
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    archiveTarget.value = null
  }
}

async function doRestore(template: SessionTemplate) {
  try {
    await restore(template.id)
    toast.add({ title: `Restored ${template.name}`, color: 'success', icon: 'i-lucide-rotate-ccw' })
  } catch (err) {
    toast.add({
      title: 'Could not restore',
      description: (err as Error).message,
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  }
}

async function onToggleFavorite(template: SessionTemplate) {
  try {
    await toggleFavorite(template.id, !template.is_favorite)
  } catch (err) {
    toast.add({
      title: 'Could not update favourite',
      description: (err as Error).message,
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  }
}

/** Small helpers used only for rendering the block preview strip. */
function kindColor(kind: SessionTemplateBlock['kind']): string {
  if (kind === 'focus') return 'bg-primary/70'
  if (kind === 'short_break') return 'bg-info/60'
  return 'bg-warning/60'
}

function kindLabel(kind: SessionTemplateBlock['kind']): string {
  if (kind === 'focus') return 'Focus'
  if (kind === 'short_break') return 'Short break'
  return 'Long break'
}

/** Topic name by id, for the "default topic" chip on each card. */
const topicNameById = computed<Map<string, string>>(() => {
  const map = new Map<string, string>()
  for (const topic of topics.value) map.set(topic.id, topic.name)
  return map
})

const initialLoad = computed(() => loading.value && !loaded.value)
const hasError = computed(() => !!error.value && !loading.value)
const isEmpty = computed(() => loaded.value && !error.value && active.value.length === 0 && archived.value.length === 0)
</script>

<template>
  <UContainer class="py-8 sm:py-10">
    <div class="flex flex-col gap-6">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl sm:text-3xl font-semibold text-highlighted">
            Templates
          </h1>
          <p class="mt-1 text-sm text-muted max-w-xl">
            Reusable session plans — the ordered list of focus and break
            blocks the timer walks through. Build one for the shape of study
            you keep coming back to.
          </p>
        </div>

        <UButton
          icon="i-lucide-plus"
          :disabled="loading"
          @click="openCreate"
        >
          New template
        </UButton>
      </header>

      <div
        v-if="initialLoad"
        class="flex flex-col gap-2"
      >
        <USkeleton
          v-for="i in 3"
          :key="i"
          class="h-28 w-full rounded-lg"
        />
      </div>

      <UAlert
        v-else-if="hasError"
        color="error"
        variant="soft"
        icon="i-lucide-triangle-alert"
        title="We couldn't load your templates."
        :description="error ?? undefined"
        :actions="[{ label: 'Try again', color: 'error', variant: 'outline', onClick: () => load() }]"
      />

      <EmptyState
        v-else-if="isEmpty"
        icon="i-lucide-layout-template"
        title="No templates yet"
        description="A template is a plan you reuse — Pomodoro ×4, Deep Work 90. Build one once, start it in one tap."
        :action="{ label: 'New template', icon: 'i-lucide-plus', onClick: openCreate }"
      />

      <template v-else>
        <section
          v-if="active.length > 0"
          class="flex flex-col gap-3"
        >
          <div
            v-for="template in active"
            :key="template.id"
            class="rounded-lg border border-default bg-elevated/40 p-4 transition hover:bg-elevated"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="rounded p-1 -m-1 text-muted transition hover:text-warning focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    :class="template.is_favorite ? 'text-warning' : ''"
                    :aria-label="template.is_favorite ? 'Remove from favourites' : 'Mark as favourite'"
                    :aria-pressed="template.is_favorite"
                    @click="onToggleFavorite(template)"
                  >
                    <UIcon
                      :name="template.is_favorite ? 'i-lucide-star' : 'i-lucide-star'"
                      class="size-4"
                      :class="template.is_favorite ? 'fill-current' : ''"
                    />
                  </button>
                  <h2 class="text-base font-semibold text-highlighted truncate">
                    {{ template.name }}
                  </h2>
                  <span
                    v-if="template.default_topic_id && topicNameById.get(template.default_topic_id)"
                    class="hidden sm:inline text-xs text-muted"
                  >
                    · {{ topicNameById.get(template.default_topic_id) }}
                  </span>
                </div>

                <p
                  v-if="template.description"
                  class="mt-1 text-sm text-muted"
                >
                  {{ template.description }}
                </p>

                <dl class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted tabular-nums">
                  <div class="flex items-center gap-1">
                    <dt class="sr-only">Blocks</dt>
                    <dd>{{ totals.get(template.id)?.block_count ?? 0 }} blocks</dd>
                  </div>
                  <div class="flex items-center gap-1">
                    <dt class="sr-only">Focus time</dt>
                    <dd>
                      <span class="text-highlighted font-medium">{{ formatDuration(totals.get(template.id)?.planned_focus_seconds ?? 0) }}</span>
                      focus
                    </dd>
                  </div>
                  <div class="flex items-center gap-1">
                    <dt class="sr-only">Total time</dt>
                    <dd>{{ formatDuration(totals.get(template.id)?.planned_seconds ?? 0) }} total</dd>
                  </div>
                </dl>
              </div>

              <div class="flex items-center gap-0.5 shrink-0">
                <UButton
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  aria-label="Edit template"
                  @click="openEdit(template)"
                />
                <UButton
                  icon="i-lucide-archive"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  aria-label="Archive template"
                  @click="confirmArchive(template)"
                />
              </div>
            </div>

            <div
              v-if="template.session_template_blocks.length > 0"
              class="mt-3 flex flex-wrap items-center gap-1"
              role="list"
              aria-label="Block sequence"
            >
              <span
                v-for="block in template.session_template_blocks"
                :key="block.id"
                role="listitem"
                class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-white/95"
                :class="kindColor(block.kind)"
                :title="`${kindLabel(block.kind)} · ${formatDuration(block.planned_seconds)}`"
              >
                <span class="font-medium">{{ formatDuration(block.planned_seconds) }}</span>
                <span class="sr-only">{{ kindLabel(block.kind) }}</span>
              </span>
            </div>
            <p
              v-else
              class="mt-3 text-xs text-muted italic"
            >
              No blocks yet — edit to add one.
            </p>
          </div>
        </section>

        <section
          v-if="archived.length > 0"
          class="mt-4"
        >
          <button
            type="button"
            class="flex items-center gap-2 text-sm font-medium text-muted hover:text-highlighted transition"
            :aria-expanded="showArchived"
            @click="showArchived = !showArchived"
          >
            <UIcon
              :name="showArchived ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
              class="size-4"
            />
            <span>Archived ({{ archived.length }})</span>
          </button>

          <ul
            v-if="showArchived"
            class="mt-3 flex flex-col gap-2"
          >
            <li
              v-for="template in archived"
              :key="template.id"
              class="flex items-center gap-3 rounded-lg border border-default bg-elevated/20 px-3 py-2.5"
            >
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-muted truncate">
                  {{ template.name }}
                </p>
              </div>
              <UButton
                icon="i-lucide-rotate-ccw"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="doRestore(template)"
              >
                Restore
              </UButton>
            </li>
          </ul>
        </section>
      </template>
    </div>

    <UModal
      v-model:open="modalOpen"
      :title="editing ? 'Edit template' : 'New template'"
      :ui="{ content: 'sm:max-w-2xl' }"
    >
      <template #body>
        <TemplateForm
          :key="editing?.id ?? 'new'"
          :template="editing"
          :topics="topics"
          :existing-names="existingNames"
          :submitting="submitting"
          @submit="onSubmit"
          @cancel="modalOpen = false"
        />
      </template>
    </UModal>

    <UModal
      :open="archiveTarget !== null"
      title="Archive this template?"
      :ui="{ content: 'sm:max-w-md' }"
      @update:open="(v) => { if (!v) archiveTarget = null }"
    >
      <template #body>
        <p class="text-sm text-default">
          <strong>{{ archiveTarget?.name }}</strong> will be hidden from
          the template picker. Every past session that used it stays
          attributed to it and still counts toward adherence. You can
          restore it anytime.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            @click="archiveTarget = null"
          >
            Cancel
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-archive"
            @click="doArchive"
          >
            Archive
          </UButton>
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
