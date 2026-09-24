import { expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

export const fixture = name => readFileSync(new URL(`../fixtures/${name}`, import.meta.url))

/** Collect console errors and any request that leaves our origin. */
export function watch(page) {
  const errors = []
  const external = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => {
    const url = new URL(r.url())
    if (!['localhost', '127.0.0.1'].includes(url.hostname) && !['blob:', 'data:'].includes(url.protocol)) external.push(r.url())
  })
  return { errors, external }
}

export async function openLibrary(page) {
  await page.goto('./')
  await expect(page.locator('#book-grid .book-card').first()).toBeVisible()
}

export async function openStarterBook(page, id = 'pg-1342') {
  await page.locator(`.book-open[data-id="${id}"]`).first().click()
  await expect(page.locator('#reader')).toBeVisible()
  await expect(page.locator('#status-right')).toContainText('%', { timeout: 20_000 })
}

/** Text currently visible in the reader. */
export const readerText = page => page.evaluate(() => {
  const view = document.querySelector('foliate-view')
  return view?.lastLocation?.range?.toString().slice(0, 200) ?? ''
})
