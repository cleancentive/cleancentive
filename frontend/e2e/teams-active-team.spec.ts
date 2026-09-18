import { test, expect } from '@playwright/test'
import { signInFreshUser, createTeamViaApi } from './helpers/cleanup'

// The teams list carried the same defect as the cleanups list: an active team
// hard-filtered it down to that one team. Activating a team marks it, it does
// not hide the others.

const API_BASE = 'http://localhost:3000/api/v1'

test('activating a team badges it without hiding the other teams', async ({ page }) => {
  const { sessionToken } = await signInFreshUser(page)

  const suffix = Date.now()
  const activeName = `E2E Active Team ${suffix}`
  const otherName = `E2E Other Team ${suffix}`

  const activeId = await createTeamViaApi(sessionToken, activeName)
  await createTeamViaApi(sessionToken, otherName)

  const activation = await fetch(`${API_BASE}/teams/${activeId}/activate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}` },
  })
  expect(activation.ok, `activate failed: ${activation.status}`).toBe(true)

  await page.goto('/teams')
  await page.waitForLoadState('networkidle')

  const activeCard = page.locator('a.community-card', { hasText: activeName })
  const otherCard = page.locator('a.community-card', { hasText: otherName })

  await expect(activeCard).toBeVisible({ timeout: 10000 })
  await expect(otherCard).toBeVisible()

  await expect(activeCard.locator('.badge', { hasText: 'Active' })).toBeVisible()
  await expect(otherCard.locator('.badge', { hasText: 'Active' })).toHaveCount(0)
})
