<script setup lang="ts">
/**
 * The three block-level actions the user has during a running session:
 * pause/resume, end block, end session. All destructive-ish so they're
 * icon+label — nothing here is icon-only, but we still ship `aria-label`
 * for the redundant assistive read.
 *
 * The rules the DB will enforce, mirrored in the UI so the user never
 * gets to try them:
 *  - `pauses_one_open` — only one pause per block open at a time. While a
 *    pause is open, Pause disappears and Resume takes its place.
 *  - `blocks_no_overlap` — one running block. Nothing here starts a new
 *    one; that lives on the page in a template-advance flow.
 *
 * Nothing here calls Supabase directly. Every button emits — the page owns
 * the RPC calls so it can also drive the end-of-session prompt and the
 * template-advance modal from the same event source.
 */

defineProps<{
  paused: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  pause: []
  resume: []
  'end-block': []
  'end-session': []
}>()
</script>

<template>
  <div class="flex flex-wrap items-center justify-center gap-3">
    <UButton
      v-if="!paused"
      color="neutral"
      variant="soft"
      size="lg"
      icon="i-lucide-pause"
      aria-label="Pause block"
      :disabled="loading"
      @click="emit('pause')"
    >
      Pause
    </UButton>
    <UButton
      v-else
      color="primary"
      size="lg"
      icon="i-lucide-play"
      aria-label="Resume block"
      :disabled="loading"
      @click="emit('resume')"
    >
      Resume
    </UButton>

    <UButton
      color="neutral"
      variant="outline"
      size="lg"
      icon="i-lucide-square"
      aria-label="End current block"
      :disabled="loading"
      @click="emit('end-block')"
    >
      End block
    </UButton>

    <UButton
      color="error"
      variant="soft"
      size="lg"
      icon="i-lucide-log-out"
      aria-label="End session"
      :disabled="loading"
      @click="emit('end-session')"
    >
      End session
    </UButton>
  </div>
</template>
