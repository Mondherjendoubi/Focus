<script setup lang="ts">
/**
 * Forest — one tree per day the daily goal was cleared (FA-023).
 *
 * Built to `claude-design/forest-desktop-5a.html` and `forest-mobile-5b.html`.
 * Two genuinely different scenes rather than one responsive layout: a panorama
 * read left to right on desktop, a trail read top to bottom on the phone. They
 * split at `lg`, the same breakpoint the app shell uses for its sidebar, so
 * there is no width at which both render and none at which neither does.
 *
 * Deliberately not Forest-the-app: nothing here dies. A missed day is bare
 * ground, never a penalty. That follows the line the motivation layer already
 * drew — FA-017 gated the confetti so a reward would stay a reward, and FA-022
 * refused to rank friends because losing is an efficient way to lose the
 * person. Punishment would be off-key in the same way.
 *
 * Needs no migration: `v_daily_totals` already carries `goal_met` per day.
 */

definePageMeta({ middleware: 'auth' })

useSeoMeta({ title: 'Forest' })

const {
  days,
  treeCount,
  seedlingCount,
  bestMonth,
  goalMinutes,
  today,
  pending,
  error,
  refresh
} = useForest()

void refresh()

/**
 * A zero daily goal means no day can ever earn a tree — see `earnedTree`, where
 * the view's unguarded `goal_met` is corrected. That is a setting to change,
 * not an empty forest, so it gets its own state rather than falling through to
 * "nothing here yet".
 */
const goalOff = computed(() => !pending.value && error.value === null && goalMinutes.value === 0)

const isEmpty = computed(() =>
  !pending.value && error.value === null && !goalOff.value && treeCount.value === 0 && seedlingCount.value === 0
)

const hasScene = computed(() =>
  !pending.value && error.value === null && !goalOff.value && !isEmpty.value
)

const goalLabel = computed(() => formatDuration(goalMinutes.value * 60))

const stats = computed(() => [
  { value: String(treeCount.value), label: treeCount.value === 1 ? 'tree' : 'trees' },
  { value: String(seedlingCount.value), label: seedlingCount.value === 1 ? 'seedling' : 'seedlings' },
  { value: bestMonth.value ?? '—', label: 'best month' }
])
</script>

<template>
  <UContainer class="py-6 sm:py-8 lg:px-10">
    <div class="flex flex-col gap-5">
      <header class="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 class="font-display text-2xl font-semibold tracking-tight text-highlighted sm:text-[26px]">
            Forest
          </h1>
          <!-- The counts live in the sentence as well as the cards: the number
               and the rule that produces it are one thought, and a bare figure
               beside a picture of trees explains nothing on its own. -->
          <p class="mt-1.5 max-w-[560px] text-[13px] text-muted sm:text-sm">
            <template v-if="goalMinutes > 0">
              <span class="font-semibold text-highlighted">
                {{ treeCount }} {{ treeCount === 1 ? 'tree' : 'trees' }}
              </span>
              — one for every day you cleared your {{ goalLabel }} goal.
              <template v-if="seedlingCount > 0">
                {{ seedlingCount }} {{ seedlingCount === 1 ? 'seedling marks a day' : 'seedlings mark days' }}
                you came close.
              </template>
            </template>
            <template v-else>
              A tree for every day you clear your daily goal.
            </template>
          </p>
        </div>

        <!-- Desktop only, per 5a. The phone header stays two lines. -->
        <div
          v-if="hasScene"
          class="hidden shrink-0 gap-2.5 lg:flex"
        >
          <div
            v-for="stat in stats"
            :key="stat.label"
            class="rounded-[10px] border border-default bg-default px-4 py-2.5 text-center"
          >
            <p class="font-display text-xl font-semibold tabular-nums text-highlighted">
              {{ stat.value }}
            </p>
            <p class="mt-px text-[11px] text-muted">
              {{ stat.label }}
            </p>
          </div>
        </div>
      </header>

      <!-- Error first, always. RLS returns `[]` for a failed query, so an
           unreported error would render as an empty forest to someone who has
           been studying for months. -->
      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        icon="i-lucide-triangle-alert"
        title="Couldn't load your forest"
        :description="error"
        :actions="[{ label: 'Retry', onClick: () => refresh(), color: 'neutral', variant: 'outline' }]"
      />

      <USkeleton
        v-else-if="pending"
        class="h-[300px] w-full rounded-[14px] lg:h-[420px]"
      />

      <EmptyState
        v-else-if="goalOff"
        icon="i-lucide-target"
        title="Your daily goal is switched off"
        description="Trees are planted by clearing a daily goal, so nothing can grow until you set one. Pick a target you'd hit on an ordinary day, not a good one."
        :action="{ label: 'Set a daily goal', icon: 'i-lucide-settings', to: '/settings' }"
      />

      <EmptyState
        v-else-if="isEmpty"
        icon="i-lucide-sprout"
        :title="'Nothing planted yet'"
        :description="`Clear ${goalLabel} of focus in a day and the first tree appears here.`"
        :action="{ label: 'Start a session', icon: 'i-lucide-timer', to: '/' }"
      />

      <template v-else>
        <ForestPanorama
          class="hidden lg:block"
          :days="days"
          :today="today"
        />
        <ForestTrail
          class="lg:hidden"
          :days="days"
          :today="today"
        />
      </template>
    </div>
  </UContainer>
</template>
