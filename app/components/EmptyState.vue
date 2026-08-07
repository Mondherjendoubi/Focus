<script setup lang="ts">
/**
 * The one, shared empty-state component. Every "no rows yet" surface uses
 * this — the ticket's rule is "not six variants". Deliberately dumb: takes
 * the icon, the copy, and an optional action; renders a consistent
 * icon-in-a-tinted-circle + heading + description + button block.
 *
 * IMPORTANT: this is only for the "empty" branch. Error and loading states
 * live outside it. RLS returns `[]` for both errored and genuinely-empty
 * queries; a caller MUST gate rendering on `error === null` before showing
 * this, or a returning user with real history sees "no data" on a failed
 * fetch — this app's worst failure mode.
 *
 * Two ways to trigger the action: pass an `action.to` (router link) or an
 * `action.onClick` (in-page handler). If both are supplied, `to` wins,
 * because navigating away is the safer default.
 */

interface EmptyStateAction {
  label: string
  icon?: string
  to?: string
  onClick?: () => void
}

interface Props {
  icon: string
  title: string
  description?: string
  action?: EmptyStateAction
  /**
   * Visual variant. `card` wraps in a UCard for standalone pages; `bare`
   * renders the same content without the card, for callers that already
   * live inside one (dashboard section, chart body).
   */
  variant?: 'card' | 'bare'
}

const props = withDefaults(defineProps<Props>(), {
  description: undefined,
  action: undefined,
  variant: 'card'
})

const content = computed(() => props)
</script>

<template>
  <UCard
    v-if="content.variant === 'card'"
    class="text-center"
  >
    <div class="flex flex-col items-center gap-3 py-10 sm:py-14">
      <div class="rounded-full bg-primary/10 p-6">
        <UIcon
          :name="icon"
          class="size-16 text-primary"
        />
      </div>
      <h2 class="text-lg font-semibold text-highlighted">
        {{ title }}
      </h2>
      <p
        v-if="description"
        class="text-sm text-muted max-w-md mx-auto"
      >
        {{ description }}
      </p>
      <UButton
        v-if="action?.to"
        :to="action.to"
        :icon="action.icon"
        class="mt-2"
      >
        {{ action.label }}
      </UButton>
      <UButton
        v-else-if="action?.onClick"
        :icon="action.icon"
        class="mt-2"
        @click="action.onClick"
      >
        {{ action.label }}
      </UButton>
    </div>
  </UCard>

  <div
    v-else
    class="flex flex-col items-center gap-3 py-10 sm:py-14 text-center"
  >
    <div class="rounded-full bg-primary/10 p-6">
      <UIcon
        :name="icon"
        class="size-16 text-primary"
      />
    </div>
    <h2 class="text-lg font-semibold text-highlighted">
      {{ title }}
    </h2>
    <p
      v-if="description"
      class="text-sm text-muted max-w-md mx-auto"
    >
      {{ description }}
    </p>
    <UButton
      v-if="action?.to"
      :to="action.to"
      :icon="action.icon"
      class="mt-2"
    >
      {{ action.label }}
    </UButton>
    <UButton
      v-else-if="action?.onClick"
      :icon="action.icon"
      class="mt-2"
      @click="action.onClick"
    >
      {{ action.label }}
    </UButton>
  </div>
</template>
