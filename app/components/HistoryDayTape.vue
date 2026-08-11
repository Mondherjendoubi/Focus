<script setup lang="ts">
import type { HistoryDay, HistorySession } from '~/composables/useHistory'

/**
 * One day as a tape — `claude-design/history-desktop-6a.html`.
 *
 * Sessions are laid on the hours of the day rather than stacked in a list, so
 * the shape of the day is the thing you read first: a morning block and a late
 * evening one look nothing like four back-to-back afternoon ones, and a list
 * makes them identical.
 *
 * The window is 07–23 as the handoff draws it, but `useHistory` widens it when
 * a session falls outside — a 05:00 start must never be positioned off the
 * left edge and silently disappear.
 */
const props = defineProps<{
  day: HistoryDay
  startHour: number
  endHour: number
  timeLabel: (instant: string) => string
}>()

const span = computed(() => Math.max(1, props.endHour - props.startHour))

/** Gridline + label every two hours, which is what the handoff's 12.5% steps are. */
const ticks = computed(() => {
  const out: Array<{ hour: number, pct: number }> = []
  for (let h = props.startHour; h <= props.endHour; h += 2) {
    out.push({ hour: h, pct: ((h - props.startHour) / span.value) * 100 })
  }
  return out
})

/**
 * Below this much room a title is dropped rather than shown.
 *
 * Titles are `nowrap` at 11px, so two sessions an hour apart used to print
 * straight over each other into an unreadable smear. Each one is now given
 * exactly the room between its own start and the next session's, and anything
 * under ~4% of a ~940px card — about five characters — is not worth the
 * collision. The bar stays hoverable either way, and the tip carries the title.
 */
const MIN_LABEL_ROOM = 4

/**
 * Position, plus the horizontal room each title has to itself.
 *
 * `day.sessions` is start-ordered by `useHistory`, so "the next one" is simply
 * the next entry. The last session's room runs to the right edge, which is what
 * also stops a late-evening title from spilling out of the card.
 */
const laid = computed(() => {
  const lefts = props.day.sessions.map(session =>
    Math.max(0, Math.min(100, ((session.startHour - props.startHour) / span.value) * 100))
  )

  return props.day.sessions.map((session, i) => {
    const left = lefts[i]!
    const width = ((session.endHour - session.startHour) / span.value) * 100
    return {
      session,
      left,
      // A one-block session can round to nothing; 0.6% keeps it clickable.
      width: Math.max(0.6, Math.min(100 - left, width)),
      room: (lefts[i + 1] ?? 100) - left
    }
  })
})

/** Click a bar to open its block-by-block list; click it again to close. */
const openId = ref<string | null>(null)
const open = computed(() => props.day.sessions.find(s => s.key === openId.value) ?? null)

function toggle(session: HistorySession) {
  openId.value = openId.value === session.key ? null : session.key
}

const host = useTemplateRef<HTMLElement>('host')
const hovered = ref<HistorySession | null>(null)
const anchor = ref({ x: 0, y: 0, width: 0 })

function locate(event: Event): HistorySession | null {
  const target = event.target
  if (!(target instanceof Element)) return null
  const bar = target.closest('[data-session]')
  if (!bar || host.value === null) return null

  const id = bar.getAttribute('data-session')
  const session = props.day.sessions.find(s => s.key === id) ?? null
  if (session === null) return null

  const box = bar.getBoundingClientRect()
  const frame = host.value.getBoundingClientRect()
  anchor.value = { x: box.left - frame.left + box.width / 2, y: box.top - frame.top, width: frame.width }
  return session
}

function onPointerOver(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return
  hovered.value = locate(event)
}

const tipStyle = computed(() => {
  const HALF = 118
  const limit = Math.max(HALF, anchor.value.width - HALF)
  return {
    left: `${Math.min(Math.max(anchor.value.x, HALF), limit)}px`,
    top: `${anchor.value.y - 10}px`,
    transform: 'translate(-50%, -100%)'
  }
})

function kindLabel(kind: HistorySession['blocks'][number]['kind']): string {
  switch (kind) {
    case 'focus': return 'Focus'
    case 'short_break': return 'Short break'
    case 'long_break': return 'Long break'
  }
  return kind
}
</script>

