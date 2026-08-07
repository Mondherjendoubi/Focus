/**
 * Hand-mapped from Schema/01_schema.sql — field-for-field with the SQL columns.
 *
 * Two things to keep straight when editing:
 *  - All durations are SECONDS. Format at the render layer, never store minutes.
 *  - Anything derived from an open row is null: a running block has no
 *    `ended_at`, so `duration_seconds` and `net_seconds` are null too.
 */

export type BlockKind = 'focus' | 'short_break' | 'long_break'
export type SessionStatus = 'active' | 'completed' | 'abandoned'
export type GoalPeriod = 'daily' | 'weekly' | 'monthly'

/** `date` columns arrive as 'YYYY-MM-DD'. Already timezone-corrected by the DB. */
export type LocalDay = string
/** `timestamptz` columns arrive as ISO 8601 strings. */
export type Timestamp = string

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export interface Profile {
  id: string
  display_name: string | null
  timezone: string
  daily_goal_minutes: number
  /** ISO weekday: 1 = Monday. */
  week_starts_on: number
  created_at: Timestamp
  updated_at: Timestamp
}

export interface Topic {
  id: string
  user_id: string
  parent_id: string | null
  name: string
  /** Always '#rrggbb' — the DB rejects anything else. */
  color: string
  icon: string | null
  description: string | null
  position: number
  /** Soft delete: hide from pickers, keep in history. */
  archived_at: Timestamp | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface SessionTemplate {
  id: string
  user_id: string
  name: string
  description: string | null
  default_topic_id: string | null
  is_favorite: boolean
  archived_at: Timestamp | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface SessionTemplateBlock {
  id: string
  template_id: string
  user_id: string
  position: number
  kind: BlockKind
  planned_seconds: number
  /** null = inherit the session's topic. */
  topic_id: string | null
  label: string | null
}

export interface Session {
  id: string
  user_id: string
  template_id: string | null
  topic_id: string | null
  title: string | null
  status: SessionStatus
  planned_seconds: number | null
  started_at: Timestamp
  ended_at: Timestamp | null
  /** Self-report, 1–5. */
  focus_rating: number | null
  notes: string | null
  created_at: Timestamp
  updated_at: Timestamp
}

export interface SessionBlock {
  id: string
  session_id: string
  user_id: string
  topic_id: string | null
  template_block_id: string | null
  kind: BlockKind
  position: number
  planned_seconds: number | null
  started_at: Timestamp
  /** null while the block is running. */
  ended_at: Timestamp | null
  paused_seconds: number
  interruptions: number
  /** Ran to its planned length. */
  completed: boolean
  /** Stamped by trigger from profiles.timezone. Never recompute client-side. */
  local_day: LocalDay | null
  note: string | null
  created_at: Timestamp
  /** Generated: wall clock. null while running. */
  duration_seconds: number | null
  /** Generated: wall clock minus pauses. This is "time studied". null while running. */
  net_seconds: number | null
}

export interface BlockPause {
  id: string
  block_id: string
  user_id: string
  started_at: Timestamp
  /** null while the pause is open. */
  ended_at: Timestamp | null
  reason: string | null
}

export interface Goal {
  id: string
  user_id: string
  /** null = an overall goal across all topics. */
  topic_id: string | null
  period: GoalPeriod
  target_minutes: number
  active: boolean
  created_at: Timestamp
}

// ---------------------------------------------------------------------------
// Views — prefer these over re-aggregating tables in the browser
// ---------------------------------------------------------------------------

export interface TemplateTotals {
  template_id: string
  user_id: string
  name: string
  block_count: number
  planned_seconds: number
  planned_focus_seconds: number
}

export interface BlockFact {
  block_id: string
  user_id: string
  session_id: string
  topic_id: string | null
  topic_name: string | null
  topic_color: string | null
  topic_parent_id: string | null
  kind: BlockKind
  local_day: LocalDay
  started_at: Timestamp
  ended_at: Timestamp
  net_seconds: number
  net_minutes: number
  interruptions: number
  /** ISO weekday: 1 = Monday. */
  day_of_week: number
  hour_of_day: number
  local_week: LocalDay
  local_month: LocalDay
}

export interface DailyTopicTotal {
  user_id: string
  local_day: LocalDay
  topic_id: string | null
  topic_name: string | null
  topic_color: string | null
  focus_seconds: number | null
  break_seconds: number | null
  focus_blocks: number
  interruptions: number | null
}

export interface DailyTotal {
  user_id: string
  local_day: LocalDay
  focus_seconds: number | null
  focus_minutes: number | null
  break_seconds: number | null
  session_count: number
  topic_count: number
  interruptions: number | null
  goal_minutes: number
  goal_met: boolean | null
}

export interface TopicRollup {
  topic_id: string
  topic_name: string
  topic_color: string
  parent_id: string | null
  user_id: string
  /** Includes descendant sub-topics. */
  total_focus_seconds: number
  total_focus_hours: number
  session_count: number
  active_days: number
  last_studied_at: Timestamp | null
}

/**
 * A day-of-week x hour-of-day grid — one row per (dow, hour) pair.
 * To get "best hours of the day" you must re-aggregate to collapse day_of_week.
 */
export interface FocusHeatmapCell {
  user_id: string
  day_of_week: number
  hour_of_day: number
  focus_seconds: number
  focus_minutes: number
  block_count: number
  avg_block_minutes: number
}

export interface SessionSummary {
  session_id: string
  user_id: string
  title: string | null
  status: SessionStatus
  template_id: string | null
  template_name: string | null
  topic_id: string | null
  started_at: Timestamp
  ended_at: Timestamp | null
  focus_rating: number | null
  block_count: number
  actual_focus_seconds: number
  paused_seconds: number
  interruptions: number
  planned_focus_seconds: number | null
  /** actual / planned. null when the session had no template. */
  adherence_ratio: number | null
}

export interface Streaks {
  user_id: string
  longest_streak: number
  current_streak: number
  last_active_day: LocalDay | null
}

// ---------------------------------------------------------------------------
// RPC argument shapes — mutations go through these, never raw inserts.
// They already enforce the invariants (one active session, no overlapping
// blocks, closing an open pause before ending a block).
// ---------------------------------------------------------------------------

export interface RpcArgs {
  start_session: { p_template_id?: string | null, p_topic_id?: string | null, p_title?: string | null }
  start_block: {
    p_session_id: string
    p_topic_id?: string | null
    p_kind?: BlockKind
    p_planned_seconds?: number | null
    p_template_block_id?: string | null
  }
  end_block: { p_block_id: string, p_note?: string | null }
  pause_block: { p_block_id: string, p_reason?: string | null }
  resume_block: { p_block_id: string }
  end_session: {
    p_session_id: string
    p_status?: SessionStatus
    p_focus_rating?: number | null
    p_notes?: string | null
  }
}
