import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * One client for the whole app. `ssr: false` means this only ever runs in the
 * browser, so session persistence in localStorage is safe.
 */
export default defineNuxtPlugin({
  name: 'supabase',
  setup() {
    const { supabaseUrl, supabaseKey } = useRuntimeConfig().public

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_KEY. Copy .env.example to .env and fill it in.')
    }

    const client = createClient(supabaseUrl as string, supabaseKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })

    return {
      provide: {
        supabase: client as SupabaseClient
      }
    }
  }
})
