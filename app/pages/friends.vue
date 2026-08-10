<script setup lang="ts">
import type { FriendEdge, ProfileLookup } from '~/types/database'

/**
 * Friends — send a request by handle, accept or decline, see a friend's week.
 *
 * Ordering is deliberate: incoming requests first, because they are the only
 * time-sensitive thing on the page. Everything else can wait.
 *
 * There is no ranking and no leaderboard. A two-person leaderboard where one of
 * you is having a bad month is an efficient way to lose the person having the
 * bad month, which is the opposite of what a study app should do.
 *
 * Requires `Schema/02_social.sql` to have been run — until then every RPC here
 * 404s and the error state below is what the user sees.
 */

definePageMeta({ middleware: 'auth' })

useSeoMeta({ title: 'Friends' })

const {
  accepted,
  incoming,
  outgoing,
  stats,
  loading,
  error,
  loaded,
  load,
  isNewlyAccepted,
  newlyAccepted,
  markSeen,
  findByUsername,
  existingEdgeWith,
  sendRequest,
  accept,
  remove
} = useFriends()

const { profile, load: loadProfile } = useProfile()
const toast = useToast()

// The nav badge may have loaded edges already; this still runs because it also
// fetches the per-friend stats that the light path skips.
void load()
if (!profile.value) void loadProfile()

// Stamped on the way OUT, so "New" chips survive the visit that revealed them
// instead of clearing as the list paints.
onUnmounted(markSeen)

const query = ref('')
const searching = ref(false)
const searched = ref(false)
const result = ref<ProfileLookup | null>(null)
const searchError = ref<string | null>(null)
/** Which edge is mid-write, so only that row shows a spinner. */
const busyId = ref<string | null>(null)

/** The friend whose picture is open full-size, or null. */
const viewing = ref<FriendEdge | null>(null)

const viewingName = computed(() => {
  const edge = viewing.value
  if (edge === null) return ''
  const display = edge.display_name?.trim()
  if (display && display.length > 0) return display
  return edge.username ? `@${edge.username}` : 'Profile picture'
})

function onViewAvatar(edge: FriendEdge) {
  viewing.value = edge
}

/** You cannot be found if you have not claimed a handle — and neither can they. */
const myHandle = computed(() => profile.value?.username ?? null)
const hasHandle = computed(() => myHandle.value !== null)

/**
 * Your own handle, shown back to you.
 *
 * It was previously visible in exactly one place — the settings input you typed
 * it into — so you set it once and then had no way to answer "what's your
 * handle?" without going to look it up. A handle nobody can recall is a handle
 * nobody can be given.
 */
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

onUnmounted(() => {
  if (copiedTimer !== null) clearTimeout(copiedTimer)
})

async function copyHandle() {
  const handle = myHandle.value
  if (handle === null) return

  try {
    await navigator.clipboard.writeText(`@${handle}`)
    copied.value = true
    if (copiedTimer !== null) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // The clipboard API needs a secure context and permission, and refuses
    // silently otherwise. The handle is printed right next to the button
    // regardless, so this is not worth an error — just say it out loud.
    toast.add({
      title: `Your handle is @${handle}`,
      icon: 'i-lucide-at-sign',
      color: 'neutral'
    })
  }
}

/** An edge that already exists with the search result, if any. */
const existing = computed(() => (result.value ? existingEdgeWith(result.value.id) : null))

async function onSearch() {
  if (searching.value || query.value.trim().length === 0) return
  searching.value = true
  searchError.value = null
  result.value = null
  try {
    result.value = await findByUsername(query.value)
    searched.value = true
  } catch (err) {
    searchError.value = (err as Error).message
  } finally {
    searching.value = false
  }
}

async function onSend() {
  const target = result.value
  if (!target) return
  searching.value = true
  try {
    await sendRequest(target.id)
    toast.add({ title: 'Request sent', icon: 'i-lucide-send', color: 'success' })
    query.value = ''
    result.value = null
    searched.value = false
  } catch (err) {
    searchError.value = (err as Error).message
  } finally {
    searching.value = false
  }
}

