/* Reader: hosts <foliate-view>, drives layout/styles from settings, tracks
 * progress, bookmarks and the reading chrome. */

import '../../vendor/foliate-js/view.js'
import * as db from '../db.js'
import * as library from '../library.js'
import { settings, bookCSS, onChange, marginFraction } from '../settings.js'
import { $, esc, toast, formatDuration } from '../ui/dom.js'
import { isNoteRef, loadNote } from './footnotes.js'

let fontCSSPromise = null
function fontCSS() {
  fontCSSPromise ??= fetch('styles/fonts.css')
    .then(r => r.text())
    .then(css => css.replaceAll('../fonts/', new URL('fonts/', location.href).href))
    .catch(() => '')
  return fontCSSPromise
}

const debounce = (fn, ms) => {
  let t
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms) }
  d.flush = (...args) => { clearTimeout(t); return fn(...args) }
  return d
}

export class Reader extends EventTarget {
  view = null
  record = null
  book = null
  location = null
  chromeVisible = true
  #fontCSS = ''
  #offSettings = null
  #annotations = []

  constructor(root) {
    super()
    this.root = root
    this.stage = $('#reader-stage', root)
    this.saveProgress = debounce(() => this.#persist(), 800)
  }

  get isOpen() { return Boolean(this.view) }

  async open(record) {
    await this.close()
    this.record = record
    this.#fontCSS = await fontCSS()
    const bookObj = await library.openBookObject(record)

    const view = document.createElement('foliate-view')
    view.id = 'foliate'
    this.view = view
    this.stage.replaceChildren(view)

    view.addEventListener('relocate', e => this.#onRelocate(e.detail))
    view.addEventListener('load', e => this.#onLoad(e.detail))
    view.addEventListener('link', e => {
      const { a, href } = e.detail
      if (!isNoteRef(a)) return
      e.preventDefault()
      this.suppressTap = Date.now()
      loadNote(view.book, href)
        .then(note => note?.paragraphs.length
          ? this.dispatchEvent(new CustomEvent('footnote', { detail: note }))
          : view.goTo(href))
        .catch(() => view.goTo(href))
    })
    view.addEventListener('external-link', e => {
      e.preventDefault()
      const a = document.createElement('a')
      a.href = e.detail.a.href
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.click()
    })

    await view.open(bookObj)
    this.book = view.book
    this.#applyLayout()
    view.book.transformTarget?.addEventListener('data', ({ detail }) => {
      detail.data = Promise.resolve(detail.data).catch(err => {
        console.warn(`Failed to load ${detail.name}`, err)
        return ''
      })
    })

    this.#annotations = await db.getAllByIndex('annotations', 'bookId', record.id)
    this.#offSettings = onChange((_, patch) => this.#onSettings(patch))

    const saved = await library.getProgress(record.id)
    if (saved?.cfi) await view.init({ lastLocation: saved.cfi })
    else if (saved?.fraction > 0) await view.goToFraction(saved.fraction)
    else await view.init({ showTextStart: true })
    if (!this.location) await view.next().catch(() => {})

    this.showChrome()
    this.dispatchEvent(new Event('open'))
  }

  async close() {
    if (!this.view) return
    await this.saveProgress.flush()
    this.#offSettings?.()
    this.view.close()
    this.view.remove()
    this.book?.destroy?.()
    this.view = this.book = this.record = this.location = null
    this.dispatchEvent(new Event('close'))
  }

  /* ---------------- layout & styles ---------------- */

  #applyLayout() {
    const r = this.view?.renderer
    if (!r) return
    r.setAttribute('flow', settings.flow)
    r.setAttribute('gap', `${Math.round(marginFraction() * 100)}%`)
    r.setAttribute('margin', settings.flow === 'scrolled' ? '0px' : '44px')
    r.setAttribute('max-inline-size', `${Math.round(700 * settings.fontSize / 100)}px`)
    r.setAttribute('max-column-count', settings.columns === 'auto' ? '2' : '1')
    if (settings.animated) r.setAttribute('animated', '')
    else r.removeAttribute('animated')
    r.setStyles?.(bookCSS(this.#fontCSS))
    this.root.dataset.flow = settings.flow
  }

  #onSettings(patch) {
    if (!this.view) return
    this.#applyLayout()
    if ('flow' in patch) this.dispatchEvent(new Event('layout'))
  }

  /* ---------------- events ---------------- */

  #onLoad({ doc, index }) {
    doc.addEventListener('keydown', e => this.dispatchEvent(new CustomEvent('doc-keydown', { detail: e })))
    doc.addEventListener('click', e => this.#onDocClick(e, doc), false)
    this.dispatchEvent(new CustomEvent('section-load', { detail: { doc, index } }))
  }

  #onDocClick(e, doc) {
    if (e.defaultPrevented || e.target.closest?.('a[href]')) return
    const sel = doc.getSelection()
    if (sel && !sel.isCollapsed) return
    const frame = doc.defaultView.frameElement
    const x = (frame?.getBoundingClientRect().left ?? 0) + e.clientX
    // Defer so a tap on a highlight (handled by foliate's overlayer) can claim it first.
    setTimeout(() => {
      if (Date.now() - (this.suppressTap ?? 0) < 400) return
      if (this.dispatchEvent(new CustomEvent('tap', { cancelable: true }))) this.handleTap(x)
    }, 0)
  }

  /** Tap zones: left third = back, right third = forward, middle toggles chrome. */
  handleTap(clientX) {
    const width = this.stage.clientWidth || innerWidth
    const rel = (clientX - this.stage.getBoundingClientRect().left) / width
    if (settings.flow === 'paginated' && rel < 0.28) { this.hideChrome(); this.prev() }
    else if (settings.flow === 'paginated' && rel > 0.72) { this.hideChrome(); this.next() }
    else this.toggleChrome()
  }

  #onRelocate(detail) {
    this.location = detail
    this.saveProgress()
    this.dispatchEvent(new CustomEvent('relocate', { detail }))
  }

  async #persist() {
    if (!this.record || !this.location) return
    const { cfi, fraction, tocItem } = this.location
    await library.saveProgress({ id: this.record.id, cfi, fraction, label: tocItem?.label ?? '' })
  }

