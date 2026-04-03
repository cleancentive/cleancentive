import { describe, expect, test } from 'vitest'

import { pwaConfig } from './vite.config'

describe('pwaConfig', () => {
  test('does not use app-shell fallback for API navigations', () => {
    expect(pwaConfig.workbox?.navigateFallbackDenylist).toEqual([/^\/api\//])
  })
})
