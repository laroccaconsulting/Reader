import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { trackRange, romanToInt, mapTracks } from '../../app/audio/chapters.js'
import { parseText } from '../../app/txt/gutenberg.js'

test('track titles and LibriVox file names give chapter ranges', () => {
  assert.deepEqual(trackRange('Chapters 1-3'), [1, 3])
  assert.deepEqual(trackRange('Chapter 06'), [6, 6])
  assert.deepEqual(trackRange('Chapter XIV'), [14, 14])
  assert.deepEqual(trackRange('Chapters Four and Five'), [4, 5])
  assert.deepEqual(trackRange('', 'prideandprejudice_10-11_austen_64kb.mp3'), [10, 11])
  assert.equal(trackRange('Preface', 'x_00_austen_64kb.mp3'), null)
  assert.equal(romanToInt('XLIV'), 44)
})

test('Pride and Prejudice LibriVox sections map onto the parsed chapters', () => {
  const book = parseText(readFileSync('books/1342.txt', 'utf8'))
  const tracks = [
    { title: 'Chapters 1-3', name: 'prideandprejudice_01-03_austen_64kb.mp3' },
    { title: 'Chapters 4-5', name: 'prideandprejudice_04-05_austen_64kb.mp3' },
    { title: 'Chapter 6', name: 'prideandprejudice_06_austen_64kb.mp3' },
    { title: 'Chapters 60-61', name: 'prideandprejudice_60-61_austen_64kb.mp3' },
  ]
  const mapped = mapTracks(tracks, book.toc)
  assert.deepEqual(mapped.map(t => t.label), ['Chapter I.', 'Chapter IV.', 'Chapter VI.', 'Chapter LX.'])
  assert.ok(mapped.every(t => /^s\d+$/.test(t.href)))
})

test('volume books with restarting chapter numbers map by ordinal', () => {
  const toc = [
    { label: 'Volume I', href: 'v1', subitems: [{ label: 'Chapter I', href: 'a' }, { label: 'Chapter II', href: 'b' }] },
    { label: 'Volume II', href: 'v2', subitems: [{ label: 'Chapter I', href: 'c' }, { label: 'Chapter II', href: 'd' }] },
  ]
  const mapped = mapTracks([{ title: 'Chapter 03' }, { title: 'Chapter 04' }], toc)
  assert.deepEqual(mapped.map(t => t.href), ['c', 'd'])
})

test('non-chapter tracks match by label or follow the previous track', () => {
  const toc = [{ label: 'Preface', href: 'p' }, { label: 'Chapter 1', href: 'c1' }, { label: 'Chapter 2', href: 'c2' }]
  const mapped = mapTracks([{ title: 'Preface' }, { title: 'Chapter 1' }, { title: 'Chapter 1 (continued)' }, { title: 'Chapter 2' }], toc)
  assert.deepEqual(mapped.map(t => t.href), ['p', 'c1', 'c1', 'c2'])
})

import { syncPoints, timeToFraction, fractionToTime, leadFromAnchor } from '../../app/audio/sync.js'

test('sync: the introduction and sign-off are skipped, text in between moves evenly', () => {
  const pts = syncPoints({ from: 0.1, to: 0.2, duration: 600, lead: 20, tail: 10 })
  assert.equal(timeToFraction(pts, 5), 0.1)
  assert.ok(Math.abs(timeToFraction(pts, 305) - 0.15) < 1e-9)
  assert.equal(timeToFraction(pts, 595), 0.2)
  assert.ok(Math.abs(fractionToTime(pts, 0.15) - 305) < 1e-9)
})

test('sync: marks the reader taps bend the mapping through them', () => {
  const pts = syncPoints({ from: 0.1, to: 0.2, duration: 600, lead: 20, tail: 10, anchors: [{ t: 400, f: 0.13 }] })
  assert.ok(Math.abs(timeToFraction(pts, 400) - 0.13) < 1e-9)
  assert.ok(timeToFraction(pts, 200) < 0.13)
  assert.ok(Math.abs(fractionToTime(pts, 0.13) - 400) < 1e-9)
  // a mark during what we assumed was the introduction replaces it
  const early = syncPoints({ from: 0.1, to: 0.2, duration: 600, lead: 20, tail: 10, anchors: [{ t: 8, f: 0.1005 }] })
  assert.ok(Math.abs(timeToFraction(early, 8) - 0.1005) < 1e-9)
  // contradictory marks (later in time but earlier in text) are ignored
  const bad = syncPoints({ from: 0.1, to: 0.2, duration: 600, anchors: [{ t: 300, f: 0.16 }, { t: 350, f: 0.12 }] })
  assert.equal(bad.filter(p => p.f === 0.12).length, 0)
})

test('sync: a mark near the chapter start measures the introduction', () => {
  const span = { from: 0.1, to: 0.2, duration: 610, tail: 10 }
  const lead = leadFromAnchor(span, { t: 35 + 0.05 * (600 - 35), f: 0.105 })
  assert.ok(Math.abs(lead - 35) < 1, String(lead))
  assert.equal(leadFromAnchor(span, { t: 300, f: 0.15 }), null)
})

import { rankVoices, voiceLabel } from '../../app/reader/voices.js'

test('voices: best quality first, joke voices hidden, other languages left out', () => {
  const voices = [
    { name: 'Bubbles', lang: 'en-US', localService: true },
    { name: 'Samantha', lang: 'en-US', localService: true, default: true },
    { name: 'Ava (Premium)', lang: 'en-US', localService: true },
    { name: 'Daniel (Enhanced)', lang: 'en-GB', localService: true },
    { name: 'Grandma', lang: 'en-US', localService: true },
    { name: 'Amélie', lang: 'fr-CA', localService: true },
  ]
  assert.deepEqual(rankVoices(voices, 'en').map(v => v.name), ['Ava (Premium)', 'Daniel (Enhanced)', 'Samantha', 'Grandma'])
  assert.deepEqual(rankVoices(voices, 'fr').map(v => v.name), ['Amélie'])
  const label = voiceLabel({ name: 'Ava (Premium)', lang: 'en-US' })
  assert.equal(label.name, 'Ava')
  assert.equal(label.quality, 'premium')
  assert.match(label.region, /English/)
})
