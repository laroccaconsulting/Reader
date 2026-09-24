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
