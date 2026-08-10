<script setup lang="ts">
/**
 * A person, as a circle. One component so the initials fallback is derived the
 * same way everywhere — a friend whose avatar fails to load must not become a
 * blank hole in one place and a letter in another.
 *
 * The fallback is not an edge case: avatars are optional and null by default,
 * so most people will render as initials most of the time. It is the primary
 * state, not the error state.
 */
const props = defineProps<{
  name?: string | null
  username?: string | null
  src?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
}>()

/** Falls through name → handle → '?', so this never renders empty. */
const label = computed(() => {
  const name = props.name?.trim()
  if (name && name.length > 0) return name
  const handle = props.username?.trim()
  if (handle && handle.length > 0) return handle
  return '?'
})

/**
 * Up to two initials from the first and last word. `Array.from` rather than
 * `charAt` so a name starting with an emoji or a non-BMP character yields that
 * whole character instead of half a surrogate pair.
 */
const initials = computed(() => {
  const words = label.value.split(/\s+/).filter(Boolean)
  const first = words[0] ?? '?'
  const last = words.length > 1 ? words[words.length - 1]! : ''

  const firstChar = Array.from(first)[0] ?? '?'
  const lastChar = last.length > 0 ? Array.from(last)[0] ?? '' : ''

  return `${firstChar}${lastChar}`.toUpperCase()
})
</script>

<template>
  <UAvatar
    :src="src ?? undefined"
    :alt="label"
    :text="initials"
    :size="size ?? 'md'"
    :ui="{ fallback: 'font-medium' }"
  />
</template>
