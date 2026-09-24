import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
const svg = readFileSync('icons/icon.svg', 'utf8')
const browser = await chromium.launch({ executablePath: process.env.CHROME })
const page = await browser.newPage()
const render = async (size, file, { maskable = false, flat = false } = {}) => {
  await page.setViewportSize({ width: size, height: size })
  // maskable: full-bleed background, artwork inside the 80% safe zone
  let s = svg
  if (flat) s = s.replace(/<rect width="512" height="512" rx="112"/, "<rect width=\"512\" height=\"512\" rx=\"0\"")
  if (maskable) s = s.replace(/<rect width="512" height="512" rx="112"[^>]*\/>/, "")
  const inner = maskable ? `<div style="width:100%;height:100%;background:linear-gradient(135deg,#8B7EC8,#5B4FA8);display:flex;align-items:center;justify-content:center"><div style="width:78%;height:78%">${s}</div></div>` : s
  await page.setContent(`<html><body style="margin:0;background:transparent">${inner}</body></html><style>svg{width:100%;height:100%;display:block}</style>`)
  await page.screenshot({ path: file, omitBackground: !maskable && !flat })
}
await render(192, 'icons/icon-192.png')
await render(512, 'icons/icon-512.png')
await render(512, 'icons/maskable-512.png', { maskable: true })
await render(180, 'icons/apple-touch-icon.png', { flat: true })
await browser.close()
