<script setup lang="ts">
import type { ForestDay } from '~/composables/useForest'

/**
 * The desktop forest — `claude-design/forest-desktop-5a.html`.
 *
 * A single continuous landscape read left to right, oldest first. Canopies
 * overlap heavily on purpose: at 17px between trunks and a canopy radius up to
 * 20, a good month closes into one mass rather than a row of separate icons.
 * That overlap is the design, not an accident of spacing.
 *
 * Horizontal position is earned, not calendar-linear: a tree takes 17px, a
 * seedling 15, and a rest day only 7. So a fortnight off narrows to a clearing
 * instead of a long blank, and the picture stays about what you did.
 *
 * Widths are measured from the handoff. Beyond its three months the viewBox
 * simply gets wider and the card scrolls — trees keep their size rather than
 * shrinking to nothing, which is what `width: max(100%, …)` below buys.
 */
const props = defineProps<{
  days: ForestDay[]
  today: string | null
}>()

const HEIGHT = 420
/** Leading space before the first month post, and trailing space after the last tree. */
const LEAD = 42
const TAIL = 54
/** Step per day, by what that day earned. From the handoff. */
const STEP = { tree: 17, seedling: 15, bare: 7 } as const
/** A month post pushes the next tree this far clear of its label. */
const MONTH_GAP = 30

interface Planted { day: ForestDay, x: number, groundY: number }
interface Post { x: number, groundY: number, name: string }

const scene = computed(() => {
  const planted: Planted[] = []
  const posts: Post[] = []
  let cursor = LEAD

  for (const day of props.days) {
    if (day.monthStart) {
      posts.push({ x: cursor, groundY: panoramaGroundY(cursor), name: day.monthName })
      cursor += MONTH_GAP
    }
    if (day.kind !== 'bare') {
      planted.push({ day, x: cursor, groundY: panoramaGroundY(cursor) })
    }
    cursor += STEP[day.kind]
  }

  return { planted, posts, width: Math.max(cursor + TAIL, 600) }
})

/** The ground, sampled every 20 units like the handoff's own polyline. */
const groundPath = computed(() => {
  const w = scene.value.width
  const points: string[] = [`M0 ${HEIGHT}`]
  for (let x = 0; x <= w - 14; x += 20) points.push(`L${x} ${panoramaGroundY(x).toFixed(1)}`)
  points.push(`L${w} ${HEIGHT}`, 'Z')
  return points.join(' ')
})

/**
 * The two hill silhouettes.
 *
 * The handoff draws these as chained quadratic curves whose reflected control
 * points make each arc bigger than the last — fine across its fixed 1174, but
 * it would swing wildly over a forest three times as long. These are sines in
 * the same visible band instead (roughly 262–322 and 288–328, the part that
 * clears the ground line), re-emitted at the real width so a longer history
 * gets more ridges rather than stretched ones.
 */
function hillPath(baseY: number, amplitude: number, period: number, phase: number): string {
  const w = scene.value.width
  const points: string[] = [`M0 ${baseY}`]
  for (let x = 0; x <= w; x += 20) {
    points.push(`L${x} ${(baseY - amplitude * Math.sin((2 * Math.PI * (x + phase)) / period)).toFixed(1)}`)
  }
  points.push(`L${w} ${HEIGHT}`, `L0 ${HEIGHT}`, 'Z')
  return points.join(' ')
}

const hillFar = computed(() => hillPath(292, 30, 720, 10))
const hillNear = computed(() => hillPath(308, 20, 960, 20))

/** Kept off the right edge so the glow never clips. */
const sunX = computed(() => Math.max(120, scene.value.width - 160))

// The host is the OUTER card, not the scrolling strip: anchoring against a
// non-scrolling frame is what lets the card sit over the card's own padding
// without being clipped by `overflow-x-auto`.
const host = useTemplateRef<HTMLElement>('host')
const dayList = computed(() => props.days)
const { active, cardStyle, onPointerOver, onPointerLeave, onClick } = useForestHover(dayList, host)
</script>

