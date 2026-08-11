<script setup lang="ts">
import type { FriendEdge, ProfileLookup } from '~/types/database'

/**
 * Friends — the 3b desktop layout.
 *
 * Header carries your own handle (with copy) and an **Add friend** button; the
 * search that used to sit inline now lives in that button's modal, because a
 * permanent search box is a control you use once and then scroll past forever.
 *
 * Incoming requests are inline banners directly under the header — they are the
 * only time-sensitive thing on this page, and a banner is harder to skip than a
 * card in a list. Friends are a table, so weekly totals, streaks and goal days
 * line up column-wise and can actually be compared.
 *
 * Still no ranking. Sorting friends by hours would turn the page into a
 * leaderboard, and a two-person leaderboard where one of you is having a bad
 * month is an efficient way to lose the person having the bad month.
 *
 * Needs `Schema/02_social.sql`, `03_avatars.sql` and `04_friend_days.sql`.
 */

definePageMeta({ middleware: 'auth' })

useSeoMeta({ title: 'Friends' })

const {
  accepted,
  incoming,
  outgoing,
  stats,
  days,
  loading,
  error,
  load,
  isNewlyAccepted,
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
// fetches the per-friend stats and sparklines that the light path skips.
void load()
if (!profile.value) void loadProfile()

// Stamped on the way OUT, so "New" chips survive the visit that revealed them
// instead of clearing as the list paints.
onUnmounted(markSeen)

const myHandle = computed(() => profile.value?.username ?? null)
const hasHandle = computed(() => myHandle.value !== null)

// ---------------------------------------------------------------------------
// Copying your own handle
// ---------------------------------------------------------------------------

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
    // Needs a secure context and permission, and fails silently otherwise. The
    // handle is on screen either way, so say it rather than raise an error.
    toast.add({ title: `Your handle is @${handle}`, icon: 'i-lucide-at-sign', color: 'neutral' })
  }
}

// ---------------------------------------------------------------------------
// Add-friend modal
// ---------------------------------------------------------------------------

const addOpen = ref(false)
const query = ref('')
const searching = ref(false)
const searched = ref(false)
const result = ref<ProfileLookup | null>(null)
const searchError = ref<string | null>(null)

/** Which edge is mid-write, so only that row spins. */
const busyId = ref<string | null>(null)

/** An edge that already exists with the search result, if any. */
const existing = computed(() => (result.value ? existingEdgeWith(result.value.id) : null))

function openAdd() {
  query.value = ''
  result.value = null
  searched.value = false
  searchError.value = null
  addOpen.value = true
}

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
    addOpen.value = false
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
    addOpen.value = false
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

/** Returns whether the edge actually went away, so callers can stay open on failure. */
async function onRemove(edge: FriendEdge): Promise<boolean> {
  busyId.value = edge.friendship_id
  try {
    await remove(edge.friendship_id)
    return true
  } catch (err) {
    toast.add({
      title: 'Could not remove',
      description: (err as Error).message,
      icon: 'i-lucide-triangle-alert',
      color: 'error'
    })
    return false
  } finally {
    busyId.value = null
  }
}

// ---------------------------------------------------------------------------
// Unfriending, confirmed
// ---------------------------------------------------------------------------

/**
 * The friend awaiting confirmation, or null.
 *
 * Removal is a hard delete of the edge (`useFriends.remove` — there is no
 * soft-delete on purpose, since a kept-but-declined row would keep granting the
 * access it was meant to end), it is symmetric, and it is one icon-only button
 * sitting at the end of every row. That combination needs a question in front
 * of it; the same click on Decline or Cancel throws away a request, not a
 * friendship, so those stay immediate.
 */
const removeTarget = ref<FriendEdge | null>(null)

async function doRemove() {
  const edge = removeTarget.value
  if (edge === null) return
  // Closed only on success: a failed delete has already toasted, and dropping
  // the dialog too would leave the row on screen looking untouched.
  if (await onRemove(edge)) removeTarget.value = null
}

