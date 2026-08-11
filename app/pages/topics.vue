<script setup lang="ts">
import type { Topic } from '~/types/database'
import type { TopicInput } from '~/composables/useTopics'

/**
 * Topic tree management. Everything the user needs to attribute a session
 * to a topic later on: create, edit, archive/restore, reorder within a
 * sibling group.
 *
 * A brand-new user lands here first (this and the profile page are the
 * only two things that produce useful data without a session), so the
 * empty state is deliberate and inviting, not a bare "no rows".
 */

definePageMeta({ middleware: 'auth' })

useSeoMeta({ title: 'Topics' })

const {
  active,
  archived,
  rollups,
  loading,
  error,
  loaded,
  load,
  create,
  update,
  archive,
  restore,
  descendantsOf
} = useTopics()

const toast = useToast()

// Modal state — one modal covers both create and edit; `editing` distinguishes.
const modalOpen = ref(false)
const editing = ref<Topic | null>(null)
const submitting = ref(false)
const showArchived = ref(false)

// Confirm-before-archive keeps history honest: the copy explains that
// archived topics keep their history and can be restored.
const archiveTarget = ref<Topic | null>(null)

onMounted(() => {
  if (!loaded.value) load()
})

function openCreate() {
  editing.value = null
  modalOpen.value = true
}

function openEdit(topic: Topic) {
  editing.value = topic
  modalOpen.value = true
}

/** Candidate parents: everything except self and descendants of self. */
const parentCandidates = computed<Topic[]>(() => {
  if (!editing.value) return active.value
  const blocked = descendantsOf(editing.value.id)
  return active.value.filter(t => !blocked.has(t.id))
})

/**
 * Sibling names in lower case for the client-side uniqueness check.
 * Parameterised on the parent id the form is currently pointing at, so
 * changing the parent in the form updates the validation set live.
 * The editing topic itself is excluded so a save that only touches
 * colour or description does not clash with its own name.
 */
function siblingNamesFor(parentId: string | null): ReadonlySet<string> {
  const excludeId = editing.value?.id ?? null
  const names = new Set<string>()
  for (const topic of active.value) {
    if (topic.parent_id === parentId && topic.id !== excludeId) {
      names.add(topic.name.toLowerCase())
    }
  }
  return names
}

