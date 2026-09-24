/* Book covers: real cover images when we have them, otherwise a generated
 * cloth-bound style cover coloured by genre (or by a hash of the title). */

import { html, raw } from './dom.js'

const GENRE_COLORS = {
  Romance: '#B06A7B', Horror: '#6B4E97', Mystery: '#3F6F93', Adventure: '#2F8A6B',
  'Sci-Fi': '#2F6DB0', Drama: '#9E6A35', Comedy: '#B08E17', Philosophy: '#4E7D5D',
  Fantasy: '#7B55B4', Fiction: '#8F4D6A', Historical: '#7C5436', Epic: '#394F8A',
  'Non-Fiction': '#3F8472', Fables: '#7A8029',
}

function hashHue(s) {
  let h = 0
  for (const c of s) h = (h * 31 + c.codePointAt(0)) >>> 0
  return h % 360
}

export function coverColor(book) {
  return GENRE_COLORS[book.genre] ?? `hsl(${hashHue(book.title ?? '')} 38% 42%)`
}

const objectUrls = new WeakMap()
export function coverUrl(book) {
  if (book.cover instanceof Blob) {
    if (!objectUrls.has(book.cover)) objectUrls.set(book.cover, URL.createObjectURL(book.cover))
    return objectUrls.get(book.cover)
  }
  return book.coverUrl ?? null
}

/** Cover markup. `size` is 'grid' | 'small'. */
export function coverHtml(book, { badge = '' } = {}) {
  const url = coverUrl(book)
  const generated = html`
    <div class="cover-generated" style="--cover:${coverColor(book)}">
      <span class="cover-title">${book.title}</span>
      <span class="cover-rule"></span>
      <span class="cover-author">${book.author}</span>
    </div>`
  return html`
    <div class="cover">
      ${generated}
      ${url ? html`<img src="${url}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}
      ${raw(badge)}
    </div>`
}