<template>
  <div
    ref="host"
    class="forest-scene relative overflow-hidden rounded-[14px] border border-default bg-default shadow-sm"
  >
    <!-- The picture scrolls, the legend under it does not. -->
    <div class="overflow-x-auto">
      <svg
        :viewBox="`0 0 ${scene.width} ${HEIGHT}`"
        :style="{ width: `max(100%, ${Math.round(scene.width * 0.886)}px)` }"
        class="block h-auto"
        role="img"
        aria-label="Your forest — one tree for every day you cleared your daily goal"
        @pointerover="onPointerOver"
        @pointerleave="onPointerLeave"
        @click="onClick"
      >
        <defs>
          <linearGradient
            id="forest-sky"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop
              offset="0"
              stop-color="var(--forest-sky-top)"
            />
            <stop
              offset="1"
              stop-color="var(--forest-sky-bottom)"
            />
          </linearGradient>
        </defs>

        <rect
          :width="scene.width"
          :height="HEIGHT"
          fill="url(#forest-sky)"
        />

        <!-- Core then glow, in that order: the wider circle sits over the smaller
           one, which is what gives the sun its soft edge. -->
        <circle
          :cx="sunX"
          cy="76"
          r="34"
          fill="var(--forest-sun)"
          opacity="0.55"
        />
        <circle
          :cx="sunX"
          cy="76"
          r="52"
          fill="var(--forest-sun)"
          opacity="0.18"
        />

        <path
          :d="hillFar"
          fill="var(--forest-hill-far)"
          opacity="0.75"
        />
        <path
          :d="hillNear"
          fill="var(--forest-hill-near)"
          opacity="0.6"
        />
        <path
          :d="groundPath"
          fill="var(--forest-ground)"
        />

        <!-- Month posts sit on the ground line, behind the trees, like signposts. -->
        <g
          v-for="post in scene.posts"
          :key="post.name + post.x"
        >
          <line
            :x1="post.x"
            :y1="post.groundY"
            :x2="post.x"
            :y2="post.groundY - 26"
            stroke="var(--forest-post)"
            stroke-width="2.4"
          />
          <rect
            :x="post.x - 24"
            :y="post.groundY - 40"
            width="48"
            height="17"
            rx="3.5"
            fill="var(--forest-label-bg)"
            stroke="var(--forest-label-border)"
          />
          <text
            :x="post.x"
            :y="post.groundY - 28"
            text-anchor="middle"
            class="font-sans"
            font-size="9.5"
            font-weight="600"
            fill="var(--forest-label-text)"
          >{{ post.name }}</text>
        </g>

        <ForestMark
          v-for="mark in scene.planted"
          :key="mark.day.localDay"
          :day="mark.day"
          :x="mark.x"
          :ground-y="mark.groundY"
          :scale="FOREST_SCALE_DESKTOP"
          :just-planted="mark.day.localDay === today"
        />
      </svg>
    </div>

    <ForestDayCard
      v-if="active"
      :day="active"
      class="absolute z-10"
      :style="cardStyle"
    />

    <div class="flex flex-wrap items-center gap-x-[18px] gap-y-2 border-t border-muted px-5 py-3 text-xs text-muted">
      <span class="flex items-center gap-[7px]">
        <span class="size-[9px] rounded-[2px] bg-[var(--forest-tone-2)]" />
        goal cleared
      </span>
      <span class="flex items-center gap-[7px]">
        <span class="size-[9px] rounded-[2px] bg-[var(--forest-tone-0)]" />
        seedling — studied, fell short
      </span>
      <span class="flex items-center gap-[7px]">
        <span class="size-[9px] rounded-[2px] border border-[var(--forest-ground-edge)] bg-[var(--forest-ground)]" />
        rest day
      </span>
      <span class="ml-auto">deeper green = further past goal · hover a tree for that day's breakdown</span>
    </div>
  </div>
</template>