function edgeName(edge: FriendEdge): string {
  const display = edge.display_name?.trim()
  if (display && display.length > 0) return display
  return edge.username ? `@${edge.username}` : 'Someone'
}

const showSent = ref(false)
</script>

<template>
  <UContainer class="py-6 sm:py-8 lg:px-10">
    <div class="flex min-h-[calc(100vh-6rem)] flex-col gap-5">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="font-display text-2xl font-semibold tracking-tight text-highlighted sm:text-[26px]">
            Friends
          </h1>
          <p class="mt-1.5 text-sm text-muted">
            Friends see your weekly total, streak and goal days — never your topics or notes.
          </p>
        </div>

        <div class="flex shrink-0 items-center gap-2.5">
          <!-- Your handle lives in the header so the page can always answer
               "what do I tell people?" without a trip to settings. -->
          <UButton
            v-if="hasHandle"
            color="neutral"
            variant="outline"
            size="sm"
            :icon="copied ? 'i-lucide-check' : 'i-lucide-at-sign'"
            trailing-icon="i-lucide-copy"
            @click="copyHandle"
          >
            {{ copied ? 'Copied' : `@${myHandle}` }}
          </UButton>
          <UButton
            v-else
            to="/settings"
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-at-sign"
          >
            Pick a handle
          </UButton>

          <!-- The prototype draws the round-head user glyphs throughout, so the
               whole page uses `user-round-*` rather than mixing the two sets. -->
          <UButton
            icon="i-lucide-user-round-plus"
            size="sm"
            @click="openAdd"
          >
            Add friend
          </UButton>
        </div>
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

      <!-- Without a handle nobody can find you. Said once, quietly, here. -->
      <UAlert
        v-else-if="!hasHandle"
        color="warning"
        variant="soft"
        icon="i-lucide-at-sign"
        title="Pick a handle so friends can find you"
        description="Until you set one, nobody can search for you. You can still add other people."
        :actions="[{ label: 'Open settings', to: '/settings', color: 'neutral', variant: 'outline' }]"
      />

      <!-- Incoming requests: banners, not list rows. The only thing here that
           needs answering, so it should be the hardest thing to scroll past. -->
      <div
        v-for="edge in incoming"
        :key="edge.friendship_id"
        class="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3"
      >
        <UserAvatar
          :name="edge.display_name"
          :username="edge.username"
          :src="edge.avatar_url"
          size="md"
        />
        <!-- The prototype's banner text is blue-700, not the primary-500 this
             had: on a blue-50 tint 500 lands under 4.5:1 at 13px. Dark mode
             flips to the light end of the same ramp — `text-primary` there is
             blue-400, which would be unreadable on a dark tint. -->
        <p class="min-w-0 flex-1 text-[13px] text-primary-700 dark:text-primary-200">
          <strong class="font-semibold">{{ edgeName(edge) }}</strong>
          wants to follow your progress · sent {{ relativeTime(edge.created_at) }}
        </p>
        <UButton
          size="sm"
          :loading="busyId === edge.friendship_id"
          :disabled="busyId === edge.friendship_id"
          @click="onAccept(edge)"
        >
          Accept
        </UButton>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="busyId === edge.friendship_id"
          @click="onRemove(edge)"
        >
          Decline
        </UButton>
      </div>

      <div
        v-if="loading && accepted.length === 0"
        class="flex flex-col gap-2"
      >
        <USkeleton
          v-for="i in 3"
          :key="i"
          class="h-16 w-full rounded-xl"
        />
      </div>

      <EmptyState
        v-else-if="accepted.length === 0 && !error"
        icon="i-lucide-users"
        title="No friends yet"
        description="Add someone by their handle to compare weeks."
        :action="{ label: 'Add friend', icon: 'i-lucide-user-round-plus', onClick: openAdd }"
      />

      <!-- The table. Fixed column widths so numbers align down the page. -->
      <div
        v-else
        class="overflow-x-auto rounded-xl border border-default bg-default shadow-sm"
      >
        <div class="min-w-[860px]">
          <div class="flex items-center gap-4 border-b border-muted px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider text-dimmed">
            <span class="w-[280px] shrink-0">Friend</span>
            <span class="w-[110px] shrink-0">This week</span>
            <span class="w-[130px] shrink-0">Last 7 days</span>
            <span class="w-[70px] shrink-0 text-center">Streak</span>
            <span class="w-[80px] shrink-0 text-center">Goal days</span>
            <span class="flex-1" />
          </div>

          <FriendRow
            v-for="edge in accepted"
            :key="edge.friendship_id"
            :edge="edge"
            :stats="stats[edge.friend_id]"
            :days="days[edge.friend_id]"
            :is-new="isNewlyAccepted(edge)"
            :removing="busyId === edge.friendship_id"
            @remove="removeTarget = $event"
          />
        </div>
      </div>

      <!-- Sent requests collapse to a single line: useful to check, not worth
           permanent space beside the friends you already have. -->
      <div
        v-if="outgoing.length > 0"
        class="mt-auto pt-2"
      >
        <button
          type="button"
          class="flex items-center gap-2 text-[13px] font-medium text-muted transition hover:text-highlighted"
          :aria-expanded="showSent"
          @click="showSent = !showSent"
        >
          <UIcon
            :name="showSent ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            class="size-4"
          />
          Sent requests ({{ outgoing.length }})
        </button>

        <!-- Padding lives on the rows, not here, so the dividers run the full
             width of the card instead of stopping short of the border. -->
        <ul
          v-if="showSent"
          class="mt-3 flex flex-col divide-y divide-muted overflow-hidden rounded-xl border border-default bg-default shadow-sm"
        >
          <FriendRequestRow
            v-for="edge in outgoing"
            :key="edge.friendship_id"
            :edge="edge"
            :busy="busyId === edge.friendship_id"
            @accept="onAccept"
            @remove="onRemove"
          />
        </ul>
      </div>
    </div>

    <UModal
      v-model:open="addOpen"
      title="Add a friend"
      :ui="{ content: 'sm:max-w-md' }"
    >
      <template #body>
        <form
          class="flex flex-col gap-3"
          @submit.prevent="onSearch"
        >
          <div class="flex gap-2">
            <UInput
              v-model="query"
              placeholder="their handle"
              icon="i-lucide-at-sign"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              autofocus
              :disabled="searching"
              class="flex-1"
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
            <div class="flex min-w-0 items-center gap-2.5">
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

            <!-- The unique index is on the PAIR, so a reverse request would
                 come back as a raw constraint violation. Offer the useful
                 action instead of letting them hit it. -->
            <UButton
              v-if="existing?.direction === 'incoming'"
              icon="i-lucide-user-round-check"
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
              icon="i-lucide-user-round-plus"
              size="sm"
              :loading="searching"
              @click="onSend"
            >
              Send request
            </UButton>
          </div>

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
      </template>
    </UModal>

    <!-- Unfriending is a hard delete and it cuts both ways, so it gets asked
         about. Same shape as the archive confirm on /topics. -->
    <UModal
      :open="removeTarget !== null"
      title="Remove this friend?"
      :ui="{ content: 'sm:max-w-md' }"
      @update:open="(v) => { if (!v) removeTarget = null }"
    >
      <template #body>
        <p class="text-sm text-default">
          <strong>{{ removeTarget ? edgeName(removeTarget) : '' }}</strong>
          will stop seeing your weekly total, streak and goal days, and you'll
          stop seeing theirs. Nothing either of you has studied is deleted — but
          there's no undo, so one of you would have to send a new request.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="busyId !== null"
            @click="removeTarget = null"
          >
            Cancel
          </UButton>
          <UButton
            color="error"
            icon="i-lucide-user-round-minus"
            :loading="busyId === removeTarget?.friendship_id"
            @click="doRemove"
          >
            Remove
          </UButton>
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
