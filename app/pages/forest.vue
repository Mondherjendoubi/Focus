<script setup lang="ts">
/**
 * Forest — one tree per day the daily goal was cleared (FA-023).
 *
 * The first thing in this app that gets bigger the longer you use it. The
 * recap resets weekly, the timer resets daily, the streak resets the moment you
 * miss; a forest only accumulates.
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

const { months, treeCount, goalMinutes, today, pending, error, refresh } = useForest()

void refresh()

/**
 * A zero daily goal means no day can ever earn a tree — see `earnedTree`, where
 * the view's unguarded `goal_met` is corrected. That is a setting to change,
 * not an empty forest, so it gets its own state rather than falling through to
 * "nothing here yet".
 */
const goalOff = computed(() => !pending.value && error.value === null && goalMinutes.value === 0)

const isEmpty = computed(() =>
  !pending.value && error.value === null && !goalOff.value && treeCount.value === 0
)
</script>

<template>
  <UContainer class="py-6 sm:py-8 lg:px-10">
    <div class="flex min-h-[calc(100vh-6rem)] flex-col gap-5">
      <header>
        <h1 class="font-display text-2xl font-semibold tracking-tight text-highlighted sm:text-[26px]">
          Forest
        </h1>
        <!-- The count lives in the sentence rather than in a stat tile beside
             it: the number and the rule that produces it are one thought, and
             splitting them leaves a big figure that explains nothing. -->
        <p class="mt-1.5 max-w-xl text-sm text-muted">
          <template v-if="goalMinutes > 0">
            <span class="font-semibold text-highlighted">
              {{ treeCount }} {{ treeCount === 1 ? 'tree' : 'trees' }}
            </span>
            — one for every day you cleared your {{ formatDuration(goalMinutes * 60) }} goal.
            Days you studied but fell short show as seedlings.
          </template>
          <template v-else>
            A tree for every day you clear your daily goal.
          </template>
        </p>
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

      <div
        v-else-if="pending"
        class="flex flex-col gap-4"
      >
        <USkeleton
          v-for="i in 2"
          :key="i"
          class="h-[130px] w-full rounded-xl"
        />
      </div>

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
        title="Nothing planted yet"
        :description="`Clear ${formatDuration(goalMinutes * 60)} of focus in a day and the first tree appears here.`"
        :action="{ label: 'Start a session', icon: 'i-lucide-timer', to: '/' }"
      />

      <div
        v-else
        class="flex flex-col gap-4"
      >
        <ForestMonth
          v-for="month in months"
          :key="month.key"
          :month="month"
          :today="today"
        />
      </div>
    </div>
  </UContainer>
</template>
