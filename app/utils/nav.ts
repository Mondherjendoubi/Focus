/**
 * The app's primary destinations, defined once (FA-026).
 *
 * Two navigations render these — the desktop rail in `AppNav` and the mobile
 * bottom bar in `AppTabBar`. They used to be one list inside `AppNav`, which
 * meant a seventh destination could reach the sidebar and never the phone.
 *
 * Auto-imported, like everything in `app/utils/` — never `import` from here.
 */

export interface NavItem {
  label: string
  to: string
  icon: string
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Focus', to: '/', icon: 'i-lucide-timer' },
  { label: 'Dashboard', to: '/dashboard', icon: 'i-lucide-chart-column' },
  { label: 'Topics', to: '/topics', icon: 'i-lucide-tags' },
  { label: 'History', to: '/history', icon: 'i-lucide-history' },
  { label: 'Forest', to: '/forest', icon: 'i-lucide-trees' },
  { label: 'Friends', to: '/friends', icon: 'i-lucide-users' }
]

/**
 * `/` has to match exactly. A bare `startsWith` test would light up Focus on
 * every route in the app, which is how "active" stops meaning anything.
 *
 * The others match themselves and their children, but on a segment boundary —
 * plain `startsWith('/topics')` would also claim a `/topics-archive`.
 */
export function isNavActive(path: string, to: string): boolean {
  if (to === '/') return path === '/'
  return path === to || path.startsWith(`${to}/`)
}
