import { test, expect } from '@playwright/test'
import { fixture, readerText } from './helpers.js'

test.beforeEach(async ({ page }) => {
  await page.route('https://standardebooks.org/ebooks?**', r => r.fulfill({ body: fixture('se-listing.html'), contentType: 'text/html', headers: { 'Access-Control-Allow-Origin': '*' } }))
  await page.route('https://standardebooks.org/ebooks/ada-tester/a-test-voyage', r => r.fulfill({ body: '<html><head><meta name="description" content="Free epub ebook download of the Standard Ebooks edition of A Test Voyage: A short voyage."></head><body></body></html>', contentType: 'text/html', headers: { 'Access-Control-Allow-Origin': '*' } }))
  await page.route('https://standardebooks.org/ebooks/ada-tester/a-test-voyage/downloads/**', r => r.fulfill({ body: fixture('sample.epub'), contentType: 'application/epub+zip', headers: { 'Access-Control-Allow-Origin': '*' } }))
  await page.route('https://standardebooks.org/images/**', r => r.fulfill({ status: 404 }))
  await page.route('https://www.gutenberg.org/ebooks/search.opds/**', r => r.fulfill({ body: fixture('pg-search.xml'), contentType: 'application/atom+xml', headers: { 'Access-Control-Allow-Origin': '*' } }))
  await page.route('https://www.gutenberg.org/ebooks/84.opds', r => r.fulfill({ body: '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Frankenstein</title><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Summary: A scientist creates life.</p><p>Downloads: 127770</p></div></content></entry></feed>', contentType: 'application/atom+xml', headers: { 'Access-Control-Allow-Origin': '*' } }))
  await page.route('https://www.gutenberg.org/cache/**', r => r.fulfill({ status: 404 }))
})

test('Standard Ebooks: browse, get a book, read it', async ({ page }) => {
  await page.goto('./#/discover')
  const cards = page.locator('#discover-results .book-card')
  await expect(cards).toHaveCount(2)
  await expect(cards.first()).toContainText('A Test Voyage')
  await cards.first().locator('.book-open').click()
  await expect(page.locator('#book-body')).toContainText('A short voyage.')
  await page.click('#book-body [data-act="get"]')
  await expect(page.locator('#book-body [data-act="read"]')).toBeVisible({ timeout: 15_000 })
  await page.click('#book-body [data-act="read"]')
  await expect.poll(() => readerText(page)).toContain('bright cold day')
})

test('Standard Ebooks download URL includes translator segment', async ({ page }) => {
  await page.goto('./')
  const url = await page.evaluate(async () => (await import('./app/catalog/standard-ebooks.js')).epubUrl('/ebooks/leo-tolstoy/anna-karenina/constance-garnett'))
  expect(url).toBe('https://standardebooks.org/ebooks/leo-tolstoy/anna-karenina/constance-garnett/downloads/leo-tolstoy_anna-karenina_constance-garnett.epub?source=download')
})

test('Project Gutenberg: search works; without a relay it offers alternatives', async ({ page }) => {
  await page.goto('./#/discover')
  await page.click('#source-tabs [data-source="gutenberg"]')
  await expect(page.locator('#source-note')).toContainText('download relay')
  const cards = page.locator('#discover-results .book-card')
  await expect(cards).toHaveCount(2)
  await expect(cards.first()).toContainText('Mary Wollstonecraft Shelley')
  await cards.first().locator('.book-open').click()
  await expect(page.locator('#book-body')).toContainText('A scientist creates life.')
  // Frankenstein is on the starter shelf, so its plain-text edition is readable right away
  await expect(page.locator('#book-body [data-act="read-starter"]')).toBeVisible()
  await expect(page.locator('#book-body [data-act="find-se"]')).toBeVisible()
})
