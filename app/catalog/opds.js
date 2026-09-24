/* OPDS catalogs (1.x Atom and 2.0 JSON): the open standard used by public
 * library feeds, Calibre-Web, Kavita, Komga, COPS and more. Users add any
 * feed URL; we browse navigation, publications, pagination and search. */

import * as db from '../db.js'
import { fetchText } from '../net.js'
import { getFeed, getPublication, getOpenSearch, getSearch, isOPDSCatalog, REL, SYMBOL } from '../../vendor/foliate-js/opds.js'

export const id = 'opds'
export const name = 'Catalogs'
export const note = 'Add any OPDS catalog: your Calibre-Web, Kavita or Komga server, or a public library feed.'
export const custom = true

export const SUGGESTED = [
  { title: 'Project Gutenberg', url: 'https://www.gutenberg.org/ebooks.opds/' },
]

export async function savedFeeds() {
  return db.kvGet('opds-feeds', [])
}

export async function saveFeed(feed) {
  const feeds = (await savedFeeds()).filter(f => f.url !== feed.url)
  feeds.unshift(feed)
  await db.kvSet('opds-feeds', feeds)
}

export async function removeFeed(url) {
  await db.kvSet('opds-feeds', (await savedFeeds()).filter(f => f.url !== url))
}

const FORMATS = [
  ['application/epub+zip', 'epub'],
  ['application/x-fictionbook+xml', 'fb2'],
  ['application/x-mobipocket-ebook', 'mobi'],
  ['application/vnd.amazon.ebook', 'azw3'],
  ['application/vnd.comicbook+zip', 'cbz'],
  ['application/x-cbz', 'cbz'],
  ['text/plain', 'txt'],
]

const OPEN_ACQ = new Set([REL.ACQ, `${REL.ACQ}/open-access`, 'http://opds-spec.org/acquisition/sample'])

/** Pick the best downloadable file among a publication's links. */
export function bestAcquisition(links) {
  const candidates = links.filter(l => [l.rel].flat().some(r => OPEN_ACQ.has(r)))
  for (const [type, format] of FORMATS) {
    const hit = candidates.find(l => l.type?.split(';')[0].trim().toLowerCase() === type)
    if (hit) return { href: hit.href, format, type }
  }
  return null
}

const text = x => typeof x === 'string' ? x : x?.name ?? x?.value ?? ''
const people = x => [x ?? []].flat().map(p => typeof p === 'string' ? p : text(p?.name ?? p)).filter(Boolean).join(', ')
const stripTags = s => (s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
const hash = s => { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)) | 0; return (h >>> 0).toString(36) }

/** Normalise an OPDS 2 publication into a Discover item. */
export function toItem(pub, base, feedTitle) {
  const abs = href => { try { return new URL(href, base).href } catch { return href } }
  const acq = bestAcquisition(pub.links ?? [])
  const image = (pub.images ?? [])[0]?.href
  const content = pub.metadata?.[SYMBOL.CONTENT]
  const description = typeof pub.metadata?.description === 'string'
    ? stripTags(pub.metadata.description)
    : stripTags(content?.value)
  const alt = (pub.links ?? []).find(l => l.rel === 'alternate' && /html/.test(l.type ?? ''))
  return {
    id: `opds-${hash(pub.metadata?.identifier ?? acq?.href ?? pub.metadata?.title ?? '')}`,
    title: text(pub.metadata?.title) || 'Untitled',
    author: people(pub.metadata?.author),
    language: [pub.metadata?.language ?? 'en'].flat()[0],
    description,
    coverUrl: image ? abs(image) : null,
    format: acq?.format ?? null,
    source: acq
      ? { type: 'opds', url: abs(acq.href), feedTitle, page: alt ? abs(alt.href) : null, fileName: null }
      : { type: 'opds', url: null, feedTitle, page: alt ? abs(alt.href) : null },
  }
}

/** Fetch and parse any OPDS feed URL into { title, navigation, items, next, search }. */
export async function load(url, { signal } = {}) {
  const raw = await fetchText(url, { signal, accept: 'application/atom+xml, application/opds+json, application/json;q=0.9, */*;q=0.5' })
  let feed
  if (/^\s*[{[]/.test(raw)) {
    feed = JSON.parse(raw) // OPDS 2.0 is already in the target shape
  } else {
    const doc = new DOMParser().parseFromString(raw, 'application/xml')
    if (doc.querySelector('parsererror')) throw new Error('Not an OPDS feed')
    const root = doc.documentElement.localName
    if (root === 'entry') feed = { metadata: {}, publications: [getPublication(doc.documentElement)], links: [] }
    else if (root === 'feed') feed = getFeed(doc)
    else throw new Error('Not an OPDS feed')
  }
  const title = text(feed.metadata?.title) || new URL(url).host
  const abs = href => new URL(href, url).href
  const links = feed.links ?? []
  const next = links.find(l => [l.rel].flat().includes('next'))
  const searchLink = links.find(l => [l.rel].flat().includes('search'))

  const publications = [...(feed.publications ?? []), ...(feed.groups ?? []).flatMap(g => g.publications ?? [])]
  const navigation = [...(feed.navigation ?? []), ...(feed.groups ?? []).flatMap(g => g.navigation ?? [])]
    .filter(n => n.href)
    .map(n => ({ title: text(n.title) || n.href, href: abs(n.href), summary: stripTags(n[SYMBOL.SUMMARY] ?? '') }))

  return {
    title,
    url,
    navigation,
    items: publications.map(p => toItem(p, url, title)),
    next: next ? abs(next.href) : null,
    searchLink: searchLink ? { ...searchLink, href: abs(searchLink.href) } : null,
  }
}

/** Resolve a search URL for `query` using the feed's OpenSearch or templated link. */
export async function searchUrl(searchLink, query, { signal } = {}) {
  if (!searchLink) return null
  if (searchLink.templated || /\{/.test(searchLink.href)) {
    const s = await getSearch(searchLink)
    return s.search(new Map([[null, new Map([['query', query], ['searchTerms', query]])]]))
  }
  if (isOPDSCatalog(searchLink.type)) return searchLink.href
  const xml = await fetchText(searchLink.href, { signal })
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const os = getOpenSearch(doc)
  return new URL(os.search(new Map([[null, new Map([['searchTerms', query]])]])), searchLink.href).href
}

export async function details(item) {
  return { description: item.description }
}
