<script setup lang="ts">
const { isLoggedIn, ready } = useAuth()

useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ],
  htmlAttrs: {
    lang: 'en'
  }
})

const title = 'tutorex'
const description = 'Your study buddy — start a focus session, keep your streak, see where your time actually goes.'

useSeoMeta({
  title,
  titleTemplate: (t?: string) => (t && t !== title ? `${t} · ${title}` : title),
  description,
  ogTitle: title,
  ogDescription: description,
  twitterCard: 'summary'
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
