<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ layout: false })

useSeoMeta({ title: 'Create account' })

const { signUp, isLoggedIn, ready } = useAuth()

const state = reactive({
  email: '',
  password: '',
  displayName: ''
})

const showPassword = ref(false)
const pending = ref(false)
const formError = ref<string | null>(null)
const confirmationSent = ref(false)
const confirmationEmail = ref('')

// If a session already exists (they came here by mistake) send them home.
// Skip this once we've shown the confirmation state — the trigger has flipped
// `user` from the initial signUp response but there is no session yet, and we
// want the inbox message to stay put.
watchEffect(() => {
  if (ready.value && isLoggedIn.value && !confirmationSent.value) {
    navigateTo('/', { replace: true })
  }
})

function validate(data: typeof state) {
  const errors: Array<{ name: string, message: string }> = []
  if (!data.email) errors.push({ name: 'email', message: 'Email is required' })
  if (!data.password) {
    errors.push({ name: 'password', message: 'Password is required' })
  } else if (data.password.length < 6) {
    errors.push({ name: 'password', message: 'Password must be at least 6 characters' })
  }
  return errors
}

async function onSubmit(event: FormSubmitEvent<typeof state>) {
  if (pending.value) return
  pending.value = true
  formError.value = null
  try {
    const trimmedName = event.data.displayName.trim()
    // `signUp` calls the auth endpoint. The `handle_new_user` trigger on
    // auth.users creates the matching profile row — we never insert one
    // ourselves, and displayName travels via options.data.full_name.
    const { needsConfirmation } = await signUp(
      event.data.email,
      event.data.password,
      trimmedName.length > 0 ? trimmedName : undefined
    )
    if (needsConfirmation) {
      // No session yet. Show a distinct state so the user knows to check
      // their inbox instead of landing on an empty, RLS-filtered app.
      confirmationEmail.value = event.data.email
      confirmationSent.value = true
    } else {
      await navigateTo('/', { replace: true })
    }
  } catch (error) {
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
        <template
          v-if="!confirmationSent"
          #header
        >
          <div class="flex flex-col gap-1">
            <h1 class="text-2xl font-display font-semibold tracking-tight text-highlighted">
              Create your account
            </h1>
            <p class="text-sm text-muted">
              Set your first topic, start your first session. Should take a minute.
            </p>
          </div>
        </template>

        <div
          v-if="confirmationSent"
          class="flex flex-col items-center text-center gap-4 py-6"
        >
          <div class="flex items-center justify-center w-14 h-14 rounded-full bg-primary/10">
            <UIcon
              name="i-lucide-mail-check"
              class="w-7 h-7 text-primary"
            />
          </div>
          <div class="flex flex-col gap-2">
            <h1 class="text-2xl font-display font-semibold tracking-tight text-highlighted">
              Check your inbox
            </h1>
            <p class="text-sm text-muted">
              We sent a confirmation link to
              <span class="font-medium text-default">{{ confirmationEmail }}</span>.
              Click it to activate your account, then sign in.
            </p>
          </div>
          <UButton
            to="/login"
            variant="soft"
            icon="i-lucide-log-in"
          >
            Back to sign in
          </UButton>
        </div>

        <UForm
          v-else
          :state="state"
          :validate="validate"
          class="flex flex-col gap-4"
          @submit="onSubmit"
        >
          <UFormField
            label="Display name"
            name="displayName"
            hint="Optional"
          >
            <UInput
              v-model="state.displayName"
              type="text"
              autocomplete="name"
              placeholder="What should we call you?"
              :disabled="pending"
              class="w-full"
            />
          </UFormField>

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
            hint="At least 6 characters"
          >
            <UInput
              v-model="state.password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="Pick a strong password"
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
            icon="i-lucide-user-plus"
          >
            Create account
          </UButton>
        </UForm>

        <template
          v-if="!confirmationSent"
          #footer
        >
          <p class="text-sm text-muted text-center">
            Already have an account?
            <ULink
              to="/login"
              class="text-primary font-medium"
            >
              Sign in
            </ULink>
          </p>
        </template>
      </UCard>
    </div>
  </div>
</template>
