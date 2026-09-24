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

/** Open Contents → Notes with the `t` shortcut (retried: key presses can race sheet animations under load). */
async function openNotes(page) {
  await expect(async () => {
    if (!(await page.locator('#sheet-nav').evaluate(el => el.classList.contains('open')))) await page.keyboard.press('t')
    await expect(page.locator('#sheet-nav')).toHaveClass(/open/, { timeout: 1000 })
  }).toPass({ timeout: 10_000 })
  await page.click('#nav-tabs [data-pane="marks"]')
}

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

  await openNotes(page)
  const mark = page.locator('#marks-list .mark')
  await expect(mark).toHaveCount(1)
  await expect(mark).toContainText('A famous opening line.')
  const download = page.waitForEvent('download')
  await page.click('#export-notes')
  expect((await download).suggestedFilename()).toContain('Pride and Prejudice')

  await page.reload()
  await expect(page.locator('#status-right')).toContainText('%', { timeout: 20_000 })
  await openNotes(page)
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

/** Select a text node's first 30 chars at the top or bottom of the page; returns its rect. */
const selectAt = (page, where) => page.evaluate(where => {
  const { doc } = document.querySelector('foliate-view').renderer.getContents()[0]
  const frame = doc.defaultView.frameElement.getBoundingClientRect()
  const stage = document.querySelector('#reader-stage').getBoundingClientRect()
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const candidates = []
  let n
  while ((n = walker.nextNode())) {
    if (n.data.trim().length < 40) continue
    const r = doc.createRange(); r.setStart(n, 0); r.setEnd(n, 30)
    const rect = r.getBoundingClientRect()
    const top = frame.top + rect.top
    if (frame.left + rect.left < stage.left || frame.left + rect.left > stage.right || top < stage.top || top > stage.bottom - 20) continue
    candidates.push({ r, top, left: frame.left + rect.left, width: rect.width, height: rect.height })
  }
  const pick = where === 'bottom' ? candidates[candidates.length - 1] : candidates[Math.floor(candidates.length / 3)]
  doc.getSelection().removeAllRanges(); doc.getSelection().addRange(pick.r)
  doc.dispatchEvent(new Event('selectionchange'))
  return { x: pick.left, y: pick.top, width: pick.width, height: pick.height }
}, where)

const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

test('on touch screens the highlight toolbar docks away from the selection (and the iOS menu)', async ({ page }, info) => {
  await openLibrary(page)
  await openStarterBook(page, 'pg-1342')
  await page.waitForTimeout(800)
  const touch = info.project.name === 'mobile'

  const mid = await selectAt(page, 'middle')
  await expect(page.locator('#hl-pop')).toBeVisible()
  const pop = await page.locator('#hl-pop').boundingBox()
  expect(intersects(pop, mid)).toBe(false)
  if (touch) {
    await expect(page.locator('#hl-pop')).toHaveClass(/docked/)
    await expect(page.locator('#hl-pop')).not.toHaveClass(/dock-top/)
  } else {
    await expect(page.locator('#hl-pop')).not.toHaveClass(/docked/)
  }

  if (!touch) return
  await page.keyboard.press('Escape')
  const low = await selectAt(page, 'bottom')
  await expect(page.locator('#hl-pop')).toHaveClass(/dock-top/)
  expect(intersects(await page.locator('#hl-pop').boundingBox(), low)).toBe(false)
})
