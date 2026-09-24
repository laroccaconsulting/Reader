import { test, expect } from '@playwright/test'
import { openLibrary, openStarterBook, readerText } from './helpers.js'

const fraction = page => page.evaluate(() => readerApp.reader.location?.fraction ?? 0)
const wpm = page => page.evaluate(() => readerApp.autopilot.wpm)
const centre = async page => {
  const b = await page.locator('#reader-stage').boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, right: b.x + b.width * 0.9 }
}

async function startAutopilot(page, book = 'pg-1342') {
  await openLibrary(page)
  await openStarterBook(page, book)
  await page.click('#toc-btn')
  await page.locator('#toc-list .toc-link', { hasText: 'Chapter III.' }).first().click()
  await page.waitForTimeout(700)
  await page.evaluate(async () => (await import('./app/settings.js')).update({ autoWpm: 230 }))
  await page.keyboard.press('a')
  await expect(page.locator('#auto-ui')).toBeVisible()
}

test('pages: the bar fills and the page turns by itself', async ({ page }) => {
  await startAutopilot(page)
  const before = await readerText(page)
  await page.evaluate(() => { readerApp.autopilot.duration = 900; readerApp.autopilot.elapsed = 0 })
  await expect.poll(() => page.evaluate(() => document.querySelector('#auto-fill').style.transform)).not.toBe('scaleX(0)')
  await expect.poll(() => readerText(page), { timeout: 5000 }).not.toBe(before)
})

test('pages: holding keeps the page, letting go turns it and slows the pace', async ({ page }) => {
  await startAutopilot(page)
  const start = await wpm(page)
  const before = await readerText(page)
  // realistic timing: the bar is about to run out, and the reader holds for 2 more seconds
  const c = await centre(page)
  await page.mouse.move(c.x, c.y)
  await page.evaluate(() => { const a = readerApp.autopilot; a.duration = a.words / a.wpm * 60000; a.elapsed = a.duration - 700 })
  await page.mouse.down()
  await page.waitForTimeout(2000)
  await expect(page.locator('#auto-ui')).toHaveClass(/held/)
  await expect(page.locator('#auto-status')).toContainText('let go to turn')
  expect(await readerText(page)).toBe(before) // the page waited
  const state = await page.evaluate(() => { const a = readerApp.autopilot; return { words: a.words, elapsed: a.elapsed, duration: a.duration, wpm: a.wpm } })
  await page.mouse.up()
  await expect.poll(() => readerText(page), { timeout: 5000 }).not.toBe(before)
  expect(await wpm(page), JSON.stringify(state)).toBeLessThan(start)
  await expect(page.locator('#auto-ui')).not.toHaveClass(/held/)
})

test('pages: tapping ahead of the bar turns early and speeds up', async ({ page }) => {
  await startAutopilot(page)
  const start = await wpm(page)
  const before = await readerText(page)
  // realistic timing: halfway through the page's planned time
  await page.evaluate(() => { const a = readerApp.autopilot; a.duration = a.words / a.wpm * 60000; a.elapsed = a.duration * 0.5 })
  const c = await centre(page)
  await page.mouse.click(c.right, c.y)
  await expect.poll(() => readerText(page), { timeout: 5000 }).not.toBe(before)
  expect(await wpm(page)).toBeGreaterThan(start)
})

test('micro-adjust, pause with a centre tap, Escape stops only autopilot', async ({ page }) => {
  await startAutopilot(page)
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('#auto-wpm')).toHaveText('235 wpm')
  await page.click('#auto-slower')
  await page.click('#auto-slower')
  await expect(page.locator('#auto-wpm')).toHaveText('225 wpm')
  const c = await centre(page)
  await page.mouse.click(c.x, c.y)
  await expect(page.locator('#auto-ui')).toHaveClass(/paused/)
  const f = await fraction(page)
  await page.evaluate(() => { readerApp.autopilot.duration = 300 })
  await page.waitForTimeout(800)
  expect(await fraction(page)).toBe(f) // paused: no page turn
  await page.keyboard.press('Escape')
  await expect(page.locator('#auto-ui')).toBeHidden()
  await expect(page.locator('#reader')).toBeVisible()
})

