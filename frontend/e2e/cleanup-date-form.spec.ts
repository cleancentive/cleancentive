import { test, expect, type Page } from '@playwright/test'
import { signInFreshUser, createCleanupViaApi } from './helpers/cleanup'

async function openAddDateForm(page: Page) {
  // Wait until the cleanup detail page has finished loading (legend with cleanup name)
  await expect(page.locator('fieldset.page-card legend').first()).toBeVisible({ timeout: 10000 })
  const addBtn = page.locator('button.link-button:has-text("Add date")')
  await expect(addBtn).toBeVisible({ timeout: 10000 })
  await addBtn.click()
  await expect(page.locator('.community-create-form')).toBeVisible()
}

test.describe.configure({ mode: 'serial' })

test.describe('Cleanup date form', () => {
  const pageErrors: string[] = []
  test.beforeEach(async ({ page }) => {
    pageErrors.length = 0
    page.on('pageerror', (err) => pageErrors.push(`[pageerror] ${err.message}\n${err.stack}`))
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(`[console.error] ${msg.text()}`)
    })
  })
  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== 'passed' && pageErrors.length > 0) {
      await testInfo.attach('page-errors', { body: pageErrors.join('\n\n'), contentType: 'text/plain' })
    }
  })

  test('opens and cancels cleanly', async ({ page }) => {
    const { sessionToken } = await signInFreshUser(page)
    const { cleanupId } = await createCleanupViaApi(sessionToken)

    await page.goto(`/cleanups/${cleanupId}`)
    await page.waitForLoadState('networkidle')

    await openAddDateForm(page)
    await page.locator('.community-create-form input[type="datetime-local"]').first()
    await page.locator('.community-create-form button.secondary-button:has-text("Cancel")').click()
    await expect(page.locator('.community-create-form')).not.toBeVisible()
  })

  test('shows the duration warning for < 2h slots', async ({ page }) => {
    const { sessionToken } = await signInFreshUser(page)
    const { cleanupId } = await createCleanupViaApi(sessionToken)

    await page.goto(`/cleanups/${cleanupId}`)
    await page.waitForLoadState('networkidle')
    await openAddDateForm(page)

    const inputs = page.locator('.community-create-form input[type="datetime-local"]')
    await inputs.nth(0).fill('2026-06-15T09:00')
    await inputs.nth(1).fill('2026-06-15T10:00')

    await expect(page.locator('.form-warning')).toContainText('less than 2 hours')
  })

  test('auto-populates start input on focus when empty', async ({ page }) => {
    const { sessionToken } = await signInFreshUser(page)
    const { cleanupId } = await createCleanupViaApi(sessionToken)

    await page.goto(`/cleanups/${cleanupId}`)
    await page.waitForLoadState('networkidle')
    await openAddDateForm(page)

    const startInput = page.locator('.community-create-form input[type="datetime-local"]').first()
    await startInput.focus()
    // Auto-fill happens in onFocus; assert non-empty rather than pinning to a clock value.
    await expect(startInput).not.toHaveValue('')
  })

  test('repeat preview shows N entries when enabled', async ({ page }) => {
    const { sessionToken } = await signInFreshUser(page)
    const { cleanupId } = await createCleanupViaApi(sessionToken)

    await page.goto(`/cleanups/${cleanupId}`)
    await page.waitForLoadState('networkidle')
    await openAddDateForm(page)

    const inputs = page.locator('.community-create-form input[type="datetime-local"]')
    await inputs.nth(0).fill('2026-06-15T09:00')
    await inputs.nth(1).fill('2026-06-15T11:00')

    await page.locator('.repeat-toggle input[type="checkbox"]').check()
    await page.locator('.repeat-options select').selectOption('weekly')
    await page.locator('.repeat-options input[type="number"]').fill('4')

    await expect(page.locator('.repeat-preview li')).toHaveCount(4)
  })

  test('submit adds a new date card to the page', async ({ page }) => {
    const { sessionToken } = await signInFreshUser(page)
    const { cleanupId } = await createCleanupViaApi(sessionToken)

    await page.goto(`/cleanups/${cleanupId}`)
    await page.waitForLoadState('networkidle')

    const initialDateCount = await page.locator('.cleanup-date-card').count()
    await openAddDateForm(page)

    const inputs = page.locator('.community-create-form input[type="datetime-local"]')
    await inputs.nth(0).fill('2030-09-20T10:00')
    await inputs.nth(1).fill('2030-09-20T13:00')

    // LocationPicker uses <label>Lat</label><input> without htmlFor, so target by parent .form-group.
    await page.locator('.form-group:has(label:text-is("Lat")) input').fill('47.3769')
    await page.locator('.form-group:has(label:text-is("Lon")) input').fill('8.5417')

    await page.locator('.community-create-form button.primary-button:has-text("Add Date")').click()
    await expect(page.locator('.community-create-form')).not.toBeVisible({ timeout: 10000 })

    await expect(page.locator('.cleanup-date-card')).toHaveCount(initialDateCount + 1)
  })
})
