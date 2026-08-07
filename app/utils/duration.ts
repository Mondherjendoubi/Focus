/**
 * Seconds to human text. Every duration in the database is stored in seconds,
 * so this is the only place that turns them into something a person reads.
 *
 * A null duration is not a zero duration. A running block has no `net_seconds`
 * yet, and rendering that as "0m" would tell the user their work vanished.
 */

/** Shown when a duration is genuinely absent, i.e. the row is still open. */
const NO_VALUE = '—'

/**
 * Clamps to a whole, non-negative count of seconds.
 *
 * Returns null for anything with no numeric value at all, so callers can tell
 * "not measured yet" apart from "measured, and it was zero".
 */
function toSeconds(seconds: number | null | undefined): number | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null
  return Math.max(0, Math.floor(seconds))
}

/**
 * Totals, cards and history: `3780` reads as `'1h 3m'`, `2520` as `'42m'`,
 * `7200` as `'2h'`. Under a minute reads as `'0m'`; only null reads as `'—'`.
 */
export function formatDuration(seconds: number | null | undefined): string {
  const total = toSeconds(seconds)
  if (total === null) return NO_VALUE

  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

/**
 * The running timer: `59` reads as `'00:59'`, `1499` as `'24:59'`, `3661` as
 * `'1:01:01'`. Minutes and seconds always pad to two digits; the hour segment
 * appears only once there is one, and is not padded.
 */
export function formatClock(seconds: number | null | undefined): string {
  const total = toSeconds(seconds)
  if (total === null) return NO_VALUE

  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60

  const mm = String(minutes).padStart(2, '0')
  const ss = String(rest).padStart(2, '0')

  if (hours > 0) return `${hours}:${mm}:${ss}`
  return `${mm}:${ss}`
}

/**
 * Compact stats: `3780` reads as `'63 min'`.
 *
 * Truncates rather than rounds, so the same number never reads higher here than
 * it does through `formatDuration`.
 */
export function formatMinutes(seconds: number | null | undefined): string {
  const total = toSeconds(seconds)
  if (total === null) return NO_VALUE

  return `${Math.floor(total / 60)} min`
}
