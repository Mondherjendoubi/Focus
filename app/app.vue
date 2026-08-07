<script setup lang="ts">
const { isLoggedIn, ready } = useAuth()

const title = 'tutorex'
const description = 'Your study buddy — start a focus session, keep your streak, see where your time actually goes.'
const siteName = 'tutorex'

useHead({
  htmlAttrs: {
    lang: 'en'
  },
  link: [
    { rel: 'icon', href: '/favicon.ico' }
    // Add these when the assets exist in /public:
    // { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' }
    // { rel: 'manifest', href: '/site.webmanifest' }
  ],
  meta: [
    // Stop iOS from linkifying the timer digits ("25:00" → phone number).
    { name: 'format-detection', content: 'telephone=no' }
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
  // ogImage: '/og-image.png',  // add a 1200×630 png to /public and uncomment

  twitterCard: 'summary',
  twitterTitle: title,
  twitterDescription: description
  // twitterImage: '/og-image.png'
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
