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
 * GoTrue's own wording, mapped to something a person can act on.
 *
 * These are matched BEFORE the constraint list because a couple of them are
 * already readable English and would otherwise fall through to the driver's
 * text unchanged — which is how users ended up reading
 * `over_email_send_rate_limit` in a form alert.
 *
 * "Invalid login credentials" deliberately stays vague about *which* half was
 * wrong: Supabase does not disclose whether an email exists, and a friendlier
 * "no account with that email" would undo that protection.
 */
const AUTH_MESSAGES: ReadonlyArray<readonly [string, string]> = [
  ['invalid login credentials', 'That email and password don\'t match.'],
  ['email not confirmed', 'Check your inbox and confirm your email before signing in.'],
  ['user already registered', 'There is already an account with that email. Try signing in.'],
  ['email address is invalid', 'That doesn\'t look like a valid email address.'],
  // The built-in sender allows 2 emails an hour, project-wide. Nothing the user
  // does clears it, so the message must not imply they should retry immediately.
  ['over_email_send_rate_limit', 'Too many emails sent. Try again in an hour.'],
  ['email rate limit exceeded', 'Too many emails sent. Try again in an hour.'],
  ['over_request_rate_limit', 'Too many attempts. Wait a few minutes and try again.'],
  ['for security purposes, you can only request this', 'Just a moment — try that again in a minute.'],
  ['password should be at least', 'Pick a longer password — at least 6 characters.'],
  ['same_password', 'That is already your password. Pick a different one.'],
  ['weak_password', 'That password is too weak. Try a longer one.'],
  ['session_not_found', 'Your session expired. Sign in again.'],
  ['refresh_token_not_found', 'Your session expired. Sign in again.']
]

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
  // Indexed on the PAIR, so this also fires when THEY have already asked YOU.
  // The friends page checks its loaded edges first and offers to accept instead.
  ['friendships_unique_pair', 'You already have a request with that person.'],
  ['friendships_not_self', 'You can\'t send yourself a friend request.'],
  ['profiles_username_unique', 'That handle is taken. Try another.'],
  ['profiles_username_format', 'Handles are 3–20 characters: letters, numbers and underscores.'],
  ['only the addressee can accept', 'Only the person you invited can accept that request.'],
  ['friendship parties are immutable', 'That request can\'t be edited.'],
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
  // in `message`, so search all of them, plus the SQLSTATE code. GoTrue puts
  // its machine-readable reason in `code` and the prose in `message`, so the
  // same haystack serves both.
  const haystack = [raw, field(error, 'details'), field(error, 'hint'), field(error, 'code')]
    .join(' ')
    .toLowerCase()

  for (const [needle, message] of AUTH_MESSAGES) {
    if (haystack.includes(needle)) return message
  }

  for (const [needle, message] of CONSTRAINT_MESSAGES) {
    if (haystack.includes(needle)) return message
  }

  // `new Error(String(thrown))` on a thrown undefined produces exactly 'undefined'.
  if (raw.length === 0 || raw === 'undefined' || raw === 'null') return FALLBACK
  return raw
}
