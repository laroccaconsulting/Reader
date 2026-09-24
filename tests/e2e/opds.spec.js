import { test, expect } from '@playwright/test'
import { fixture, readerText } from './helpers.js'

test('add an OPDS catalog, browse it, download a book and read it', async ({ page }) => {
  const cors = { 'Access-Control-Allow-Origin': '*' }
  await page.route('https://opds.example.org/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/catalog') return route.fulfill({ body: fixture('opds-root.xml'), contentType: 'application/atom+xml', headers: cors })
    if (path === '/new' || path === '/search') return route.fulfill({ body: fixture('opds-new.xml'), contentType: 'application/atom+xml', headers: cors })
    if (path === '/files/voyage.epub') return route.fulfill({ body: fixture('sample.epub'), contentType: 'application/epub+zip', headers: cors })
    return route.fulfill({ status: 404, headers: cors })
  })
  await page.goto('./#/discover')
  await page.click('#source-tabs [data-source="opds"]')
  await page.fill('#feed-url', 'https://opds.example.org/catalog')
  await page.click('#add-feed button')
  await expect(page.locator('.feed-head h2')).toHaveText('Test Library')
  await page.click('[data-feed="https://opds.example.org/new"]')
  const cards = page.locator('#discover-results .book-card')
  await expect(cards).toHaveCount(2)
  await cards.nth(1).locator('.book-open').click()
  await expect(page.locator('#book-body')).toContainText('no free download')
  await page.keyboard.press('Escape')
  await cards.first().locator('.book-open').click()
  await expect(page.locator('#book-body')).toContainText('A tiny book for tests.')
  await page.click('#book-body [data-act="get"]')
  await page.click('#book-body [data-act="read"]')
  await expect.poll(() => readerText(page)).toContain('bright cold day')

  // saved catalog persists and search works
  await page.goto('./#/discover')
  await page.click('#source-tabs [data-source="opds"]')
  await expect(page.locator('.nav-item', { hasText: 'Test Library' })).toBeVisible()
  await page.click('.nav-item >> text=Test Library')
  await page.fill('#discover-search', 'voyage')
  await page.press('#discover-search', 'Enter')
  await expect(page.locator('.feed-head h2')).toHaveText('New arrivals')
})