test('scroll layout: text glides, and holding pauses it', async ({ page }) => {
  await openLibrary(page)
  await page.evaluate(async () => (await import('./app/settings.js')).update({ flow: 'scrolled', autoWpm: 900 }))
  await openStarterBook(page, 'pg-1342')
  await page.keyboard.press('a')
  const pos = () => page.evaluate(() => readerApp.reader.view.renderer.start)
  const p0 = await pos()
  await expect.poll(pos, { timeout: 5000 }).toBeGreaterThan(p0 + 5)
  const c = await centre(page)
  await page.mouse.move(c.x, c.y)
  await page.mouse.down()
  await page.waitForTimeout(600)
  const held = await pos()
  await page.waitForTimeout(700)
  expect(await pos()).toBe(held)
  await page.mouse.up()
  await expect.poll(pos, { timeout: 5000 }).toBeGreaterThan(held)
})

/** Rects (page coordinates) of every visible line of text in the reader. */
const textLines = page => page.evaluate(() => {
  const { renderer } = document.querySelector('foliate-view')
  const { doc } = renderer.getContents()[0]
  const frame = doc.defaultView.frameElement.getBoundingClientRect()
  const stage = document.querySelector('#reader-stage').getBoundingClientRect()
  const range = doc.createRange()
  range.selectNodeContents(doc.body)
  return [...range.getClientRects()]
    .map(r => ({ top: frame.top + r.top, bottom: frame.top + r.bottom, left: frame.left + r.left, right: frame.left + r.right }))
    // clip to the reading area: text outside it is hidden by the renderer
    .map(r => ({ top: Math.max(r.top, stage.top), bottom: Math.min(r.bottom, stage.bottom), left: Math.max(r.left, stage.left), right: Math.min(r.right, stage.right) }))
    .filter(r => r.bottom - r.top > 4 && r.right > r.left)
})

const overlaps = (a, lines) => lines.some(l => a.x < l.right && a.x + a.width > l.left && a.y < l.bottom && a.y + a.height > l.top)

for (const flow of ['paginated', 'scrolled']) {
  test(`controls never cover the text (${flow})`, async ({ page }) => {
    await openLibrary(page)
    await page.evaluate(async f => (await import('./app/settings.js')).update({ flow: f, autoWpm: 120 }), flow)
    await openStarterBook(page, 'pg-1342')
    await page.waitForTimeout(800)
    await page.keyboard.press('a')
    await page.keyboard.press('ArrowUp') // shows the pill
    await page.waitForTimeout(600)
    const pill = await page.locator('#auto-pill').boundingBox()
    expect(overlaps(pill, await textLines(page))).toBe(false)

    const c = await centre(page)
    await page.mouse.move(c.x, c.y)
    await page.mouse.down()
    await page.waitForTimeout(700)
    await expect(page.locator('#auto-status')).toBeVisible()
    const chip = await page.locator('#auto-status').boundingBox()
    const lines = await textLines(page)
    expect(lines.length).toBeGreaterThan(5)
    expect(overlaps(chip, lines)).toBe(false)
    const pillNow = await page.locator('#auto-pill').boundingBox()
    if (await page.locator('#auto-pill').evaluate(el => el.classList.contains('visible'))) expect(overlaps(pillNow, lines)).toBe(false)
    await page.mouse.up()
  })
}

test('scroll layout: pauses at the end of a chapter until the reader taps', async ({ page }) => {
  await openLibrary(page)
  await page.evaluate(async () => (await import('./app/settings.js')).update({ flow: 'scrolled', autoWpm: 300 }))
  await openStarterBook(page, 'pg-1342')
  await page.waitForTimeout(800)
  await page.keyboard.press('a')
  const section = () => page.evaluate(() => readerApp.reader.location?.section?.current)
  const start = await section()
  // jump to just before the end of this chapter
  await page.evaluate(() => { const r = readerApp.reader.view.renderer; r.scrollByPixels(r.viewSize - r.end - 30) })
  await expect(page.locator('#auto-status')).toHaveText('End of chapter · tap to continue', { timeout: 8000 })
  await page.waitForTimeout(1500)
  expect(await section()).toBe(start) // it waits for the reader
  const c = await centre(page)
  await page.mouse.click(c.x, c.y)
  await expect.poll(section, { timeout: 8000 }).toBe(start + 1)
  await expect(page.locator('#auto-ui')).not.toHaveClass(/paused/)
})
