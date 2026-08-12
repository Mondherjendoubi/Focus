/**
 * Sends a brand-new account to the welcome wizard (FA-025).
 *
 * Global, because a new user can land on any route — signup redirects to `/`,
 * but a saved link or the `?redirect=` on the login page can drop them anywhere
 * behind the auth gate.
 *
 * Deliberately cheap: `useOnboarding.probe()` caches in `useState`, so this
 * costs two `limit(1)` queries once per app load and nothing on every
 * navigation after.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  // `ssr: false`, but a route middleware still runs on the server during
  // prerender. There is no session there, so there is nothing to decide.
  if (import.meta.server) return

  // Auth pages own their whole screen and the wizard is one of them. Redirecting
  // `/welcome` to itself would loop.
  if (to.meta.layout === false) return

  const { isLoggedIn, ready } = useAuth()
  if (!ready.value || !isLoggedIn.value) return

  const { probe } = useOnboarding()
  if (await probe()) {
    return navigateTo('/welcome', { replace: true })
  }
})
