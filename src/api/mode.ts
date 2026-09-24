/** Build-time boundary: production ignores every demo flag and browser override. */
export const developmentOnly = import.meta.env.DEV && !import.meta.env.PROD
export function resolveDevelopmentMockMode(input: {
  dev: boolean
  query?: string | null
  stored?: string | null
  flag?: string
  apiMode?: string
}) {
  if (!input.dev) return false
  const choice = input.query === 'demo' || input.query === 'real' ? input.query : input.stored
  return choice === 'demo' || (choice !== 'real' && (input.flag === 'demo' || (input.flag !== 'real' && input.apiMode === 'mock')))
}
function developmentChoice() {
  if (!developmentOnly || typeof window === 'undefined') return null
  const query = new URLSearchParams(window.location.search).get('devMode')
  try {
    if (query === 'demo' || query === 'real') sessionStorage.setItem('acg-development-mode', query)
    return sessionStorage.getItem('acg-development-mode')
  } catch { return query }
}
const choice = developmentChoice()
export const isMockMode = developmentOnly && resolveDevelopmentMockMode({
  dev: developmentOnly,
  query: choice,
  flag: import.meta.env.VITE_DEV_MODE,
  apiMode: import.meta.env.VITE_API_MODE,
})

/** A full navigation discards Pinia state, pending requests and access tokens.
 * The query choice is read only by development bundles, before stores initialize.
 */
export function switchDevelopmentMode(mode: 'demo' | 'real') {
  if (!developmentOnly) return
  window.location.replace(`/?devMode=${mode}`)
}
