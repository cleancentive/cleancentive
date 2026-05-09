import { describe, expect, test } from 'vitest'

import { pwaConfig } from './vite.config'

describe('pwaConfig', () => {
  test('does not use app-shell fallback for API navigations', () => {
    expect(pwaConfig.workbox?.navigateFallbackDenylist).toEqual([/^\/api\//])
  })

  test('excludes runtime-generated config.js from precache', () => {
    // config.js is rewritten by docker-entrypoint.sh at container start;
    // precaching the build-time placeholder hides every per-deploy config
    // change (e.g. wikiUrl, umamiWebsiteId) behind the service worker.
    expect(pwaConfig.workbox?.globIgnores).toContain('**/config.js')
  })
})
