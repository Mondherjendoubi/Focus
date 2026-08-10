import type { PostgrestError } from '@supabase/supabase-js'

/**
 * Raw Postgres errors to sentences a user can act on.
 *
 * The database is what enforces the domain rules, so a user who races the UI
 * gets a constraint violation rather than a friendly refusal. Every constraint
 * the UI can actually trigger is mapped here. Anything else falls through to
 * the driver's own message, which is still more useful than silence.
 */

/** Last resort. Never return a blank string: a blank error reads as success. */
const FALLBACK = 'Something went wrong. Please try again.'

/**
 * Matched as lower-cased substrings, because Postgres names the constraint
 * inside a longer sentence and the cycle trigger appends the topic id.
 * Order does not matter here: no needle is contained in another.
 */
const CONSTRAINT_MESSAGES: ReadonlyArray<readonly [string, string]> = [
  ['sessions_one_active', 'You already have a session running.'],
  ['blocks_no_overlap', 'Another block is still running.'],
  ['pauses_one_open', 'This block is already paused.'],
  ['topics_unique_name', 'You already have a topic with that name here.'],
  // Partial index — `where active` — so this fires only against another goal
  // that is still switched on. Deactivated ones never collide.
  ['goals_unique', 'You already have an active goal for that topic and period.'],
  ['topics_color_check', 'Pick a valid colour.'],
  ['topic hierarchy cycle detected', 'A topic can\'t be moved inside itself.']
]

/** Reads a string field off an error shape that may or may not carry it. */
function field(error: object, key: string): string {
  const value = (error as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

/**
 * The one function the UI calls to render a failure.
 *
 * Always returns a non-empty sentence, so a caller can bind it straight to a
 * toast or an alert without checking it first.
 */
export function toMessage(error: PostgrestError | Error | null | undefined): string {
  if (!error) return FALLBACK

  const raw = field(error, 'message').trim()

  // Postgres puts the constraint name in `details` or `hint` about as often as
  // in `message`, so search all of them, plus the SQLSTATE code.
  const haystack = [raw, field(error, 'details'), field(error, 'hint'), field(error, 'code')]
    .join(' ')
    .toLowerCase()

  for (const [needle, message] of CONSTRAINT_MESSAGES) {
    if (haystack.includes(needle)) return message
  }

  // `new Error(String(thrown))` on a thrown undefined produces exactly 'undefined'.
  if (raw.length === 0 || raw === 'undefined' || raw === 'null') return FALLBACK
  return raw
}