async function onAccept(edge: FriendEdge) {
  busyId.value = edge.friendship_id
  try {
    await accept(edge.friendship_id)
    toast.add({ title: 'You are now friends', icon: 'i-lucide-user-check', color: 'success' })
  } catch (err) {
    toast.add({
      title: 'Could not accept',
      description: (err as Error).message,
      icon: 'i-lucide-triangle-alert',
      color: 'error'
    })
  } finally {
    busyId.value = null
  }
}

async function onRemove(edge: FriendEdge) {
  busyId.value = edge.friendship_id
  try {
    await remove(edge.friendship_id)
  } catch (err) {
    toast.add({
      title: 'Could not remove',
      description: (err as Error).message,
      icon: 'i-lucide-triangle-alert',
      color: 'error'
    })
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <UContainer class="py-6 sm:py-10">
    <div class="flex flex-col gap-8">
      <header class="flex flex-col gap-1">
        <h1 class="font-display text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">
          Friends
        </h1>
        <p class="text-sm text-muted">
          Friends see your weekly total, streak and goal days — never your topics or notes.
        </p>
      </header>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        icon="i-lucide-triangle-alert"
        title="Couldn't load your friends"
        :description="error"
        :actions="[{ label: 'Retry', onClick: () => load(), color: 'neutral', variant: 'outline' }]"
      />

      <!-- Without a handle you are invisible to search. Saying so here beats
           letting someone wonder why nobody can find them. -->
      <UAlert
        v-if="!hasHandle && !error"
        color="warning"
        variant="soft"
        icon="i-lucide-at-sign"
        title="Pick a handle so friends can find you"
        description="Until you set one, nobody can search for you. You can still add other people."
        :actions="[{ label: 'Open settings', to: '/settings', color: 'neutral', variant: 'outline' }]"
      />

      <!-- Once set, the handle stays on screen. This is the page you are on
           when someone asks what your handle is, so it is the page that has to
           be able to answer. -->
      <UCard
        v-else-if="hasHandle && !error"
        :ui="{ body: 'p-4 sm:p-5' }"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="text-xs font-medium uppercase tracking-wide text-muted">
              Your handle
            </p>
            <p class="mt-1 truncate font-display text-lg font-semibold tracking-tight text-highlighted">
              @{{ myHandle }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              Give this to people so they can add you.
            </p>
          </div>
          <UButton
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            :color="copied ? 'primary' : 'neutral'"
            variant="outline"
            size="sm"
            @click="copyHandle"
          >
            {{ copied ? 'Copied' : 'Copy' }}
          </UButton>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="text-sm font-medium text-highlighted">
            Add a friend
          </h2>
        </template>

        <form
          class="flex flex-col gap-3"
          @submit.prevent="onSearch"
        >
          <div class="flex flex-col gap-2 sm:flex-row">
            <UInput
              v-model="query"
              placeholder="their handle"
              icon="i-lucide-at-sign"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              :disabled="searching"
              class="w-full sm:flex-1"
            />
            <UButton
              type="submit"
              icon="i-lucide-search"
              :loading="searching"
              :disabled="searching || query.trim().length === 0"
            >
              Search
            </UButton>
          </div>

          <UAlert
            v-if="searchError"
            color="error"
            variant="soft"
            icon="i-lucide-triangle-alert"
            :title="searchError"
          />

          <div
            v-else-if="result"
            class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default p-3"
          >
            <div class="flex min-w-0 items-center gap-3">
              <UserAvatar
                :name="result.display_name"
                :username="result.username"
                :src="result.avatar_url"
                size="sm"
              />
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-highlighted">
                  {{ result.display_name?.trim() || `@${result.username}` }}
                </p>
                <p
                  v-if="result.display_name"
                  class="truncate text-xs text-muted"
                >
                  @{{ result.username }}
                </p>
              </div>
            </div>

            <!-- The unique index is on the pair, so a reverse request would
                 come back as a raw constraint violation. Offer the useful
                 action instead of letting them hit it. -->
            <UButton
              v-if="existing?.direction === 'incoming'"
              icon="i-lucide-user-check"
              size="sm"
              :loading="busyId === existing.friendship_id"
              @click="onAccept(existing)"
            >
              They asked you — accept
            </UButton>
            <span
              v-else-if="existing?.direction === 'friend'"
              class="text-sm text-muted"
            >
              Already friends
            </span>
            <span
              v-else-if="existing?.direction === 'outgoing'"
              class="text-sm text-muted"
            >
              Request pending
            </span>
            <UButton
              v-else
              icon="i-lucide-user-plus"
              size="sm"
              :loading="searching"
              @click="onSend"
            >
              Send request
            </UButton>
          </div>

          <!-- Naming the likely cause matters here. Search matches the handle
               only, never the display name, and an account that has never set
               a handle is invisible — which looks identical to a typo from the
               searcher's side. Blaming spelling alone sends people hunting for
               a mistake that isn't theirs. -->
          <div
            v-else-if="searched && !searching"
            class="flex flex-col gap-1 text-sm"
          >
            <p class="text-muted">
              No one with that handle.
            </p>
            <p class="text-xs text-muted">
              Handles are exact, and they're not the same as a display name — if
              that person hasn't set one in their settings, they can't be found yet.
            </p>
          </div>
        </form>
      </UCard>

      <!-- Incoming first: the only time-sensitive thing on this page. -->
      <UCard v-if="incoming.length > 0">
        <template #header>
          <h2 class="text-sm font-medium text-highlighted">
            Requests for you
          </h2>
        </template>
        <ul class="flex flex-col divide-y divide-default">
          <FriendRequestRow
            v-for="edge in incoming"
            :key="edge.friendship_id"
            :edge="edge"
            :busy="busyId === edge.friendship_id"
            @accept="onAccept"
            @remove="onRemove"
          />
        </ul>
      </UCard>

      <section
        aria-labelledby="friends-heading"
        class="flex flex-col gap-4"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="friends-heading"
            class="text-sm font-medium text-highlighted"
          >
            Your friends
          </h2>
          <!-- Stated once at the top as well as chipped per card, so an
               acceptance registers without having to scan the grid for a badge. -->
          <p
            v-if="newlyAccepted.length > 0"
            class="flex items-center gap-1.5 text-sm text-primary"
          >
            <UIcon
              name="i-lucide-user-check"
              class="size-4"
            />
            {{ newlyAccepted.length }}
            {{ newlyAccepted.length === 1 ? 'request was' : 'requests were' }} accepted
          </p>
        </div>

        <div
          v-if="loading && accepted.length === 0"
          class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <USkeleton
            v-for="i in 3"
            :key="i"
            class="h-40"
          />
        </div>

        <EmptyState
          v-else-if="accepted.length === 0 && !error"
          icon="i-lucide-users"
          title="No friends yet"
          description="Search for someone's handle above to send them a request."
        />

        <div
          v-else
          class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <FriendCard
            v-for="edge in accepted"
            :key="edge.friendship_id"
            :edge="edge"
            :stats="stats[edge.friend_id]"
            :removing="busyId === edge.friendship_id"
            :is-new="isNewlyAccepted(edge)"
            @remove="onRemove"
            @view="onViewAvatar"
          />
        </div>
      </section>

      <!-- Full-size picture. `:open` is derived from the subject rather than a
           separate boolean, so the two can never disagree about what is shown. -->
      <UModal
        :open="viewing !== null"
        :title="viewingName"
        :ui="{ content: 'sm:max-w-sm' }"
        @update:open="(open) => { if (!open) viewing = null }"
      >
        <template #body>
          <img
            v-if="viewing?.avatar_url"
            :src="viewing.avatar_url"
            :alt="`${viewingName}'s profile picture`"
            class="mx-auto w-full max-w-xs rounded-lg"
          >
        </template>
      </UModal>

      <UCard v-if="outgoing.length > 0">
        <template #header>
          <h2 class="text-sm font-medium text-highlighted">
            Sent
          </h2>
        </template>
        <ul class="flex flex-col divide-y divide-default">
          <FriendRequestRow
            v-for="edge in outgoing"
            :key="edge.friendship_id"
            :edge="edge"
            :busy="busyId === edge.friendship_id"
            @accept="onAccept"
            @remove="onRemove"
          />
        </ul>
      </UCard>
    </div>
  </UContainer>
</template>
