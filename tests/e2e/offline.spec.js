import { test, expect } from '@playwright/test'
import { openLibrary, openStarterBook, readerText } from './helpers.js'

test('works fully offline after the first visit', async ({ page, context }) => {
  await openLibrary(page)
  await openStarterBook(page, 'pg-43')
  await page.keyboard.press('Escape')
  // wait for the service worker to take control and finish precaching
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await page.waitForTimeout(500)

  await context.setOffline(true)
  await page.reload()
  await expect(page.locator('#book-grid .book-card')).toHaveCount(51)
  await page.locator('.book-open[data-id="pg-43"]').first().click()
  await expect.poll(() => readerText(page), { timeout: 20_000 }).not.toBe('')
  await context.setOffline(false)
})
