<script setup lang="ts">
import type { ForestDay } from '~/composables/useForest'

/**
 * The welcome wizard's illustration — `claude-design/welcome-{desktop-7a,mobile-7b}.html`.
 *
 * One landscape, three scenes, switched by the step the user is on: the tree
 * their goal would earn, a sapling per topic they name, and the trail through
 * the five places in the app. Both handoffs draw the identical 460×700 scene —
 * desktop hangs it in a 400px right pane, mobile crops it to a 208px band — so
 * it lives here once and the page picks the frame.
 *
 * Colours come from `.forest-scene` in `main.css` rather than the handoff's
 * hexes. They are the same values, and the forest already owns them: this is
 * the picture the wizard is promising, so it has to be lit like the real one,
 * dusk palette included. The handoffs are light-only.
 *
 * **The hero tree deliberately departs from 7a.** The handoff drew a bespoke
 * lollipop — trunk 2.37× its canopy radius, always the same blob, greened by
 * how *large* the goal is — and none of that is what FA-023 plants. A real tree
 * has a trunk 1.28× its canopy, is one of three species picked from the date,
 * and takes its green from how far past goal the day went, so a day that lands
 * exactly on target is the palest one there is. Drawing the handoff's tree
 * under the words "a tree like this is planted" made the screen a promise the
 * forest does not keep. This renders `ForestMark` at `ratio = 1` instead: the
 * actual tree, for today's actual date, that clearing the goal actually earns.
 */

/**
 * The two frames the scene is hung in, and the only reason its background paths
 * run out to ±300 beyond the drawing.
 *
 * `slice` scales to cover, so whichever axis is proportionally tighter sets the
 * zoom. In the tall desktop panel that is the width, which is what makes the
 * full 460×700 read as a landscape. In a short full-width band it would be the
 * width too — and a band that gets wider zooms further in and eats the crown
 * from the top, which is exactly what a 900px window did. Handing the band a
 * slab 1060 wide and 230 tall flips it: height governs at every width up to the
 * `lg` switch, so the tree is never cropped again.
 */
const FRAMES = {
  panel: '0 0 460 700',
  band: '-300 470 1060 230'
} as const

const props = defineProps<{
  /** 0 = your day, 1 = topics, 2 = the tour. */
  step: number
  /** `band` above the form on a phone, `panel` in the right pane on a desktop. */
  frame: keyof typeof FRAMES
  /** Rendered into the step-0 caption, already formatted by the page. */
  goalLabel: string
  /** Seeds today's date, so the hero is the tree tonight would really plant. */
  timezone: string
  topics: ReadonlyArray<{ name: string, color: string }>
  /** The tour destinations, in order — labels for the trail's five waypoints. */
  places: ReadonlyArray<string>
}>()

// ---------------------------------------------------------------------------
// Scene 0 — the tree the goal earns
// ---------------------------------------------------------------------------

/**
 * Panorama scale is tuned for trees 17px apart; one tree alone in this frame
 * has to carry it. The ceiling is the mobile band: `slice` on a 390×208 crop
 * shows only y 455…700, and the tallest thing `buildTree` can return at this
 * ratio reaches `620 - 3.19 × size`. 3.4 puts that at ~485 — clear of the crop
 * on a phone, and still taller than the handoff's own tree on a desktop.
 */
const HERO_SCALE = 3.4

/**
 * `ratio: 1` is the whole point — exactly clearing the goal, which is what the
 * caption promises and nothing more. Everything the mark reads is set here; the
 * fields the hover card would use stay empty because nothing hovers this one.
 */
const heroDay = computed<ForestDay>(() => ({
  localDay: todayLocalDay(props.timezone),
  kind: 'tree',
  focusSeconds: 0,
  ratio: 1,
  monthStart: false,
  monthName: '',
  sessionCount: 0,
  interruptions: 0,
  topics: []
}))

// ---------------------------------------------------------------------------
// Scene 1 — a sapling per topic
// ---------------------------------------------------------------------------

/** Six is what the ground fits at 60 units apart before the row runs off the edge. */
const SAPLING_LIMIT = 6

const saplings = computed(() =>
  props.topics.slice(0, SAPLING_LIMIT).map((topic, index) => {
    const x = 82 + index * 60
    // Alternating rows: a straight line of six reads as a fence, not a planting.
    const y = 616 - (index % 2) * 26

    return {
      key: `${index}:${topic.name}`,
      color: topic.color,
      label: topic.name.length > 9 ? `${topic.name.slice(0, 8)}…` : topic.name,
      x,
      y,
      stem: `M${x} ${y} L${x} ${y - 16}`,
      leaves: [
        `M${x} ${y - 9} C${x - 7} ${y - 10} ${x - 9} ${y - 19} ${x - 7} ${y - 20} C${x - 2} ${y - 20} ${x} ${y - 14} ${x} ${y - 11}`,
        `M${x} ${y - 11} C${x + 2} ${y - 16} ${x + 4} ${y - 22} ${x + 8} ${y - 22} C${x + 9} ${y - 16} ${x + 4} ${y - 12} ${x} ${y - 11}`
      ]
    }
  })
)

// ---------------------------------------------------------------------------
// Scene 2 — the trail
// ---------------------------------------------------------------------------

const TRAIL = 'M95 618 L205 583 L130 535 L262 505 L358 547'

/**
 * The handoff's trail, lifted and compressed into y 505…618 from its original
 * 516…650. Both ends were in trouble: at 650 the first waypoint sat under the
 * caption pill in the desktop panel (it does in the handoff too), and lifting
 * the whole path instead would have pushed the fourth waypoint's label off the
 * top of the band's shorter slab. This is the window that clears both.
 */
