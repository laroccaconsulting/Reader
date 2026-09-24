/* Shareable quote links.
 *
 *   <app>#/q/<book-ref>?t=<quote>&p=<prefix>&s=<suffix>&b=<title>&a=<author>&c=<cfi>
 *
 * The link names the *book*, not a file: `pg84` (Project Gutenberg #84) or
 * `se:mary-shelley/frankenstein` (Standard Ebooks). The quote is found by its
 * text plus a little context on either side (like the web's Text Fragments),
 * so it resolves in any edition. The CFI is only a fast path for the same
 * edition. Title/author let the landing card render with no network at all.
 */

export const MAX_QUOTE = 280
const CONTEXT = 32

/** Public, re-downloadable identity of a library record, or null (e.g. imported files). */
export function bookRef(rec) {
  if (!rec?.source) return null
  const pg = rec.source.gutenberg ?? (/^pg-(\d+)$/.exec(rec.id)?.[1])
  if ((rec.source.type === 'starter' || rec.source.type === 'gutenberg') && pg) return `pg${pg}`
  if (rec.source.type === 'standardebooks') return `se:${rec.id.replace(/^se:/, '')}`
  return null
}

/** Library record id for a book ref. */
export function recordIdFor(ref) {
  if (/^pg\d+$/.test(ref)) return `pg-${ref.slice(2)}`
  if (ref.startsWith('se:')) return ref
  return null
}

const squash = s => s.replace(/\s+/g, ' ').trim()

/** Trim a selection to MAX_QUOTE chars at a word boundary. */
export function clampQuote(text) {
  const t = squash(text)
  if (t.length <= MAX_QUOTE) return { text: t, truncated: false }
  return { text: t.slice(0, MAX_QUOTE).replace(/\s+\S*$/, '') + '…', truncated: true }
}

/** Text immediately before/after a DOM range, for disambiguation. */
export function rangeContext(range) {
  const doc = range.startContainer.ownerDocument
  const before = doc.createRange()
  before.setStart(doc.body, 0)
  before.setEnd(range.startContainer, range.startOffset)
  const after = doc.createRange()
  after.setStart(range.endContainer, range.endOffset)
  after.setEnd(doc.body, doc.body.childNodes.length)
  return {
    prefix: squash(before.toString()).slice(-CONTEXT),
    suffix: squash(after.toString()).slice(0, CONTEXT),
  }
}

export function buildLink({ ref, text, prefix, suffix, title, author, cfi }, base = appBase()) {
  const q = new URLSearchParams()
  q.set('t', text.replace(/…$/, ''))
  if (prefix) q.set('p', prefix)
  if (suffix) q.set('s', suffix)
  if (title) q.set('b', title)
  if (author) q.set('a', author)
  if (cfi) q.set('c', cfi)
  return `${base}#/q/${encodeURIComponent(ref)}?${q.toString()}`
}

export function parseLink(hash) {
  const m = /^#\/q\/([^?]+)\?(.*)$/.exec(hash)
  if (!m) return null
  const q = new URLSearchParams(m[2])
  const text = q.get('t')
  if (!text) return null
  return {
    ref: decodeURIComponent(m[1]),
    text,
    prefix: q.get('p') ?? '',
    suffix: q.get('s') ?? '',
    title: q.get('b') ?? '',
    author: q.get('a') ?? '',
    cfi: q.get('c') ?? '',
  }
}

export const appBase = () => `${location.origin}${location.pathname}`

/* ---------------------------------------------------------------------- */
/* Locating a quote in a document                                          */
/* ---------------------------------------------------------------------- */

const norm = s => s.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[—–]/g, '-').toLowerCase()

/** Build whitespace-collapsed text of `doc` with a map back to DOM positions. */
function indexText(doc) {
  const chars = []
  const map = [] // per char: [node, offset]
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT)
  let lastSpace = true
  let node
  while ((node = walker.nextNode())) {
    const parent = node.parentElement?.tagName
    if (parent === 'SCRIPT' || parent === 'STYLE') continue
    const data = node.data
    for (let i = 0; i < data.length; i++) {
      const c = data[i]
      if (/\s/.test(c)) {
        if (lastSpace) continue
        chars.push(' '); map.push([node, i]); lastSpace = true
      } else {
        chars.push(c); map.push([node, i]); lastSpace = false
      }
    }
    // Block boundaries count as a space so words from adjacent paragraphs don't merge.
    if (!lastSpace) { chars.push(' '); map.push([node, data.length]); lastSpace = true }
  }
  return { text: norm(chars.join('')), map }
}

/** Find the quote in `doc`; returns a Range or null. Prefers the occurrence whose context matches. */
export function locate(doc, { text, prefix = '', suffix = '' }) {
  const { text: hay, map } = indexText(doc)
  const needle = norm(squash(text))
  if (!needle) return null
  const p = norm(squash(prefix)), s = norm(squash(suffix))
  let best = -1, bestScore = -1
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) {
    let score = 0
    if (p && hay.slice(Math.max(0, i - p.length - 1), i).trim().endsWith(p.trim())) score += 2
    if (s && hay.slice(i + needle.length, i + needle.length + s.length + 1).trim().startsWith(s.trim())) score += 2
    if (score > bestScore) { best = i; bestScore = score }
    if (score === 4) break
  }
  if (best < 0) return null
  const [sn, so] = map[best]
  const [en, eo] = map[best + needle.length - 1]
  const range = doc.createRange()
  range.setStart(sn, so)
  range.setEnd(en, eo + 1)
  return range
}
