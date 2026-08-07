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

- **FA-000 done** — Supabase wired and verified against the live project. The schema in
  [Schema/01_schema.sql](Schema/01_schema.sql) is already deployed there; no migration step.
- **FA-001 implemented, not yet reviewed** — `app/utils/{duration,errors,dates}.ts`.
- Everything else is `todo`. `app/app.vue` and `app/pages/index.vue` are still the Nuxt starter
  template and get replaced by FA-002 and FA-008.

## Environment gotchas

- **`npm run lint` is broken.** Node is v20.20.2; ESLint 10 needs `Object.groupBy` (Node 21+).
  It throws `TypeError: Object.groupBy is not a function` no matter what the code says — a
  tooling failure, never a code finding. **`npm run typecheck` is the only usable gate.**
  Upgrading to Node 22 fixes this and the Nuxt engine warnings with it.
- Not a git repository. Diff-based review has nothing to diff; review the named files.
- `ssr: false` — RLS keys off `auth.uid()` and the server has no session.
- Env vars live in `.env` (not `.env.local`; Nuxt only reads `.env`).

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
- **Empty is not failed.** RLS returns `[]` for an errored or unauthenticated query, identical
  to having no data. Always surface `error` — telling a user with months of history that they
  have no sessions is this app's worst failure mode.
