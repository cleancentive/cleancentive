// The wiki (Outline) origin. Injected at container start into
// window.__CLEANCENTIVE_CONFIG__ by frontend/docker-entrypoint.sh, so it can
// differ per deployment without a rebuild.
export const WIKI_URL = window.__CLEANCENTIVE_CONFIG__?.wikiUrl
  || import.meta.env.VITE_WIKI_URL
  || 'https://wiki.cleancentive.local'
