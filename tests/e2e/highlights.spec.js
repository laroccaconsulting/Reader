import { test, expect } from '@playwright/test'
import { openLibrary, openStarterBook } from './helpers.js'

/** Select the first N characters of the first paragraph on screen. */
const selectText = page => page.evaluate(() => {
  const view = document.querySelector('foliate-view')
  const { doc } = view.renderer.getContents()[0]
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode()) && node.data.trim().length < 60) { /* find a long text node */ }
  const range = doc.createRange()
  range.setStart(node, 0)
  range.setEnd(node, 40)
  const sel = doc.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
  doc.dispatchEvent(new Event('selectionchange'))
  return range.toString()
})

test('highlight with a note, list it, export it, and keep it after reload', async ({ page }) => {
  await openLibrary(page)
  await openStarterBook(page, 'pg-1342')
  const text = await selectText(page)
  await expect(page.locator('#hl-pop')).toBeVisible()
  await page.click('#hl-pop [data-act="note"]')
  await expect(page.locator('#sheet-note')).toHaveClass(/open/)
  await expect(page.locator('#note-quote')).toHaveText(text.trim())
  await page.fill('#note-text', 'A famous opening line.')
  await page.click('#note-save')
  await expect(page.locator('#sheet-note')).not.toHaveClass(/open/)

  await page.keyboard.press('t')
  await page.click('#nav-tabs [data-pane="marks"]')
  const mark = page.locator('#marks-list .mark')
  await expect(mark).toHaveCount(1)
  await expect(mark).toContainText('A famous opening line.')
  const download = page.waitForEvent('download')
  await page.click('#export-notes')
  expect((await download).suggestedFilename()).toContain('Pride and Prejudice')

  await page.reload()
  await expect(page.locator('#status-right')).toContainText('%', { timeout: 20_000 })
  await page.keyboard.press('t')
  await page.click('#nav-tabs [data-pane="marks"]')
  await expect(page.locator('#marks-list .mark')).toHaveCount(1)
  // the highlight is drawn in the overlay
  await page.keyboard.press('Escape')
  const drawn = await page.evaluate(() => {
    const { overlayer } = document.querySelector('foliate-view').renderer.getContents()[0]
    return overlayer.element.childElementCount
  })
  expect(drawn).toBeGreaterThan(0)
})

test('define a single selected word (cached for offline)', async ({ page }) => {
  let calls = 0
  await page.route('https://en.wiktionary.org/api/rest_v1/page/definition/**', r => {
    calls++
    return r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'A <a href="/wiki/x">test</a> meaning.' }] }] }) })
  })
  await openLibrary(page)
  await openStarterBook(page, 'pg-1342')
  const select = () => page.evaluate(() => {
    const { doc } = document.querySelector('foliate-view').renderer.getContents()[0]
    const p = [...doc.querySelectorAll('p')].find(x => /\btruth\b/.test(x.textContent))
    const node = p.firstChild
    const i = node.data.indexOf('truth')
    const range = doc.createRange()
    range.setStart(node, i); range.setEnd(node, i + 5)
    doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
    doc.dispatchEvent(new Event('selectionchange'))
  })
  await select()
  await page.click('#hl-pop [data-act="define"]')
  await expect(page.locator('#define-body')).toContainText('A test meaning.')
  await page.keyboard.press('Escape')
  await select()
  await page.click('#hl-pop [data-act="define"]')
  await expect(page.locator('#define-body')).toContainText('A test meaning.')
  expect(calls).toBe(1)
})
