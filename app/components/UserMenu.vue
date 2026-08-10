<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const { user, signOut } = useAuth()
const supabase = useSupabase()

const displayName = ref<string | null>(null)
const avatarUrl = ref<string | null>(null)
const loading = ref(false)

const email = computed(() => user.value?.email ?? '')
const emailLocalPart = computed(() => email.value.split('@')[0] ?? '')

const label = computed(() => displayName.value || emailLocalPart.value || 'Account')

const initial = computed(() => (label.value.charAt(0) || '?').toUpperCase())

watch(user, async (u) => {
  if (!u) {
    displayName.value = null
    avatarUrl.value = null
    return
  }
  loading.value = true
  const { data, error } = await supabase
    .from('profiles')
    .select('display_name, avatar_url')
    .maybeSingle()
  loading.value = false
  if (error) {
    // Non-fatal: surface silently, fall back to email local-part and initials.
    displayName.value = null
    avatarUrl.value = null
    return
  }
  displayName.value = data?.display_name ?? null
  avatarUrl.value = data?.avatar_url ?? null
}, { immediate: true })

async function handleSignOut() {
  try {
    await signOut()
  } catch (err) {
    console.error('sign out failed', err)
  }
}

const items = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: label.value,
      type: 'label'
    }
  ],
  [
    {
      label: 'Settings',
      icon: 'i-lucide-settings',
      to: '/settings'
    }
  ],
  [
    {
      label: 'Sign out',
      icon: 'i-lucide-log-out',
      color: 'error',
      onSelect: handleSignOut
    }
  ]
])
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'end' }"
  >
    <UButton
      color="neutral"
      variant="ghost"
      class="gap-2"
      :aria-label="`Account menu for ${label}`"
    >
      <UAvatar
        :src="avatarUrl ?? undefined"
        :alt="label"
        :text="initial"
        size="xs"
      />
      <span class="hidden sm:inline text-sm font-medium truncate max-w-32">{{ label }}</span>
      <UIcon
        name="i-lucide-chevron-down"
        class="size-4 text-muted"
      />
    </UButton>
  </UDropdownMenu>
</template>
