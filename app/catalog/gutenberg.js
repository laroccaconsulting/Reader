/* Project Gutenberg (https://www.gutenberg.org) — 75,000+ free ebooks.
 * Its OPDS catalog sends CORS headers, so browsing and search work directly.
 * Book files do not, so downloads need the user's relay (see /relay). */

import { fetchText, relayConfigured } from '../net.js'

const BASE = 'https://www.gutenberg.org'

export const id = 'gutenberg'
export const name = 'Project Gutenberg'
export const note = 'The oldest digital library: 75,000+ free ebooks in 60+ languages.'

export const coverFor = pgId => `${BASE}/cache/epub/${pgId}/pg${pgId}.cover.medium.jpg`
export const epubFor = pgId => `${BASE}/ebooks/${pgId}.epub3.images`

const ATOM = 'http://www.w3.org/2005/Atom'

export function parseSearchFeed(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const entries = [...doc.getElementsByTagNameNS(ATOM, 'entry')]
  const items = []
  for (const e of entries) {
    const idText = e.getElementsByTagNameNS(ATOM, 'id')[0]?.textContent ?? ''
    const m = /\/ebooks\/(\d+)\.opds$/.exec(idText)
    if (!m) continue
    const pgId = Number(m[1])
    items.push(item(pgId,
      e.getElementsByTagNameNS(ATOM, 'title')[0]?.textContent?.trim(),
      e.getElementsByTagNameNS(ATOM, 'content')[0]?.textContent?.trim() ?? ''))
  }
  const next = [...doc.getElementsByTagNameNS(ATOM, 'link')].find(l => l.getAttribute('rel') === 'next')
  return { items, next: next ? new URL(next.getAttribute('href'), BASE).href : null }
}

function item(pgId, title, author) {
  return {
    id: `pg-${pgId}`,
    title: tidyTitle(title),
    author: tidyAuthor(author),
    coverUrl: coverFor(pgId),
    format: 'epub',
    language: 'en',
    source: { type: 'gutenberg', gutenberg: pgId, url: epubFor(pgId), page: `${BASE}/ebooks/${pgId}`, fileName: `pg${pgId}.epub` },
  }
}

/** "Frankenstein; or, the modern prometheus" -> "Frankenstein; or, The Modern Prometheus" is risky; keep, but trim. */
const tidyTitle = t => (t ?? 'Untitled').replace(/\s+/g, ' ').trim()
/** "Shelley, Mary Wollstonecraft" -> "Mary Wollstonecraft Shelley" */
export function tidyAuthor(a) {
  return (a ?? '').split(/\s*;\s*|\s+and\s+/).map(name => {
    const clean = name.replace(/,?\s*\d{3,4}\??-\d{0,4}\??$/, '').replace(/\s*\[.*?\]\s*/g, '').trim()
    const parts = clean.split(/,\s*/)
    return parts.length === 2 && !/\b(Jr|Sr)\.?$/.test(parts[1]) ? `${parts[1]} ${parts[0]}` : clean
  }).filter(Boolean).join(', ')
}

export async function list({ query = '', page = 1, next = null, signal } = {}) {
  const url = next ?? (query
    ? `${BASE}/ebooks/search.opds/?${new URLSearchParams({ query })}`
    : `${BASE}/ebooks/search.opds/?sort_order=downloads`)
  const xml = await fetchText(url, { signal })
  const { items, next: nextUrl } = parseSearchFeed(xml)
  return { items, hasNext: Boolean(nextUrl), next: nextUrl }
}

/** Book details from /ebooks/{id}.opds: summary, subjects, languages. */
export async function details(it, { signal } = {}) {
  const pgId = it.source.gutenberg
  const xml = await fetchText(`${BASE}/ebooks/${pgId}.opds`, { signal })
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const entry = doc.getElementsByTagNameNS(ATOM, 'entry')[0]
  const paras = entry ? [...entry.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'p')].map(p => p.textContent.replace(/\s+/g, ' ').trim()) : []
  const field = name => paras.filter(p => p.startsWith(`${name}:`)).map(p => p.slice(name.length + 1).trim())
  let summary = field('Summary')[0] ?? ''
  summary = summary.replace(/\s*\(This is an automatically generated summary\.\)\s*$/i, '')
  const author = entry?.getElementsByTagNameNS(ATOM, 'author')[0]?.textContent?.trim()
  const lang = entry?.getElementsByTagNameNS('http://purl.org/dc/terms/', 'language')[0]?.textContent?.trim()
  const published = field('Published')[0]
  return {
    description: summary,
    subjects: field('Subject').map(s => s.replace(/\s*--\s*Fiction$/, '')).slice(0, 6),
    author: author ? tidyAuthor(author) : undefined,
    language: lang,
    downloads: Number(field('Downloads')[0]) || null,
    published,
  }
}

export const canDownload = () => relayConfigured()
