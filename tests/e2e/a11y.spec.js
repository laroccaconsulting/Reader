import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { openLibrary, openStarterBook } from './helpers.js'

const audit = async (page, include) => {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
  if (include) builder.include(include)
  const { violations } = await builder.analyze()
  return violations.filter(v => ['serious', 'critical'].includes(v.impact))
    .map(v => `${v.id}: ${v.help} -> ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`)
}

for (const theme of ['light', 'dark', 'sepia']) {
  test(`library, discover and settings have no serious a11y violations (${theme})`, async ({ page }) => {
    await page.addInitScript(t => localStorage.setItem('reader:settings:v2', JSON.stringify({ theme: t })), theme)
    await page.route('https://standardebooks.org/**', r => r.fulfill({ status: 503 }))
    await openLibrary(page)
    expect(await audit(page)).toEqual([])
    await page.goto('./#/discover')
    await page.waitForTimeout(400)
    expect(await audit(page)).toEqual([])
    await page.goto('./#/settings')
    await page.waitForSelector('#relay-url')
    expect(await audit(page)).toEqual([])
  })
}

test('reader chrome and sheets have no serious a11y violations', async ({ page }) => {
  await openLibrary(page)
  await openStarterBook(page, 'pg-11')
  expect(await audit(page, '#reader')).toEqual([])
  await page.click('#type-btn')
  await page.waitForTimeout(400)
  expect(await audit(page, '#sheet-type')).toEqual([])
  await page.keyboard.press('Escape')
  await page.click('#toc-btn')
  await page.waitForTimeout(400)
  expect(await audit(page, '#sheet-nav')).toEqual([])
})
