# tutorex

Your study buddy. Track focus sessions across topics, keep a streak, see where your time actually goes.

## What's in the box

- **Focus** — timer with topic + optional template, pause/resume, overtime, breaks
- **Dashboard** — today's focus time, sessions, interruptions, week total, goal ring, streak
- **Topics** — nested tree, colours, icons, archive (no hard delete)
- **Templates** — reusable session plans (e.g. Pomodoro ×4, Deep Work 90)
- **History** — reviewable session log with per-block breakdown
- **Charts** — 30-day daily focus by topic, 7×24 hour-of-day heatmap
- **Onboarding** — three-step checklist for new accounts

## Stack

- **[Nuxt 4](https://nuxt.com)** (client-rendered, `ssr: false`) + TypeScript
- **[Nuxt UI 4](https://ui.nuxt.com)** + **[Tailwind 4](https://tailwindcss.com)**
- **[Supabase](https://supabase.com)** Postgres — schema in [`Schema/01_schema.sql`](Schema/01_schema.sql), RLS scoped by `auth.uid()`
- **[Unovis](https://unovis.dev)** for charts
- Icons: `@iconify-json/lucide` + `@iconify-json/simple-icons`

## Requirements

- **Node ≥ 22** recommended. Node 20 works but `npm run lint` will crash (`Object.groupBy` requires Node 21+); `npm run typecheck` is the reliable gate on any version.
- A **Supabase** project with the schema in `Schema/01_schema.sql` applied.

## Setup

```bash
# 1. Install deps
npm install

# 2. Configure env
cp .env.example .env
# then fill in SUPABASE_URL and SUPABASE_KEY (the anon key)

# 3. Apply the schema to your Supabase project
#    (once, via the Supabase SQL editor or CLI — see Schema/01_schema.sql)

# 4. Run the dev server
npm run dev
```

The app runs at `http://localhost:3000`. Create an account at `/signup`, then land on `/` for the timer.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server on port 3000 |
| `npm run build` | Build for production |
| `npm run preview` | Preview the production build locally |
| `npm run typecheck` | `nuxt typecheck` — the reliable code gate |
| `npm run lint` | ESLint (broken on Node 20 — see requirements) |

## Data model notes

A few things that quietly matter if you touch queries:

- **Durations are seconds** in the database. Format at render (`formatDuration` / `formatClock`); never store minutes. The one exception is `profiles.daily_goal_minutes`, deliberately in minutes.
- **`net_seconds` is "time studied"** (excludes paused time), not `duration_seconds`.
- **`local_day` is server-stamped** from `profiles.timezone` on insert. Don't bucket days in the browser.
- **RLS scopes every query.** Never `.eq('user_id', ...)` — it's already implied.
- **Mutations for sessions/blocks/pauses go through RPCs** (`start_session`, `start_block`, `end_block`, `pause_block`, `resume_block`, `end_session`). Direct inserts violate the schema's `sessions_one_active` / `blocks_no_overlap` / `pauses_one_open` invariants.
- **Archive, never delete.** `archived_at` is a soft delete; a hard delete cascades away history.
- **Empty ≠ failed.** A failed query returns `[]` under RLS — surface `error` explicitly so a returning user with real history never sees "no data".

## Project layout

```
app/
├── app.vue                 # shell (header, nav, footer, color-mode)
├── app.config.ts           # Nuxt UI theme (primary blue, neutral slate)
├── assets/css/main.css     # custom blue ramp, fonts, animations
├── components/             # AppNav, TimerRing, StatTile, GoalRing, charts, …
├── composables/            # useAuth, useSupabase, useActiveSession, useTopics, …
├── middleware/             # auth guard
├── pages/                  # /, /dashboard, /topics, /templates, /history, /settings, /login, /signup
├── plugins/                # supabase client init
├── types/database.ts       # generated schema types
└── utils/                  # duration.ts, dates.ts, errors.ts (auto-imported)

Schema/
└── 01_schema.sql           # tables, views, RPCs, RLS policies, triggers
```

## License

MIT — see [LICENSE](LICENSE).
