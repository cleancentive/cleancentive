import { test, expect } from './fixtures'

// Guards feedback 01a0954d: importing a photo whose EXIF carries no GPS used to
// dead-end with "Enable Location in your camera app and try again" and the photo
// was discarded. That is what an iPhone hits routinely — Safari transcodes Photo
// Library picks to JPEG and drops the GPS block on the way — so the photo really
// does have coordinates on the phone and none by the time it reaches us.
//
// The rule pinned down here: a photo we cannot place is kept, and the user can
// put it on the map by hand.

const STRIPPED = 'src/lib/__fixtures__/gps-stripped.jpg'
const TAGGED = 'src/lib/__fixtures__/gps-tagged.jpg'

test('a photo without GPS is kept and can be placed by hand', async ({ page }) => {
  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: 47.5596, longitude: 7.5886 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.locator('input.file-import-input').setInputFiles(STRIPPED)

  // Kept, with the reason and the iPhone hint — not an error dead end.
  const recovery = page.locator('.location-consent', { hasText: 'without location data' })
  await expect(recovery).toBeVisible()
  await expect(recovery).toContainText('Browse')
  await expect(page.locator('.error-message')).toHaveCount(0)

  await recovery.locator('.primary-button').click()

  const picker = page.locator('.manual-location-dialog')
  await expect(picker).toBeVisible()
  await picker.locator('.maplibregl-canvas').click({ position: { x: 200, y: 150 } })
  await picker.locator('.primary-button').click()

  // The photo reached the outbox — precisely what never happened before.
  await expect(recovery).toHaveCount(0)
  await expect(page.locator('.history-card').first()).toBeVisible()
})

test('a GPS-tagged photo still imports without prompting', async ({ page }) => {
  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: 47.5596, longitude: 7.5886 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.locator('input.file-import-input').setInputFiles(TAGGED)

  await expect(page.locator('.location-consent', { hasText: 'without location data' })).toHaveCount(0)
  await expect(page.locator('.manual-location-dialog')).toHaveCount(0)
})

test('a batch keeps photos without GPS and places them with one pin', async ({ page }) => {
  await page.context().grantPermissions(['geolocation'])
  await page.context().setGeolocation({ latitude: 47.5596, longitude: 7.5886 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.locator('input.file-import-input').setInputFiles([STRIPPED, TAGGED])

  const dialog = page.locator('.batch-import-dialog')
  await expect(dialog).toBeVisible()

  // Both photos survive processing — the unlocated one used to be dropped here.
  await expect(dialog.locator('.batch-import-item')).toHaveCount(2)

  const banner = dialog.locator('.batch-import-needs-location')
  await expect(banner).toContainText('1 photo has no location data')
  await expect(banner).toContainText('Browse')

  await banner.locator('.secondary-button').click()
  const picker = page.locator('.manual-location-dialog')
  await expect(picker).toBeVisible()
  await picker.locator('.maplibregl-canvas').click({ position: { x: 200, y: 150 } })
  await picker.locator('.primary-button').click()

  // The batch dialog is still open — the picker's backdrop must not cancel it.
  await expect(dialog).toBeVisible()
  await expect(banner).toContainText('will be logged at the pin')

  await dialog.locator('.batch-import-group-actions button', { hasText: 'Import' }).first().click()
  await expect(dialog.locator('.batch-import-done')).toContainText('2 photos imported')
})
