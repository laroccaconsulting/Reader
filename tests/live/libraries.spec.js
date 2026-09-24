// Live checks against the real libraries (network required). Run: npm run test:live
import { test, expect } from '@playwright/test'

test('Standard Ebooks: listing parses and an EPUB downloads with CORS', async ({ page }) => {
  await page.goto('./')
  const result = await page.evaluate(async () => {
    const SE = await import('./app/catalog/standard-ebooks.js')
    const { items } = await SE.list({ query: 'frankenstein' })
    const first = items[0]
    const res = await fetch(first.source.url)
    const bytes = new Uint8Array(await res.arrayBuffer())
    const details = await SE.details(first)
    return { count: items.length, title: first.title, author: first.author, cover: first.coverUrl, zip: bytes[0] === 0x50 && bytes[1] === 0x4b, size: bytes.length, desc: details.description?.slice(0, 60) }
  })
  console.log(JSON.stringify(result))
  expect(result.count).toBeGreaterThan(0)
  expect(result.title).toMatch(/Frankenstein/)
  expect(result.author).toMatch(/Shelley/)
  expect(result.zip).toBe(true)
  expect(result.desc).toBeTruthy()
})

test('Project Gutenberg: OPDS search and details parse', async ({ page }) => {
  await page.goto('./')
  const result = await page.evaluate(async () => {
    const PG = await import('./app/catalog/gutenberg.js')
    const { items, hasNext } = await PG.list({ query: 'dickens' })
    const top = await PG.list({})
    const d = await PG.details(items[0])
    return { count: items.length, hasNext, first: items[0], top: top.items.length, summary: d.description?.slice(0, 60) }
  })
  console.log(JSON.stringify(result))
  expect(result.count).toBeGreaterThan(5)
  expect(result.first.source.gutenberg).toBeGreaterThan(0)
  expect(result.top).toBeGreaterThan(10)
  expect(result.summary).toBeTruthy()
})

test('Wiktionary definitions resolve', async ({ page }) => {
  await page.goto('./')
  const entries = await page.evaluate(async () => (await import('./app/reader/define.js')).define('serendipity'))
  expect(entries.length).toBeGreaterThan(0)
})

test('LibriVox via the Internet Archive: a recording is found and its chapters map onto the book', async ({ page }) => {
  await page.goto('./')
  const result = await page.evaluate(async () => {
    const { findRecording } = await import('./app/audio/librivox.js')
    const { mapTracks } = await import('./app/audio/chapters.js')
    const rec = await findRecording({ id: 'live-pp', title: 'Pride and Prejudice', author: 'Jane Austen' }, { force: true })
    const toc = Array.from({ length: 61 }, (_, i) => ({ label: `Chapter ${i + 1}`, href: `c${i + 1}` }))
    const mapped = mapTracks(rec.tracks, toc)
    const head = await fetch(rec.tracks[1].url, { headers: { Range: 'bytes=0-1023' } })
    return { id: rec.id, tracks: rec.tracks.length, first: rec.tracks[0], mapped: mapped.slice(0, 4).map(t => [t.title, t.href]), unmapped: mapped.filter(t => !t.href).length, status: head.status, bytes: (await head.arrayBuffer()).byteLength }
  })
  console.log(JSON.stringify(result))
  expect(result.tracks).toBeGreaterThan(10)
  expect(result.first.url).toMatch(/^https:\/\/archive\.org\/download\/.+_64kb\.mp3$/)
  expect(result.first.duration).toBeGreaterThan(60)
  expect(result.unmapped).toBe(0)
  expect([200, 206]).toContain(result.status)
  expect(result.bytes).toBeGreaterThan(0)
})
