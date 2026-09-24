/* IndexedDB storage layer.
 *
 * Stores
 *   books        { id, title, author, language, format, source, size, addedAt,
 *                  lastOpenedAt, cover (Blob|null), genre, year, description }
 *   files        { id, blob }                       book file, kept apart from metadata
 *   progress     { id, cfi, fraction, label, updatedAt }
 *   annotations  { id, bookId, type: 'bookmark'|'highlight', cfi, text, note, color, createdAt }
 *   catalog      { key, data, fetchedAt }           cached catalog responses
 *   kv           { key, value }                     settings, stats, flags
 */

const DB_NAME = 'reader'
const DB_VERSION = 1

let dbPromise = null

function open() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    let req
    try { req = indexedDB.open(DB_NAME, DB_VERSION) } catch (e) { reject(e); return }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('annotations')) {
        const s = db.createObjectStore('annotations', { keyPath: 'id' })
        s.createIndex('bookId', 'bookId')
      }
      if (!db.objectStoreNames.contains('catalog')) db.createObjectStore('catalog', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB blocked'))
  }).catch(err => {
    console.warn('IndexedDB unavailable, using memory storage', err)
    return null
  })
  return dbPromise
}

/* Memory fallback (Safari private mode, blocked storage). */
const memory = new Map()
const mem = store => {
  if (!memory.has(store)) memory.set(store, new Map())
  return memory.get(store)
}
const keyOf = (store, value) => value[store === 'catalog' || store === 'kv' ? 'key' : 'id']

const wrap = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})

async function tx(store, mode, fn) {
  const db = await open()
  if (!db) return fn(null)
  const t = db.transaction(store, mode)
  const result = await fn(t.objectStore(store))
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error ?? new Error('Transaction aborted'))
  })
  return result
}

export const get = (store, key) =>
  tx(store, 'readonly', s => s ? wrap(s.get(key)) : mem(store).get(key))

export const getAll = store =>
  tx(store, 'readonly', s => s ? wrap(s.getAll()) : [...mem(store).values()])

export const put = (store, value) =>
  tx(store, 'readwrite', s => s ? wrap(s.put(value)) : void mem(store).set(keyOf(store, value), value))

export const del = (store, key) =>
  tx(store, 'readwrite', s => s ? wrap(s.delete(key)) : void mem(store).delete(key))

export const getAllByIndex = (store, index, value) =>
  tx(store, 'readonly', s => s
    ? wrap(s.index(index).getAll(value))
    : [...mem(store).values()].filter(v => v[index] === value))

export const clear = store =>
  tx(store, 'readwrite', s => s ? wrap(s.clear()) : void mem(store).clear())

export async function kvGet(key, fallback) {
  const rec = await get('kv', key)
  return rec ? rec.value : fallback
}
export const kvSet = (key, value) => put('kv', { key, value })

export async function isPersistent() {
  return (await open()) !== null
}

/** Ask the browser not to evict our data. Returns the resulting state. */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch { return false }
}

export async function storageEstimate() {
  try { return await navigator.storage?.estimate?.() } catch { return null }
}

/** One-time import of books cached by the previous version of the app. */
export async function migrateLegacy() {
  if (await kvGet('legacy-migrated')) return []
  const imported = []
  try {
    const dbs = await indexedDB.databases?.()
    if (dbs && !dbs.some(d => d.name === 'ReaderDB')) { await kvSet('legacy-migrated', true); return [] }
    const legacy = await new Promise((resolve, reject) => {
      const req = indexedDB.open('ReaderDB')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onupgradeneeded = () => { req.transaction.abort() }
    })
    if (legacy.objectStoreNames.contains('books')) {
      const t = legacy.transaction(['books', 'progress'], 'readonly')
      const books = await wrap(t.objectStore('books').getAll())
      const progress = await wrap(t.objectStore('progress').getAll())
      for (const b of books) {
        if (typeof b.text !== 'string' || b.text.length < 500) continue
        const p = progress.find(x => x.id === b.id)
        imported.push({
          id: b.id,
          text: b.text,
          fraction: p?.chapterCount > 1 ? p.chapter / (p.chapterCount - 1) : 0,
        })
      }
    }
    legacy.close()
  } catch (e) {
    console.warn('Legacy migration skipped', e)
  }
  await kvSet('legacy-migrated', true)
  return imported
}
