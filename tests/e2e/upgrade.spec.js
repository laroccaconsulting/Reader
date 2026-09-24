import { test, expect } from '@playwright/test'

test('books and positions from the previous app version are migrated', async ({ page }) => {
  await page.goto('./index.html?blank')
  // Recreate the 1.x storage layout, then start fresh as a returning user would.
  await page.evaluate(async () => {
    localStorage.clear()
    await new Promise(r => { const q = indexedDB.deleteDatabase('reader'); q.onsuccess = q.onerror = q.onblocked = r })
    const text = await (await fetch('books/2852.txt')).text()
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('ReaderDB', 1)
      req.onupgradeneeded = () => {
        const d = req.result
        d.createObjectStore('books', { keyPath: 'id' })
        d.createObjectStore('progress', { keyPath: 'id' })
        d.createObjectStore('bookmarks', { keyPath: 'id' })
      }
      req.onsuccess = () => {
        const tx = req.result.transaction(['books', 'progress'], 'readwrite')
        tx.objectStore('books').put({ id: 2852, text, v: 2 })
        tx.objectStore('progress').put({ id: 2852, chapter: 7, chapterCount: 15, scrollTop: 0 })
        tx.oncomplete = () => { req.result.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
    })
  })
  await page.goto('./')
  const card = page.locator('#book-grid .book-open[data-id="pg-2852"]')
  await expect(card).toHaveAttribute('aria-label', /% read/)
  await expect(card).not.toHaveAttribute('aria-label', /not downloaded/)
  await expect(page.locator('#continue-slot')).toContainText('Baskervilles')
  await page.locator('#continue-slot .book-open').click()
  await expect(page.locator('#status-right')).toContainText(/\b(4\d|5\d)%/, { timeout: 20_000 })
})

test('a half-deployed mix of files is refused: nothing is cached, and the app still works', async ({ page, context }) => {
  // The server hands out one file from another version (as a CDN can right after a deploy)
  await context.route('**/app/stats.js', async route => {
    const res = await route.fetch()
    route.fulfill({ response: res, body: `${await res.text()}\n// from another version\n` })
  })
  await page.goto('./')
  await expect(page.locator('#book-grid .book-card').first()).toBeVisible()
  await page.waitForTimeout(3000) // long enough to download and check everything
  expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active))).toBe(false)
  expect(await page.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('reader-shell')))).toEqual([])
  // Once the server is consistent again, the next visit installs normally
  await context.unroute('**/app/stats.js')
  await page.reload()
  await expect(page.locator('#book-grid .book-card').first()).toBeVisible()
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  expect((await page.evaluate(async () => caches.keys())).some(k => k.startsWith('reader-shell'))).toBe(true)
})

test('if the app cannot start, a Repair screen appears and repairing fixes it', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('#book-grid .book-card').first()).toBeVisible()
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  // Corrupt the cached copy of a module, like a half-finished update would
  await page.evaluate(async () => {
    const key = (await caches.keys()).find(k => k.startsWith('reader-shell'))
    const cache = await caches.open(key)
    const req = (await cache.keys()).find(r => r.url.endsWith('/app/stats.js'))
    await cache.put(req, new Response('export const nope = ', { headers: { 'Content-Type': 'text/javascript' } }))
  })
  await page.reload()
  await expect(page.locator('#boot-rescue')).toBeVisible()
  await expect(page.locator('#boot-rescue')).toContainText('Read Free didn’t start')
  await page.click('#boot-rescue button')
  await expect(page.locator('#book-grid .book-card').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('#boot-rescue')).toHaveCount(0)
})
