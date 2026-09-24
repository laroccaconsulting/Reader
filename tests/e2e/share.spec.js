import { test, expect } from '@playwright/test'
import { openLibrary, openStarterBook, fixture } from './helpers.js'

/** Select a passage deep in the current section (after the first paragraphs). */
const selectPassage = page => page.evaluate(() => {
  const { doc } = document.querySelector('foliate-view').renderer.getContents()[0]
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode()) && node.data.trim().length < 120) { /* skip short nodes */ }
  const range = doc.createRange()
  range.setStart(node, 10)
  range.setEnd(node, 90)
  doc.getSelection().removeAllRanges()
  doc.getSelection().addRange(range)
  doc.dispatchEvent(new Event('selectionchange'))
  return range.toString().replace(/\s+/g, ' ').trim()
})

const flashedText = page => page.evaluate(() => {
  const doc = document.querySelector('foliate-view')?.renderer?.getContents?.()[0]?.doc
  const h = doc?.defaultView.CSS.highlights.get('shared-quote')
  return h ? [...h][0].toString().replace(/\s+/g, ' ').trim() : ''
})

test('share a quote: image renders, link round-trips to the exact passage for a new reader', async ({ page, browser, context }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openLibrary(page)
  await openStarterBook(page, 'pg-1342')
  await page.click('#toc-btn')
  await page.locator('#toc-list .toc-link', { hasText: 'Chapter XX.' }).first().click()
  await page.waitForTimeout(800)
  const quote = await selectPassage(page)
  await expect(page.locator('#hl-pop')).toBeVisible()
  await page.click('#hl-pop [data-act="share"]')
  await expect(page.locator('#sheet-share')).toHaveClass(/open/)

  // The image renders at the chosen size
  await expect.poll(() => page.evaluate(() => document.querySelector('#share-img')?.naturalWidth)).toBe(1080)
  await page.click('#share-body [data-format="story"]')
  await expect.poll(() => page.evaluate(() => document.querySelector('#share-img')?.naturalHeight)).toBe(1920)
  const download = page.waitForEvent('download')
  await page.click('#share-save')
  expect((await download).suggestedFilename()).toMatch(/Pride-and-Prejudice-quote-story\.png/)

  await page.click('#share-link')
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toContain('#/q/pg1342?')
  expect(decodeURIComponent(link)).toContain('b=Pride+and+Prejudice'.replace(/\+/g, ' ').split(' ')[0])

  // Same device: opens straight at the passage
  await page.goto(link)
  await expect.poll(() => flashedText(page), { timeout: 20_000 }).toBe(quote)

  // A brand-new reader: landing card -> get the book -> lands on the passage
  const fresh = await browser.newContext({ ...info.project.use })
  const other = await fresh.newPage()
  await other.goto(link)
  await expect(other.locator('#sheet-quote')).toHaveClass(/open/)
  await expect(other.locator('.landing-quote')).toHaveText(quote)
  await expect(other.locator('.landing-cite')).toContainText('Pride and Prejudice')
  await other.click('#quote-get')
  await expect.poll(() => flashedText(other), { timeout: 25_000 }).toBe(quote)
  await fresh.close()
})

test('Standard Ebooks quote link downloads the book for a new reader', async ({ page }) => {
  const cors = { 'Access-Control-Allow-Origin': '*' }
  await page.route('https://standardebooks.org/ebooks/ada-tester/a-test-voyage/downloads/**', r => r.fulfill({ body: fixture('sample.epub'), contentType: 'application/epub+zip', headers: cors }))
  const q = new URLSearchParams({ t: 'the lighthouse keeper smiled', p: 'The clocks were striking thirteen and', b: 'A Test Voyage', a: 'Ada Tester' })
  await page.goto(`./#/q/${encodeURIComponent('se:ada-tester/a-test-voyage')}?${q}`)
  await expect(page.locator('.landing-cite')).toContainText('A Test Voyage')
  await page.click('#quote-get')
  await expect.poll(() => flashedText(page), { timeout: 20_000 }).toBe('the lighthouse keeper smiled')
  await expect(page.locator('#reader-chapter')).toHaveText('The Middle')
})

test('imported books share images but not links', async ({ page }) => {
  await openLibrary(page)
  await page.setInputFiles('#file-input', { name: 'sample.epub', mimeType: 'application/epub+zip', buffer: fixture('sample.epub') })
  await page.locator('.book-open[aria-label^="A Test Voyage"]').click()
  await page.waitForTimeout(1500)
  await selectPassage(page)
  await page.click('#hl-pop [data-act="share"]')
  await expect(page.locator('#share-save')).toBeVisible()
  await expect(page.locator('#share-link')).toHaveCount(0)
  await expect(page.locator('#share-body')).toContainText('imported')
})
