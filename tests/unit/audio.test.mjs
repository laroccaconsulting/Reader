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
