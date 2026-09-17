import { test, expect } from '@playwright/test'
import { signInFreshUser, createCleanupViaApi } from './helpers/cleanup'

// The cleanups list used to hard-filter itself down to the single cleanup whose
// nearest date matched the user's active_cleanup_date_id. On /cleanups there is
// no control to clear that — the ContextBar hides the cleanup selector there and
// its clear button skips deactivation in filter mode — so the page silently
// dropped every other cleanup the API returned and reported "Cleanups (1)".
//
// The rule pinned down here: activating a date marks that cleanup, it does not
// hide the others.

const API_BASE = 'http://localhost:3000/api/v1'

function ongoingWindow() {
  const start = new Date(Date.now() - 60 * 60_000)      // started an hour ago
  const end = new Date(Date.now() + 3 * 60 * 60_000)    // ends in three hours
  return { startAt: start.toISOString(), endAt: end.toISOString() }
}

test('activating a cleanup date badges it without hiding the other cleanups', async ({ page }) => {
  const { sessionToken } = await signInFreshUser(page)

  const suffix = Date.now()
  const activeName = `E2E Active ${suffix}`
  const otherName = `E2E Other ${suffix}`

  const active = await createCleanupViaApi(sessionToken, { name: activeName, ...ongoingWindow() })
  await createCleanupViaApi(sessionToken, { name: otherName, ...ongoingWindow() })

  // Creating a cleanup activates its own date, so pin the activation explicitly
  // rather than relying on whichever one was created last.
  const activation = await fetch(`${API_BASE}/cleanups/dates/${active.cleanupDateId}/activate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}` },
  })
  expect(activation.ok, `activate failed: ${activation.status}`).toBe(true)

  // Both dates are ongoing, so the default ongoing+future pills already cover them.
  await page.goto('/cleanups')
  await page.waitForLoadState('networkidle')

  const activeCard = page.locator('a.community-card', { hasText: activeName })
  const otherCard = page.locator('a.community-card', { hasText: otherName })

  await expect(activeCard).toBeVisible({ timeout: 10000 })
  await expect(otherCard).toBeVisible()

  // The active cleanup is marked, and only that one.
  await expect(activeCard.locator('.badge', { hasText: 'Active' })).toBeVisible()
  await expect(otherCard.locator('.badge', { hasText: 'Active' })).toHaveCount(0)

  // The header count reflects what is on screen, not a filtered-down subset.
  const cardCount = await page.locator('a.community-card').count()
  expect(cardCount).toBeGreaterThanOrEqual(2)
  await expect(page.locator('fieldset.page-card legend').first()).toHaveText(`Cleanups (${cardCount})`)
})
