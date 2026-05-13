import { expect, type Page } from '@playwright/test'
import { generateTestEmail } from './api'
import { clearMailpit, waitForEmail, extractMagicLink } from './mailpit'

const API_BASE = 'http://localhost:3000/api/v1'

/**
 * Sign in a fresh test user via the magic-link UI flow and return the
 * session token from localStorage so API setup can run as that user.
 */
export async function signInFreshUser(page: Page): Promise<{ email: string; sessionToken: string }> {
  await clearMailpit()
  const email = generateTestEmail('e2e-cleanup-form')

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  // Sign-in lives in a modal; the trigger is either the guest-state primary
  // button on AppLayout or the user-menu icon button (aria-label="Sign in").
  const signInTrigger = page
    .locator('button[aria-label="Sign in"], button.primary-button:has-text("Sign In")')
    .first()
  await signInTrigger.waitFor({ state: 'visible', timeout: 10000 })
  await signInTrigger.click()

  const dialog = page.locator('.sign-in-dialog')
  await expect(dialog).toBeVisible({ timeout: 5000 })
  await expect(dialog.locator('h2:has-text("Welcome to CleanCentive")')).toBeVisible()

  await dialog.locator('input#email').fill(email)
  await dialog.locator('button[type="submit"]:has-text("Send magic link")').click()
  await expect(dialog.locator('h2:has-text("Check your email")')).toBeVisible({ timeout: 5000 })

  const message = await waitForEmail(email, 10000)
  const magicLink = extractMagicLink(message.HTML)
  if (!magicLink) throw new Error('No magic link found in email')
  // /auth/verify returns JSON + an x-session-token header rather than redirecting,
  // so opening it directly in the page would show raw JSON. Instead hit it as a
  // plain fetch from the test runner — this completes the pending-auth record on
  // the backend, and the frontend's poll on /auth/pending/:requestId picks it up.
  const tokenMatch = magicLink.match(/[?&]token=([^&]+)/)
  if (!tokenMatch) throw new Error(`No token in magic link: ${magicLink}`)
  const verifyResponse = await fetch(`${API_BASE}/auth/verify?token=${tokenMatch[1]}`)
  if (!verifyResponse.ok) {
    throw new Error(`/auth/verify failed: ${verifyResponse.status} ${await verifyResponse.text()}`)
  }

  // Frontend polls every 2s; give it generous time to react.
  await expect(page.locator('button[aria-label="User menu"]')).toBeVisible({ timeout: 15000 })

  const sessionToken = await page.evaluate(() => {
    const raw = localStorage.getItem('auth-storage')
    if (!raw) return null
    try {
      return JSON.parse(raw)?.state?.sessionToken ?? null
    } catch {
      return null
    }
  })

  if (!sessionToken) throw new Error('Failed to read sessionToken from localStorage after sign-in')
  return { email, sessionToken: sessionToken as string }
}

/**
 * Create a cleanup via the API as the signed-in user. The creator
 * automatically becomes the organizer.
 */
export async function createCleanupViaApi(
  sessionToken: string,
  overrides: Partial<{
    name: string
    description: string
    startAt: string
    endAt: string
    latitude: number
    longitude: number
    locationName: string
  }> = {},
): Promise<{ cleanupId: string; cleanupDateId: string }> {
  const start = new Date(Date.now() + 7 * 24 * 60 * 60_000) // a week from now
  const end = new Date(start.getTime() + 3 * 60 * 60_000)   // 3 hours later

  const body = {
    name: overrides.name ?? `E2E Cleanup ${Date.now()}`,
    description: overrides.description ?? 'Created by Playwright',
    date: {
      startAt: overrides.startAt ?? start.toISOString(),
      endAt: overrides.endAt ?? end.toISOString(),
      latitude: overrides.latitude ?? 47.3769,
      longitude: overrides.longitude ?? 8.5417,
      locationName: overrides.locationName ?? 'Zurich',
    },
  }

  const response = await fetch(`${API_BASE}/cleanups`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(`Failed to create cleanup: ${response.status} ${await response.text()}`)
  }

  const data = await response.json()
  const cleanupId = data.cleanup?.id ?? data.id
  const cleanupDateId = data.cleanupDate?.id ?? data.cleanup?.dates?.[0]?.id ?? data.dates?.[0]?.id
  if (!cleanupId || !cleanupDateId) {
    throw new Error(`Unexpected createCleanup response shape: ${JSON.stringify(data)}`)
  }
  return { cleanupId, cleanupDateId }
}
