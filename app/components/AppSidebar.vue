<script setup lang="ts">
/**
 * Desktop shell navigation — the 240px rail from the FA-020 handoff.
 *
 * Logo top, nav below, account pinned to the bottom via `mt-auto`. Rendered
 * only at `lg` and up; below that `app.vue` falls back to the existing
 * `UHeader` and its slideover, so the two never coexist.
 *
 * Colours come from theme tokens rather than the handoff's literal hexes. They
 * resolve to the same values — `--color-blue-500` IS `#3565F5` in
 * `app/assets/css/main.css` — but hardcoding them would break dark mode, which
 * the light-only prototype does not cover.
 */
</script>

<template>
  <!-- `sticky top-0 h-screen` pins the rail while the main column scrolls.
       `self-start` is load-bearing: the parent is a flex row, whose default
       `align-items: stretch` would give this element a resolved height and
       sticky would then have nothing left to travel against — the rail would
       scroll away with the page, which is exactly the reported bug.
       `overflow-y-auto` keeps the nav reachable on a short viewport. -->
  <aside
    class="sticky top-0 flex h-screen w-60 shrink-0 flex-col self-start overflow-y-auto border-r border-default bg-default px-3 py-5"
  >
    <NuxtLink
      to="/"
      aria-label="tutorex home"
      class="flex items-center px-3 pb-5 pt-1"
    >
      <AppLogo />
    </NuxtLink>

    <AppNav orientation="vertical" />

    <!-- Pushed to the bottom of the rail. The account menu is a destination you
         reach for deliberately, not something to keep in the primary scan path.
         The colour-mode toggle sits here too: the handoff's prototype is
         light-only and does not show one, but the app has had dark mode since
         FA-014 and silently dropping the control would be a regression. -->
    <div class="mt-auto flex items-center gap-1 pt-4">
      <div class="min-w-0 flex-1">
        <UserMenu block />
      </div>
      <UColorModeButton />
    </div>
  </aside>
</template>
