import { test, expect } from '@playwright/test'
import { signInFreshUser, createCleanupViaApi } from './helpers/cleanup'

// Descriptions are Markdown, written by users and imported from other people's
// websites. Rendering happens in a real DOM, so this is where the sanitizer is
// worth testing rather than in a unit test against a stub.

test.describe.configure({ mode: 'serial' })

test('markdown renders as formatted text, with links that leave safely', async ({ page }) => {
  const { sessionToken } = await signInFreshUser(page)
  const suffix = Date.now()
  const { cleanupId } = await createCleanupViaApi(sessionToken, {
    name: `E2E Markdown ${suffix}`,
    description: [
      '### Programm',
      '',
      'Treffpunkt: [Gondelbahn](https://maps.example.org/x)',
      '',
      '- Handschuhe',
      '- Picknick',
      '',
      '**Bitte** pünktlich sein.',
    ].join('\n'),
  })

  await page.goto(`/cleanups/${cleanupId}`)
  const description = page.locator('.cleanup-description-display')
  await expect(description).toBeVisible({ timeout: 10000 })

  await expect(description.locator('h3')).toHaveText('Programm')
  await expect(description.locator('li')).toHaveCount(2)
  await expect(description.locator('strong')).toHaveText('Bitte')

  const link = description.locator('a', { hasText: 'Gondelbahn' })
  await expect(link).toHaveAttribute('href', 'https://maps.example.org/x')
  await expect(link).toHaveAttribute('rel', /noopener/)
  await expect(link).toHaveAttribute('target', '_blank')
})

test('a description cannot smuggle script or a javascript: link into the page', async ({ page }) => {
  const { sessionToken } = await signInFreshUser(page)
  const suffix = Date.now()
  const { cleanupId } = await createCleanupViaApi(sessionToken, {
    name: `E2E Markdown XSS ${suffix}`,
    description: [
      '<script>window.__xss = true</script>',
      '',
      '<img src=x onerror="window.__xss = true">',
      '',
      '[click me](javascript:window.__xss = true)',
      '',
      '<a href="javascript:window.__xss = true">or me</a>',
      '',
      '<iframe src="https://evil.example.org"></iframe>',
      '',
      'harmless tail',
    ].join('\n'),
  })

  await page.goto(`/cleanups/${cleanupId}`)
  const description = page.locator('.cleanup-description-display')
  await expect(description).toContainText('harmless tail', { timeout: 10000 })

  // Nothing executed, and none of the dangerous nodes made it into the DOM.
  expect(await page.evaluate(() => (window as unknown as { __xss?: boolean }).__xss)).toBeUndefined()
  await expect(description.locator('script, iframe, img')).toHaveCount(0)

  const hrefs = await description.locator('a').evaluateAll((els) => els.map((el) => el.getAttribute('href')))
  expect(hrefs.some((href) => href?.toLowerCase().startsWith('javascript:'))).toBe(false)
})
