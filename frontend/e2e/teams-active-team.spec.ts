import { test, expect } from '@playwright/test'
import { signInFreshUser } from './helpers/cleanup'

// The teams list carried the same defect as the cleanups list: an active team
// hard-filtered it down to that one team. Activating a team marks it, it does
// not hide the others.

const API_BASE = 'http://localhost:3000/api/v1'

async function createTeamViaApi(sessionToken: string, name: string): Promise<string> {
  const response = await fetch(`${API_BASE}/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify({ name, description: 'Created by Playwright' }),
  })
  if (!response.ok) throw new Error(`Failed to create team: ${response.status} ${await response.text()}`)
  const data = await response.json()
  const id = data.team?.id ?? data.id
  if (!id) throw new Error(`Unexpected createTeam response shape: ${JSON.stringify(data)}`)
  return id
}

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
