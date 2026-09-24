// Live check of the production site: secure connection, no mixed content.
import { test, expect } from '@playwright/test'

test('readfree.app loads securely, with no insecure content anywhere in the main screens', async ({ page }) => {
  const messages = []
  page.on('console', m => messages.push(`${m.type()}: ${m.text()}`))
  const insecure = []
  page.on('request', r => { if (r.url().startsWith('http:')) insecure.push(r.url()) })

  const res = await page.goto('https://readfree.app/')
  console.log('status', res.status(), 'tls', JSON.stringify(await res.securityDetails()))
  await expect(page).toHaveTitle('Read Free')
  await expect(page.locator('#book-grid .book-card').first()).toBeVisible()
  await page.locator('.book-open[data-id="pg-1342"]').first().click()
  await expect(page.locator('#status-right')).toContainText('%', { timeout: 30_000 })
  await page.waitForTimeout(4000) // let the audiobook lookup and covers load
  await page.goto('https://readfree.app/#/discover')
  await page.waitForTimeout(6000)

  console.log('insecure requests', JSON.stringify(insecure))
  console.log('console', JSON.stringify(messages.filter(m => /mixed|insecure|http:/i.test(m))))
  expect(insecure).toEqual([])
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true)
})
