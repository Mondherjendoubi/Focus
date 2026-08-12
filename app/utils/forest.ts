/**
 * Forest geometry (FA-023), read off the `forest-desktop-5a` / `forest-mobile-5b`
 * handoffs.
 *
 * Every constant here is measured from the prototypes rather than invented. The
 * two screens draw the same trees at two scales — mobile is desktop × 0.912 —
 * so the shape lives here once and both scenes pass their own `scale`.
 *
 * Nothing in this file touches Vue or Supabase: it is pure geometry, which is
 * also the only reason the tree shapes could be checked by rasterising them.
 */

/** The prototypes' scale factors. Desktop is the reference. */
export const FOREST_SCALE_DESKTOP = 1
export const FOREST_SCALE_MOBILE = 0.912

export type TreeSpecies = 'deciduous' | 'conifer' | 'poplar'

export interface TreeShape {
  species: TreeSpecies
  /** The scale every dimension below derives from — `S` in the handoff. */
  size: number
  /** Ground-contact shadow. */
  shadow: { rx: number, ry: number }
  /** `deciduous` only: tapered trunk quad. */
  trunk?: string
  /** `deciduous` only: canopy lobes, main blob first. */
  blobs?: Array<{ cx: number, cy: number, r: number }>
  /** `conifer` / `poplar`: rectangular trunk. */
  post?: { x: number, y: number, width: number, height: number }
  /** `conifer` only: three tiers, top first so the lower ones overlap. */
  tiers?: string[]
  /** `poplar` only: the single upright canopy. */
  crown?: { cx: number, cy: number, rx: number, ry: number }
}

/**
 * FNV-1a over the date string. Adjacent days differ by one character, and this
 * mixes well enough that they still draw unrelated trees rather than a row of
 * near-identical ones.
 */
