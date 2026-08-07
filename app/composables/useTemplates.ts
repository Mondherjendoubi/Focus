import type { PostgrestError } from '@supabase/supabase-js'
import type { BlockKind, SessionTemplate, SessionTemplateBlock, TemplateTotals } from '~/types/database'

/**
 * Session templates: the reusable plans the timer walks through.
 *
 * RLS scopes every query by `auth.uid()`, so we never filter by user_id.
 * Mutations pass `user_id` on insert because both `session_templates` and
 * `session_template_blocks` are `not null` on that column with no default;
 * `with check (user_id = auth.uid())` still enforces ownership.
 *
 * Reorders and edits go through `saveBlocks`, which deletes the whole block
 * set and reinserts it in one call. Firing N independent position updates
 * transiently duplicates `(template_id, position)` and trips the unique
 * index mid-flight — do not do that.
 */

/** Row shape returned when nested blocks are selected. */
export type TemplateWithBlocks = SessionTemplate & {
  session_template_blocks: SessionTemplateBlock[]
}

/** Fields the template form actually writes; timestamps stay server-owned. */
export interface TemplateInput {
  name: string
  description: string | null
  default_topic_id: string | null
  is_favorite: boolean
}

/**
 * A block as the form knows it: durations in MINUTES.
 * The conversion to `planned_seconds` happens exactly once, in `saveBlocks`,
 * so no downstream code has to remember which unit it is looking at.
 */
export interface BlockDraft {
  kind: BlockKind
  minutes: number
  topic_id: string | null
  label: string | null
}

const EMPTY_TOTALS: ReadonlyMap<string, TemplateTotals> = new Map()

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505'

