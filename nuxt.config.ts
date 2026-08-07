import { fileURLToPath } from 'node:url'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  // Every table is behind RLS keyed on auth.uid(), so the server has no
  // session to query with. Rendering client-side keeps auth in one place.
  ssr: false,

  runtimeConfig: {
    public: {
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_KEY
    }
  },

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

  compatibilityDate: '2026-06-30',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
