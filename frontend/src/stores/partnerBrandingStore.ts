import { useAuthStore } from './authStore'

const STYLE_ELEMENT_ID = 'partner-css'
const DEFAULT_FAVICON_HREF = '/favicon.ico'

let currentFaviconHref = DEFAULT_FAVICON_HREF

function getOrCreateStyleElement(): HTMLStyleElement {
  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ELEMENT_ID
    document.head.appendChild(el)
  }
  return el
}

function removeStyleElement(): void {
  const el = document.getElementById(STYLE_ELEMENT_ID)
  if (el) el.remove()
}

function updateFavicon(href: string): void {
  if (href === currentFaviconHref) return
  currentFaviconHref = href
  let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = href
}

function detectFaviconFromCss(): void {
  const computed = getComputedStyle(document.documentElement)
  const val = computed.getPropertyValue('--partner-favicon-url').trim()
  if (val) {
    // Extract URL from url('...') or url("...") or url(...)
    const match = val.match(/url\(['"]?(.+?)['"]?\)/)
    if (match?.[1]) {
      updateFavicon(match[1])
      return
    }
  }
  updateFavicon(DEFAULT_FAVICON_HREF)
}

export function applyPartnerBranding(): void {
  const user = useAuthStore.getState().user
  const css = user?.active_team_custom_css

  if (css) {
    const el = getOrCreateStyleElement()
    el.textContent = css
    // Check for favicon override after CSS is applied
    requestAnimationFrame(detectFaviconFromCss)
  } else if (user?.active_team_is_partner) {
    // Partner team with no custom CSS — clear any old CSS but keep default behavior
    removeStyleElement()
    updateFavicon(DEFAULT_FAVICON_HREF)
  } else {
    removeStyleElement()
    updateFavicon(DEFAULT_FAVICON_HREF)
  }
}

export function clearPartnerBranding(): void {
  removeStyleElement()
  updateFavicon(DEFAULT_FAVICON_HREF)
}

// Subscribe to auth store changes
let previousCss: string | null | undefined = undefined
let previousTeamId: string | null | undefined = undefined

useAuthStore.subscribe((state) => {
  const css = state.user?.active_team_custom_css
  const teamId = state.user?.active_team_id

  if (css !== previousCss || teamId !== previousTeamId) {
    previousCss = css
    previousTeamId = teamId
    if (state.user) {
      applyPartnerBranding()
    } else {
      clearPartnerBranding()
    }
  }
})
