import { test, expect } from '@playwright/test'
import { signInFreshUser, createCleanupViaApi, createTeamViaApi } from './helpers/cleanup'

// A cleanup a team runs should say so: listed on the team's page, badged in the
// cleanups list, and credited on its own page with a link back to the team.

// Serial: both tests sign in by magic link, and clearMailpit() wipes the whole
// inbox — run in parallel they delete each other's link.
test.describe.configure({ mode: 'serial' })

test('a team page lists its cleanups, upcoming before past', async ({ page }) => {
  const { sessionToken } = await signInFreshUser(page)

  const suffix = Date.now()
  const teamId = await createTeamViaApi(sessionToken, `E2E Organizing Team ${suffix}`)

  const past = new Date(Date.now() - 30 * 24 * 60 * 60_000)
  await createCleanupViaApi(sessionToken, {
    name: `E2E Past Cleanup ${suffix}`,
    teamId,
    startAt: past.toISOString(),
    endAt: new Date(past.getTime() + 3 * 60 * 60_000).toISOString(),
  })
  await createCleanupViaApi(sessionToken, { name: `E2E Upcoming Cleanup ${suffix}`, teamId })

  await page.goto(`/teams/${teamId}`)

  const cleanupsCard = page.locator('fieldset.page-card', { hasText: 'Cleanups (2)' })
  await expect(cleanupsCard).toBeVisible({ timeout: 10000 })

  const titles = cleanupsCard.locator('.community-card h3')
  await expect(titles).toHaveCount(2)
  await expect(titles.nth(0)).toHaveText(`E2E Upcoming Cleanup ${suffix}`)
  await expect(titles.nth(1)).toHaveText(`E2E Past Cleanup ${suffix}`)
  await expect(cleanupsCard.locator('h3', { hasText: 'Past cleanups' })).toBeVisible()
})

test('a team cleanup is badged in the list and credits the team on its page', async ({ page }) => {
  const { sessionToken } = await signInFreshUser(page)

  const suffix = Date.now()
  const teamName = `E2E Credited Team ${suffix}`
  const teamId = await createTeamViaApi(sessionToken, teamName)
  const cleanupName = `E2E Credited Cleanup ${suffix}`
  const { cleanupId } = await createCleanupViaApi(sessionToken, { name: cleanupName, teamId })

  await page.goto('/cleanups')
  const card = page.locator('.community-card', { hasText: cleanupName })
  await expect(card).toBeVisible({ timeout: 10000 })
  await expect(card.locator('.badge', { hasText: teamName })).toBeVisible()

  await page.goto(`/cleanups/${cleanupId}`)
  const credit = page.locator('.partner-notice', { hasText: 'Organized by' })
  await expect(credit).toBeVisible({ timeout: 10000 })

  await credit.locator(`a:has-text("${teamName}")`).click()
  await expect(page).toHaveURL(new RegExp(`/teams/${teamId}$`))
})
