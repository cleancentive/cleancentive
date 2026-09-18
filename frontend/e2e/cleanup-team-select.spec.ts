import { test, expect } from '@playwright/test'
import { signInFreshUser, createCleanupViaApi, createTeamViaApi } from './helpers/cleanup'

// The feedback behind this: a team that organizes cleanups had no way to say so.
// An organizer picks the team on the create form, or adds it later by editing.

// Serial: both tests sign in by magic link, and clearMailpit() wipes the whole
// inbox — run in parallel they delete each other's link.
test.describe.configure({ mode: 'serial' })

test('an organizer picks their team when creating a cleanup', async ({ page }) => {
  const { sessionToken } = await signInFreshUser(page)

  const suffix = Date.now()
  const teamName = `E2E Select Team ${suffix}`
  const teamId = await createTeamViaApi(sessionToken, teamName)
  const cleanupName = `E2E Selected Cleanup ${suffix}`

  await page.goto('/cleanups')
  await page.locator('button.primary-button:has-text("Create Cleanup")').click()

  await page.locator('#cleanup-name').fill(cleanupName)
  await page.locator('#cleanup-team').selectOption(teamId)

  const start = new Date(Date.now() + 7 * 24 * 60 * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const localDate = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
  await page.locator('#cleanup-start').fill(`${localDate}T09:00`)
  await page.locator('#cleanup-end').fill(`${localDate}T15:00`)
  await page.locator('input[placeholder="40.785"]').fill('47.3769')
  await page.locator('input[placeholder="-73.968"]').fill('8.5417')

  await page.locator('form.community-create-form button[type="submit"]').click()

  await expect(page.locator('.cleanup-provenance', { hasText: teamName })).toBeVisible({ timeout: 10000 })
  await expect(page).toHaveURL(/\/cleanups\/[0-9a-f-]+$/)
})

test('an organizer assigns a team to an existing cleanup by editing it', async ({ page }) => {
  const { sessionToken } = await signInFreshUser(page)

  const suffix = Date.now()
  const teamName = `E2E Later Team ${suffix}`
  const teamId = await createTeamViaApi(sessionToken, teamName)
  const { cleanupId } = await createCleanupViaApi(sessionToken, { name: `E2E Unassigned Cleanup ${suffix}` })

  await page.goto(`/cleanups/${cleanupId}`)
  await expect(page.locator('.cleanup-provenance', { hasText: 'Organized by' })).toHaveCount(0)

  await page.locator('button.legend-edit-button:has-text("Edit")').click()
  await page.locator('#cleanup-edit-team').selectOption(teamId)
  await page.locator('button.primary-button:has-text("Save")').click()

  await expect(page.locator('.cleanup-provenance', { hasText: teamName })).toBeVisible({ timeout: 10000 })
})