const WAYPOINTS = [
  { x: 95, y: 618 },
  { x: 205, y: 583 },
  { x: 130, y: 535 },
  { x: 262, y: 505 },
  { x: 358, y: 547 }
] as const

const stops = computed(() =>
  WAYPOINTS.map((point, index) => ({ ...point, number: index + 1, label: props.places[index] ?? '' }))
)

const caption = computed(() => {
  if (props.step === 1) return 'Every topic becomes a young sapling in your forest.'
  if (props.step === 2) return `${props.places.length} places — that's the whole app.`
  return null
})

const sceneLabel = computed(() => {
  if (props.step === 1) return 'A sapling for each topic you have named'
  if (props.step === 2) return `A trail through the ${props.places.length} places in the app`
  return 'The tree today would plant in your forest if you clear your daily goal'
})
</script>

<template>
  <!-- `size-full`, and the caller sizes the frame. Both children are absolutely
       positioned, so this box has no content height of its own — do not let a
       caller pass `absolute` here, which would collide with `relative` and
       collapse the whole scene to nothing. -->
  <div
    class="forest-scene relative size-full overflow-hidden"
    style="background: linear-gradient(180deg, var(--forest-sky-top), var(--forest-sky-bottom) 70%)"
  >
    <svg
      :viewBox="FRAMES[frame]"
      preserveAspectRatio="xMidYMax slice"
      class="absolute inset-0 size-full"
      role="img"
      :aria-label="sceneLabel"
    >
      <!-- Core then glow: the wider circle over the smaller one is what gives
           the sun its soft edge. Same order as the forest panorama. -->
      <circle
        cx="372"
        cy="200"
        r="34"
        fill="var(--forest-sun)"
        opacity="0.55"
      />
      <circle
        cx="372"
        cy="200"
        r="52"
        fill="var(--forest-sun)"
        opacity="0.18"
      />

      <!-- The handoff's curves, run flat out to ±300 so the band's wider slab
           never shows bare gradient past their ends. -->
      <path
        d="M-300 560 L0 560 Q120 505 240 545 T460 540 L760 540 L760 700 L-300 700 Z"
        fill="var(--forest-hill-far)"
        opacity="0.75"
      />
      <path
        d="M-300 585 L0 585 Q160 545 300 578 T460 572 L760 572 L760 700 L-300 700 Z"
        fill="var(--forest-hill-near)"
        opacity="0.6"
      />
      <path
        d="M-300 620 L0 620 Q230 600 460 622 L760 622 L760 700 L-300 700 Z"
        fill="var(--forest-ground)"
      />

      <!-- Scene 0 — the tree clearing the goal earns, drawn by the forest's own
           mark so the wizard cannot promise a tree the forest will not plant.
           `justPlanted` grows it out of the ground on arrival, which is the
           thing being described; `pointer-events-none` suppresses the mark's
           own hover cursor, since there is no day card behind this one. -->
      <g
        v-if="step === 0"
        class="pointer-events-none"
      >
        <ForestMark
          :day="heroDay"
          :x="230"
          :ground-y="620"
          :scale="HERO_SCALE"
          just-planted
        />
      </g>

      <!-- Scene 1 — one sapling per topic, in that topic's own colour. -->
      <g v-else-if="step === 1">
        <g
          v-for="sapling in saplings"
          :key="sapling.key"
        >
          <ellipse
            :cx="sapling.x"
            :cy="sapling.y"
            rx="10"
            ry="3"
            fill="var(--forest-shadow)"
            opacity="0.06"
          />
          <path
            :d="sapling.stem"
            fill="none"
            :stroke="sapling.color"
            stroke-width="2.2"
            stroke-linecap="round"
          />
          <path
            v-for="(leaf, index) in sapling.leaves"
            :key="index"
            :d="leaf"
            fill="none"
            :stroke="sapling.color"
            stroke-width="2.2"
            stroke-linecap="round"
          />
          <text
            :x="sapling.x"
            :y="sapling.y + 14"
            text-anchor="middle"
            class="font-sans"
            font-size="10"
            fill="var(--forest-label-text)"
          >{{ sapling.label }}</text>
        </g>
      </g>

      <!-- Scene 2 — the trail through the app. -->
      <g v-else>
        <path
          :d="TRAIL"
          fill="none"
          stroke="var(--forest-ground-edge)"
          stroke-width="7"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          :d="TRAIL"
          fill="none"
          stroke="var(--forest-label-bg)"
          stroke-width="2"
          stroke-dasharray="1 9"
          stroke-linecap="round"
        />
        <g
          v-for="stop in stops"
          :key="stop.number"
          class="text-primary"
        >
          <circle
            :cx="stop.x"
            :cy="stop.y"
            r="12"
            fill="var(--forest-label-bg)"
            stroke="currentColor"
            stroke-width="2"
          />
          <text
            :x="stop.x"
            :y="stop.y + 4"
            text-anchor="middle"
            class="font-display"
            font-size="11"
            font-weight="600"
            fill="currentColor"
          >{{ stop.number }}</text>
          <text
            :x="stop.x"
            :y="stop.y - 19"
            text-anchor="middle"
            class="font-sans"
            font-size="10"
            font-weight="600"
            fill="var(--forest-label-text)"
          >{{ stop.label }}</text>
        </g>
      </g>
    </svg>

    <p class="absolute inset-x-3 bottom-2.5 rounded-[10px] border border-default bg-default/80 px-3 py-2 text-center text-xs text-muted backdrop-blur-sm lg:inset-x-4 lg:bottom-3.5">
      <template v-if="caption">
        {{ caption }}
      </template>
      <template v-else>
        Hit <b class="font-semibold text-highlighted">{{ goalLabel }}</b> today and tonight this tree is planted.
      </template>
    </p>
  </div>
</template>