async function onSubmit(payload: TopicInput) {
  submitting.value = true
  try {
    if (editing.value) {
      await update(editing.value.id, payload)
      toast.add({ title: 'Topic updated', color: 'success', icon: 'i-lucide-check' })
    } else {
      await create(payload)
      toast.add({ title: 'Topic created', color: 'success', icon: 'i-lucide-check' })
    }
    modalOpen.value = false
    editing.value = null
  } catch (err) {
    toast.add({
      title: 'Could not save topic',
      description: (err as Error).message,
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    submitting.value = false
  }
}

function confirmArchive(topic: Topic) {
  archiveTarget.value = topic
}

async function doArchive() {
  const topic = archiveTarget.value
  if (!topic) return
  try {
    await archive(topic.id)
    toast.add({ title: `Archived ${topic.name}`, color: 'success', icon: 'i-lucide-archive' })
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

async function doRestore(topic: Topic) {
  try {
    await restore(topic.id)
    toast.add({ title: `Restored ${topic.name}`, color: 'success', icon: 'i-lucide-rotate-ccw' })
  } catch (err) {
    toast.add({
      title: 'Could not restore',
      description: (err as Error).message,
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  }
}

// Manual reorder (`useTopics.move`) is intentionally absent: the 2a card grid
// has nowhere to put up/down controls. Cards still order by `position`, and
// `move` remains on the composable, so restoring it is a UI decision rather
// than a rewrite.

/**
 * FA-021 renders one card per TOP-LEVEL topic, with its children listed inside.
 * `v_topic_rollup` already sums descendants into a parent's total, so the card
 * grid shows every topic's time exactly once — listing children as cards too
 * would double-count the same hours on screen.
 */
const rootTopics = computed(() => active.value.filter(topic => topic.parent_id === null))

function childrenOf(parentId: string) {
  return active.value.filter(topic => topic.parent_id === parentId)
}

const initialLoad = computed(() => loading.value && !loaded.value)
const hasError = computed(() => !!error.value && !loading.value)
const isEmpty = computed(() => loaded.value && !error.value && active.value.length === 0 && archived.value.length === 0)
</script>

<template>
  <UContainer class="py-8 sm:py-10">
    <div class="flex min-h-[calc(100vh-8rem)] flex-col gap-6">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="font-display text-2xl font-semibold tracking-tight text-highlighted sm:text-[26px]">
            Topics
          </h1>
          <p class="mt-1.5 max-w-xl text-sm text-muted">
            Everything you track time against — a subject, a project, a book.
            Group related work under a parent to see combined totals.
          </p>
        </div>

        <UButton
          icon="i-lucide-plus"
          :disabled="loading"
          @click="openCreate"
        >
          New topic
        </UButton>
      </header>

      <div
        v-if="initialLoad"
        class="flex flex-col gap-2"
      >
        <USkeleton
          v-for="i in 3"
          :key="i"
          class="h-14 w-full rounded-lg"
        />
      </div>

      <UAlert
        v-else-if="hasError"
        color="error"
        variant="soft"
        icon="i-lucide-triangle-alert"
        title="We couldn't load your topics."
        :description="error ?? undefined"
        :actions="[{ label: 'Try again', color: 'error', variant: 'outline', onClick: () => load() }]"
      />

      <EmptyState
        v-else-if="isEmpty"
        icon="i-lucide-tags"
        title="Nothing to study yet"
        description="Add a topic — a class, a project, a book. That's how tutorex knows where your time is going."
        :action="{ label: 'New topic', icon: 'i-lucide-plus', onClick: openCreate }"
      />

      <template v-else>
        <!-- FA-021 — card grid. Three across on wide desktop, matching the
             design's `repeat(3,1fr)`; the sidebar takes 240px of the viewport,
             so the third column only earns its place at `xl`. -->
        <section
          class="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
          style="align-content: start"
        >
          <TopicCard
            v-for="topic in rootTopics"
            :key="topic.id"
            :topic="topic"
            :children="childrenOf(topic.id)"
            :rollups="rollups"
            @edit="openEdit"
            @archive="confirmArchive"
          />

          <!-- The dashed tile is the primary create affordance in this layout;
               the header button stays for when the grid is scrolled past. -->
          <button
            type="button"
            class="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-accented text-sm font-medium text-muted transition hover:border-primary hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            @click="openCreate"
          >
            <UIcon
              name="i-lucide-plus"
              class="size-5"
            />
            New topic
          </button>
        </section>

        <section
          v-if="archived.length > 0"
          class="mt-auto pt-2"
        >
          <button
            type="button"
            class="flex items-center gap-2 text-[13px] font-medium text-muted hover:text-highlighted transition"
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
              v-for="topic in archived"
              :key="topic.id"
              class="flex items-center gap-3 rounded-lg border border-default bg-elevated/20 px-3 py-2.5"
            >
              <div class="min-w-0 flex-1">
                <TopicBadge
                  :topic="topic"
                  muted
                />
              </div>
              <UButton
                icon="i-lucide-rotate-ccw"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="doRestore(topic)"
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
      :title="editing ? 'Edit topic' : 'New topic'"
      :ui="{ content: 'sm:max-w-lg' }"
    >
      <template #body>
        <TopicForm
          :key="editing?.id ?? 'new'"
          :topic="editing"
          :parents="parentCandidates"
          :sibling-names-for="siblingNamesFor"
          :submitting="submitting"
          @submit="onSubmit"
          @cancel="modalOpen = false"
        />
      </template>
    </UModal>

    <UModal
      :open="archiveTarget !== null"
      title="Archive this topic?"
      :ui="{ content: 'sm:max-w-md' }"
      @update:open="(v) => { if (!v) archiveTarget = null }"
    >
      <template #body>
        <p class="text-sm text-default">
          <strong>{{ archiveTarget?.name }}</strong> will be hidden from
          pickers, but every past session stays attributed to it and keeps
          counting in your stats. You can restore it anytime.
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
