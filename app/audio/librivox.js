/* Find a free LibriVox recording for a book.
 *
 * LibriVox's own API doesn't send CORS headers (and is slow), but every
 * LibriVox recording lives on the Internet Archive, whose search, metadata and
 * MP3 files all allow browser access (verified in CI). Results are cached on
 * the device, including "no recording found" (re-checked after a week).
 */

import * as db from '../db.js'

const SEARCH = 'https://archive.org/advancedsearch.php'
const META = 'https://archive.org/metadata/'
const MISS_TTL = 7 * 24 * 3600 * 1000

const norm = s => (s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const mainTitle = t => norm((t ?? '').split(/[;:(]|, or,? /i)[0])
const lastName = a => norm(a).split(' ').filter(Boolean).pop() ?? ''

/** Pick the best candidate: matching title and author, most listened-to, not a dramatic reading or excerpt. */
export function pickRecording(docs, { title, author }) {
  const want = mainTitle(title)
  const who = lastName(author)
  const scored = docs.map(d => {
    const t = mainTitle(Array.isArray(d.title) ? d.title[0] : d.title)
    const c = norm([].concat(d.creator ?? []).join(' '))
    let score = 0
    if (t === want) score += 100
    else if (t.startsWith(want) || want.startsWith(t)) score += 60
    else return null
    if (who && c.includes(who)) score += 50
    if (/dramatic|excerpt|abridged|selections?/i.test(String(d.title))) score -= 40
    if (d.language && !/^(english|eng|en)$/i.test([].concat(d.language)[0])) score -= 30
    score += Math.log10((d.downloads ?? 0) + 1) * 5
    return { d, score }
  }).filter(Boolean)
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.score >= 100 ? scored[0].d : null
}

/** Build the track list from an Internet Archive item's metadata. */
export function tracksFromMetadata(meta) {
  const files = meta.files ?? []
  let mp3 = files.filter(f => /_64kb\.mp3$/i.test(f.name))
  if (!mp3.length) mp3 = files.filter(f => /\.mp3$/i.test(f.name) && !/_(?:128|256)kb\.mp3$/i.test(f.name))
  const trackNo = f => Number(String(f.track ?? '').split('/')[0]) || Infinity
  mp3.sort((a, b) => trackNo(a) - trackNo(b) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  const id = meta.metadata?.identifier
  return mp3.map((f, i) => ({
    name: f.name,
    title: (f.title ?? '').trim() || `Part ${i + 1}`,
    duration: Number(f.length) || parseClock(f.length) || null,
    size: Number(f.size) || null,
    url: `https://archive.org/download/${encodeURIComponent(id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
  }))
}

function parseClock(v) {
  if (typeof v !== 'string' || !v.includes(':')) return null
  return v.split(':').reduce((t, x) => t * 60 + Number(x), 0)
}

export async function findRecording(book, { force = false } = {}) {
  const key = `audio|${book.id}`
  const cached = await db.get('catalog', key).catch(() => null)
  if (cached && !force) {
    if (cached.data) return cached.data
    if (Date.now() - cached.fetchedAt < MISS_TTL) return null
  }
  if (navigator.onLine === false) return cached?.data ?? null

  const title = mainTitle(book.title)
  if (!title) return null
  const q = `collection:(librivoxaudio) AND title:(${title.split(' ').slice(0, 8).join(' ')})`
  const params = new URLSearchParams({ q, rows: '12', output: 'json' })
  for (const f of ['identifier', 'title', 'creator', 'downloads', 'language']) params.append('fl[]', f)
  params.append('sort[]', 'downloads desc')
  const res = await fetch(`${SEARCH}?${params}`)
  if (!res.ok) throw new Error(`Archive search failed (${res.status})`)
  const docs = (await res.json()).response?.docs ?? []
  const best = pickRecording(docs, book)
  if (!best) {
    await db.put('catalog', { key, data: null, fetchedAt: Date.now() }).catch(() => {})
    return null
  }
  const meta = await (await fetch(`${META}${encodeURIComponent(best.identifier)}`)).json()
  const tracks = tracksFromMetadata(meta)
  if (!tracks.length) return null
  const recording = {
    id: best.identifier,
    title: [].concat(best.title)[0],
    readers: meta.metadata?.creator ? [].concat(meta.metadata.creator).join(', ') : '',
    page: `https://archive.org/details/${best.identifier}`,
    tracks,
    totalDuration: tracks.reduce((n, t) => n + (t.duration ?? 0), 0),
    totalSize: tracks.reduce((n, t) => n + (t.size ?? 0), 0),
  }
  await db.put('catalog', { key, data: recording, fetchedAt: Date.now() }).catch(() => {})
  return recording
}
