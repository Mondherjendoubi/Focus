# Handoff: Focus page — desktop workspace layout (left sidebar)

## Overview
Desktop redesign of the tutorex Focus page (root route `/`). The horizontal header nav moves into a persistent 240px left sidebar; the main area becomes a two-pane workspace: the running-session timer on the left, and a right rail with daily goal, session plan (template progress), and today's earlier sessions.

Target codebase: **Mondherjendoubi/Focus** (Nuxt 4 + Nuxt UI 4 + Tailwind 4). This design reuses the app's existing tokens, components, and icons — it is a re-layout, not a re-theme.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy directly. Recreate them in the Focus codebase using its established patterns: Nuxt UI components (`UCard`, `UButton`, `UNavigationMenu`), the existing `TimerRing`, `SessionControls`, `GoalRing`, `StatTile`, `TopicBadge` components, and lucide icons via `UIcon`.

- `focus-desktop-1c.html` — standalone, opens in any browser, hover states work.

## Fidelity
**High-fidelity.** Colors, type, spacing and radii match the repo's real tokens (`app/assets/css/main.css` blue ramp, Inter / Space Grotesk). Recreate pixel-perfectly with the codebase's existing libraries.

## Screens / Views

### Focus (running session) — 1440×900 reference
Layout: `display:flex` page. Sidebar 240px fixed; main = CSS grid `1fr 380px`, gap 24px, padding 32px 40px.

**Sidebar** (`aside`, white `#FFFFFF`, `border-right: 1px solid #E2E8F0`, padding 20px 12px, flex column):
- Logo row: lucide `highlighter` 24px in `#3565F5` + wordmark "tutorex", Space Grotesk 600 18px, `-0.02em`, `#0F172A`. Padding 4px 12px 20px.
- Nav (flex column, gap 2px). Items: Focus (`i-lucide-timer`), Dashboard (`i-lucide-chart-column`), Topics (`i-lucide-tags`), History (`i-lucide-history`), Friends (`i-lucide-users`).
  - Item: flex, gap 10px, padding 9px 12px, radius 8px, icon 18px.
  - Active (Focus): solid `#3565F5` bg, white text, 600, `box-shadow: 0 1px 2px rgba(33,72,217,.3)`.
  - Inactive: `#475569`, 500; hover `background:#F1F5F9; color:#0F172A`.
- Bottom (margin-top:auto): user row — 28px circle avatar `#DAE6FF` bg / `#2148D9` initial (12px 600), display name 13px 500 `#0F172A`, `i-lucide-chevron-down` 14px `#94A3B8` right-aligned. Hover `#F1F5F9`. Opens the existing UserMenu dropdown (Settings / Sign out).

**Main left — timer card** (white, `border:1px solid #E2E8F0`, radius 12px, `box-shadow:0 1px 2px rgba(0,0,0,.05)`, content centered, gap 24px):
- Session title: 22px 600 `#0F172A` (session.title, fallback "Focus session").
- Meta row 13px `#64748B`: TopicBadge pill (bg `#F1F5F9`, 10px topic-color dot, radius 999px) · template name.
- TimerRing: 320×320, SVG viewBox 240, r=108, stroke 12. Track `#64748B` at 20% opacity; progress `#3565F5`, round linecap, rotated -90°. Clock centered: 62px 600 tabular-nums `#0F172A`; below `/ 25:00` 13px `#64748B`. (Reuse `TimerRing.vue` — only the size changes: `size-80` on desktop.)
- Controls row (gap 12px), 14px 600, radius 8px, padding 10px 18px:
  - Pause — soft neutral: bg `#F1F5F9`, text `#334155`, hover `#E2E8F0` (`UButton color="neutral" variant="soft"`)
  - End block — outline: white bg, `1px solid #CBD5E1`, text `#334155` (`variant="outline"`)
  - End session — soft error: bg `#FEF2F2`, text `#DC2626`, hover `#FEE2E2` (`color="error" variant="soft"`)

