import { test, expect } from '@playwright/test'
import { openLibrary, openStarterBook, fixture } from './helpers.js'

// Safari Private Browsing can't store Blobs in IndexedDB, so books and covers are stored as bytes.
test('books and covers are stored as bytes (Safari private mode safe) and read back as files', async ({ page }) => {
  await openLibrary(page)
  await openStarterBook(page, 'pg-345')
  await page.keyboard.press('Escape')
  await page.setInputFiles('#file-input', { name: 'sample.epub', mimeType: 'application/epub+zip', buffer: fixture('sample.epub') })
  await expect(page.locator('.book-open[aria-label^="A Test Voyage"]')).toBeVisible()
  const raw = await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('reader')
    req.onsuccess = () => {
      const t = req.result.transaction(['files', 'books'], 'readonly')
      const out = {}
      t.objectStore('files').get('pg-345').onsuccess = e => { out.txt = e.target.result }
      t.objectStore('files').getAll().onsuccess = e => { out.epub = e.target.result.find(f => f.id.startsWith('local-')) }
      t.objectStore('books').getAll().onsuccess = e => { out.cover = e.target.result.find(b => b.id.startsWith('local-'))?.cover }
      t.oncomplete = () => resolve({
        txtIsBytes: out.txt.blob.__blob instanceof ArrayBuffer && !(out.txt.blob instanceof Blob),
        epubIsBytes: out.epub.blob.__blob instanceof ArrayBuffer,
        coverIsBytes: out.cover?.__blob instanceof ArrayBuffer,
      })
      t.onerror = () => reject(t.error)
    }
  }))
  expect(raw).toEqual({ txtIsBytes: true, epubIsBytes: true, coverIsBytes: true })
  // and they still open (read back as Files)
  await page.locator('.book-open[aria-label^="A Test Voyage"]').click()
  await expect(page.locator('#reader-title')).toHaveText('A Test Voyage')
  await expect(page.locator('#status-right')).toContainText('%', { timeout: 20_000 })
})
