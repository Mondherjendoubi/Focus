<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ layout: false })

useSeoMeta({ title: 'Sign in' })

const route = useRoute()
const { signInWithPassword, isLoggedIn, ready } = useAuth()

const state = reactive({
  email: '',
  password: ''
})

const showPassword = ref(false)
const pending = ref(false)
const formError = ref<string | null>(null)

// Where to bounce a logged-in visitor. `route.query.redirect` is set by the
// auth middleware; fall back to the app root.
function redirectTarget(): string {
  const raw = route.query.redirect
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && value.length > 0 ? value : '/'
}

// Already-authenticated users must never see this form. The plugin flips
// `ready` once the session is resolved; we react to both the initial resolve
// and any later state change.
watchEffect(() => {
  if (ready.value && isLoggedIn.value) {
    navigateTo(redirectTarget(), { replace: true })
  }
})

function validate(data: typeof state) {
  const errors: Array<{ name: string, message: string }> = []
  if (!data.email) errors.push({ name: 'email', message: 'Email is required' })
  if (!data.password) errors.push({ name: 'password', message: 'Password is required' })
  return errors
}

async function onSubmit(event: FormSubmitEvent<typeof state>) {
  if (pending.value) return
  pending.value = true
  formError.value = null
  try {
    await signInWithPassword(event.data.email, event.data.password)
    await navigateTo(redirectTarget(), { replace: true })
  } catch (error) {
    // Keep the form filled; show a form-level error the user can read.
    formError.value = toMessage(error as Error)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4 py-12 bg-default">
    <div class="w-full max-w-md flex flex-col items-center">
      <div class="flex flex-col items-center gap-3 mb-6">
        <AppLogo />
      </div>
      <UCard
        class="w-full"
        :ui="{ body: 'p-6 sm:p-8' }"
      >
        <template #header>
          <div class="flex flex-col gap-1">
            <h1 class="text-2xl font-display font-semibold tracking-tight text-highlighted">
              Welcome back
            </h1>
            <p class="text-sm text-muted">
              Sign in and pick up where you left off.
            </p>
          </div>
        </template>

        <UForm
          :state="state"
          :validate="validate"
          class="flex flex-col gap-4"
          @submit="onSubmit"
        >
          <UFormField
            label="Email"
            name="email"
            required
          >
            <UInput
              v-model="state.email"
              type="email"
              autocomplete="email"
              placeholder="you@example.com"
              :disabled="pending"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Password"
            name="password"
            required
          >
            <UInput
              v-model="state.password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              placeholder="Your password"
              :disabled="pending"
              class="w-full"
              :ui="{ trailing: 'pe-1' }"
            >
              <template #trailing>
                <UButton
                  :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :aria-label="showPassword ? 'Hide password' : 'Show password'"
                  :disabled="pending"
                  @click="showPassword = !showPassword"
                />
              </template>
            </UInput>
          </UFormField>

          <UAlert
            v-if="formError"
            color="error"
            variant="soft"
            icon="i-lucide-triangle-alert"
            :title="formError"
          />

          <UButton
            type="submit"
            block
            :loading="pending"
            :disabled="pending"
            icon="i-lucide-log-in"
          >
            Sign in
          </UButton>
        </UForm>

        <template #footer>
          <p class="text-sm text-muted text-center">
            New here?
            <ULink
              to="/signup"
              class="text-primary font-medium"
            >
              Create an account
            </ULink>
          </p>
        </template>
      </UCard>
    </div>
  </div>
</template>
