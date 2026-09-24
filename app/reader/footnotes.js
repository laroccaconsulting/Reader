/* Footnote/endnote popups: tapping a note reference shows the note in a sheet
 * instead of jumping to the back of the book. */

const types = el => new Set(el?.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type')?.split(/\s+/) ?? [])
const roles = el => new Set(el?.getAttribute?.('role')?.split(/\s+/) ?? [])

export function isNoteRef(a) {
  const t = types(a), r = roles(a)
  if (t.has('noteref') || r.has('doc-noteref') || t.has('biblioref') || r.has('doc-biblioref')) return true
  if (t.has('backlink') || r.has('doc-backlink')) return false
  const sup = el => el?.matches?.('sup') || el?.ownerDocument?.defaultView?.getComputedStyle(el).verticalAlign === 'super'
  return sup(a) || (a.children.length === 1 && sup(a.children[0])) || sup(a.parentElement)
}

const INLINE = 'a, span, sup, sub, em, strong, i, b, small'

/** Resolve a note's text (as plain paragraphs) from its href. */
export async function loadNote(book, href) {
  const target = book.resolveHref(href)
  if (!target) return null
  const doc = await book.sections[target.index].createDocument()
  let el = target.anchor(doc)
  if (!el || el === doc.body) return null
  if (el.startContainer) el = el.startContainer.parentElement
  while (el.matches?.(INLINE) && el.parentElement && el.parentElement !== doc.body) el = el.parentElement
  const clone = el.cloneNode(true)
  clone.querySelectorAll('a[role~="doc-backlink"], a[epub\\:type~="backlink"], script, style').forEach(x => x.remove())
  for (const a of clone.querySelectorAll('a')) if (/^[↩↑]|^back$/i.test(a.textContent.trim())) a.remove()
  const blocks = [...clone.querySelectorAll('p, li, dd, blockquote')].map(x => x.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const paragraphs = blocks.length ? blocks : [clone.textContent.replace(/\s+/g, ' ').trim()]
  return { paragraphs: paragraphs.filter(Boolean).slice(0, 12), href }
}
