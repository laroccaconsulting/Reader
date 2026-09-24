import { test, expect } from '@playwright/test'
import { openLibrary, openStarterBook } from './helpers.js'

// Pretend to be a device with a few voices, and record what gets spoken.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const voices = [
      { name: 'Samantha', lang: 'en-US', localService: true, default: true },
      { name: 'Ava (Premium)', lang: 'en-US', localService: true, default: false },
      { name: 'Bubbles', lang: 'en-US', localService: true, default: false },
      { name: 'Thomas', lang: 'fr-FR', localService: true, default: false },
    ]
    window.__spoken = []
    Object.defineProperty(window, 'speechSynthesis', { value: {
      getVoices: () => voices,
      speak: u => { window.__spoken.push({ text: u.text, voice: u.voice?.name }); setTimeout(() => u.onend?.(), 600) },
      cancel: () => {}, pause: () => {}, resume: () => {},
      addEventListener: () => {}, speaking: false,
    } })
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
  })
})

test('read aloud: pick a voice, hear a sample, and it is remembered', async ({ page }) => {
  await openLibrary(page)
  await openStarterBook(page, 'pg-1342')
  await page.keyboard.press('p') // start reading aloud
  await expect(page.locator('#tts-bar')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.__spoken[0]?.voice)).toBe('Ava (Premium)') // best voice by default
  await page.click('#tts-play') // pause
  await page.click('#tts-voice')
  await expect(page.locator('#sheet-voice')).toBeVisible()
  const names = await page.locator('#voice-body .voice-name').allTextContents()
  expect(names).toEqual(['Ava', 'Samantha']) // joke and other-language voices hidden
  await expect(page.locator('#voice-body .voice-badge')).toHaveText('Premium')
  await expect(page.locator('#voice-body')).toContainText('Spoken Content') // how to get better voices (iPhone UA on mobile, generic on desktop)
    .catch(async () => expect(page.locator('#voice-body')).toContainText('Voices come from your device'))
  await page.click('[data-voice="Samantha"]')
  await expect(page.locator('[data-voice="Samantha"]')).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => page.evaluate(() => window.__spoken.at(-1)?.voice)).toBe('Samantha') // sample
  expect(await page.evaluate(async () => (await import('./app/settings.js')).settings.voice)).toBe('Samantha')
})
