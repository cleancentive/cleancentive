import { test, expect } from '@playwright/test';
import { generateTestEmail } from './helpers/api';
import {
  clearMailpit,
  waitForEmail,
  extractMagicLink,
} from './helpers/mailpit';

/** Helper: open login form from guest banner */
async function openLoginForm(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const loginFormVisible = await page
    .locator('h2:has-text("Sign in to CleanCentive")')
    .isVisible()
    .catch(() => false);

  if (!loginFormVisible) {
    const signInButton = page
      .locator('button:has-text("Login"), button:has-text("Sign in"), a:has-text("Login"), a:has-text("Sign in")')
      .first();
    if (await signInButton.isVisible().catch(() => false)) {
      await signInButton.click();
    }
  }

  await expect(page.locator('h2:has-text("Sign in to CleanCentive")')).toBeVisible();
}

/** Helper: submit email in login form and wait for success */
async function submitEmail(page: import('@playwright/test').Page, email: string) {
  await page.locator('input#email').fill(email);
  await page.locator('button[type="submit"]:has-text("Send magic link")').click();
  await expect(page.locator('h2:has-text("Check your email!")')).toBeVisible({ timeout: 5000 });
  await expect(page.locator(`text=${email}`)).toBeVisible();
}

test.describe('Magic Link Authentication', () => {
  test.beforeEach(async () => {
    await clearMailpit();
  });

  test('guest claims account with new email and authenticates', async ({ page }) => {
    const testEmail = generateTestEmail('e2e-claim');

    // Guest opens app and submits email via the UI
    await openLoginForm(page);
    await submitEmail(page, testEmail);

    // Email should arrive (new email gets attached to guest, magic link sent)
    console.log('Waiting for email in Mailpit...');
    const email = await waitForEmail(testEmail, 10000);
    expect(email).toBeDefined();
    expect(email.Subject).toContain('Magic Link');
    console.log(`Received email: ${email.Subject}`);

    // Extract and follow magic link
    const magicLink = extractMagicLink(email.HTML);
    expect(magicLink).not.toBeNull();
    console.log(`Extracted magic link: ${magicLink}`);

    await page.goto(magicLink!);
    await page.waitForLoadState('networkidle');

    // Verify authenticated — guest banner should be gone
    const guestBanner = page.locator('text="You\'re browsing as a guest"');
    await expect(guestBanner).not.toBeVisible({ timeout: 5000 });

    // Should see Sign Out button
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();

    // Still on the app
    await expect(page).toHaveURL(/.*localhost:5173/);
    console.log('User authenticated successfully');
  });

  test('returning user gets magic link for existing email', async ({ page }) => {
    const testEmail = generateTestEmail('e2e-return');

    // First: claim the account via UI
    await openLoginForm(page);
    await submitEmail(page, testEmail);

    const firstEmail = await waitForEmail(testEmail, 10000);
    const firstLink = extractMagicLink(firstEmail.HTML);
    await page.goto(firstLink!);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();

    // Now sign out
    await page.locator('button:has-text("Sign Out")').click();
    await page.waitForLoadState('networkidle');

    // Clear mailpit and request login again with same email
    await clearMailpit();
    await openLoginForm(page);
    await submitEmail(page, testEmail);

    // Should receive a second magic link
    const secondEmail = await waitForEmail(testEmail, 10000);
    expect(secondEmail.Subject).toContain('Magic Link');

    const secondLink = extractMagicLink(secondEmail.HTML);
    expect(secondLink).not.toBeNull();

    await page.goto(secondLink!);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('button:has-text("Sign Out")')).toBeVisible();
    console.log('Returning user authenticated successfully');
  });

  test('validates email format', async ({ page }) => {
    await openLoginForm(page);

    const emailInput = page.locator('input#email');
    await emailInput.fill('notanemail');

    const validationMessage = await emailInput.evaluate(
      (el: HTMLInputElement) => el.validationMessage,
    );

    if (validationMessage) {
      expect(validationMessage.length).toBeGreaterThan(0);
      console.log(`HTML5 validation message: ${validationMessage}`);
    } else {
      await page.locator('button[type="submit"]:has-text("Send magic link")').click();
      const successVisible = await page
        .locator('h2:has-text("Check your email!")')
        .isVisible()
        .catch(() => false);
      expect(successVisible).toBe(false);
    }
  });
});