function hashSeed(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32. Deterministic from the seed, so a date draws the same tree forever. */
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
 * How far past the goal a day went, flattened to 0…1. Drives both the canopy
 * tone and the tree's size.
 *
 * **Logarithmic, saturating at 1.9× (FA-027).** The handoff's version was linear
 * to 2.5×, which gave each of the five greens a 30%-of-goal band — wider than
 * the spread of an entire real month. Days cluster within roughly ±25% of goal,
 * so every ordinary day landed in the first band at the smallest size, and a
 * month rendered as one flat green mass. Compressing the top end and curving the
 * bottom spends the ramp where the days actually are.
 *
 * Still monotonic and still capped, which is what the legend under the picture
 * promises: deeper and bigger always means further past goal, and one enormous
 * day cannot dwarf a whole year of ordinary ones.
 */
const STRENGTH_CEILING = Math.log(1.9)

export function treeStrength(ratio: number): number {
  if (ratio <= 1) return 0
  return Math.min(1, Math.log(ratio) / STRENGTH_CEILING)
}

/** Five greens, `--forest-tone-0` … `-4`. Index confirmed as `floor(strength × 5)`. */
export function treeToneIndex(strength: number): number {
  return Math.min(4, Math.floor(strength * 5))
}

/** Deterministic per date, in the handoff's rough 60 / 20 / 20 mix. */
function pickSpecies(roll: number): TreeSpecies {
  if (roll < 0.6) return 'deciduous'
  if (roll < 0.8) return 'conifer'
  return 'poplar'
}

/**
 * One tree, anchored at `(x, groundY)` and growing upward.
 *
 * The random draws happen in a fixed order — species, lean, lobe count, then
 * per-lobe angle/distance/radius — because changing that order would silently
 * reshape every tree in every existing forest.
 */
export function buildTree(localDay: string, ratio: number, x: number, groundY: number, scale: number): TreeShape {
  const rand = makeRng(hashSeed(localDay))
  const strength = treeStrength(ratio)
  const size = (12.5 + 7.8 * strength) * scale
  const shadow = { rx: size * 0.714, ry: 3 * scale }

  const species = pickSpecies(rand())

  if (species === 'conifer') {
    // Three stacked tiers. The factors are measured, not derived — the handoff's
    // conifer is a drawn shape, not a formula.
    const apex = [2.388, 1.906, 1.38]
    const base = [1.475, 0.906, 0.35]
    const half = [0.525, 0.698, 0.87]
    const tiers = apex.map((a, i) => {
      const baseY = groundY - size * base[i]!
      const halfW = size * half[i]!
      return `M${x} ${(groundY - size * a).toFixed(1)} L${(x - halfW).toFixed(1)} ${baseY.toFixed(1)} L${(x + halfW).toFixed(1)} ${baseY.toFixed(1)} Z`
    })

    return {
      species,
      size,
      shadow,
      post: { x: x - 1.6 * scale, y: groundY - size * 0.525, width: 3.2 * scale, height: size * 0.525 },
      tiers
    }
  }

  if (species === 'poplar') {
    return {
      species,
      size,
      shadow,
      post: { x: x - 1.5 * scale, y: groundY - size * 0.476, width: 3 * scale, height: size * 0.476 },
      crown: { cx: x, cy: groundY - size * 1.38, rx: size * 0.57, ry: size * 1.07 }
    }
  }

  // Deciduous. The trunk leans, and the canopy sits on top of wherever it leans
  // to — so the trunk's top edge is centred on the canopy, not on `x`.
  const lean = (rand() - 0.5) * 3.6 * scale
  const cx = x + lean
  const trunkTop = groundY - size * 1.281
  const halfBottom = 1.8 * scale
  const halfTop = 0.9 * scale
  const trunk = [
    `M${(x - halfBottom).toFixed(1)} ${groundY.toFixed(1)}`,
    `L${(cx - halfTop).toFixed(1)} ${trunkTop.toFixed(1)}`,
    `L${(cx + halfTop).toFixed(1)} ${trunkTop.toFixed(1)}`,
    `L${(x + halfBottom).toFixed(1)} ${groundY.toFixed(1)}`,
    'Z'
  ].join(' ')

  const cy = groundY - size * 1.687
  const lobes = 2 + Math.floor(rand() * 3)
  const blobs = [{ cx, cy, r: size }]
  for (let i = 0; i < lobes; i++) {
    // Angles are spread evenly across the upper arc and then jittered, rather
    // than drawn at random, so no tree ends up with every lobe on one side.
    const deg = 200 + (i + 0.5) * (140 / lobes) + (rand() - 0.5) * 20
    const rad = (deg * Math.PI) / 180
    const dist = size * (0.5 + rand() * 0.3)
    blobs.push({
      cx: cx + Math.cos(rad) * dist,
      cy: cy + Math.sin(rad) * dist,
      r: size * (0.53 + rand() * 0.21)
    })
  }

  return { species: 'deciduous', size, shadow, trunk, blobs }
}

export interface SeedlingShape {
  shadow: { rx: number, ry: number }
  strokeWidth: number
  stem: string
  leaves: [string, string]
}

/**
 * A near-miss. Fixed size and always the same green, however short the day fell
 * — a seedling that shrank with the shortfall would rank people's bad days.
 */
export function buildSeedling(x: number, groundY: number, scale: number): SeedlingShape {
  const u = (n: number) => groundY - n * scale
  const h = (n: number) => x + n * scale
  const f = (n: number) => n.toFixed(1)

  return {
    shadow: { rx: 3.9 * scale, ry: 1.8 * scale },
    strokeWidth: 1.8 * scale,
    stem: `M${f(x)} ${f(groundY)} L${f(x)} ${f(u(6.9))}`,
    leaves: [
      `M${f(x)} ${f(u(4.14))} C${f(h(-3.9))} ${f(u(4.84))} ${f(h(-4.6))} ${f(u(9.64))} ${f(h(-3.7))} ${f(u(10.34))} `
      + `C${f(h(-1.2))} ${f(u(10.34))} ${f(h(-0.2))} ${f(u(6.94))} ${f(x)} ${f(u(4.84))}`,
      `M${f(x)} ${f(u(4.84))} C${f(h(1.2))} ${f(u(7.64))} ${f(h(2.3))} ${f(u(11.04))} ${f(h(4.1))} ${f(u(11.04))} `
      + `C${f(h(4.6))} ${f(u(6.24))} ${f(h(2.3))} ${f(u(4.14))} ${f(x)} ${f(u(4.84))}`
    ]
  }
}

/**
 * The panorama's rolling ground line.
 *
 * Fitted to the handoff's sampled polyline — every one of its 59 points lands
 * within half a pixel of this. The period is fixed rather than stretched to the
 * forest's length, so a long history gets more hills instead of flatter ones.
 */
export function panoramaGroundY(x: number): number {
  return 336 + 14 * Math.sin((2 * Math.PI * (x - 5)) / 1060)
}

/** The trail's winding centre line, `x` as a function of `y`. Same fitting note. */
export function trailX(y: number, width: number): number {
  return width / 2 + 82 * Math.sin((2 * Math.PI * (y - 14)) / 940)
}

/**
 * Which side of the trail a day's tree stands on, and how far off.
 *
 * Seeded from the date like everything else, so the trail does not rearrange
 * itself between visits. The 30–45 range is measured from the handoff and keeps
 * the widest canopy clear of the path.
 */
export function trailOffset(localDay: string): number {
  const rand = makeRng(hashSeed(`${localDay}:trail`))
  const side = rand() < 0.5 ? -1 : 1
  return side * (30 + rand() * 15)
}
