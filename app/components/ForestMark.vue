<script setup lang="ts">
import type { ForestDay } from '~/composables/useForest'

/**
 * One day, planted at `(x, groundY)` (FA-023).
 *
 * Shared by both scenes so the panorama and the trail can never draw the same
 * day differently — they pass their own `scale` and their own anchor, and
 * nothing else about the mark changes.
 *
 * The geometry all comes from `app/utils/forest.ts`, which is measured off the
 * 5a/5b handoffs. Three species and a seedling, picked deterministically from
 * the date, so a given day looks the same forever.
 */
const props = defineProps<{
  day: ForestDay
  x: number
  groundY: number
  scale: number
  /** Earned today. The one mark allowed to animate in. */
  justPlanted?: boolean
}>()

const isTree = computed(() => props.day.kind === 'tree')

const tree = computed(() =>
  isTree.value ? buildTree(props.day.localDay, props.day.ratio, props.x, props.groundY, props.scale) : null
)

const seedling = computed(() =>
  props.day.kind === 'seedling' ? buildSeedling(props.x, props.groundY, props.scale) : null
)

/** `--forest-tone-0` … `-4`. Seedlings are always tone 1, however short they fell. */
const toneIndex = computed(() => treeToneIndex(treeStrength(props.day.ratio)))

const tone = computed(() =>
  isTree.value ? `var(--forest-tone-${toneIndex.value})` : 'var(--forest-tone-1)'
)

/**
 * The outline colour, two ramp steps darker than the canopy (FA-027).
 *
 * Canopies overlap by roughly half, so without an edge a run of same-tone days
 * merges into one shape. Scaled with the mark so it holds at the panorama's
 * scale 1, the trail's 0.912 and the welcome hero's 3.4.
 */
const edge = computed(() => `var(--forest-edge-${toneIndex.value})`)
const edgeWidth = computed(() => 1.7 * props.scale)

/**
 * The hover target. The scene puts ONE delegated listener on its `<svg>` and
 * resolves the mark from this attribute, so a forest with hundreds of trees
 * still has a single listener.
 *
 * `<title>` used to live here for the native tooltip. It is gone deliberately:
 * the rich card would otherwise be shadowed a second later by the browser's own
 * one-line version of the same thing. Nothing is lost to assistive tech — the
 * scene's `<svg>` carries `role="img"`, so these inner titles were never
 * announced in the first place.
 */
const hitbox = computed(() => props.day.localDay)
</script>

<template>
  <g
    v-if="tree"
    :data-day="hitbox"
    class="cursor-pointer"
    :class="justPlanted ? 'animate-grow' : ''"
    :style="justPlanted ? { transformOrigin: `${x}px ${groundY}px` } : undefined"
  >
    <ellipse
      :cx="x"
      :cy="groundY"
      :rx="tree.shadow.rx"
      :ry="tree.shadow.ry"
      fill="var(--forest-shadow)"
      :opacity="`var(--forest-shadow-opacity)`"
    />

    <!-- Drawn twice (FA-027): pass 1 strokes the same shapes in the edge colour
         to lay down a silhouette one half-stroke wider than the tree, pass 2
         fills over it. Stroking each shape once instead would also outline the
         seams where a canopy's own lobes overlap, which draws a bag of circles
         rather than a canopy — pass 2's fills are what hide those. -->
    <g
      v-for="pass in 2"
      :key="pass"
      :fill="pass === 1 ? edge : tone"
      :stroke="pass === 1 ? edge : undefined"
      :stroke-width="pass === 1 ? edgeWidth : undefined"
      stroke-linejoin="round"
    >
      <template v-if="tree.species === 'deciduous'">
        <path :d="tree.trunk" />
        <circle
          v-for="(blob, i) in tree.blobs"
          :key="i"
          :cx="blob.cx"
          :cy="blob.cy"
          :r="blob.r"
        />
      </template>

      <template v-else>
        <rect
          :x="tree.post!.x"
          :y="tree.post!.y"
          :width="tree.post!.width"
          :height="tree.post!.height"
        />
        <!-- Conifer: three tiers, top drawn first so the wider ones below overlap it. -->
        <path
          v-for="(tier, i) in tree.tiers ?? []"
          :key="i"
          :d="tier"
        />
        <ellipse
          v-if="tree.crown"
          :cx="tree.crown.cx"
          :cy="tree.crown.cy"
          :rx="tree.crown.rx"
          :ry="tree.crown.ry"
        />
      </template>
    </g>
  </g>

  <g
    v-else-if="seedling"
    :data-day="hitbox"
    :stroke="tone"
    :stroke-width="seedling.strokeWidth"
    stroke-linecap="round"
    fill="none"
    class="cursor-pointer"
  >
    <!-- A seedling is a thin stroke, so the stroke itself is a poor target.
         This invisible disc gives it the same reach as a small tree. -->
    <circle
      :cx="x"
      :cy="groundY - 6 * scale"
      :r="11 * scale"
      fill="transparent"
      stroke="none"
    />
    <ellipse
      :cx="x"
      :cy="groundY"
      :rx="seedling.shadow.rx"
      :ry="seedling.shadow.ry"
      fill="var(--forest-shadow)"
      opacity="0.06"
      stroke="none"
    />
    <path :d="seedling.stem" />
    <path
      v-for="(leaf, i) in seedling.leaves"
      :key="i"
      :d="leaf"
    />
  </g>
</template>
