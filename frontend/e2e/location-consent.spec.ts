import { test, expect } from './fixtures'

// Guards feedback 019ecb80: the app used to fire the native geolocation prompt on
// page load, because locationStore started watchPosition() as a module-level side
// effect. The rule these tests pin down is "no native prompt without an explicit
// in-app gesture" — so they instrument the geolocation API and assert on *when*
// the app reaches for it, which is the part that regressed.

const instrument = async (page: any) => {
  await page.addInitScript(() => {
    ;(window as any).__geoCalls = []
    const g = navigator.geolocation
    for (const name of ['getCurrentPosition', 'watchPosition'] as const) {
      const orig = (g as any)[name].bind(g)
      ;(g as any)[name] = (...a: any[]) => {
        ;(window as any).__geoCalls.push(name)
        return orig(...a)
      }
    }
  })
}

test('fresh visitor: no geolocation call on load, in-app card offered instead', async ({ page }) => {
  await instrument(page)
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)

  const calls = await page.evaluate(() => (window as any).__geoCalls)
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

  const before = await page.evaluate(() => (window as any).__geoCalls)
  expect(before).toEqual([])

  await expect(page.locator('.location-consent')).toBeVisible()
  await page.locator('.location-consent .primary-button').click()
  await page.waitForTimeout(1500)

  const after = await page.evaluate(() => (window as any).__geoCalls)
  expect(after.length).toBeGreaterThan(0)
})

test('returning visitor with permission granted: silent watch, no card', async ({ page }) => {
  await instrument(page)
  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: 47.5596, longitude: 7.5886 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1500)

  const calls = await page.evaluate(() => (window as any).__geoCalls)
  expect(calls.length).toBeGreaterThan(0)
  await expect(page.locator('.location-consent')).toHaveCount(0)
})