  /* ---------------- navigation ---------------- */

  next() { return this.view?.goRight() }
  prev() { return this.view?.goLeft() }
  goTo(target) { return this.view?.goTo(target) }
  goToFraction(f) { return this.view?.goToFraction(f) }
  nextSection() { return this.view?.renderer.nextSection?.() }
  prevSection() { return this.view?.renderer.prevSection?.() }

  /* ---------------- chrome ---------------- */

  showChrome() {
    this.chromeVisible = true
    this.root.classList.remove('chrome-hidden')
  }
  hideChrome() {
    this.chromeVisible = false
    this.root.classList.add('chrome-hidden')
  }
  toggleChrome() { this.chromeVisible ? this.hideChrome() : this.showChrome() }

  /* ---------------- info ---------------- */

  get toc() { return this.book?.toc ?? [] }

  progressText() {
    const loc = this.location
    if (!loc) return { left: '', right: '' }
    const pct = Math.round((loc.fraction ?? 0) * 100)
    const minutesLeft = loc.time?.section
    return {
      left: loc.tocItem?.label ?? '',
      right: `${pct}%${minutesLeft != null ? ` · ${formatDuration(minutesLeft)} left in chapter` : ''}`,
    }
  }

  /** Text of the current visible page, for bookmarks and RSVP. */
  currentExcerpt(max = 140) {
    const text = this.location?.range?.toString().replace(/\s+/g, ' ').trim() ?? ''
    return text.length > max ? `${text.slice(0, max).replace(/\s\S*$/, '')}…` : text
  }

  /* ---------------- bookmarks ---------------- */

  get bookmarks() {
    return this.#annotations.filter(a => a.type === 'bookmark').sort((a, b) => (a.fraction ?? 0) - (b.fraction ?? 0))
  }

  currentBookmark() {
    const loc = this.location
    if (!loc?.range) return null
    return this.bookmarks.find(b => {
      if (b.sectionIndex !== loc.section?.current) return false
      try {
        const { anchor } = this.view.resolveNavigation(b.cfi)
        const target = anchor(loc.range.startContainer.getRootNode())
        const r = target?.startContainer ? target : null // Range from the iframe realm: no instanceof
        return r ? loc.range.comparePoint(r.startContainer, r.startOffset) === 0 : false
      } catch { return false }
    }) ?? null
  }

  async toggleBookmark() {
    const existing = this.currentBookmark()
    if (existing) {
      await db.del('annotations', existing.id)
      this.#annotations = this.#annotations.filter(a => a.id !== existing.id)
      toast('Bookmark removed')
    } else if (this.location) {
      const collapsed = this.location.range?.cloneRange()
      collapsed?.collapse(true)
      const cfi = collapsed ? this.view.getCFI(this.location.section.current, collapsed) : this.location.cfi
      const rec = {
        id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        bookId: this.record.id,
        type: 'bookmark',
        cfi,
        fraction: this.location.fraction,
        sectionIndex: this.location.section?.current,
        label: this.location.tocItem?.label ?? '',
        text: this.currentExcerpt(),
        createdAt: Date.now(),
      }
      await db.put('annotations', rec)
      this.#annotations.push(rec)
      toast('Bookmarked')
    }
    this.dispatchEvent(new Event('bookmarks'))
  }

  async deleteAnnotation(id) {
    await db.del('annotations', id)
    this.#annotations = this.#annotations.filter(a => a.id !== id)
    this.dispatchEvent(new Event('bookmarks'))
  }
}

export function tocHtml(items, currentHref, depth = 0) {
  return items.map(item => `
    <li>
      <button class="toc-link${item.href === currentHref ? ' current' : ''}" data-href="${esc(item.href)}" style="--depth:${depth}"
        ${item.href === currentHref ? 'aria-current="true"' : ''}>${esc(item.label?.trim() || 'Untitled')}</button>
      ${item.subitems?.length ? `<ol>${tocHtml(item.subitems, currentHref, depth + 1)}</ol>` : ''}
    </li>`).join('')
}
