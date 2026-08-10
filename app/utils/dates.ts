import type { LocalDay, Timestamp } from '~/types/database'

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

/** Hour-of-day formatters are as costly to build as the day ones; cache them too. */
const hourFormatters = new Map<string, Intl.DateTimeFormat>()

function hourFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = hourFormatters.get(timezone)
  if (!formatter) {
    // `hourCycle: 'h23'` so midnight is 00 and not 24 — `hour12: false` alone
    // still yields '24' in some locales.
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hourCycle: 'h23'
    })
    hourFormatters.set(timezone, formatter)
  }
  return formatter
}

/**
 * The hour (0–23) an instant falls on in `timezone`, or null if it is not a
 * parseable timestamp.
 *
 * Same sanctioned exception as `toLocalDay`, for the same reason: `started_at`
 * is a `timestamptz` and no view exposes an hour column for it, so to ask "when
 * does this user study" the browser has to name the hour — and the browser's
 * own zone is not the answer. `Intl` owns the DST and half-hour-offset rules.
 */
export function localHour(instant: Timestamp | null | undefined, timezone: string): number | null {
  if (typeof instant !== 'string' || instant === '') return null

  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) return null

  const parsed = Number(hourFormatter(timezone).format(date))
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : null
}

/**
 * Number of days in the calendar month `localDay` falls in.
 *
 * Day 0 of the *next* month is the last day of this one, which is the standard
 * trick and is leap-year correct without a special case for February.
 */
export function daysInMonthOf(localDay: LocalDay): number {
  const date = parseLocalDay(localDay)
  if (!date) return 30

  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
}

/**
 * Whole days from `from` to `to`, inclusive of both ends — so a window that
 * starts today is 1 day elapsed, not 0. Returns 0 if either label is malformed.
 */
export function daysElapsedInclusive(from: LocalDay, to: LocalDay): number {
  const start = parseLocalDay(from)
  const end = parseLocalDay(to)
  if (!start || !end) return 0

  const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000)
  return diff < 0 ? 0 : diff + 1
}

/**
 * First day of the week `today` falls in, honouring `profiles.week_starts_on`.
 *
 * The weekday is read off the `local_day` label in UTC, which is the whole
 * point: a label has no time-of-day to be shifted across a boundary, so the
 * result is the same whether the user is in Auckland or Los Angeles. Deriving
 * it from the browser's `Date` instead would put someone whose profile says
 * Tokyo into the wrong week for most of their evening.
 */
export function weekStartDay(timezone: string, weekStartsOn: number): LocalDay {
  const today = todayLocalDay(timezone)
  const date = parseLocalDay(today)
  if (!date) return today

  // `getUTCDay()` is 0=Sunday..6=Saturday; ISO — and `week_starts_on` — is
  // 1=Monday..7=Sunday.
  const isoDow = date.getUTCDay() === 0 ? 7 : date.getUTCDay()
  const start = Math.min(7, Math.max(1, Math.round(weekStartsOn) || 1))

  return shiftDay(today, -(((isoDow - start) + 7) % 7))
}

/**
 * First day of the calendar month `today` falls in, in `timezone`.
 *
 * Sliced off the label rather than computed: `todayLocalDay` has already done
 * the timezone work, and `'YYYY-MM'` + `'-01'` cannot land on the wrong month
 * the way `setUTCDate(1)` on a mis-zoned `Date` can.
 */
export function monthStartDay(timezone: string): LocalDay {
  return `${todayLocalDay(timezone).slice(0, 7)}-01`
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