<template>
  <section class="flex flex-col gap-2.5">
    <div class="flex items-baseline gap-2.5">
      <h2 class="text-xs font-semibold uppercase tracking-[.06em] text-muted">
        {{ day.label }}
      </h2>
      <span
        v-if="day.dateLabel"
        class="text-xs text-dimmed"
      >{{ day.dateLabel }}</span>
      <span class="ml-auto text-xs text-muted">
        {{ day.sessions.length }} {{ day.sessions.length === 1 ? 'session' : 'sessions' }} ·
        <span class="font-semibold tabular-nums text-highlighted">{{ formatDuration(day.focusSeconds) }}</span>
        focus
      </span>
    </div>

    <div
      ref="host"
      class="relative rounded-xl border border-default bg-default px-5 pb-3 pt-3.5 shadow-sm"
      @pointerleave="hovered = null"
    >
      <div
        class="relative h-[76px]"
        @pointerover="onPointerOver"
        @click="(e) => { const s = locate(e); if (s) toggle(s) }"
      >
        <span
          v-for="tick in ticks"
          :key="`line-${tick.hour}`"
          class="absolute bottom-4 top-0 w-px bg-muted"
          :style="{ left: `${tick.pct}%` }"
        />

        <template
          v-for="item in laid"
          :key="item.session.key"
        >
          <!-- Capped to the room before the next session so titles truncate
               instead of overprinting each other. Flex so the running dot is
               never what gets clipped. -->
          <span
            v-if="item.room >= MIN_LABEL_ROOM"
            class="absolute top-4 flex items-center gap-1"
            :style="{ left: `${item.left}%`, maxWidth: `calc(${item.room}% - 8px)` }"
          >
            <span class="truncate text-[11px] font-medium leading-4 text-toned">
              {{ item.session.title }}
            </span>
            <span
              v-if="item.session.endedAt === null"
              class="size-1.5 shrink-0 rounded-full bg-primary"
            />
          </span>

          <div
            :data-session="item.session.key"
            class="absolute top-[34px] cursor-pointer shadow-sm transition hover:brightness-95"
            :style="{ left: `${item.left}%`, width: `${item.width}%` }"
          >
            <HistoryBar
              :session="item.session"
              height-class="h-[26px]"
              rounded-class="rounded-[7px]"
            />
          </div>
        </template>

        <span class="absolute inset-x-0 bottom-[15px] h-px bg-accented" />

        <span
          v-for="tick in ticks"
          :key="`label-${tick.hour}`"
          class="absolute bottom-0 -translate-x-1/2 text-[10px] tabular-nums text-dimmed"
          :style="{ left: `${tick.pct}%` }"
        >{{ String(tick.hour).padStart(2, '0') }}</span>
      </div>

      <!-- Block-by-block, for whichever bar was clicked. -->
      <div
        v-if="open"
        class="mt-0.5 border-t border-muted pt-3"
      >
        <p class="mb-2 text-xs text-muted">
          <span class="font-semibold text-highlighted">{{ open.title }}</span> — block by block
          <template v-if="open.adherenceRatio !== null && open.plannedFocusSeconds !== null">
            · {{ Math.round(open.adherenceRatio * 100) }}% of {{ formatDuration(open.plannedFocusSeconds) }} planned
          </template>
          <template v-if="open.interruptions > 0">
            · {{ open.interruptions }} {{ open.interruptions === 1 ? 'interruption' : 'interruptions' }}
          </template>
        </p>

        <p
          v-if="open.blocks.length === 0"
          class="text-[13px] text-dimmed"
        >
          This session recorded no blocks.
        </p>

        <div
          v-else
          class="flex flex-col gap-1.5"
        >
          <div
            v-for="block in open.blocks"
            :key="block.id"
            class="flex items-center gap-2.5 rounded-lg border border-muted bg-muted/40 px-3 py-2 text-[13px]"
          >
            <span
              class="size-2.5 shrink-0 rounded-full"
              :style="block.kind === 'focus' && block.topicColor ? { backgroundColor: block.topicColor } : undefined"
              :class="block.kind === 'focus' && block.topicColor ? '' : 'bg-accented'"
            />
            <span class="font-medium text-highlighted">{{ kindLabel(block.kind) }}</span>
            <span class="min-w-0 truncate text-muted">{{ block.kind === 'focus' ? block.topicName ?? 'No topic' : '' }}</span>
            <span class="ml-auto tabular-nums text-dimmed">{{ timeLabel(block.startedAt) }}</span>
            <span class="w-[52px] shrink-0 text-right font-semibold tabular-nums text-highlighted">
              {{ formatDuration(block.netSeconds) }}
            </span>
          </div>
        </div>
      </div>

      <HistoryTip
        v-if="hovered"
        :session="hovered"
        :time-label="timeLabel"
        class="absolute z-10"
        :style="tipStyle"
      />
    </div>
  </section>
</template>
