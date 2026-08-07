<script setup lang="ts">
/**
 * A single number with a label above the fold. Deliberately dumb — takes
 * the already-formatted string, not seconds, so every tile can use the
 * same duration formatter without leaking units into this component.
 */
defineProps<{
  label: string
  value: string
  icon?: string
  hint?: string
}>()
</script>

<template>
  <UCard :ui="{ body: 'p-4 sm:p-5' }">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs font-medium uppercase tracking-wide text-muted">
          {{ label }}
        </p>
        <p class="mt-2 font-display text-2xl font-semibold tracking-tight tabular-nums text-highlighted sm:text-3xl">
          <span
            :key="value"
            class="animate-pop inline-block"
          >
            {{ value }}
          </span>
        </p>
        <p
          v-if="hint"
          class="mt-1 text-xs text-muted"
        >
          {{ hint }}
        </p>
      </div>
      <UIcon
        v-if="icon"
        :name="icon"
        class="size-5 shrink-0 text-primary"
      />
    </div>
  </UCard>
</template>
