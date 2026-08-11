import type { Ref } from 'vue'
import type { ForestDay } from '~/composables/useForest'

/**
 * Hover/tap targeting for a forest scene (FA-023).
 *
 * **One delegated listener, not one per tree.** A busy forest is several hundred
 * `<g>` elements; binding `mouseenter` to each would mean hundreds of listeners
 * and hundreds of Vue patches to keep them wired. Instead the scene's `<svg>`
 * carries a single handler and `closest('[data-day]')` resolves which mark the
 * pointer is actually over.
 *
 * Positioning goes through `getBoundingClientRect` on the mark and on the host,
 * so it is correct at any scale and — importantly for the panorama, which
 * scrolls sideways inside its card — at any scroll offset, without this having
 * to know either number.
 */
export function useForestHover(days: Ref<ForestDay[]>, host: Ref<HTMLElement | null>) {
  const active = ref<ForestDay | null>(null)
  /** Pixel anchor within `host`: horizontal centre and top edge of the mark. */
  const anchor = ref({ x: 0, y: 0 })
  const hostWidth = ref(0)

  const byDay = computed(() => new Map(days.value.map(day => [day.localDay, day])))

  function locate(event: Event): ForestDay | null {
    const target = event.target
    if (!(target instanceof Element)) return null
    const mark = target.closest('[data-day]')
    if (!mark) return null

    const key = mark.getAttribute('data-day')
    const day = key === null ? null : byDay.value.get(key) ?? null
    if (day === null || host.value === null) return null

    const box = mark.getBoundingClientRect()
    const frame = host.value.getBoundingClientRect()
    anchor.value = { x: box.left - frame.left + box.width / 2, y: box.top - frame.top }
    hostWidth.value = frame.width
    return day
  }

  function onPointerOver(event: PointerEvent) {
    // Touch fires a synthetic `pointerover` on tap and then leaves it hanging,
    // so the card would stick with no way to dismiss it. Touch goes through
    // `onClick` below instead, which toggles.
    if (event.pointerType !== 'mouse') return
    // Assigned unconditionally, so moving off a tree onto bare sky closes the
    // card instead of leaving the last one stuck open until you exit the scene.
    // Safe against flicker: the card is `pointer-events-none`, so it can never
    // steal the pointer from the tree underneath it.
    active.value = locate(event)
  }

  function onPointerLeave() {
    active.value = null
  }

  function onClick(event: MouseEvent) {
    const day = locate(event)
    // Tapping the same tree twice closes it; tapping bare sky closes it too.
    active.value = day !== null && day.localDay !== active.value?.localDay ? day : null
  }

  /**
   * Dismiss on a tap anywhere else on the page.
   *
   * Needed only for touch, and needed badly: `pointerleave` is what closes the
   * card for a mouse, and it never fires on a phone. Without this, tapping a
   * tree and then scrolling away leaves the card pinned open with nothing on
   * screen that looks like it would close it.
   *
   * `pointerdown` in the capture phase, so it lands before the scene's own
   * click and a tap inside the scene is left alone for `onClick` to toggle.
   */
  function onDismissOutside(event: PointerEvent) {
    if (active.value === null) return
    const target = event.target
    if (target instanceof Node && host.value?.contains(target)) return
    active.value = null
  }

  onMounted(() => document.addEventListener('pointerdown', onDismissOutside, true))
  onBeforeUnmount(() => document.removeEventListener('pointerdown', onDismissOutside, true))

  /**
   * Above the mark, clamped so a tree at either end of a long panorama still
   * shows its whole card, and flipped below when the canopy is near the top.
   */
  const cardStyle = computed(() => {
    const HALF = 116
    const flip = anchor.value.y < 130
    const limit = Math.max(HALF, hostWidth.value - HALF)
    return {
      left: `${Math.min(Math.max(anchor.value.x, HALF), limit)}px`,
      top: `${flip ? anchor.value.y + 16 : anchor.value.y - 10}px`,
      transform: `translate(-50%, ${flip ? '0' : '-100%'})`
    }
  })

  return { active, cardStyle, onPointerOver, onPointerLeave, onClick }
}
