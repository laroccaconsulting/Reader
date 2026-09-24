/* Standard Ebooks (https://standardebooks.org) — carefully produced, CC0
 * public-domain ebooks. Their site sends `Access-Control-Allow-Origin: *`,
 * so search, covers and EPUB downloads work straight from the browser.
 * (Their OPDS feeds require a Patrons Circle login, so we read the public
 * HTML listing, which carries schema.org RDFa markup.) */

import { fetchText } from '../net.js'

const BASE = 'https://standardebooks.org'
const PER_PAGE = 24

export const id = 'standardebooks'
export const name = 'Standard Ebooks'
export const note = 'Beautifully typeset, carefully proofread public-domain classics. Free and <a href="https://standardebooks.org/donate" target="_blank" rel="noopener">volunteer-run</a>.'

/** Build the EPUB download URL from a book path like /ebooks/mary-shelley/frankenstein */
export function epubUrl(path) {
  const slug = path.replace(/^\/ebooks\//, '').replace(/\/$/, '').split('/').join('_')
  return `${BASE}${path}/downloads/${slug}.epub?source=download`
}

export function parseListing(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html')
  const items = [...doc.querySelectorAll('li[typeof="schema:Book"]')].map(li => {
    const path = li.getAttribute('about')
    const title = li.querySelector(':scope > p [property="schema:name"]')?.textContent?.trim()
      ?? li.querySelector('[property="schema:name"]')?.textContent?.trim()
    const authors = [...li.querySelectorAll('[property="schema:author"] [property="schema:name"]')]
      .map(x => x.textContent.trim())
    const img = li.querySelector('img')?.getAttribute('src')
    return {
      id: `se:${path.replace(/^\/ebooks\//, '')}`,
      title,
      author: authors.join(', '),
      coverUrl: img ? new URL(img, BASE).href : null,
      format: 'epub',
      language: 'en',
      source: { type: 'standardebooks', url: epubUrl(path), page: `${BASE}${path}` },
    }
  }).filter(x => x.title && x.id)
  const hasNext = Boolean(doc.querySelector('nav.pagination a[rel="next"], a[rel="next"]'))
    || [...doc.querySelectorAll('nav.pagination a')].some(a => /next/i.test(a.textContent))
  return { items, hasNext }
}

export async function list({ query = '', page = 1, signal } = {}) {
  const params = new URLSearchParams({ 'per-page': PER_PAGE, page })
  if (query) params.set('query', query)
  else params.set('sort', 'popularity')
  const text = await fetchText(`${BASE}/ebooks?${params}`, { signal })
  const { items, hasNext } = parseListing(text)
  return { items, hasNext: hasNext || items.length === PER_PAGE }
}

/** Fetch the book page for its description. */
export async function details(item, { signal } = {}) {
  const text = await fetchText(item.source.page, { signal })
  const doc = new DOMParser().parseFromString(text, 'text/html')
  const long = doc.querySelector('#description, section#description')
  const description = long
    ? [...long.querySelectorAll('p')].map(p => p.textContent.trim()).filter(Boolean).slice(0, 3).join('\n\n')
    : doc.querySelector('meta[name="description"]')?.content?.replace(/^Free epub ebook download of the Standard Ebooks edition of [^:]+:\s*/, '')
  const subjects = [...doc.querySelectorAll('[property="schema:genre"], .tags a')].map(a => a.textContent.trim()).filter(Boolean)
  const wordCount = doc.querySelector('[property="schema:wordCount"]')?.getAttribute('content')
  return { description, subjects: [...new Set(subjects)].slice(0, 6), words: wordCount ? Number(wordCount) : null }
}
