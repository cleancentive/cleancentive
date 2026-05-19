import { test, expect } from './fixtures'
import { signInFreshUser } from './helpers/cleanup'

test.describe.configure({ mode: 'serial' })

test.describe('Profile hint banner + inline-edit nickname', () => {
  test('shows on cleanup create when profile is incomplete and dismisses cleanly', async ({ page }) => {
    await signInFreshUser(page)

    await page.goto('/cleanups')
    await page.waitForLoadState('networkidle')

    await page.locator('button:has-text("Create Cleanup")').click()
    const form = page.locator('.community-create-form')
    await expect(form).toBeVisible()

    const banner = page.locator('.profile-hint-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('Participants will see you as the organizer')

    await banner.locator('button:has-text("Not now")').click()
    await expect(banner).not.toBeVisible()

    // Re-open the form — banner stays dismissed
    await page.locator('button:has-text("Cancel")').click()
    await page.locator('button:has-text("Create Cleanup")').click()
    await expect(form).toBeVisible()
    await expect(page.locator('.profile-hint-banner')).not.toBeVisible()
  })

  test('inline-edit nickname in user menu updates everywhere and removes the banner', async ({ page }) => {
    const { email } = await signInFreshUser(page)
    const expected = email.split('@')[0].split(/[._-]/)[0]
    const expectedCapitalized = expected.charAt(0).toUpperCase() + expected.slice(1).toLowerCase()

    await page.locator('button[aria-label="User menu"]').click()
    const identity = page.locator('.user-menu-dropdown-identity')
    await expect(identity).toBeVisible()
    await expect(identity.locator('.user-display-nickname--editable')).toContainText('guest')

    await identity.locator('.user-display-nickname--editable').click()
    const input = identity.locator('.user-display-edit-input')
    await expect(input).toBeVisible()
    await expect(input).toHaveValue(expectedCapitalized)

    // Replace the suggestion with a unique value to avoid nickname-uniqueness collisions across test runs
    const unique = `E2e-${Date.now()}`
    await input.fill(unique)
    await input.press('Enter')
    // Wait for the save to complete (input disappears when setIsEditing(false))
    await expect(input).not.toBeVisible()

    // Banner disappears across surfaces once nickname is non-'guest'
    await page.goto('/cleanups')
    await page.waitForLoadState('networkidle')
    await page.locator('button:has-text("Create Cleanup")').click()
    await expect(page.locator('.community-create-form')).toBeVisible()
    await expect(page.locator('.profile-hint-banner')).not.toBeVisible()
  })
})
