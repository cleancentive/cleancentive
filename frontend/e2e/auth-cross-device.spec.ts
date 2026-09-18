import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { generateTestEmail } from './helpers/api';
import { clearMailpit, waitForEmail, extractMagicLink } from './helpers/mailpit';

/**
 * A sign-in started in one browser and finished in another.
 *
 * Completing the waiting request hands a session to whoever started it, so it
 * used to be enough to ask for a link to an address you do not own, hold on to
 * the request id, and collect the session the moment the real owner clicked.
 * The device that opens the link now decides.
 */

async function requestMagicLink(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const heading = page.getByRole('heading', { name: 'Welcome to CleanCentive!' });
  if (!(await heading.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Sign in' }).first().click();
  }
  await expect(heading).toBeVisible();

  await page.locator('input#email').fill(email);
  await page.locator('button[type="submit"]:has-text("Send magic link")').click();
  await expect(page.locator('h2:has-text("Check your email!")')).toBeVisible({ timeout: 5000 });
}

// The header's sign-in control is icon-only and named by aria-label. Matched
// exactly: Playwright's `name` is a substring match by default, so a loose
// "Sign in" also matches the prompt's own "Yes, sign in that device" button.
const signInControl = (page: Page) => page.getByRole('button', { name: 'Sign in', exact: true });

async function expectSignedIn(page: Page): Promise<void> {
  await expect(signInControl(page)).toHaveCount(0, { timeout: 10000 });
}

async function expectSignedOut(page: Page): Promise<void> {
  await expect(signInControl(page).first()).toBeVisible();
}

test.describe('Cross-device magic link', () => {
  let other: BrowserContext;

  test.beforeEach(async ({ browser }) => {
    await clearMailpit();
    // A second context is a second device: its own storage, so it has no record
    // of having started the sign-in.
    other = await browser.newContext();
  });

  test.afterEach(async () => {
    await other?.close();
  });

  test('asks before signing in the device that started the request', async ({ page }) => {
    const email = generateTestEmail('e2e-xdev-yes');

    await requestMagicLink(page, email);
    const mail = await waitForEmail(email, 10000);
    const link = extractMagicLink(mail.HTML);
    expect(link).not.toBeNull();

    // Open the link somewhere else entirely.
    const otherPage = await other.newPage();
    await otherPage.goto(link!);
    await otherPage.waitForLoadState('networkidle');

    // That device is signed in either way — the question is only about the
    // one still waiting.
    await expectSignedIn(otherPage);
    const prompt = otherPage.getByRole('heading', {
      name: 'Finish signing in on the other device?',
    });
    await expect(prompt).toBeVisible();

    // The waiting browser must not have been signed in by the click alone.
    await expectSignedOut(page);

    await otherPage.getByRole('button', { name: 'Yes, sign in that device' }).click();
    await expect(prompt).toHaveCount(0);

    // Now it may proceed: the polling picks the session up.
    await expectSignedIn(page);
  });

  test('declining leaves the waiting device signed out', async ({ page }) => {
    const email = generateTestEmail('e2e-xdev-no');

    await requestMagicLink(page, email);
    const mail = await waitForEmail(email, 10000);
    const link = extractMagicLink(mail.HTML);

    const otherPage = await other.newPage();
    await otherPage.goto(link!);
    await otherPage.waitForLoadState('networkidle');

    await otherPage.getByRole('button', { name: 'No, only here' }).click();
    await expect(
      otherPage.getByRole('heading', { name: 'Finish signing in on the other device?' }),
    ).toHaveCount(0);

    // The person who opened the link is signed in; the requester is not, and
    // polling for a few cycles does not change that.
    await expectSignedIn(otherPage);
    await page.waitForTimeout(5000);
    await expectSignedOut(page);
  });

  test('does not ask when the same browser opens its own link', async ({ page }) => {
    const email = generateTestEmail('e2e-xdev-same');

    await requestMagicLink(page, email);
    const mail = await waitForEmail(email, 10000);
    const link = extractMagicLink(mail.HTML);

    await page.goto(link!);
    await page.waitForLoadState('networkidle');

    // The ordinary case: nothing extra to confirm.
    await expect(
      page.getByRole('heading', { name: 'Finish signing in on the other device?' }),
    ).toHaveCount(0);
    await expectSignedIn(page);
  });
});
