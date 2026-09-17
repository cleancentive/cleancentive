import { test, expect } from '@playwright/test'

// The list opens on ongoing+future. A community with nothing scheduled then got
// "No cleanups found" while the pills right above it read "Past (3)" — the page
// looked broken rather than quiet. It should widen to past on its own.
//
// The search endpoint is stubbed so the assertion does not depend on what the
// dev database happens to hold.

const PAST_COUNTS = { past: 3, ongoing: 0, future: 0 }

function pastCleanup(n: number) {
  const start = new Date(Date.now() - (n + 1) * 24 * 60 * 60_000)
  const end = new Date(start.getTime() + 3 * 60 * 60_000)
  return {
    cleanup: {
      id: `00000000-0000-0000-0000-00000000000${n}`,
      name: `Stubbed Past Cleanup ${n}`,
      description: 'Already over',
      created_at: start.toISOString(),
    },
    nearestDate: {
      id: `00000000-0000-0000-0000-0000000000f${n}`,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      latitude: 47.2,
      longitude: 7.5,
      location_name: 'Solothurn',
      recurrence_id: null,
    },
    dates: [],
    userRole: null,
  }
}

test('widens to past when nothing is ongoing or upcoming', async ({ page }) => {
  const requestedStatuses: string[] = []

  await page.route('**/cleanups/search*', async (route) => {
    const status = new URL(route.request().url()).searchParams.get('status') ?? ''
    requestedStatuses.push(status)

    const items = status.includes('past') ? [1, 2, 3].map(pastCleanup) : []
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, total: items.length, counts: PAST_COUNTS }),
    })
  })

  await page.goto('/cleanups')

  // The past pill lights up rather than the list claiming there is nothing.
  const pastPill = page.locator('.filter-pill', { hasText: 'Past' })
  await expect(pastPill).toHaveClass(/filter-pill--active/, { timeout: 10000 })
  await expect(page.locator('a.community-card')).toHaveCount(3)
  await expect(page.locator('.end-of-list')).toHaveCount(0)
  await expect(page.locator('fieldset.page-card legend').first()).toHaveText('Cleanups (3)')

  // It widened once, off the back of the default request — it did not loop.
  expect(requestedStatuses.filter(s => s.includes('past'))).toHaveLength(1)
  expect(requestedStatuses[0]).toBe('ongoing,future')
})
