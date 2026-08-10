<script setup lang="ts">
/**
 * Square-crop and reposition an avatar before it uploads.
 *
 * Built here rather than pulled in as a dependency: CLAUDE.md is "Nuxt UI 4
 * only", and a fixed-aspect avatar cropper is pan + zoom + one `drawImage`.
 * A third-party cropper would also ship its own stylesheet to fight with
 * Tailwind 4's theme tokens.
 *
 * ── The coordinate system, because the output maths depends on it ──
 *
 * `base` is the scale at which the image exactly COVERS the square viewport,
 * so `zoom = 1` always fills it whatever the source aspect ratio. Displayed
 * size is `natural × base × zoom`, and `offset` moves the image centre away
 * from the viewport centre in CSS pixels.
 *
 * Offsets are clamped so an edge can never be dragged inside the viewport —
 * otherwise the exported canvas samples outside the image and the avatar comes
 * back with transparent corners.
 *
 * Preview and export share those numbers exactly: the preview is a CSS
 * transform, the export inverts the same transform into a source rectangle.
 * If they ever disagree, what the user framed is not what they get.
 */

/** Viewport edge in CSS px. Also the units `offset` is measured in. */
const VIEWPORT = 256

/** Exported edge in px. Avatars render at 40–96px; 512 covers retina. */
const OUTPUT = 512

const props = defineProps<{
  /** The picked file. Replacing it re-initialises the whole editor. */
  file: File | null
  saving?: boolean
}>()

const emit = defineEmits<{
  confirm: [blob: Blob]
  cancel: []
}>()

const image = ref<HTMLImageElement | null>(null)
const objectUrl = ref<string | null>(null)
const loadError = ref<string | null>(null)

const zoom = ref(1)
const offset = reactive({ x: 0, y: 0 })
const dragging = ref(false)
let dragStart = { x: 0, y: 0, ox: 0, oy: 0 }

/** Scale at which the image just covers the viewport. */
const base = computed(() => {
  const img = image.value
  if (img === null || img.naturalWidth === 0 || img.naturalHeight === 0) return 1
  return Math.max(VIEWPORT / img.naturalWidth, VIEWPORT / img.naturalHeight)
})

const displayed = computed(() => {
  const img = image.value
  if (img === null) return { width: 0, height: 0 }
  const factor = base.value * zoom.value
  return { width: img.naturalWidth * factor, height: img.naturalHeight * factor }
})

/** Furthest the centre may move before an edge enters the viewport. */
const maxOffset = computed(() => ({
  x: Math.max(0, (displayed.value.width - VIEWPORT) / 2),
  y: Math.max(0, (displayed.value.height - VIEWPORT) / 2)
}))

function clampOffset() {
  offset.x = Math.min(maxOffset.value.x, Math.max(-maxOffset.value.x, offset.x))
  offset.y = Math.min(maxOffset.value.y, Math.max(-maxOffset.value.y, offset.y))
}

// Zooming out shrinks the allowed range, so a previously-legal offset can fall
// outside it — re-clamp or the image detaches from the viewport edge.
watch(zoom, clampOffset)

function releaseUrl() {
  if (objectUrl.value !== null) {
    URL.revokeObjectURL(objectUrl.value)
    objectUrl.value = null
  }
}

watch(() => props.file, (file) => {
  releaseUrl()
  image.value = null
  loadError.value = null
  zoom.value = 1
  offset.x = 0
  offset.y = 0
  if (!file) return

  const url = URL.createObjectURL(file)
  objectUrl.value = url

  const img = new Image()
  img.onload = () => {
    image.value = img
  }
  img.onerror = () => {
    loadError.value = 'That file could not be read as an image.'
  }
  img.src = url
}, { immediate: true })

onUnmounted(releaseUrl)

function onPointerDown(event: PointerEvent) {
  if (image.value === null) return
  dragging.value = true
  dragStart = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
  // Capture so a fast drag that leaves the element still tracks and still ends.
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return
  offset.x = dragStart.ox + (event.clientX - dragStart.x)
  offset.y = dragStart.oy + (event.clientY - dragStart.y)
  clampOffset()
}

