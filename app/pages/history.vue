<script setup lang="ts">
/**
 * Session history — `claude-design/history-desktop-6a.html` and `-mobile-6b`.
 *
 * Two scenes off one view model, split at `lg` like the forest: a day-tape on
 * desktop where sessions sit on the hours they actually happened, and a card
 * stack on the phone where 16 hours across 358px would put a 45-minute session
 * at 20 pixels wide.
 *
 * No new SQL. `v_session_summary` already carries planned-vs-actual and
 * adherence; `v_block_facts` carries the per-block topic and timing the bars
 * are segmented by.
 *
 * Days are bucketed by the calendar date of `started_at` in the PROFILE's
 * timezone — the same zone the server stamps `session_blocks.local_day` with.
 * That is not the browser bucketing days; it is the browser asking a timezone
 * database to name a day for a given instant in a given zone.
 */

definePageMeta({ middleware: 'auth' })

useSeoMeta({ title: 'History' })

const {
  days,
  legend,
  startHour,
  endHour,
  pending,
  loadingMore,
  error,
  hasMore,
  load,
  loadMore,
  timeLabel
} = useHistory()

onMounted(load)

const isEmpty = computed(() => !pending.value && error.value === null && days.value.length === 0)
</script>

<template>
  <UContainer class="py-6 sm:py-8 lg:px-10">
    <div class="flex max-w-[980px] flex-col gap-[22px]">
      <header>
        <h1 class="font-display text-2xl font-semibold tracking-tight text-highlighted sm:text-[26px]">
          Session history
        </h1>
        <p class="mt-1.5 text-[13px] text-muted sm:text-sm">
          <span class="hidden sm:inline">What you planned, what actually happened — laid on the hours of each day.</span>
          <span class="sm:hidden">What you planned, what actually happened.</span>
        </p>
      </header>

      <!-- Error before empty, always: RLS returns `[]` for a failed read, and
           "no sessions yet" is the wrong thing to tell someone with a year of
           them. -->
      <UAlert
        v-if="error && days.length === 0"
        color="error"
        variant="soft"
        icon="i-lucide-triangle-alert"
        title="Could not load your history"
        :description="error"
        :actions="[{ label: 'Try again', color: 'neutral', variant: 'outline', onClick: () => load() }]"
      />

      <div
        v-else-if="pending"
        class="flex flex-col gap-4"
        aria-busy="true"
      >
        <USkeleton
          v-for="i in 3"
          :key="i"
          class="h-[120px] w-full rounded-xl"
        />
      </div>

      <EmptyState
        v-else-if="isEmpty"
        icon="i-lucide-history"
        title="No sessions yet"
        description="Finished sessions land here — with what you studied, for how long, and how it went."
        :action="{ label: 'Start focusing', icon: 'i-lucide-play', to: '/' }"
      />

      <template v-else>
        <!-- Desktop only: the legend names the colours the tape is drawn in,
             which the mobile cards make redundant by putting the topic in the
             tooltip a tap away. -->
        <div
          v-if="legend.length > 0"
          class="hidden flex-wrap items-center gap-x-3.5 gap-y-2 text-xs text-muted lg:flex"
        >
          <span
            v-for="topic in legend"
            :key="topic.name"
            class="flex items-center gap-1.5"
          >
            <span
              class="size-[9px] rounded-full"
              :style="topic.color ? { backgroundColor: topic.color } : undefined"
              :class="topic.color ? '' : 'bg-accented'"
            />
            {{ topic.name }}
          </span>
          <span class="flex items-center gap-1.5">
            <span class="size-[9px] rounded-[2px] bg-accented" />
            break
          </span>
          <span class="ml-auto">hover a session for the full story</span>
        </div>

        <div class="hidden flex-col gap-[22px] lg:flex">
          <HistoryDayTape
            v-for="day in days"
            :key="day.day"
            :day="day"
            :start-hour="startHour"
            :end-hour="endHour"
            :time-label="timeLabel"
          />
        </div>

        <div class="flex flex-col gap-[18px] lg:hidden">
          <HistoryDayCards
            v-for="day in days"
            :key="day.day"
            :day="day"
            :time-label="timeLabel"
          />
        </div>

        <!-- A later page failed: keep what loaded, but say so. -->
        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          icon="i-lucide-triangle-alert"
          title="Could not load more sessions"
          :description="error"
        />

        <div
          v-if="hasMore"
          class="flex justify-center pt-0.5"
        >
          <UButton
            color="neutral"
            variant="outline"
            :loading="loadingMore"
            :disabled="loadingMore"
            @click="loadMore"
          >
            Load more
          </UButton>
        </div>
        <p
          v-else
          class="pt-0.5 text-center text-xs text-dimmed"
        >
          You have reached the end.
        </p>
      </template>
    </div>
  </UContainer>
</template>
