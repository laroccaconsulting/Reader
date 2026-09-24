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

test('files shared from other apps (Web Share Target) are imported', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('#book-grid .book-card').first()).toBeVisible()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  const status = await page.evaluate(async () => {
    const epub = await (await fetch('tests/fixtures/sample.epub')).blob()
    const form = new FormData()
    form.append('books', new File([epub], 'shared-voyage.epub', { type: 'application/epub+zip' }))
    const res = await fetch('./share-target', { method: 'POST', body: form, redirect: 'manual' })
    return res.type === 'opaqueredirect' ? 303 : res.status
  })
  expect(status).toBe(303)
  await page.goto('./#/library?shared=1')
  await page.reload()
  await expect(page.locator('.book-open[aria-label^="A Test Voyage"]')).toBeVisible()
  await expect(page).toHaveURL(/#\/library$/)
})
