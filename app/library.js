/* The user's library: book records, files, downloads and imports. */

import * as db from './db.js'
import { fetchBytes } from './net.js'
import { decodeText, makeTextBook } from './txt/txt-book.js'
import { readHeader } from './txt/gutenberg.js'

const events = new EventTarget()
export const onLibraryChange = fn => events.addEventListener('change', fn)
const changed = detail => events.dispatchEvent(new CustomEvent('change', { detail }))

/** In-flight downloads: id -> Promise */
const downloads = new Map()
export const isDownloading = id => downloads.has(id)

export async function listBooks() {
  const [books, progress] = await Promise.all([db.getAll('books'), db.getAll('progress')])
  const byId = new Map(progress.map(p => [p.id, p]))
  return books.map(b => ({ ...b, progress: byId.get(b.id) ?? null }))
}

export const getBook = id => db.get('books', id)
export const getProgress = id => db.get('progress', id)
export const saveProgress = rec => db.put('progress', { ...rec, updatedAt: Date.now() })

/* ------------------------------------------------------------------ */
/* Starter shelf                                                       */
/* ------------------------------------------------------------------ */

let starterCache = null
export async function starterCatalog() {
  if (!starterCache) {
    const res = await fetch('data/starter.json')
    starterCache = (await res.json()).books
  }
  return starterCache
}

/** On first run, add the starter shelf as not-yet-downloaded records. */
export async function seedStarterShelf() {
  if (await db.kvGet('starter-seeded')) return false
  const starter = await starterCatalog()
  const now = Date.now()
  await Promise.all(starter.map((s, i) => db.put('books', {
    id: `pg-${s.gutenberg}`,
    title: s.title,
    author: s.author,
    year: s.year,
    genre: s.genre,
    description: s.description,
    language: 'en',
    format: 'txt',
    downloaded: false,
    source: { type: 'starter', url: `books/${s.gutenberg}.txt`, gutenberg: s.gutenberg },
    addedAt: now - i, // keep catalogue order for "recently added"
  })))
  await db.kvSet('starter-seeded', true)
  changed({ seeded: true })
  return true
}

/** Carry over books cached by the previous app version (plain text only). */
export async function importLegacy(entries) {
  for (const { id, text, fraction } of entries) {
    const bookId = `pg-${id}`
    const rec = await db.get('books', bookId)
    if (!rec || rec.downloaded) continue
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    await db.put('files', { id: bookId, blob, name: `${id}.txt` })
    await db.put('books', { ...rec, downloaded: true, size: blob.size })
    if (fraction > 0) await saveProgress({ id: bookId, fraction, cfi: null })
  }
  if (entries.length) changed({})
}

/* ------------------------------------------------------------------ */
/* Downloading                                                         */
/* ------------------------------------------------------------------ */

/** Ensure a record's file is stored locally. Resolves when done. */
export function ensureDownloaded(id, { onProgress } = {}) {
  if (downloads.has(id)) return downloads.get(id)
  const job = (async () => {
    const rec = await db.get('books', id)
    if (!rec) throw new Error('Unknown book')
    if (rec.downloaded && await db.get('files', id)) return rec
    changed({ id, downloading: true })
    const { bytes, type } = await fetchBytes(rec.source.url, { onProgress, sameOrigin: rec.source.type === 'starter' })
    const name = rec.source.fileName ?? rec.source.url.split('/').pop().split('?')[0]
    const blob = new Blob([bytes], { type: type || mimeFor(rec.format) })
    if (rec.format === 'txt') {
      const text = decodeText(bytes)
      if (text.length < 500) throw new Error('Downloaded file looks empty')
    }
    await db.put('files', { id, blob, name })
    const updated = { ...rec, downloaded: true, size: blob.size }
    if (!updated.cover && rec.format !== 'txt') {
      updated.cover = await extractCover(new File([blob], name, { type: blob.type })).catch(() => null)
    }
    await db.put('books', updated)
    return updated
  })()
  downloads.set(id, job)
  job.finally(() => { downloads.delete(id); changed({ id }) }).catch(() => {})
  return job
}

const mimeFor = format => ({
  epub: 'application/epub+zip',
  txt: 'text/plain;charset=utf-8',
  fb2: 'application/x-fictionbook+xml',
  mobi: 'application/x-mobipocket-ebook',
  azw3: 'application/vnd.amazon.ebook',
  cbz: 'application/vnd.comicbook+zip',
}[format] ?? 'application/octet-stream')

