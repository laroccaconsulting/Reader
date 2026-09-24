import { test, expect } from '@playwright/test'
import { openLibrary } from './helpers.js'

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPHONE_INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 380.0.0.0'

/** Pretend some reading has happened (the nudge waits for that). */
async function withReading(page) {
  await openLibrary(page)
  await page.evaluate(async () => {
    const db = await import('./app/db.js')
    await db.kvSet('stats', { days: { '2026-01-01': 600 }, books: {} })
  })
  await page.reload()
  await expect(page.locator('#book-grid .book-card').first()).toBeVisible()
}

test.describe('iPhone Safari', () => {
  test.use({ userAgent: IPHONE_SAFARI })

  test('suggests adding to the home screen after some reading, with a step-by-step guide', async ({ page }) => {
    await openLibrary(page)
    await expect(page.locator('#install-slot')).toBeEmpty() // not on the very first visit
    await withReading(page)
    await expect(page.locator('#install-slot')).toContainText('Put Read Free on your home screen')
    await page.click('#install-go')
    await expect(page.locator('#sheet-install')).toBeVisible()
    await expect(page.locator('#install-body')).toContainText('Add to Home Screen')
    await page.keyboard.press('Escape')
    await page.click('#install-later')
    await expect(page.locator('#install-slot')).toBeEmpty()
    await page.reload()
    await expect(page.locator('#book-grid .book-card').first()).toBeVisible()
    await expect(page.locator('#install-slot')).toBeEmpty() // snoozed
    // still available from Settings
    await page.goto('./#/settings')
    await page.click('#install-app')
    await expect(page.locator('#install-body')).toContainText('Add to Home Screen')
  })
})

test.describe('in-app browser', () => {
  test.use({ userAgent: IPHONE_INSTAGRAM })

  test('explains how to open the page in Safari first', async ({ page }) => {
    await withReading(page)
    await expect(page.locator('#install-slot')).toContainText('Open this page in Safari')
    await page.click('#install-go')
    await expect(page.locator('#install-body')).toContainText('Open in Safari')
  })
})

test('browsers with an install prompt use it', async ({ page }) => {
  await withReading(page)
  await expect(page.locator('#install-slot')).toBeEmpty() // desktop Chrome in tests has no prompt
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true })
    e.prompt = () => { window.__prompted = true }
    e.userChoice = Promise.resolve({ outcome: 'accepted' })
    window.dispatchEvent(e)
  })
  await expect(page.locator('#install-go')).toHaveText('Install')
  await page.click('#install-go')
  expect(await page.evaluate(() => window.__prompted)).toBe(true)
})
