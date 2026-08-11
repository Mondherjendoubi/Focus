<script setup lang="ts">
import type { ForestDay } from '~/composables/useForest'

/**
 * One day, as a tree (FA-023).
 *
 * The shape is **generated from the date**, not picked from a set. A hash of
 * `local_day` seeds a small PRNG, so a given day draws the same tree forever —
 * across reloads, across route changes, across devices. `Math.random()` would
 * re-roll on every render and the forest would visibly reshuffle each time the
 * user navigated back to it, which turns a place into a screensaver.
 *
 * The tone is data, not decoration: how deep the green goes is how far past the
 * goal that day went. A month of double-goal days reads as a dark band from
 * across the room. That is the whole answer to why 200 trees do not become
 * wallpaper — no two are alike, and the differences mean something.
 *
 * Everything is one flat silhouette in `currentColor`. A trunk in a second
 * colour reads as a cartoon at 24px; a single fill reads as a woodcut.
 */
const props = defineProps<{
  day: ForestDay
  /** Earned today. The one tree allowed to animate in. */
  justPlanted?: boolean
}>()

/** The drawing box. Every mark shares it, so they all sit on the same ground line. */
const W = 24
const H = 34
const GROUND = H

/**
 * FNV-1a over the date string. Cheap, and well-mixed enough that adjacent days
 * — which differ by one character — produce unrelated trees rather than a row
 * of near-identical ones.
 */
function hashSeed(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32 — small, fast, and deterministic from the seed above. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 0 for a day that landed exactly on the goal, 1 for 2.5× it and beyond.
 * Everything about the tree's size and tone hangs off this.
 */
const strength = computed(() => {
  const over = (props.day.ratio - 1) / 1.5
  return Math.max(0, Math.min(1, over))
})

/**
 * Five tones, and dark mode walks the ramp the other way: on white, deeper
 * green reads as stronger; on a near-black card, deep green reads as *absent*,
 * so there the strong days are the bright ones.
 *
 * Written out in full because Tailwind scans source for literal class strings —
 * a composed `text-success-${n}` would never be generated.
 */
const TONES = [
  'text-success-300 dark:text-success-700',
  'text-success-400 dark:text-success-600',
  'text-success-500 dark:text-success-500',
  'text-success-600 dark:text-success-400',
  'text-success-700 dark:text-success-300'
] as const

const tone = computed(() => TONES[Math.min(TONES.length - 1, Math.floor(strength.value * TONES.length))]!)

/** The whole tree, resolved once per day. */
const shape = computed(() => {
  const rand = makeRng(hashSeed(props.day.localDay))
  const s = strength.value

  // Lean is the only purely cosmetic variable, and it is kept small: a row of
  // trees at wild angles reads as a storm, not a forest.
  const lean = (rand() - 0.5) * 2
  const trunkLength = 10 + s * 5
  const canopyR = 5.2 + s * 1.2
  const cx = W / 2 + lean
  const cy = GROUND - trunkLength - canopyR * 0.5

  // The taper is gentle on purpose. A trunk that narrows to a point disappears
  // at this size — at 24px wide, a half-width of 0.7 renders under one pixel
  // and the canopy reads as floating.
  const halfTop = 0.95
  const halfBottom = 1.5
  const trunk = [
    `M${W / 2 - halfBottom} ${GROUND}`,
    `L${(cx - halfTop).toFixed(2)} ${cy.toFixed(2)}`,
    `L${(cx + halfTop).toFixed(2)} ${cy.toFixed(2)}`,
    `L${W / 2 + halfBottom} ${GROUND}`,
    'Z'
  ].join(' ')

  // Three to five lobes fanned across the upper half. Angles are spread evenly
  // and then jittered, rather than drawn at random, so no tree ends up with
  // every lobe stacked on one side.
  const lobes = 3 + Math.floor(rand() * 3)
  const blobs = [{ cx, cy, r: canopyR }]
  for (let i = 0; i < lobes; i++) {
    const spread = 140 / lobes
    const deg = 200 + (i + 0.5) * spread + (rand() - 0.5) * 20
    const rad = (deg * Math.PI) / 180
    const dist = canopyR * (0.55 + rand() * 0.3)
    blobs.push({
      cx: cx + Math.cos(rad) * dist,
      cy: cy + Math.sin(rad) * dist,
      r: canopyR * (0.5 + rand() * 0.25)
    })
  }

  return { trunk, blobs }
})

const label = computed(() => {
  const when = `${dayLabel(props.day.localDay)} ${props.day.localDay}`
  return `${when} — ${formatDuration(props.day.focusSeconds)}, goal met`
})
</script>

<template>
  <svg
    :viewBox="`0 0 ${W} ${H}`"
    class="h-[34px] w-6 shrink-0 origin-bottom"
    :class="[tone, justPlanted ? 'animate-grow' : '']"
    role="img"
    :aria-label="label"
    fill="currentColor"
  >
    <title>{{ label }}</title>
    <path :d="shape.trunk" />
    <circle
      v-for="(blob, i) in shape.blobs"
      :key="i"
      :cx="blob.cx"
      :cy="blob.cy"
      :r="blob.r"
    />
  </svg>
</template>
