# focus-app

A study/focus tracker. Nuxt 4 + Nuxt UI 4 + Tailwind 4 on Supabase Postgres.

## How work happens here — read this before starting anything

Work is driven by tickets in [specs/](specs/), run through agents in [.claude/agents/](.claude/agents/).
**Do not free-style features.** If the user asks for something not covered by a ticket, either
find the ticket it belongs to or write one first.

The board and the wave order are in [specs/README.md](specs/README.md). Read it.

### The pipeline

```
ticket → focus-planner → focus-frontend-implementer → npm run typecheck → focus-reviewer → done
           (skip if the ticket says "Planner: skip")        (gate)              (gate)
```

- `focus-orchestrator` runs the loop and is the agent to use when the user names a ticket or wave.
- The implementer loads the `frontend-design:frontend-design` skill before writing UI.
- The reviewer loads `code-review:code-review` and `pr-review-toolkit:review-pr`.
- **The orchestrator runs typecheck itself** — never take an implementer's word that it passed.
- Blocking findings go back to the implementer. Two fix rounds max, then report what's left.
- When a ticket closes, update its `Status:` and its row in [specs/README.md](specs/README.md).

### What the user says, and what it means

| They say | You do |
|---|---|
| `do FA-005` | That ticket, full pipeline |
| `do wave 3` | Every ticket in that folder, implementers in parallel |
| `review FA-001` | Reviewer only |
| `keep going` | Next wave in order |

Tickets in the same `specs/tickets/wave-*/` folder own disjoint files and can run in parallel.
Two implementers must never write the same file — that is the only reason to serialize.

## Progress

**FA-000 through FA-017 are all `done`.** The app is feature-complete against the backlog:
auth, timer, topics, templates, history, dashboard, charts, onboarding, polish, the deep
analytics section, goals, and the motivation layer. See [specs/README.md](specs/README.md)
for the per-ticket board.

- The schema in [Schema/01_schema.sql](Schema/01_schema.sql) is already deployed to the live
  Supabase project. There is no migration step — treat the SQL file as a mirror, not a source.
- **[Schema/02_social.sql](Schema/02_social.sql) is NOT deployed.** FA-018's code is written
  and typechecks, but `/friends` cannot work until that file is run in the Supabase SQL
  editor. It is idempotent.

### Social: the rule that must not be broken

Friend data is reachable **only** through the `security definer` functions in
`02_social.sql` — `find_profile_by_username`, `my_friends`, `friend_stats` — each of which
verifies an accepted friendship and returns aggregates only.

**Never widen an `own rows` policy to admit friends.** All 59 queries in the app rely on RLS
being their only filter (none writes `.eq('user_id', …)`), and every view is
`security_invoker = on`. Widening those policies would fold a friend's rows into every total
the app renders, and since they are `for all` rather than `for select`, would grant friends
write access as well. Inside a definer function, query base tables — a `security_invoker`
view still resolves `auth.uid()` to the caller and would return your rows as your friend's.
- Every analytics view is now consumed by something. `v_block_facts`, `v_daily_totals`,
  `v_daily_topic_totals`, `v_topic_rollup`, `v_focus_heatmap`, `v_session_summary`,
  `v_streaks` and `v_template_totals` all have at least one reader.
- **FA-015/016/017 have not been through `focus-reviewer`.** They pass typecheck and build,
  and were self-reviewed only. Run the reviewer on them before treating them as fully closed.

### Known gaps — deliberate, not forgotten

- **No tests, and no test runner.** There is no `test/`, no vitest config, no `test` script.
  The pure builders in `useAnalytics`, `useWeeklyRecap`, `useMilestones` and `app/utils/dates.ts`
  are the natural first targets — plain functions over plain arrays, no Supabase mocking needed.
- **Node 22 upgrade** is unblocked work that would turn the lint gate back on. See below.

## Environment gotchas

- **`npm run lint` is broken.** Node is v20.20.2; ESLint 10 needs `Object.groupBy` (Node 21+).
  It throws `TypeError: Object.groupBy is not a function` no matter what the code says — a
  tooling failure, never a code finding. **`npm run typecheck` is the only usable gate**, so
  the style rules below are convention enforced by review, not by tooling. Upgrading to Node 22
  fixes this and the Nuxt engine warnings with it.
- `npm run build` (`nuxt generate`) is a useful second gate — it catches template and
  component-resolution errors that typecheck alone does not.
- **This is a git repository**, on `main`. Diff-based review works; use it.
- `ssr: false` — RLS keys off `auth.uid()` and the server has no session.
- Env vars live in `.env` (not `.env.local`; Nuxt only reads `.env`).
- **Auth email is rate-limited to 2/hour project-wide** on Supabase's built-in sender. Raising
  it requires custom SMTP; turning off "Confirm email" in the dashboard removes the email path
  entirely and is the right setting for development.

## Code rules

- Nuxt UI 4 only. No other component library.
- Icons: `i-lucide-*` or `i-simple-icons-*` — the only two installed sets.
- Auto-imports are on: never `import { ref } from 'vue'`, never import from `app/utils/`.
- Style: no semicolons, single quotes, 2-space indent, **no trailing commas**, `} else {` on one line.
- Theme tokens (`text-muted`, `bg-elevated`), never hardcoded hex — except `topics.color`,
  which comes from the database and is applied inline.
- `useSupabase()` for the client, types in [app/types/database.ts](app/types/database.ts),
  auth via `useAuth()`, guard with `definePageMeta({ middleware: 'auth' })`.
- **Never `.eq('user_id', ...)`** — RLS already scopes every query.

## Schema rules that cause wrong numbers

- **Durations are seconds.** Format at render, never store minutes. (`daily_goal_minutes` is
  the one deliberate exception.)
- **`net_seconds`, not `duration_seconds`,** is "time studied" — it excludes paused time.
- **`local_day` is server-stamped** from `profiles.timezone`. Never bucket days in the browser.
- **Open rows have `ended_at is null`**, and their `net_seconds` / `duration_seconds` are `null`.
- **`v_focus_heatmap` is a dow × hour grid** (ISO: 1 = Monday). Re-aggregate to collapse a dimension.
- **Mutations go through the RPCs** — `start_session`, `start_block`, `end_block`, `pause_block`,
  `resume_block`, `end_session`. They enforce the invariants; direct inserts violate them.
- **Archive, never delete.** `archived_at` is a soft delete; a hard delete cascades away history.
  `goals` follows the same rule via `active = false` — and its unique index is **partial**
  (`where active`), so only switched-on goals collide.
- **`target_minutes` on `goals` is minutes**, like `daily_goal_minutes`. Those two columns are
  the only exceptions to the seconds rule. Convert once, at the comparison.
- **Empty is not failed.** RLS returns `[]` for an errored or unauthenticated query, identical
  to having no data. Always surface `error` — telling a user with months of history that they
  have no sessions is this app's worst failure mode.
- **A stale open block is not a running one.** `ended_at is null` also matches a block the user
  abandoned days ago. Compare its server-stamped `local_day` against today in the profile's
  timezone before rendering it as live — `useActiveSession.isStale` does this.
