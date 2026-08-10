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

// FA-015 — the deep-analytics section below the fold. One composable feeds all
// four cards by props rather than each fetching itself, because the range
// picker drives all of them at once and four self-fetching cards would mean
// four refetches per click. Aliased on destructure: `pending` and `error` are
// already taken by the stats above, and these two are a separate failure
// domain — the analytics section can error without blanking the tiles.
const {
  range: analyticsRange,
  quality,
  consistency,
  efficiency,
  bestHours,
  daypartRatings,
  pending: analyticsPending,
  error: analyticsError,
  setRange,
  refresh: refreshAnalytics
} = useAnalytics()

void refreshAnalytics()
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
        <!-- FA-017 — the week as a sentence, in the most prominent slot on the
             page. Self-fetching and self-hiding: renders nothing at all until
             there is a week worth recapping, so a new account is not greeted by
             a headline of zeroes. Its window is a fixed 7 days and is
             deliberately NOT wired to the range picker further down. -->
        <WeeklyRecapCard />

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
          <!-- `focusedToday` is what turns the streak card from a counter into
               a prompt. It is decided here because this page already holds
               today's row, keyed on the profile's timezone rather than the
               browser's. -->
          <StreakCard
            :current="streak?.current_streak ?? 0"
            :longest="streak?.longest_streak ?? 0"
            :last-active-day="streak?.last_active_day ?? null"
            :focused-today="focusSeconds > 0"
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

        <!-- FA-015 — deep analytics. Everything ABOVE this heading has its own
             fixed window and is untouched by the range picker; the subtitle
             says so, and the picker sits inside this header rather than at the
             top of the page so its reach reads visually too. -->
        <!-- Hidden entirely for an account with no history: four cards each
             saying "no data" above the onboarding checklist is noise at exactly
             the moment the user needs one clear instruction. -->
        <section
          v-if="hasAnyActivity"
          aria-labelledby="analytics-heading"
          class="flex flex-col gap-4"
        >
          <div class="flex flex-wrap items-end justify-between gap-3 border-t border-default pt-8">
            <div class="flex flex-col gap-1">
              <h2
                id="analytics-heading"
                class="font-display text-lg font-semibold tracking-tight text-highlighted"
              >
                Deeper look
              </h2>
              <p class="text-sm text-muted">
                Scoped to the last {{ analyticsRange }} days — the cards above are not.
              </p>
            </div>
            <AnalyticsRangePicker
              :model-value="analyticsRange"
              :disabled="analyticsPending"
              @update:model-value="setRange"
            />
          </div>

          <!-- Same rule as the stats above: a failed read must never render as
               zeroes. A user with months of history being told they have none
               is this app's worst failure mode. -->
          <UAlert
            v-if="analyticsError"
            color="error"
            variant="soft"
            icon="i-lucide-triangle-alert"
            title="Couldn't load your analytics"
            :description="analyticsError"
            :actions="[{ label: 'Retry', onClick: () => refreshAnalytics(), color: 'neutral', variant: 'outline' }]"
          />

          <div
            v-else
            class="grid grid-cols-1 gap-4 lg:grid-cols-2"
          >
            <ConsistencyCard
              :consistency="consistency"
              :pending="analyticsPending"
            />
            <FocusQualityCard
              :quality="quality"
              :pending="analyticsPending"
            />
            <EfficiencyCard
              :efficiency="efficiency"
              :pending="analyticsPending"
            />
            <BestHoursChart
              :best-hours="bestHours"
              :pending="analyticsPending"
            />
            <!-- "When do I study" sits above; this is "when do I study well".
                 They read as a pair, so they stay adjacent. -->
            <RatingByDaypartCard
              :dayparts="daypartRatings"
              :pending="analyticsPending"
            />
            <!-- FA-016. Self-fetching and self-hiding: it renders nothing at
                 all when there are no active goals, so it does not leave a
                 hole in the grid for users who never set one. Its own periods
                 are fixed (day / week / month), so the range picker above
                 correctly does not touch it. -->
            <GoalProgressCard />
          </div>
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
