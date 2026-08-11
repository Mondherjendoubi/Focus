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
const tone = computed(() =>
  isTree.value ? `var(--forest-tone-${treeToneIndex(treeStrength(props.day.ratio))})` : 'var(--forest-tone-1)'
)

const label = computed(() => {
  const when = `${dayLabel(props.day.localDay)} ${props.day.localDay}`
  const outcome = isTree.value ? 'goal met' : 'short of goal'
  return `${when} — ${formatDuration(props.day.focusSeconds)}, ${outcome}`
})
</script>

<template>
  <g
    v-if="tree"
    :fill="tone"
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
    <title>{{ label }}</title>

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

  <g
    v-else-if="seedling"
    :stroke="tone"
    :stroke-width="seedling.strokeWidth"
    stroke-linecap="round"
    fill="none"
  >
    <title>{{ label }}</title>
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
