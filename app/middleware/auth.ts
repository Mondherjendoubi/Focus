/**
 * Gate for everything behind the login. Apply per-page with
 * `definePageMeta({ middleware: 'auth' })`.
 */
export default defineNuxtRouteMiddleware((to) => {
  const { isLoggedIn } = useAuth()

  if (!isLoggedIn.value) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})
