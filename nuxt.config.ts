import { fileURLToPath } from 'node:url'

const title = 'tutorex'
const description = 'Your study buddy — start a focus session, keep your streak, see where your time actually goes.'

// Read at BUILD time, not run time. Everything below is baked into the static
// shell by `nuxt generate`, so the deploy platform must have PUBLIC_SITE_URL
// set when the build runs — setting it afterwards changes nothing.
const siteUrl = (process.env.PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const ogImageUrl = `${siteUrl}/og-image.png`

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  /**
   * Every static head tag lives HERE, not in `app.vue`.
   *
   * `ssr: false` means `app.vue`'s setup never runs on the server, so nothing
   * it registers through `useHead` reaches the HTML that `nuxt generate`
   * writes to `dist/index.html` — those tags only appear once the JS bundle
   * has booted in a real browser. Two things break as a result:
   *
   *   1. Search and social crawlers fetch the shell and see no title, no
   *      description and no og:*, so the result renders with nothing under it.
   *      Googlebot may re-render with JS later; Facebook, LinkedIn, WhatsApp
   *      and Slack never do.
   *   2. The browser paints the tab before the bundle loads, finds no
   *      `<link rel="icon">`, and falls back to whatever it has cached for
   *      `/favicon.ico` — in practice its own blank/dark placeholder.
   *
   * `app.head` is the only head input Nuxt resolves at build time, so it is
   * the only one that survives into the prerendered shell. Anything DYNAMIC
   * (per-page titles, the running-timer clock) still belongs in `app.vue` —
   * it cannot be static by definition, and unhead dedupes it against these.
   */
  app: {
    head: {
      htmlAttrs: {
        lang: 'en'
      },

      title,

      // Nuxt's own shortcuts, not `meta` entries — it always emits a charset
      // and a viewport tag, so declaring them in the array below would ship
      // each one twice.
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',

      link: [
        // SVG first — browsers that understand it take it and scale it crisply
        // at any tab size. The 32px PNG covers the rest, and `favicon.ico`
        // stays last because browsers request `/favicon.ico` whether it is
        // declared or not.
        { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
        { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
        // PWA — Android reads the manifest for name/icons/theme/display when
        // the user chooses "Add to Home Screen". iOS ignores the manifest and
        // uses the apple-* meta tags below instead.
        { rel: 'manifest', href: '/site.webmanifest' },
        // Tells Google which URL owns this content. Every route serves the
        // same shell, so without it the crawler can treat /login and /signup
        // as duplicates of /.
        { rel: 'canonical', href: siteUrl }
      ],

      meta: [
        // The snippet Google prints under the blue link.
        { name: 'description', content: description },
        { name: 'robots', content: 'index, follow' },
        { name: 'application-name', content: title },
        { name: 'author', content: title },

        // Stop iOS from linkifying the timer digits ("25:00" → phone number).
        { name: 'format-detection', content: 'telephone=no' },
        // iOS home-screen: launch full-screen (no Safari chrome), set the
        // label and the status-bar look.
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: title },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
        { name: 'mobile-web-app-capable', content: 'yes' },

        // Match the header chrome on mobile browsers to the app theme. Two
        // entries, split on `media` — unhead keys theme-color on name+media,
        // so these do not collapse into one.
        { name: 'theme-color', content: '#EEF4FF', media: '(prefers-color-scheme: light)' },
        { name: 'theme-color', content: '#0E183A', media: '(prefers-color-scheme: dark)' },

        // Absolute URLs for social crawlers. Relative paths often fail to
        // preview — Facebook has been strict about requiring fully-qualified
        // URLs for og:image and og:url.
        { property: 'og:site_name', content: title },
        { property: 'og:type', content: 'website' },
        { property: 'og:locale', content: 'en_US' },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:url', content: siteUrl },
        { property: 'og:image', content: ogImageUrl },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:image:type', content: 'image/png' },
        { property: 'og:image:alt', content: 'tutorex — your study buddy' },

        // Large image card requires an og:image / twitter:image ≥ 300×157.
        // Downgrade to 'summary' if you use a smaller image.
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
        { name: 'twitter:image', content: ogImageUrl }
      ],

      script: [
        // Structured data. The body of the shell is an empty <div>, so this is
        // the only machine-readable description of the app a crawler gets.
        {
          type: 'application/ld+json',
          innerHTML: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebApplication',
            name: title,
            description,
            url: siteUrl,
            applicationCategory: 'EducationalApplication',
            operatingSystem: 'Any',
            offers: {
              '@type': 'Offer',
              price: '0',
              priceCurrency: 'USD'
            }
          })
        }
      ]
    }
  },

  // Every table is behind RLS keyed on auth.uid(), so the server has no
  // session to query with. Rendering client-side keeps auth in one place.
  ssr: false,

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    public: {
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_KEY,
      // Absolute site URL — used to build canonical + og:image URLs
      // so social crawlers (Facebook, LinkedIn, Twitter) can find them.
      // Set PUBLIC_SITE_URL on the deploy platform to your live domain.
      siteUrl: process.env.PUBLIC_SITE_URL ?? 'http://localhost:3000'
    }
  },

  compatibilityDate: '2026-06-30',

  // Static-site deploy target: emit the SPA shell + client bundle to
  // `<project>/dist/` so hosts that hard-code `dist/` (Cloudflare Pages,
  // most container builders) find the output where they expect it.
  // `publicDir` is resolved relative to `nitro.output.dir` (default
  // `.output`), so we pass an absolute path from this config file.
  nitro: {
    output: {
      publicDir: fileURLToPath(new URL('./dist', import.meta.url))
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
