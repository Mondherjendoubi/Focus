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
    { rel: 'icon', href: '/favicon.ico' },
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
</script>

<template>
  <UApp>
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

      <template
        v-if="ready && isLoggedIn"
        #default
      >
        <AppNav />
      </template>

      <template #right>
        <UColorModeButton />

        <template v-if="ready && isLoggedIn">
          <UserMenu />
        </template>
      </template>

      <template
        v-if="ready && isLoggedIn"
        #body
      >
        <AppNav orientation="vertical" />
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
  </UApp>
</template>
