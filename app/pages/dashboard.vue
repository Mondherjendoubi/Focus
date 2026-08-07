<script setup lang="ts">
/**
 * Dashboard — the first screen a returning user opens. Three questions,
 * above the fold: how much today, did I hit my goal, am I on a streak.
 *
 * Every number here comes from an analytics view. No client-side
 * aggregation of `session_blocks` — the views handle the timezone,
 * the kind filter, and the streak island math correctly, and this page
 * would only get them subtly wrong.
 */
definePageMeta({ middleware: 'auth' })

useSeoMeta({ title: 'Dashboard' })

const { today, weekSeconds, streak, timezone, goalMinutes, pending, error, refresh } = useStats()

// Fire the fetch but do not await — the reactive `pending` flag gates
// the skeleton so the user never sees a blank screen while it runs.
void refresh()

// `v_daily_totals` filter-aggregates focus separately, so `focus_seconds`,
// `focus_minutes`, and `goal_met` are null on days with only breaks and
// missing entirely on days with no rows at all. Coerce for display without
// lying in the type.
const focusSeconds = computed(() => today.value?.focus_seconds ?? 0)
const focusMinutes = computed(() => today.value?.focus_minutes ?? 0)
const sessionCount = computed(() => today.value?.session_count ?? 0)
const interruptions = computed(() => today.value?.interruptions ?? 0)

// Prefer today's row for the goal (in case the profile was updated
// after the row was aggregated by the DB), fall back to the profile.
const effectiveGoal = computed(() => today.value?.goal_minutes ?? goalMinutes.value)

const todayLabel = computed(() => todayLocalDay(timezone.value))

const hasAnyActivity = computed(
  () => focusSeconds.value > 0 || (streak.value?.longest_streak ?? 0) > 0
)
</script>

<template>
  <UContainer class="py-6 sm:py-10">
    <div class="flex flex-col gap-10 sm:gap-12">
      <header class="flex flex-col gap-1">
        <h1 class="font-display text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">
          Dashboard
        </h1>
        <p class="text-sm text-muted">
          {{ todayLabel }} · {{ timezone }}
        </p>
      </header>

      <!-- Error takes precedence: a failed query rendered as zero would
           tell a user with real history that they have none. -->
      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        icon="i-lucide-triangle-alert"
        title="Couldn't load your stats"
        :description="error"
        :actions="[{ label: 'Retry', onClick: () => refresh(), color: 'neutral', variant: 'outline' }]"
      />

      <template v-else-if="pending">
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <USkeleton
            v-for="i in 4"
            :key="i"
            class="h-24"
          />
        </div>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <USkeleton class="h-64" />
          <USkeleton class="h-64" />
        </div>
      </template>

      <template v-else>
        <!-- Stat tiles: wrap 4 -> 2 -> (implicit 1 via grid-cols-2 at 375px). -->
        <section
          aria-label="Today's totals"
          class="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4"
        >
          <StatTile
            label="Today"
            :value="formatDuration(focusSeconds)"
            icon="i-lucide-timer"
            hint="Focused time"
          />
          <StatTile
            label="Sessions"
            :value="String(sessionCount)"
            icon="i-lucide-play-circle"
            hint="Started today"
          />
          <StatTile
            label="Interruptions"
            :value="String(interruptions)"
            icon="i-lucide-bell"
            hint="Paused blocks"
          />
          <StatTile
            label="This week"
            :value="formatDuration(weekSeconds)"
            icon="i-lucide-calendar-range"
            hint="Last 7 days"
          />
        </section>

        <section
          aria-label="Goal and streak"
          class="grid grid-cols-1 gap-4 md:grid-cols-2"
        >
          <GoalRing
            :focus-minutes="focusMinutes"
            :goal-minutes="effectiveGoal"
          />
          <StreakCard
            :current="streak?.current_streak ?? 0"
            :longest="streak?.longest_streak ?? 0"
            :last-active-day="streak?.last_active_day ?? null"
          />
        </section>

        <!-- Charts (FA-010) in the left cell, topic leaderboard (FA-011)
             in the right. Both are self-fetching; the dashboard shell does
             not wait on them. -->
        <section
          aria-label="Trends and breakdowns"
          class="grid grid-cols-1 gap-4 lg:grid-cols-2"
        >
          <div class="flex flex-col gap-4">
            <DailyFocusChart />
            <FocusHeatmap />
          </div>
          <TopicLeaderboard />
        </section>

        <!-- Zero state for a brand-new user: no focus today, no history
             at all. The checklist walks them through timezone, first
             topic, first session — and dismisses itself once done. It
             self-hides if any of its probe queries error, so a returning
             user with a bad fetch never sees "get started" over history. -->
        <OnboardingChecklist v-if="!hasAnyActivity" />
      </template>
    </div>
  </UContainer>
</template>