export function useTemplates() {
  const supabase = useSupabase()
  const { user } = useAuth()

  const active = useState<TemplateWithBlocks[]>('templates:active', () => [])
  const archived = useState<SessionTemplate[]>('templates:archived', () => [])
  const totals = useState<ReadonlyMap<string, TemplateTotals>>('templates:totals', () => EMPTY_TOTALS)
  const loading = useState<boolean>('templates:loading', () => false)
  const error = useState<string | null>('templates:error', () => null)
  const loaded = useState<boolean>('templates:loaded', () => false)

  function fail(err: PostgrestError | Error | unknown): never {
    const message = toMessage(err as PostgrestError | Error)
    error.value = message
    throw new Error(message)
  }

  /** Friendlier message when the DB rejects a duplicate template name. */
  function nameConflict(err: PostgrestError): boolean {
    const code = (err as { code?: string }).code
    const details = (err as { details?: string }).details ?? ''
    return code === UNIQUE_VIOLATION && details.toLowerCase().includes('name')
  }

  async function load() {
    loading.value = true
    error.value = null
    try {
      const [activeRes, archivedRes, totalsRes] = await Promise.all([
        supabase
          .from('session_templates')
          .select('*, session_template_blocks(*)')
          .is('archived_at', null)
          .order('is_favorite', { ascending: false })
          .order('name'),
        supabase
          .from('session_templates')
          .select('*')
          .not('archived_at', 'is', null)
          .order('archived_at', { ascending: false }),
        supabase.from('v_template_totals').select('*')
      ])

      if (activeRes.error) throw activeRes.error
      if (archivedRes.error) throw archivedRes.error
      if (totalsRes.error) throw totalsRes.error

      // Nested blocks arrive unordered — sort each template's list once here
      // so consumers can trust it without repeating the sort.
      const rows = (activeRes.data ?? []) as TemplateWithBlocks[]
      for (const row of rows) {
        row.session_template_blocks = [...(row.session_template_blocks ?? [])]
          .sort((a, b) => a.position - b.position)
      }
      active.value = rows
      archived.value = (archivedRes.data ?? []) as SessionTemplate[]

      const map = new Map<string, TemplateTotals>()
      for (const row of (totalsRes.data ?? []) as TemplateTotals[]) {
        map.set(row.template_id, row)
      }
      totals.value = map
      loaded.value = true
    } catch (err) {
      // Surface the failure. Empty-vs-error must not look the same in the UI.
      error.value = toMessage(err as PostgrestError | Error)
    } finally {
      loading.value = false
    }
  }

  async function refresh() {
    await load()
  }

  /**
   * Delete every block for `templateId` and reinsert the given drafts.
   *
   * `unique (template_id, position)` makes per-row position updates unsafe:
   * two rows briefly holding the same position trips the index. Wiping the
   * set and reinserting in one call sidesteps that entirely, and it keeps
   * the sequence contiguous (0..N-1) which the UI relies on.
   *
   * Every insert carries `user_id` because the column is `not null` with no
   * default and RLS `with check (user_id = auth.uid())` rejects a row without it.
   */
  async function saveBlocks(templateId: string, drafts: BlockDraft[]): Promise<void> {
    if (!user.value) fail(new Error('You must be signed in.'))

    const del = await supabase
      .from('session_template_blocks')
      .delete()
      .eq('template_id', templateId)
    if (del.error) fail(del.error)

    if (drafts.length === 0) return

    const rows = drafts.map((draft, index) => ({
      template_id: templateId,
      user_id: user.value!.id,
      position: index,
      kind: draft.kind,
      planned_seconds: Math.round(draft.minutes * 60),
      topic_id: draft.topic_id,
      label: draft.label
    }))

    const ins = await supabase.from('session_template_blocks').insert(rows)
    if (ins.error) fail(ins.error)
  }

  async function create(input: TemplateInput, blocks: BlockDraft[]): Promise<SessionTemplate> {
    if (!user.value) fail(new Error('You must be signed in.'))

    const payload = {
      user_id: user.value!.id,
      name: input.name.trim(),
      description: input.description,
      default_topic_id: input.default_topic_id,
      is_favorite: input.is_favorite
    }

    const { data, error: err } = await supabase
      .from('session_templates')
      .insert(payload)
      .select()
      .single()

    if (err || !data) {
      if (err && nameConflict(err)) fail(new Error('You already have a template with that name.'))
      fail(err ?? new Error('Insert returned no row.'))
    }

    const template = data as SessionTemplate
    try {
      await saveBlocks(template.id, blocks)
    } catch (blockErr) {
      // Best-effort rollback: an orphan template with no blocks is a worse
      // failure mode than leaving the user with a half-created row the next
      // load surfaces. Ignore any secondary error here.
      await supabase.from('session_templates').delete().eq('id', template.id)
      throw blockErr
    }

    await refresh()
    return template
  }

  async function update(id: string, input: TemplateInput, blocks: BlockDraft[]): Promise<SessionTemplate> {
    const patch = {
      name: input.name.trim(),
      description: input.description,
      default_topic_id: input.default_topic_id,
      is_favorite: input.is_favorite
    }

    const { data, error: err } = await supabase
      .from('session_templates')
      .update(patch)
      .eq('id', id)
      .select()
      .single()

    if (err || !data) {
      if (err && nameConflict(err)) fail(new Error('You already have a template with that name.'))
      fail(err ?? new Error('Update returned no row.'))
    }

    await saveBlocks(id, blocks)
    await refresh()
    return data as SessionTemplate
  }

  async function archive(id: string): Promise<void> {
    const { error: err } = await supabase
      .from('session_templates')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id)
    if (err) fail(err)
    await refresh()
  }

  async function restore(id: string): Promise<void> {
    const { error: err } = await supabase
      .from('session_templates')
      .update({ archived_at: null })
      .eq('id', id)
    if (err) fail(err)
    await refresh()
  }

  async function toggleFavorite(id: string, value: boolean): Promise<void> {
    const { error: err } = await supabase
      .from('session_templates')
      .update({ is_favorite: value })
      .eq('id', id)
    if (err) fail(err)
    await refresh()
  }

  return {
    active,
    archived,
    totals,
    loading,
    error,
    loaded,
    load,
    refresh,
    create,
    update,
    archive,
    restore,
    toggleFavorite
  }
}
