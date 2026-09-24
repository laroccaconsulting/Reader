/* Highlights & notes: select text -> pick a colour, add a note, copy.
 * Stored as annotations { type: 'highlight', cfi, text, color, note }. */

import * as db from '../db.js'
import { Overlayer } from '../../vendor/foliate-js/overlayer.js'
import { $, toast, html } from '../ui/dom.js'
import { define, isSingleWord, normalizeWord } from './define.js'

export const COLORS = {
  yellow: 'rgba(250, 204, 21, .38)',
  green: 'rgba(74, 222, 128, .34)',
  blue: 'rgba(96, 165, 250, .34)',
  pink: 'rgba(244, 114, 182, .34)',
}

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

export class Highlights extends EventTarget {
  list = []
  #pending = null   // { cfi, text, index } for a fresh selection
  #editing = null   // existing annotation being edited
  #noteSheet = null

  constructor(reader, { noteSheet, defineSheet }) {
    super()
    this.defineSheet = defineSheet
    this.reader = reader
    this.pop = $('#hl-pop')
    this.#noteSheet = noteSheet
    reader.addEventListener('open', () => this.#onOpen())
    reader.addEventListener('close', () => { this.hidePopover(); this.list = [] })
    reader.addEventListener('section-load', e => this.#watchSelection(e.detail))

    this.pop.addEventListener('pointerdown', e => e.preventDefault()) // keep the selection alive
    this.pop.addEventListener('click', e => this.#onPopClick(e))
    $('#note-save').addEventListener('click', () => this.#saveNote())
    $('#note-delete').addEventListener('click', () => this.#deleteEditing(true))
  }

  forBook() { return this.list.slice().sort((a, b) => (a.fraction ?? 0) - (b.fraction ?? 0)) }

  async #onOpen() {
    const { view, record } = this.reader
    this.list = (await db.getAllByIndex('annotations', 'bookId', record.id)).filter(a => a.type === 'highlight')
    view.addEventListener('create-overlay', e => {
      for (const a of this.list) if (this.#indexOf(a) === e.detail.index) view.addAnnotation({ value: a.cfi, color: a.color })
    })
    view.addEventListener('draw-annotation', e => {
      const { draw, annotation } = e.detail
      draw(Overlayer.highlight, { color: COLORS[annotation.color] ?? COLORS.yellow })
    })
    view.addEventListener('show-annotation', e => {
      const a = this.list.find(x => x.cfi === e.detail.value)
      if (!a) return
      this.reader.suppressTap = Date.now()
      this.#editing = a
      this.#pending = null
      this.#showPopover(e.detail.range, true)
    })
    // Sections already on screen were created before we subscribed.
    for (const { index } of view.renderer.getContents()) {
      for (const a of this.list) if (this.#indexOf(a) === index) view.addAnnotation({ value: a.cfi, color: a.color })
    }
  }

  #indexOf(a) {
    try { return this.reader.view.resolveNavigation(a.cfi)?.index } catch { return -1 }
  }

  #watchSelection({ doc, index }) {
    let timer
    const check = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const sel = doc.getSelection()
        if (!sel || sel.isCollapsed || !sel.rangeCount) { if (!this.#editing) this.hidePopover(); return }
        const range = sel.getRangeAt(0)
        const text = range.toString().trim()
        if (!text) return
        this.#editing = null
        this.#pending = { cfi: this.reader.view.getCFI(index, range), text, index, range }
        this.#showPopover(range, false)
      }, 350)
    }
    doc.addEventListener('selectionchange', check)
    doc.addEventListener('pointerup', check)
  }

  #showPopover(range, existing) {
    const frame = range.startContainer.ownerDocument?.defaultView?.frameElement
    const rects = [...range.getClientRects()]
    if (!frame || !rects.length) return
    const f = frame.getBoundingClientRect()
    const first = rects[0], last = rects[rects.length - 1]
    this.pop.classList.toggle('existing', existing)
    const text = existing ? this.#editing?.text : this.#pending?.text
    this.pop.classList.toggle('word', Boolean(text && isSingleWord(text)))
    this.pop.querySelectorAll('[data-color]').forEach(b =>
      b.setAttribute('aria-pressed', String(existing && this.#editing?.color === b.dataset.color)))
    this.pop.hidden = false
    const pw = this.pop.offsetWidth, ph = this.pop.offsetHeight
    let top = f.top + first.top - ph - 12
    if (top < 60) top = f.top + last.bottom + 12
    let left = f.left + (first.left + last.right) / 2 - pw / 2
    left = Math.max(8, Math.min(innerWidth - pw - 8, left))
    this.pop.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  }

  hidePopover() {
    this.pop.hidden = true
  }

  get popoverOpen() { return !this.pop.hidden }

  async #onPopClick(e) {
    const btn = e.target.closest('button')
    if (!btn) return
    const color = btn.dataset.color
    if (color) return this.#applyColor(color)
    switch (btn.dataset.act) {
      case 'note': {
        const a = this.#editing ?? await this.#applyColor('yellow', { keepOpen: true })
        if (a) this.#openNote(a)
        break
      }
      case 'copy': {
        const text = this.#editing?.text ?? this.#pending?.text ?? ''
        try { await navigator.clipboard.writeText(text); toast('Copied') } catch { toast('Couldn’t copy') }
        this.#clearSelection()
        break
      }
      case 'delete': await this.#deleteEditing(false); break
      case 'define': this.#define(this.#editing?.text ?? this.#pending?.text ?? ''); break
    }
  }

  async #applyColor(color, { keepOpen = false } = {}) {
    const { view, record, location } = this.reader
    let a = this.#editing
    if (a) {
      a.color = color
      await db.put('annotations', a)
      await view.addAnnotation({ value: a.cfi, color })
    } else if (this.#pending) {
      const p = this.#pending
      const progress = view.getProgressOf?.(p.index, p.range)
      a = {
        id: uid(),
        bookId: record.id,
        type: 'highlight',
        cfi: p.cfi,
        text: p.text.replace(/\s+/g, ' '),
        color,
        note: '',
        label: progress?.tocItem?.label ?? location?.tocItem?.label ?? '',
        fraction: location?.fraction ?? 0,
        createdAt: Date.now(),
      }
      await db.put('annotations', a)
      this.list.push(a)
      await view.addAnnotation({ value: a.cfi, color })
    } else return null
    if (!keepOpen) { this.hidePopover(); this.#clearSelection(); this.#editing = null }
    this.dispatchEvent(new Event('change'))
    return a
  }

  async #define(text) {
    const word = normalizeWord(text)
    this.hidePopover()
    this.#clearSelection()
    const body = $('#define-body')
    body.innerHTML = String(html`<p class="define-word">${word}</p><div class="spinner"></div>`)
    this.defineSheet.open()
    try {
      const lang = String(this.reader.book?.metadata?.language ?? 'en').slice(0, 2)
      const entries = await define(word, lang)
      body.innerHTML = String(html`
        <p class="define-word">${word}</p>
        ${entries.length ? entries.map(e => html`
          <div class="define-entry">
            <div class="define-pos">${e.partOfSpeech}</div>
            <ol>${e.definitions.map(d => html`<li>${d}</li>`)}</ol>
            ${e.examples.length ? html`<p class="define-example">“${e.examples[0]}”</p>` : ''}
          </div>`) : html`<p class="muted">No definition found.</p>`}
        <p class="detail-source">From <a href="https://en.wiktionary.org/wiki/${encodeURIComponent(word)}" target="_blank" rel="noopener">Wiktionary</a> (CC BY-SA). Words you look up are saved for offline use.</p>`)
    } catch {
      body.innerHTML = String(html`<p class="define-word">${word}</p><p class="muted">${navigator.onLine === false ? 'You’re offline. Definitions need a connection the first time you look a word up.' : 'Couldn’t reach Wiktionary.'}</p>`)
    }
  }

  #openNote(a) {
    this.#editing = a
    this.hidePopover()
    this.#clearSelection()
    $('#note-quote').textContent = a.text
    $('#note-text').value = a.note ?? ''
    this.#noteSheet.open()
    setTimeout(() => $('#note-text').focus(), 350)
  }

  async #saveNote() {
    const a = this.#editing
    if (!a) return
    a.note = $('#note-text').value.trim()
    await db.put('annotations', a)
    this.#noteSheet.close()
    this.#editing = null
    toast(a.note ? 'Note saved' : 'Highlight saved')
    this.dispatchEvent(new Event('change'))
  }

  async #deleteEditing(fromSheet) {
    const a = this.#editing
    if (!a) return
    await this.remove(a.id)
    if (fromSheet) this.#noteSheet.close()
    this.hidePopover()
    this.#editing = null
    toast('Highlight removed')
  }

  async remove(id) {
    const a = this.list.find(x => x.id === id)
    if (!a) return
    await db.del('annotations', id)
    this.list = this.list.filter(x => x.id !== id)
    await this.reader.view?.deleteAnnotation({ value: a.cfi })
    this.dispatchEvent(new Event('change'))
  }

  editNote(id) {
    const a = this.list.find(x => x.id === id)
    if (a) this.#openNote(a)
  }

  #clearSelection() {
    for (const { doc } of this.reader.view?.renderer.getContents() ?? []) doc.getSelection()?.removeAllRanges()
  }

  /** Markdown export of this book's highlights and notes. */
  toMarkdown() {
    const r = this.reader.record
    const lines = [`# ${r.title}`, r.author ? `*${r.author}*` : '', '']
    let label = null
    for (const a of this.forBook()) {
      if (a.label && a.label !== label) { lines.push(`## ${a.label}`, ''); label = a.label }
      lines.push(`> ${a.text}`, '')
      if (a.note) lines.push(a.note, '')
    }
    return lines.join('\n')
  }
}
