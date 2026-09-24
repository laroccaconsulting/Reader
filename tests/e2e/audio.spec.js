import { test, expect } from '@playwright/test'
import { openLibrary, openStarterBook } from './helpers.js'

const cors = { 'Access-Control-Allow-Origin': '*' }

/** A few seconds of silence as a WAV file (stands in for the LibriVox MP3s). */
function silence(seconds = 8, rate = 8000) {
  const data = rate * seconds
  const b = Buffer.alloc(44 + data)
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8)
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34)
  b.write('data', 36); b.writeUInt32LE(data, 40); b.fill(128, 44)
  return b
}

const files = [
  { name: 'prideandprejudice_01-03_austen_64kb.mp3', title: 'Chapters 01-03', track: '1', length: '8', size: '64044' },
  { name: 'prideandprejudice_04-06_austen_64kb.mp3', title: 'Chapters 04-06', track: '2', length: '8', size: '64044' },
  { name: 'prideandprejudice_07-09_austen_64kb.mp3', title: 'Chapters 07-09', track: '3', length: '8', size: '64044' },
  { name: 'prideandprejudice_01-03_austen.mp3', title: 'Chapters 01-03', track: '1', length: '8', size: '999999' },
]

async function mockArchive(page, { found = true } = {}) {
  const requests = []
  await page.route('https://archive.org/advancedsearch.php?**', r => {
    requests.push(r.request().url())
    r.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ response: { docs: found ? [
      { identifier: 'pride_and_prejudice_dramatic', title: 'Pride and Prejudice (Dramatic Reading)', creator: 'Jane Austen', downloads: 90000 },
      { identifier: 'pride_prejudice_test', title: 'Pride and Prejudice', creator: 'Jane Austen', downloads: 50000 },
    ] : [] } }) })
  })
  await page.route('https://archive.org/metadata/**', r => r.fulfill({ headers: cors, contentType: 'application/json',
    body: JSON.stringify({ metadata: { identifier: 'pride_prejudice_test', creator: 'LibriVox Volunteers' }, files }) }))
  // Like archive.org, answer Range requests (needed for seeking)
  await page.route('https://archive.org/download/**', r => {
    const body = silence()
    const m = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range ?? '')
    if (!m) return r.fulfill({ headers: { ...cors, 'Accept-Ranges': 'bytes' }, contentType: 'audio/wav', body })
    const start = Number(m[1]), end = m[2] ? Number(m[2]) : body.length - 1
    r.fulfill({ status: 206, contentType: 'audio/wav', body: body.subarray(start, end + 1),
      headers: { ...cors, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${body.length}` } })
  })
  return requests
}

const fraction = page => page.evaluate(() => readerApp.reader.location?.fraction ?? 0)

test('read-along: finds the LibriVox recording, plays the chapter you are on and follows the narrator', async ({ page }) => {
  const requests = await mockArchive(page)
  await openLibrary(page)
  await openStarterBook(page, 'pg-1342')
  await expect(page.locator('#audio-btn')).toBeVisible()
  expect(new URL(requests[0]).searchParams.get('q')).toBe('collection:(librivoxaudio) AND title:(pride and prejudice)')

  await page.click('#audio-btn')
  await expect(page.locator('#audio-bar')).toBeVisible()
  await expect(page.locator('#audio-track')).toContainText('Chapters 01-03')
  await expect.poll(() => page.evaluate(() => readerApp.readAlong.audio.src)).toContain('_01-03_austen_64kb.mp3')

  // Next chapter group opens the matching chapter in the book
  await page.click('#audio-next')
  await expect(page.locator('#audio-track')).toContainText('Chapters 04-06')
  await expect(page.locator('#reader-chapter')).toHaveText(/Chapter IV/)
  const start = await fraction(page)

  // Late in the track, the page follows the narration forward
  await expect.poll(() => page.evaluate(() => { const a = readerApp.readAlong.audio; return a.src.includes('_04-06_') && a.readyState >= 1 })).toBe(true)
  await page.evaluate(() => {
    const { audio } = readerApp.readAlong
    audio.pause()
    audio.currentTime = audio.duration * 0.9
  })
  await expect.poll(() => fraction(page), { timeout: 8000 }).toBeGreaterThan(start + 0.005)
  await expect(page.locator('#reader-chapter')).toHaveText(/Chapter V/)

  // Reading elsewhere pauses following and offers a way back
  await page.evaluate(() => readerApp.reader.goToFraction(0.8))
  await page.evaluate(() => { const a = readerApp.readAlong.audio; a.currentTime = a.duration * 0.5 })
  await expect(page.locator('#audio-sync')).toBeVisible()
  await page.click('#audio-sync')
  await expect.poll(() => fraction(page)).toBeLessThan(0.5)

  // Closing stops the audiobook
  await page.click('#audio-close')
  await expect(page.locator('#audio-bar')).toBeHidden()
})

test('read-along: narration can be saved for offline listening', async ({ page }) => {
  await mockArchive(page)
  await openLibrary(page)
  await openStarterBook(page, 'pg-1342')
  await page.click('#audio-btn')
  await expect(page.locator('#audio-bar')).toBeVisible()
  page.on('dialog', d => d.accept())
  await page.click('#audio-save')
  await expect(page.locator('#toast')).toContainText('Narration saved for offline listening')
  const saved = await page.evaluate(async () => (await import('./app/db.js')).kvGet('audiofiles|pg-1342', []))
  expect(saved).toHaveLength(3)

  // Saved chapters play from the device
  await page.click('#audio-next')
  await expect.poll(() => page.evaluate(() => readerApp.readAlong.audio.src)).toMatch(/^blob:/)
})

test('read-along: no button when there is no recording, and the miss is remembered', async ({ page }) => {
  const requests = await mockArchive(page, { found: false })
  await openLibrary(page)
  await openStarterBook(page, 'pg-1342')
  await expect.poll(() => requests.length).toBe(1)
  await page.waitForTimeout(300)
  await expect(page.locator('#audio-btn')).toBeHidden()
  await page.click('#reader-back')
  await openStarterBook(page, 'pg-1342')
  await page.waitForTimeout(500)
  expect(requests).toHaveLength(1)
})
