<script setup lang="ts">
import type { ForestDay } from '~/composables/useForest'

/**
 * The mobile forest — `claude-design/forest-mobile-5b.html`.
 *
 * Same days as the panorama, turned ninety degrees: a trail winding down the
 * screen with the trees scattered either side of it. **Newest first**, unlike
 * the panorama — on a phone the top of the page is where you land, and what you
 * came to see is whether today has a tree yet.
 *
 * The rhythm is flatter than the panorama's — every marked day takes 30 and a
 * rest day 11, with no distinction between a tree and a seedling — because
 * vertical space is cheap here and the trail needs a steady cadence to read as
 * a path rather than a list.
 */
const props = defineProps<{
  days: ForestDay[]
  today: string | null
}>()

const WIDTH = 358
const HEAD = 92
const TAIL = 74
const STEP_MARKED = 30
const STEP_BARE = 11
/** How far above its first day a month pill sits — more for the very first one. */
const PILL_LIFT = 18
const PILL_LIFT_FIRST = 40

interface Planted { day: ForestDay, x: number, y: number }
interface Pill { y: number, name: string }

const scene = computed(() => {
  const planted: Planted[] = []
  const pills: Pill[] = []
  // Newest at the top, so the list is walked backwards.
  const ordered = [...props.days].reverse()

  let cursor = HEAD
  let seenMonth: string | null = null

  for (const day of ordered) {
    const key = day.localDay.slice(0, 7)
    if (key !== seenMonth) {
      pills.push({ y: cursor - (seenMonth === null ? PILL_LIFT_FIRST : PILL_LIFT), name: day.monthName })
      seenMonth = key
    }

    if (day.kind !== 'bare') {
      planted.push({ day, x: trailX(cursor, WIDTH) + trailOffset(day.localDay), y: cursor })
      cursor += STEP_MARKED
    } else {
      cursor += STEP_BARE
    }
  }

  return { planted, pills, height: Math.max(cursor - STEP_MARKED + TAIL, 320) }
})

/**
 * The path itself, sampled every 15 units. The handoff samples it at each day
 * slot; a fixed interval gives the same curve without tying the trail's
 * smoothness to how many rest days happen to be in the run.
 */
const trailPath = computed(() => {
  const points: string[] = []
  for (let y = HEAD - 28; y <= scene.value.height - TAIL + 20; y += 15) {
    points.push(`${points.length === 0 ? 'M' : 'L'}${trailX(y, WIDTH).toFixed(1)} ${y}`)
  }
  return points.join(' ')
})
</script>

<template>
  <div class="forest-scene">
    <svg
      :viewBox="`0 0 ${WIDTH} ${scene.height}`"
      class="block h-auto w-full"
      role="img"
      aria-label="Your forest trail, newest at the top"
    >
      <!-- Two strokes make the path: the bed, then a dashed centre line over it. -->
      <path
        :d="trailPath"
        fill="none"
        stroke="var(--forest-ground-edge)"
        stroke-width="7"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        :d="trailPath"
        fill="none"
        stroke="var(--forest-label-bg)"
        stroke-width="2"
        stroke-dasharray="1 9"
        stroke-linecap="round"
      />

      <g
        v-for="pill in scene.pills"
        :key="pill.name + pill.y"
      >
        <rect
          x="12"
          :y="pill.y"
          width="58"
          height="20"
          rx="10"
          fill="var(--forest-label-bg)"
          stroke="var(--forest-label-border)"
        />
        <text
          x="41"
          :y="pill.y + 14"
          text-anchor="middle"
          class="font-sans"
          font-size="10"
          font-weight="600"
          fill="var(--forest-label-text)"
        >{{ pill.name }}</text>
      </g>

      <ForestMark
        v-for="mark in scene.planted"
        :key="mark.day.localDay"
        :day="mark.day"
        :x="mark.x"
        :ground-y="mark.y"
        :scale="FOREST_SCALE_MOBILE"
        :just-planted="mark.day.localDay === today"
      />
    </svg>
  </div>
</template>