function onPointerUp(event: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
}

/** Keyboard panning — a drag-only control is unusable without a pointer. */
function nudge(dx: number, dy: number) {
  offset.x += dx
  offset.y += dy
  clampOffset()
}

const previewStyle = computed(() => ({
  width: `${displayed.value.width}px`,
  height: `${displayed.value.height}px`,
  transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`
}))

/**
 * Invert the preview transform into a source rectangle and draw it.
 *
 * The viewport covers `VIEWPORT / (base × zoom)` source pixels. Its centre sits
 * at the image centre shifted back by the offset, converted out of CSS px into
 * source px by the same factor.
 */
function exportBlob(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = image.value
    if (img === null) {
      reject(new Error('No image loaded.'))
      return
    }

    const factor = base.value * zoom.value
    const srcSize = VIEWPORT / factor
    const centreX = img.naturalWidth / 2 - offset.x / factor
    const centreY = img.naturalHeight / 2 - offset.y / factor

    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT
    canvas.height = OUTPUT
    const ctx = canvas.getContext('2d')
    if (ctx === null) {
      reject(new Error('Could not process that image.'))
      return
    }

    // Flattened onto white: the export is JPEG, and a transparent PNG would
    // otherwise composite to black.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, OUTPUT, OUTPUT)
    ctx.drawImage(
      img,
      centreX - srcSize / 2, centreY - srcSize / 2, srcSize, srcSize,
      0, 0, OUTPUT, OUTPUT
    )

    canvas.toBlob(
      blob => (blob === null ? reject(new Error('Could not process that image.')) : resolve(blob)),
      'image/jpeg',
      0.85
    )
  })
}

async function onConfirm() {
  try {
    emit('confirm', await exportBlob())
  } catch (err) {
    loadError.value = (err as Error).message
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <p
      v-if="loadError"
      class="text-sm text-error"
    >
      {{ loadError }}
    </p>

    <template v-else>
      <div class="flex flex-col items-center gap-4">
        <!-- Square drag surface with a circular mask, so what you see framed is
             what the export samples. -->
        <div
          class="relative overflow-hidden rounded-full bg-elevated touch-none select-none"
          :class="dragging ? 'cursor-grabbing' : 'cursor-grab'"
          :style="{ width: `${VIEWPORT}px`, height: `${VIEWPORT}px` }"
          role="application"
          :aria-label="'Drag to reposition. Arrow keys nudge, slider zooms.'"
          tabindex="0"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @keydown.left.prevent="nudge(-8, 0)"
          @keydown.right.prevent="nudge(8, 0)"
          @keydown.up.prevent="nudge(0, -8)"
          @keydown.down.prevent="nudge(0, 8)"
        >
          <img
            v-if="objectUrl"
            :src="objectUrl"
            alt=""
            draggable="false"
            class="absolute left-1/2 top-1/2 max-w-none"
            :style="previewStyle"
          >
        </div>

        <div class="flex w-full max-w-xs items-center gap-3">
          <UIcon
            name="i-lucide-zoom-out"
            class="size-4 shrink-0 text-muted"
          />
          <USlider
            v-model="zoom"
            :min="1"
            :max="4"
            :step="0.01"
            :disabled="saving"
            aria-label="Zoom"
            class="flex-1"
          />
          <UIcon
            name="i-lucide-zoom-in"
            class="size-4 shrink-0 text-muted"
          />
        </div>

        <p class="text-xs text-muted">
          Drag to reposition · arrow keys nudge
        </p>
      </div>
    </template>

    <div class="flex justify-end gap-2 border-t border-default pt-4">
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="saving"
        @click="emit('cancel')"
      >
        Cancel
      </UButton>
      <UButton
        icon="i-lucide-check"
        :loading="saving"
        :disabled="saving || image === null"
        @click="onConfirm"
      >
        Save picture
      </UButton>
    </div>
  </div>
</template>
