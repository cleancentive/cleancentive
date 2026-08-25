import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

declare global {
  interface Window {
    __geoCalls: string[]
  }
}

// Guards feedback 019ecb80: the app used to fire the native geolocation prompt on
// page load, because locationStore started watchPosition() as a module-level side
// effect. The rule these tests pin down is "no native prompt without an explicit
// in-app gesture" — so they instrument the geolocation API and assert on *when*
// the app reaches for it, which is the part that regressed.

const instrument = async (page: Page) => {
  await page.addInitScript(() => {
    window.__geoCalls = []
    const g = navigator.geolocation
    const record = <T extends 'getCurrentPosition' | 'watchPosition'>(name: T) => {
      const orig = g[name].bind(g)
      g[name] = ((...args: Parameters<Geolocation[T]>) => {
        window.__geoCalls.push(name)
        return (orig as (...a: unknown[]) => unknown)(...args)
      }) as Geolocation[T]
    }
    record('getCurrentPosition')
    record('watchPosition')
  })
}

test('fresh visitor: no geolocation call on load, in-app card offered instead', async ({ page }) => {
  await instrument(page)
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)

  const calls = await page.evaluate(() => window.__geoCalls)
  expect(calls).toEqual([])

  await expect(page.locator('.location-consent')).toBeVisible()
})

test('the geolocation API is touched only after the explicit gesture', async ({ page }) => {
  await instrument(page)
  await page.context().setGeolocation({ latitude: 47.5596, longitude: 7.5886 })
  // Permission stays in "prompt" for the whole test: the point is *when* the app
  // reaches for the API, not whether the browser ultimately grants it.
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)

  const before = await page.evaluate(() => window.__geoCalls)
  expect(before).toEqual([])

  await expect(page.locator('.location-consent')).toBeVisible()
  await page.locator('.location-consent .primary-button').click()
  await page.waitForTimeout(1500)

  const after = await page.evaluate(() => window.__geoCalls)
  expect(after.length).toBeGreaterThan(0)
})

test('returning visitor with permission granted: silent watch, no card', async ({ page }) => {
  await instrument(page)
  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: 47.5596, longitude: 7.5886 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)

  const calls = await page.evaluate(() => window.__geoCalls)
  expect(calls.length).toBeGreaterThan(0)
  await expect(page.locator('.location-consent')).toHaveCount(0)
})
