import { test, expect } from '@playwright/test'

test.describe('Cleanups mobile layout', () => {
  test('keeps bottom tab bar visible and avoids horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    await page.goto('/cleanups')
    await page.waitForLoadState('networkidle')

    const tabBar = page.locator('.tab-bar')
    await expect(tabBar).toBeVisible()

    const viewportHeight = await page.evaluate(() => window.innerHeight)
    const tabBarBottom = await tabBar.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return rect.bottom
    })

    expect(tabBarBottom).toBeLessThanOrEqual(viewportHeight + 1)

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth
    })

    expect(hasHorizontalOverflow).toBe(false)
  })
})
