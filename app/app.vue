<script setup lang="ts">
const { isLoggedIn, ready } = useAuth()

const title = 'tutorex'

/**
 * The static head — title, description, og:*, icons, manifest, theme-color —
 * lives in `nuxt.config.ts` under `app.head`, NOT here.
 *
 * `ssr: false` means this file's setup never runs on the server, so anything
 * registered below is invisible to `nuxt generate` and never reaches
 * `dist/index.html`. Crawlers and the first tab paint both read that shell.
 * Moving a tag back into this file silently removes it from the shipped HTML
 * while still looking correct in a browser devtools inspector, because the
 * bundle injects it a moment after load.
 *
 * What stays here is what CANNOT be static: `titleTemplate` is a function
 * (`app.head` is serialised at build time and cannot hold one), and the timer
 * clock below changes every second.
 */
useHead({
  titleTemplate: (t?: string) => (t && t !== title ? `${t} · ${title}` : title)
})

// Mirror the header nav into the mobile slideover; render nothing before
// auth resolves so we never flash the logged-out shell at a returning user.
const mobileOpen = ref(false)

/**
 * Auth pages own their whole screen.
 *
 * `definePageMeta({ layout: false })` on login/signup only disables the
 * `layouts/` mechanism — it does NOT suppress `app.vue`, which wraps every
 * route. So without this those pages rendered the app header (logo, colour
 * toggle) and the footer AROUND a full-height card that already draws its own
 * centred `AppLogo`: two logos, and chrome on a screen meant to stand alone.
 *
 * Keyed off that existing meta flag rather than a hardcoded path list, so a
 * future standalone page opts in the same way and this never drifts.
 */
const route = useRoute()
const chromeless = computed(() => route.meta.layout === false)

// Browser-tab timer: while a block is running, the tab shows the countdown so
// the user can watch it from another tab.
//
// `tagPriority: 'high'` is load-bearing. Every page sets its own title, and a
// page's setup runs after app.vue's — at equal weight unhead resolves a title
// collision in favour of the last entry registered, so without the bump the
// page title silently buries the clock on every route.
//
// Returning `undefined` (not `null`, which still emits a title tag, just an
// empty one that would then outrank the page) drops this entry entirely, so
// the moment the block ends the tab snaps back to e.g. "Dashboard · tutorex".
// The bare clock is returned without the site name — `titleTemplate` above
// appends it, and returning it here too would render "24:59 · tutorex · tutorex".
const timer = useActiveSession()
useHead({
  title: computed(() => {
    const b = timer.block.value
    if (b === null) return undefined
    // A block carried over from a previous day is abandoned, not running. Its
    // clock counts from whenever the tab was closed, so putting it in the tab
    // strip would advertise a number that means nothing.
    if (timer.isStale.value) return undefined
    if (timer.isPaused.value) return 'Paused'
    const clock = formatClock(timer.remainingSeconds.value ?? timer.elapsedSeconds.value)
    return b.kind === 'focus' ? clock : `Break · ${clock}`
  })
}, { tagPriority: 'high' })
</script>

<template>
  <UApp>
    <!-- FA-020 — desktop workspace shell.
         Two mutually exclusive navigations, split at `lg`: the sidebar below,
         and the original UHeader + slideover above. `lg:hidden` / `hidden lg:flex`
         rather than a JS breakpoint, so there is no width at which both render
         and none at which neither does. -->
    <!-- `bg-muted` is slate-50 (`neutral: 'slate'` in app.config), which is the
         prototype's #F8FAFC page. Without it the page and the cards are both
         white and the cards read as nothing but hairlines.
         Dark stays on `bg-default`: `bg-muted` is neutral-800 there, LIGHTER
         than the neutral-900 cards sit on, which would invert the elevation. -->
    <!-- Login / signup: the page IS the screen. No header, no sidebar, no
         footer — see `chromeless` above. -->
    <NuxtPage v-if="chromeless" />

    <div
      v-else-if="ready && isLoggedIn"
      class="flex min-h-screen bg-muted dark:bg-default"
    >
      <AppSidebar class="hidden lg:flex" />

      <div class="flex min-w-0 flex-1 flex-col">
        <!-- FA-026 — no `#body`, and so no hamburger: navigation moved to the
             bottom bar. `:toggle="false"` is belt and braces, since the toggle
             is what used to open the slideover this replaces. What stays here
             is identity, not navigation — Settings and Sign out live in
             `UserMenu` and are deliberately not tabs. -->
        <UHeader
          :toggle="false"
          class="lg:hidden"
        >
          <template #left>
            <NuxtLink
              to="/"
              aria-label="tutorex home"
              class="flex items-center"
            >
              <AppLogo />
            </NuxtLink>
          </template>

          <template #right>
            <UColorModeButton />
            <UserMenu />
          </template>
        </UHeader>

        <!-- No footer inside the app shell: the prototype's main column runs
             to the bottom of the viewport, and a copyright bar under a running
             timer is chrome the design deliberately does not have. The signed
             -out shell below keeps it.
             The padding clears the fixed tab bar — without it every page's last
             element sits under it, the Focus controls included. It carries the
             safe-area inset because the bar does: a flat `pb-20` covers the
             bar's 57px on Android but not the 91px it becomes once iOS adds 34px
             for the home indicator. -->
        <UMain class="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
          <NuxtPage />
        </UMain>
      </div>

      <AppTabBar />
    </div>

    <!-- Signed out, or auth still resolving: no navigation to show, so the
         plain shell stays. Rendering the sidebar here would flash an empty
         rail at someone on the login page. -->
    <template v-else>
      <UHeader v-model:open="mobileOpen">
        <template #left>
          <NuxtLink
            to="/"
            aria-label="tutorex home"
            class="flex items-center"
          >
            <AppLogo />
          </NuxtLink>
        </template>

        <template #right>
          <UColorModeButton />
        </template>
      </UHeader>

      <UMain>
        <NuxtPage />
      </UMain>

      <UFooter>
        <template #left>
          <p class="text-sm text-muted">
            © {{ new Date().getFullYear() }} tutorex
          </p>
        </template>
      </UFooter>
    </template>
  </UApp>
</template>
