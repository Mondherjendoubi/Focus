<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

defineProps<{
  orientation?: 'horizontal' | 'vertical'
}>()

/**
 * Pending requests waiting on YOU, as a nav badge — the only part of the
 * friends flow that needs answering, and otherwise invisible unless you
 * happened to open the page.
 *
 * `loadEdges` rather than `load`: the full loader fires a `friend_stats` call
 * per accepted friend, and this renders on every page. State is shared through
 * `useState`, so the friends page reuses whatever this already fetched.
 */
const { incomingCount, loaded, loadEdges } = useFriends()

if (!loaded.value) void loadEdges()

const items = computed<NavigationMenuItem[]>(() => [
  { label: 'Focus', to: '/', icon: 'i-lucide-timer' },
  { label: 'Dashboard', to: '/dashboard', icon: 'i-lucide-chart-column' },
  { label: 'Topics', to: '/topics', icon: 'i-lucide-tags' },
  { label: 'History', to: '/history', icon: 'i-lucide-history' },
  {
    label: 'Friends',
    to: '/friends',
    icon: 'i-lucide-users',
    // Undefined, not 0 — NavigationMenu renders a literal `0` badge otherwise.
    badge: incomingCount.value > 0
      ? { label: String(incomingCount.value), color: 'primary' as const }
      : undefined
  }
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