**Main right rail** (flex column, gap 20px; cards same white/border/radius/shadow, padding 20px):
1. **Daily goal card**: 72px goal ring (r=30, stroke 7, track `#E2E8F0`, fill `#3565F5`, percent centered 14px 600) + label block: "DAILY GOAL" 11px 500 uppercase `.05em` `#64748B`; value "2h 45m of 4h" — number Space Grotesk 20px 600 `#0F172A`, "of 4h" 13px `#64748B`; "Streak: 6 days" 12px `#64748B`. (Reuse `GoalRing`.)
2. **Session plan card** (flex:1): header "Session plan" 13px 600 + "Step 2 of 8" 12px `#64748B`. Rows (padding 8px 10px, radius 8px, 13px):
   - Done: lucide `check` 15px `#10B981`, label line-through `#94A3B8`, right-aligned elapsed tabular.
   - Current: bg `#EEF4FF`, border `1px solid #BDD1FF`, text `#1A38A8` 600, 8px `#3565F5` dot, live clock right.
   - Upcoming: `#475569`, 8px `#CBD5E1` dot.
3. **Earlier today card**: "Earlier today" 13px 600; rows: 10px topic-color dot, session label 13px `#475569`, duration right-aligned `#64748B` tabular.

Other page states (idle SessionStarter, ready-between-blocks, stale-session) keep their existing card content, centered in the left pane.

## Interactions & Behavior
- Nav: standard `NuxtLink` routing; active state from route. Replace `UHeader`'s horizontal `AppNav` with a vertical variant inside the new sidebar (AppNav already accepts `orientation="vertical"`).
- Timer ticks every second (`useActiveSession.elapsedSeconds`); ring `stroke-dashoffset` animates with `transition: stroke-dashoffset .5s`.
- Pause ⇄ Resume swap per `pauses_one_open`; End block and End session open the existing confirm modals — no new flows.
- Session plan rows advance as blocks end (existing template-advance logic); current row is the open block.
- Hovers: nav items `#F1F5F9`; buttons per above. Easing/browser defaults, ~150ms.
- Responsive: below `lg` collapse the right rail under the timer; below `md` fall back to the existing mobile header + slideover.

## State Management
All state already exists: `useActiveSession` (session/block/pause, elapsed, paused), `useTopics`, `useGoals` (daily goal + streak), template blocks from `session_template_blocks`. No new stores; this is layout only.

## Design Tokens
From `app/assets/css/main.css` and Tailwind slate:
- Blue ramp: 50 `#EEF4FF`, 100 `#DAE6FF`, 200 `#BDD1FF`, 500 `#3565F5` (primary), 600 `#2148D9`, 700 `#1A38A8`
- Slate: 50 `#F8FAFC` (page bg), 100 `#F1F5F9`, 200 `#E2E8F0`, 300 `#CBD5E1`, 400 `#94A3B8`, 500 `#64748B`, 700 `#334155`, 900 `#0F172A`
- Success `#10B981` · error `#DC2626` / `#FEF2F2` / `#FEE2E2`
- Fonts: Inter (body), Space Grotesk (display/stats), tabular-nums on all clocks/numbers
- Radii: 8px (nav items, buttons, plan rows), 12px (cards), 999px (pills, avatar, dots)
- Shadows: cards `0 1px 2px rgba(0,0,0,.05)`; active nav `0 1px 2px rgba(33,72,217,.3)`
- Spacing: sidebar 240px; main padding 32px 40px; grid gap 24px; rail gap 20px; card padding 20px

## Assets
Icons are all **lucide** (already in the repo via `@iconify-json/lucide`): highlighter, timer, chart-column, tags, history, users, chevron-down, pause, square, log-out, check. No images.

## Files
- `focus-desktop-1c.html` — standalone design reference (this bundle)
- In the design project: `Focus Desktop.dc.html`, option `1c` (plus alternates `1a` light-faithful and `1b` dark)
- Repo files this maps onto: `app/app.vue` (shell), `app/components/AppNav.vue`, `app/pages/index.vue`, `app/components/{TimerRing,SessionControls,GoalRing,TopicBadge,UserMenu}.vue`
