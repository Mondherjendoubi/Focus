<script setup lang="ts">
/**
 * Mobile primary navigation (FA-026) — a persistent bottom tab bar.
 *
 * Replaces the hamburger and slideover that used to sit in the top right of
 * `UHeader`. That cost two taps and hid the destinations behind an overlay;
 * this costs one and never leaves the screen. Rendered below `lg` only, where
 * `AppSidebar` takes over — the two are mutually exclusive, so there is no
 * width at which the app shows two navigations.
 *
 * Active is a solid primary pill around the icon, which is `AppNav`'s active
 * language reduced to fit six tabs on a 360px screen. Tinted text alone is not
 * enough at this size.
 */

const route = useRoute()

/** Shared `useState`, so this does not re-fetch what the sidebar already loaded. */
const { incomingCount, loaded, loadEdges } = useFriends()

if (!loaded.value) void loadEdges()

function isActive(to: string): boolean {
  return isNavActive(route.path, to)
}
</script>

<template>
  <!-- `pb-[env(safe-area-inset-bottom)]` keeps the labels clear of the iOS home
       indicator; `viewport-fit=cover` in `app.vue` is what makes the variable
       resolve to anything. The matching bottom padding that stops page content
       hiding under this bar lives on `UMain`. -->
  <nav
    class="fixed inset-x-0 bottom-0 z-40 border-t border-default bg-default pb-[env(safe-area-inset-bottom)] lg:hidden"
    aria-label="Main"
  >
    <div class="flex items-stretch">
      <NuxtLink
        v-for="item in NAV_ITEMS"
        :key="item.to"
        :to="item.to"
        class="flex min-w-0 flex-1 flex-col items-center gap-1 px-0.5 pb-1.5 pt-2 transition"
        :aria-current="isActive(item.to) ? 'page' : undefined"
      >
        <span
          class="relative flex h-7 w-12 items-center justify-center rounded-full transition"
          :class="isActive(item.to) ? 'bg-primary text-inverted' : 'text-toned'"
        >
          <UIcon
            :name="item.icon"
            class="size-[18px] shrink-0"
          />

          <!-- Anchored to the icon rather than the column: at 60px per tab a
               badge beside the label would push the label out of centre. -->
          <UBadge
            v-if="item.to === '/friends' && incomingCount > 0"
            color="primary"
            variant="solid"
            size="sm"
            class="absolute -right-1 -top-1 ring-2 ring-default"
          >
            {{ incomingCount }}
          </UBadge>
        </span>

        <span
          class="max-w-full truncate text-[10px] leading-none"
          :class="isActive(item.to) ? 'font-semibold text-primary' : 'font-medium text-muted'"
        >{{ item.label }}</span>
      </NuxtLink>
    </div>
  </nav>
</template>