/** Add a remote book (from Discover) and download it. */
export async function addRemoteBook(entry) {
  const existing = await db.get('books', entry.id)
  const rec = {
    ...(existing ?? {}),
    id: entry.id,
    title: entry.title,
    author: entry.author,
    language: entry.language ?? 'en',
    description: entry.description ?? existing?.description,
    year: entry.year ?? existing?.year,
    genre: entry.genre ?? existing?.genre,
    format: entry.format,
    source: entry.source,
    coverUrl: entry.coverUrl,
    downloaded: existing?.format === entry.format ? existing.downloaded : false,
    addedAt: existing?.addedAt ?? Date.now(),
  }
  // Switching format (e.g. TXT -> EPUB) invalidates the old file and CFIs.
  if (existing && existing.format !== entry.format) {
    await db.del('files', entry.id)
    const p = await db.get('progress', entry.id)
    if (p) await db.put('progress', { id: entry.id, fraction: p.fraction ?? 0, cfi: null })
  }
  await db.put('books', rec)
  changed({ id: rec.id })
  return ensureDownloaded(rec.id)
}

/* ------------------------------------------------------------------ */
/* Local import                                                        */
/* ------------------------------------------------------------------ */

const EXT_FORMATS = { epub: 'epub', txt: 'txt', fb2: 'fb2', fbz: 'fb2', mobi: 'mobi', azw3: 'azw3', azw: 'azw3', cbz: 'cbz' }

export function formatOf(name) {
  const ext = name.toLowerCase().split('.').pop()
  if (name.toLowerCase().endsWith('.fb2.zip')) return 'fb2'
  return EXT_FORMATS[ext] ?? null
}

async function hashBlob(blob) {
  const buf = await blob.slice(0, 1 << 20).arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf).catch(() => null)
  if (!digest) return `${blob.size}-${Date.now()}`
  return [...new Uint8Array(digest)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('') + `-${blob.size}`
}

export async function importFile(file) {
  const format = formatOf(file.name)
  if (!format) throw new Error(`Unsupported file type: ${file.name}`)
  const id = `local-${await hashBlob(file)}`
  const existing = await db.get('books', id)
  if (existing) return existing

  let meta = {}
  let cover = null
  if (format === 'txt') {
    const header = readHeader(decodeText(await file.slice(0, 20000).arrayBuffer()))
    meta = { title: header.title ?? file.name.replace(/\.txt$/i, ''), author: header.author ?? '', language: header.language ?? 'en' }
  } else {
    const { makeBook } = await import('../vendor/foliate-js/view.js')
    const book = await makeBook(file)
    meta = {
      title: langString(book.metadata?.title) || file.name.replace(/\.[^.]+$/, ''),
      author: contributors(book.metadata?.author),
      language: [].concat(book.metadata?.language ?? 'en')[0],
      description: stripTags(langString(book.metadata?.description) ?? ''),
    }
    cover = await Promise.resolve(book.getCover?.()).catch(() => null) ?? null
    book.destroy?.()
  }

  const rec = {
    id, ...meta, format, cover,
    downloaded: true,
    size: file.size,
    source: { type: 'local', fileName: file.name },
    addedAt: Date.now(),
  }
  await db.put('files', { id, blob: file, name: file.name })
  await db.put('books', rec)
  changed({ id })
  return rec
}

/* ------------------------------------------------------------------ */
/* Opening & removal                                                   */
/* ------------------------------------------------------------------ */

/** Returns something `<foliate-view>.open()` accepts. */
export async function openBookObject(rec) {
  const file = await db.get('files', rec.id)
  if (!file) throw new Error('Book file missing')
  await db.put('books', { ...rec, lastOpenedAt: Date.now() })
  if (rec.format === 'txt') {
    const text = decodeText(await file.blob.arrayBuffer())
    return makeTextBook(text, { title: rec.title, author: rec.author, language: rec.language })
  }
  return new File([file.blob], file.name ?? `${rec.id}.${rec.format}`, { type: file.blob.type })
}

export async function removeBook(id, { keepRecord = false } = {}) {
  await db.del('files', id)
  if (keepRecord) {
    const rec = await db.get('books', id)
    if (rec) await db.put('books', { ...rec, downloaded: false })
  } else {
    await db.del('books', id)
    await db.del('progress', id)
    for (const a of await db.getAllByIndex('annotations', 'bookId', id)) await db.del('annotations', a.id)
  }
  changed({ id, removed: true })
}

export async function markOpened(id) {
  const rec = await db.get('books', id)
  if (rec) await db.put('books', { ...rec, lastOpenedAt: Date.now() })
}

async function extractCover(file) {
  const { makeBook } = await import('../vendor/foliate-js/view.js')
  const book = await makeBook(file)
  const cover = await Promise.resolve(book.getCover?.()).catch(() => null)
  book.destroy?.()
  return cover ?? null
}

/* ------------------------------------------------------------------ */
/* Metadata helpers                                                    */
/* ------------------------------------------------------------------ */

export function langString(x) {
  if (!x) return ''
  if (typeof x === 'string') return x
  return x.en ?? Object.values(x)[0] ?? ''
}

export function contributors(x) {
  if (!x) return ''
  const one = c => typeof c === 'string' ? c : langString(c?.name)
  return Array.isArray(x) ? x.map(one).filter(Boolean).join(', ') : one(x)
}

export const stripTags = s => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
