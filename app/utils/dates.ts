import type { LocalDay } from '~/types/database'

/**
 * Day boundaries in the profile's timezone.
 *
 * `session_blocks.local_day` is stamped by the database from `profiles.timezone`,
 * and that server value is what every other file reads. This module is the one
 * sanctioned exception: to *query* by `local_day` the browser has to name the
 * day it wants, and the browser's own zone is not the answer. Someone in Berlin
 * looking at a profile set to Tokyo must still get Tokyo's date.
 */

/** Shown when a date input is not a date at all. */
const NO_VALUE = '—'

/** A `local_day` is a bare calendar date, so its weekday is fixed; read it in UTC. */
const WEEKDAY_SHORT = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })
const WEEKDAY_LONG = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' })

/** `Intl.DateTimeFormat` is expensive to construct and these run in render paths. */
const dayFormatters = new Map<string, Intl.DateTimeFormat>()

function dayFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = dayFormatters.get(timezone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    dayFormatters.set(timezone, formatter)
  }
  return formatter
}

/**
 * The calendar date `instant` falls on in `timezone`.
 *
 * Built from `formatToParts` rather than by adding an offset to a `Date`:
 * `Intl` owns the DST rules and the half-hour zones, and assembling the parts
 * by name means the locale's own field order cannot reorder the result.
 */
function toLocalDay(instant: Date, timezone: string): LocalDay {
  const parts = dayFormatter(timezone).formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? ''

  return `${part('year')}-${part('month')}-${part('day')}`
}

/**
 * Calendar arithmetic on a `'YYYY-MM-DD'` label, done in UTC on purpose: a
 * local day is a label rather than an instant, so stepping it must not be able
 * to land on a DST hour and slip a day.
 */
function shiftDay(localDay: LocalDay, days: number): LocalDay {
  const parts = localDay.split('-')
  const date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])))
  date.setUTCDate(date.getUTCDate() + days)

  return date.toISOString().slice(0, 10)
}

/** Strict `'YYYY-MM-DD'` to a Date at UTC midnight, or null if it is not one. */
function parseLocalDay(localDay: LocalDay | null | undefined): Date | null {
  if (typeof localDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(localDay)) return null

  const date = new Date(`${localDay}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Today's date in `timezone` as `'YYYY-MM-DD'` — the value to match against
 * `local_day`. Every daily total in the app is scoped by this, so it reads the
 * given zone and never the browser's.
 */
export function todayLocalDay(timezone: string): LocalDay {
  return toLocalDay(new Date(), timezone)
}

/**
 * The last `n` days in `timezone`, oldest first and ending with today.
 *
 * Charts need a slot for every day in the range, including the ones the user
 * did not study at all and which therefore have no rows to group.
 */
export function lastNDays(n: number, timezone: string): LocalDay[] {
  const count = Math.floor(n)
  if (!Number.isFinite(count) || count <= 0) return []

  const today = todayLocalDay(timezone)
  const days: LocalDay[] = []
  for (let offset = count - 1; offset >= 0; offset--) {
    days.push(shiftDay(today, -offset))
  }

  return days
}

/** Axis ticks and history headers: `'2026-08-06'` reads as `'Thu'`. */
export function dayLabel(localDay: LocalDay | null | undefined): string {
  const date = parseLocalDay(localDay)
  if (!date) return NO_VALUE

  return WEEKDAY_SHORT.format(date)
}

/**
 * ISO weekday to its name: `1` reads as `'Monday'` through `7` as `'Sunday'`,
 * matching `profiles.week_starts_on` and `v_block_facts.day_of_week`.
 */
export function weekdayName(isoDow: number | null | undefined): string {
  if (typeof isoDow !== 'number' || !Number.isInteger(isoDow) || isoDow < 1 || isoDow > 7) {
    return NO_VALUE
  }

  // 2024-01-01 was a Monday, so the day of the month lines up with the ISO number.
  return WEEKDAY_LONG.format(new Date(Date.UTC(2024, 0, isoDow)))
}
