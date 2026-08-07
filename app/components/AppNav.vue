<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

defineProps<{
  orientation?: 'horizontal' | 'vertical'
}>()

const items = computed<NavigationMenuItem[]>(() => [
  { label: 'Focus', to: '/', icon: 'i-lucide-timer' },
  { label: 'Dashboard', to: '/dashboard', icon: 'i-lucide-chart-column' },
  { label: 'Topics', to: '/topics', icon: 'i-lucide-tags' },
  { label: 'History', to: '/history', icon: 'i-lucide-history' }
])
</script>

<template>
  <UNavigationMenu
    :items="items"
    :orientation="orientation ?? 'horizontal'"
    highlight
    color="primary"
    variant="link"
    :ui="{ link: 'font-medium' }"
  />
</template>
