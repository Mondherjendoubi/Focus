<script setup lang="ts">
/**
 * The shared inline representation of a topic: colour swatch, optional
 * icon, name. Every list, picker, and form preview uses it so the visual
 * grammar stays identical across the app.
 *
 * Colour is applied inline because it comes from `topics.color` in the
 * database — the one hardcoded-hex exception the theme allows. The label
 * always carries the identity so colour never has to; a colour-blind user
 * loses no information.
 */

withDefaults(defineProps<{
  topic: {
    name: string
    color: string
    icon?: string | null
  }
  size?: 'sm' | 'md'
  muted?: boolean
}>(), {
  size: 'md',
  muted: false
})
</script>

<template>
  <span
    class="inline-flex items-center gap-2 min-w-0"
    :class="[
      size === 'sm' ? 'text-sm' : 'text-base',
      muted ? 'text-muted' : 'text-highlighted'
    ]"
  >
    <span
      class="shrink-0 rounded-full ring-1 ring-inset ring-black/5 dark:ring-white/10"
      :class="size === 'sm' ? 'size-3' : 'size-4'"
      :style="{ backgroundColor: topic.color }"
      aria-hidden="true"
    />
    <UIcon
      v-if="topic.icon"
      :name="topic.icon"
      :class="size === 'sm' ? 'size-4' : 'size-5'"
      class="shrink-0 text-muted"
      aria-hidden="true"
    />
    <span class="truncate font-medium">{{ topic.name }}</span>
  </span>
</template>
