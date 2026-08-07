<script setup lang="ts">
/**
 * A small confetti burst for session completion. Ten 6x6 squares fly
 * outward from centre over ~800ms, staggered. No library, no dependency.
 *
 * Emits `done` once the animation finishes so the parent can unmount it.
 * Under `prefers-reduced-motion: reduce` the component renders nothing
 * and emits `done` on the next tick — no static confetti sitting there.
 */

const emit = defineEmits<{
  done: []
}>()

const PARTICLE_COUNT = 10
const DURATION_MS = 800
const MAX_DELAY_MS = 150

const prefersReducedMotion = ref(false)

interface Particle {
  id: number
  tx: number
  ty: number
  rot: number
  delay: number
  isHighlight: boolean
}

const particles = ref<Particle[]>([])

onMounted(() => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    prefersReducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  if (prefersReducedMotion.value) {
    nextTick(() => emit('done'))
    return
  }

  particles.value = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
    const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + (Math.random() - 0.5) * 0.4
    const distance = 60 + Math.random() * 50
    return {
      id: i,
      tx: Math.cos(angle) * distance,
      ty: Math.sin(angle) * distance,
      rot: (Math.random() - 0.5) * 360,
      delay: Math.random() * MAX_DELAY_MS,
      isHighlight: i % 2 === 0
    }
  })

  const totalMs = DURATION_MS + MAX_DELAY_MS + 50
  setTimeout(() => emit('done'), totalMs)
})
</script>

<template>
  <svg
    v-if="!prefersReducedMotion && particles.length > 0"
    class="confetti-svg text-primary"
    viewBox="-120 -120 240 240"
    aria-hidden="true"
    focusable="false"
  >
    <rect
      v-for="p in particles"
      :key="p.id"
      x="-3"
      y="-3"
      width="6"
      height="6"
      rx="1"
      :fill="p.isHighlight ? 'var(--tutorex-highlight)' : 'currentColor'"
      class="confetti-particle"
      :style="{
        '--tx': `${p.tx}px`,
        '--ty': `${p.ty}px`,
        '--rot': `${p.rot}deg`,
        animationDelay: `${p.delay}ms`
      }"
    />
  </svg>
</template>

<style scoped>
.confetti-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: visible;
}

.confetti-particle {
  transform-origin: center;
  transform-box: fill-box;
  animation: confetti-fly 800ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

@keyframes confetti-fly {
  0% {
    transform: translate(0, 0) rotate(0deg);
    opacity: 1;
  }
  60% {
    opacity: 1;
  }
  100% {
    transform: translate(var(--tx), var(--ty)) rotate(var(--rot));
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .confetti-particle {
    animation: none;
  }
}
</style>
