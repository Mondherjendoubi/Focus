<script setup lang="ts">
const { isLoggedIn, ready } = useAuth()

const title = 'tutorex'
const description = 'Your study buddy — start a focus session, keep your streak, see where your time actually goes.'
const siteName = 'tutorex'

// Absolute URLs for social crawlers (Facebook, LinkedIn, Twitter).
// Relative paths often fail to preview — Facebook has been strict about
// requiring fully-qualified URLs for og:image and og:url.
const siteUrl = useRuntimeConfig().public.siteUrl.replace(/\/$/, '')
const ogImageUrl = `${siteUrl}/og-image.png`

useHead({
  htmlAttrs: {
    lang: 'en'
  },
  link: [
    // SVG first — browsers that understand it take it and scale it crisply at
    // any tab size. The 32px PNG covers the rest, and `favicon.ico` stays last
    // because browsers request `/favicon.ico` whether it is declared or not.
    { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' },
    { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
    { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
    // PWA — Android reads the manifest for name/icons/theme/display when the
    // user chooses "Add to Home Screen". iOS ignores the manifest and uses
    // the apple-* meta tags below instead.
    { rel: 'manifest', href: '/site.webmanifest' }
  ],
  meta: [
    // Stop iOS from linkifying the timer digits ("25:00" → phone number).
    { name: 'format-detection', content: 'telephone=no' },
    // iOS home-screen: launch full-screen (no Safari chrome), set the label
    // and the status-bar look. Android/Chrome uses the manifest instead.
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-title', content: 'tutorex' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
    { name: 'mobile-web-app-capable', content: 'yes' }
  ]
})

useSeoMeta({
  title,
  titleTemplate: (t?: string) => (t && t !== title ? `${t} · ${title}` : title),
  description,
  viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
  // Match the header chrome on mobile browsers to the app theme.
  themeColor: [
    { content: '#EEF4FF', media: '(prefers-color-scheme: light)' },
    { content: '#0E183A', media: '(prefers-color-scheme: dark)' }
  ],
  robots: 'index, follow',
  applicationName: siteName,
  author: 'tutorex',

  ogSiteName: siteName,
  ogType: 'website',
  ogLocale: 'en_US',
  ogTitle: title,
  ogDescription: description,
  ogUrl: siteUrl,
  ogImage: {
    url: ogImageUrl,
    width: 1200,
    height: 630,
    alt: 'tutorex — your study buddy',
    type: 'image/png'
  },

  // Large image card requires an og:image / twitter:image ≥ 300×157.
  // Downgrade to 'summary' if you use a smaller image.
  twitterCard: 'summary_large_image',
  twitterTitle: title,
  twitterDescription: description,
  twitterImage: ogImageUrl
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
