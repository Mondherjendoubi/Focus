<script setup lang="ts">
/**
 * Primary navigation, as the FA-020/2a prototypes draw it: a vertical list
 * where the ACTIVE item is a solid primary pill with white text, not tinted
 * text on a transparent row.
 *
 * Hand-rolled rather than `UNavigationMenu` because that component's `link`
 * and `pill` variants both express "active" as a colour/underline treatment on
 * an otherwise transparent row. Reproducing a filled pill through its theme
 * slots meant overriding more of it than writing the six lines below.
 *
 * Since FA-026 this is the desktop rail only — the mobile slideover it used to
 * share with is gone, replaced by `AppTabBar`. The items themselves live in
 * `app/utils/nav.ts` so the two navigations cannot drift apart.
 */
defineProps<{
  orientation?: 'horizontal' | 'vertical'
}>()

const route = useRoute()

/**
 * Requests waiting on you, surfaced wherever the nav is. `loadEdges` rather
 * than `load`, which would fire a `friend_stats` call per accepted friend on
 * every page.
 */
const { incomingCount, loaded, loadEdges } = useFriends()

if (!loaded.value) void loadEdges()

const items = NAV_ITEMS

function isActive(to: string): boolean {
  return isNavActive(route.path, to)
}
</script>

<template>
  <nav
    class="flex gap-0.5"
    :class="orientation === 'vertical' ? 'flex-col' : 'flex-row items-center'"
    aria-label="Main"
  >
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition"
      :class="isActive(item.to)
        ? 'bg-primary font-semibold text-inverted shadow-sm'
        : 'font-medium text-toned hover:bg-elevated hover:text-highlighted'"
      :aria-current="isActive(item.to) ? 'page' : undefined"
    >
      <UIcon
        :name="item.icon"
        class="size-[18px] shrink-0"
      />
      <span>{{ item.label }}</span>

      <!-- Sits at the end of the row in the vertical rail, where there is
           space; inline beside the label when horizontal. -->
      <UBadge
        v-if="item.to === '/friends' && incomingCount > 0"
        :color="isActive(item.to) ? 'neutral' : 'primary'"
        variant="solid"
        size="sm"
        :class="orientation === 'vertical' ? 'ml-auto' : ''"
      >
        {{ incomingCount }}
      </UBadge>
    </NuxtLink>
  </nav>
</template>
