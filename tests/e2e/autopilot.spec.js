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
  await page.mouse.up()
  await expect.poll(() => readerText(page), { timeout: 5000 }).not.toBe(before)
  expect(await wpm(page)).toBeLessThan(start)
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
