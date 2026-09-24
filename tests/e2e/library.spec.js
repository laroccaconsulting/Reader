import { test, expect } from '@playwright/test'
import { watch, openLibrary, openStarterBook, readerText, fixture } from './helpers.js'

test('library shows the starter shelf without errors or third-party requests', async ({ page }) => {
  const w = watch(page)
  await openLibrary(page)
  await expect(page.locator('#book-grid .book-card')).toHaveCount(51)
  await expect(page.locator('#banner-slot')).toContainText('Take the classics offline')
  await page.waitForTimeout(500)
  expect(w.errors).toEqual([])
  expect(w.external).toEqual([])
})

test('search and filters narrow the library', async ({ page }) => {
  await openLibrary(page)
  await page.fill('#library-search', 'austen')
  await expect(page.locator('#book-grid .book-card')).toHaveCount(3)
  await page.fill('#library-search', 'zzzz')
  await expect(page.locator('#library-empty')).toContainText('No matching books')
})

test('opening a starter book downloads it, starts at chapter 1 and turns pages', async ({ page }) => {
  const w = watch(page)
  await openLibrary(page)
  await openStarterBook(page, 'pg-5200') // The Metamorphosis: previously one wall of text
  await expect(page.locator('#reader-chapter')).toHaveText('I')
  const first = await readerText(page)
  expect(first).toContain('One morning, when Gregor Samsa woke')
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => readerText(page)).not.toBe(first)
  expect(w.errors).toEqual([])
})

test('table of contents navigates and shows real chapters', async ({ page }) => {
  await openLibrary(page)
  await openStarterBook(page, 'pg-2701') // Moby-Dick: contents list used to become chapters
  await page.click('#toc-btn')
  const links = page.locator('#toc-list .toc-link')
  await expect(links.nth(1)).toHaveText('Etymology.')
  await page.locator('#toc-list .toc-link', { hasText: 'Chapter 1. Loomings.' }).click()
  await expect(page.locator('#reader-chapter')).toHaveText('Chapter 1. Loomings.')
  await expect.poll(() => readerText(page)).toContain('Call me Ishmael')
})

test('progress and bookmarks survive a reload', async ({ page }) => {
  await openLibrary(page)
  await openStarterBook(page, 'pg-11')
  await page.click('#toc-btn')
  await page.locator('#toc-list .toc-link', { hasText: 'Chapter III' }).click()
  await expect(page.locator('#reader-chapter')).toContainText('Chapter III')
  await page.waitForTimeout(800) // let the section finish laying out
  const box = await page.locator('#reader-stage').boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2) // centre tap shows the chrome
  await expect(page.locator('#reader')).not.toHaveClass(/chrome-hidden/)
  await page.click('#bookmark-btn')
  await expect(page.locator('#bookmark-btn')).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(1200) // progress save is debounced
  await page.reload()
  await expect(page.locator('#reader-chapter')).toContainText('Chapter III', { timeout: 20_000 })
  await page.click('#toc-btn')
  await page.click('#nav-tabs [data-pane="marks"]')
  await expect(page.locator('#marks-list .mark')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.locator('#continue-slot')).toContainText('Alice')
})

test('Escape in speed reading closes only the speed reader (regression B5)', async ({ page }) => {
  await openLibrary(page)
  await openStarterBook(page, 'pg-1342')
  await page.click('#rsvp-btn')
  await expect(page.locator('#rsvp')).toHaveClass(/open/)
  await expect(page.locator('#rsvp-pivot')).not.toBeEmpty()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Escape')
  await expect(page.locator('#rsvp')).not.toHaveClass(/open/)
  await expect(page.locator('#reader')).toBeVisible()
})

test('reading settings change theme and text size', async ({ page }) => {
  await openLibrary(page)
  await openStarterBook(page, 'pg-84')
  await page.click('#type-btn')
  await page.click('#type-body [data-set="theme"][data-value="dark"]')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const bg = await page.evaluate(() => {
    const view = document.querySelector('foliate-view')
    const doc = view.renderer.getContents()[0].doc
    return getComputedStyle(doc.documentElement).backgroundColor
  })
  expect(bg).toBe('rgb(24, 24, 27)')
  await page.click('#type-body [data-step="fontSize"][data-delta="5"]')
  await expect(page.locator('#out-size')).toHaveText('105%')
})

test('importing an EPUB adds it with its cover and opens it; book scripts are blocked', async ({ page }) => {
  await openLibrary(page)
  await page.setInputFiles('#file-input', { name: 'sample.epub', mimeType: 'application/epub+zip', buffer: fixture('sample.epub') })
  await expect(page.locator('#toast')).toContainText('A Test Voyage')
  const card = page.locator('.book-open[aria-label^="A Test Voyage"]')
  await expect(card.locator('img')).toHaveCount(1)
  await card.click()
  await expect(page.locator('#reader-title')).toHaveText('A Test Voyage')
  await expect.poll(() => readerText(page)).toContain('bright cold day')
  expect(await page.evaluate(() => window.__epubScriptRan)).toBeUndefined()
})

test('tapping a note reference shows the endnote in place', async ({ page }) => {
  await openLibrary(page)
  await page.setInputFiles('#file-input', { name: 'sample.epub', mimeType: 'application/epub+zip', buffer: fixture('sample.epub') })
  await page.locator('.book-open[aria-label^="A Test Voyage"]').click()
  await expect.poll(() => readerText(page)).toContain('bright cold day')
  await page.evaluate(() => {
    const { doc } = document.querySelector('foliate-view').renderer.getContents()[0]
    doc.querySelector('a[href*="notes.xhtml"]').click()
  })
  await expect(page.locator('#sheet-footnote')).toHaveClass(/open/)
  await expect(page.locator('#footnote-text')).toHaveText('Lighthouses were once kept by hand.')
})
