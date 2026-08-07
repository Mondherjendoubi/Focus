<script setup lang="ts">
defineProps<{ class?: string }>()
</script>

<template>
  <span
    :class="[$props.class, 'inline-flex items-center gap-2 text-highlighted']"
    aria-label="tutorex"
  >
    <UIcon
      name="i-lucide-highlighter"
      class="size-6 text-primary"
    />
    <span class="font-display text-lg font-semibold tracking-tight">
      tutorex
    </span>
  </span>
</template>
