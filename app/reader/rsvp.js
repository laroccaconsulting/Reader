/* RSVP speed reading: shows one word at a time with the optimal recognition
 * point centred. Starts at the current page, continues across sections, and
 * on exit moves the reader to the last word shown. */

import { settings, update } from '../settings.js'
import { $, $$ } from '../ui/dom.js'

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT'])

/** Collect words (with their DOM positions) from `startNode/startOffset` to the end of `doc`. */
export function collectWords(doc, start) {
  const words = []
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT, {
    acceptNode: n => {
      for (let p = n.parentElement; p; p = p.parentElement) if (SKIP.has(p.tagName)) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  let started = !start
  let node
  while ((node = walker.nextNode())) {
    let from = 0
    if (!started) {
      if (node === start.node) { started = true; from = start.offset }
      else if (start.node.nodeType === 1 && start.node.contains(node)) started = true
      else if (start.node.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) started = true
      else continue
    }
    const text = node.data
    const re = /\S+/g
    re.lastIndex = from
    let m
    while ((m = re.exec(text)) !== null) words.push({ w: m[0], node, offset: m.index })
    // Paragraph boundaries get a longer pause
    if (words.length && /^(P|DIV|H\d|LI|BLOCKQUOTE)$/.test(node.parentElement?.tagName ?? '')) {
      const last = words[words.length - 1]
      if (node.parentElement.lastChild === node) last.para = true
    }
  }
  return words
}

export function orpIndex(word) {
  const n = word.replace(/[^\p{L}\p{N}]/gu, '').length || word.length
  if (n <= 1) return 0
  if (n <= 5) return 1
  if (n <= 9) return 2
  if (n <= 13) return 3
  return 4
}

/** Position of the pivot within the raw word (skipping leading punctuation). */
function pivotOf(word) {
  const lead = /^[^\p{L}\p{N}]*/u.exec(word)[0].length
  return Math.min(word.length - 1, lead + orpIndex(word))
}

export function delayFor(entry, wpm) {
  const base = 60000 / wpm
  const w = entry.w
  let k = 1
  if (entry.para) k = 2.6
  else if (/[.!?]["”’)]*$/.test(w)) k = 2.2
  else if (/[,;:—–-]["”’)]*$/.test(w)) k = 1.5
  if (w.length > 10) k += 0.3
  return base * k
}

export class RSVP {
  words = []
  index = 0
  playing = false
  timer = null
  sectionIndex = 0

  constructor(reader) {
    this.reader = reader
    this.el = $('#rsvp')
    this.left = $('#rsvp-left', this.el)
    this.pivot = $('#rsvp-pivot', this.el)
    this.right = $('#rsvp-right', this.el)
    this.fill = $('#rsvp-fill', this.el)
    this.label = $('#rsvp-label', this.el)
    this.context = $('#rsvp-context', this.el)
    this.#wire()
  }

  get isOpen() { return this.el.classList.contains('open') }

  async open() {
    const { view, location } = this.reader
    if (!view || !location) return
    const { doc, index } = view.renderer.getContents()[0] ?? {}
    if (!doc) return
    const r = location.range
    this.sectionIndex = index
    this.words = collectWords(doc, r ? { node: r.startContainer, offset: r.startOffset } : null)
    this.index = 0
    if (!this.words.length) await this.#loadNextSection()
    this.#setWpm(settings.wpm)
    this.#render()
    this.el.classList.add('open')
    this.el.setAttribute('aria-hidden', 'false')
    $('#rsvp-play', this.el).focus({ preventScroll: true })
  }

  async close() {
    this.pause()
    this.el.classList.remove('open')
    this.el.setAttribute('aria-hidden', 'true')
    const entry = this.words[this.index]
    if (entry && this.index > 0) {
      try {
        const range = entry.node.ownerDocument.createRange()
        range.setStart(entry.node, entry.offset)
        range.collapse(true)
        await this.reader.goTo(this.reader.view.getCFI(this.sectionIndex, range))
      } catch (e) { console.warn('RSVP: could not sync position', e) }
    }
    $('#rsvp-btn')?.focus({ preventScroll: true })
  }

  async #loadNextSection() {
    const { book } = this.reader
    for (let i = this.sectionIndex + 1; i < book.sections.length; i++) {
      const s = book.sections[i]
      if (s.linear === 'no' || !s.createDocument) continue
      const doc = await s.createDocument()
      const words = collectWords(doc, null)
      if (words.length) {
        this.sectionIndex = i
        this.words = words
        this.index = 0
        return true
      }
    }
    return false
  }

  play() {
    if (!this.words.length) return
    this.playing = true
    this.el.classList.add('playing')
    this.#schedule()
  }

  pause() {
    this.playing = false
    this.el.classList.remove('playing')
    clearTimeout(this.timer)
    this.#renderContext()
  }

  toggle() { this.playing ? this.pause() : this.play() }

  #schedule() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.#tick(), delayFor(this.words[this.index], settings.wpm))
  }

  async #tick() {
    if (!this.playing) return
    if (this.index < this.words.length - 1) this.index++
    else if (!(await this.#loadNextSection())) { this.pause(); return }
    this.#render()
    this.#schedule()
  }

  step(n) {
    this.pause()
    this.index = Math.max(0, Math.min(this.words.length - 1, this.index + n))
    this.#render()
  }

  #setWpm(wpm) {
    const v = Math.max(100, Math.min(1000, Math.round(wpm / 25) * 25))
    if (v !== settings.wpm) update({ wpm: v })
    $('#rsvp-wpm', this.el).textContent = `${v} wpm`
    $$('.rsvp-preset', this.el).forEach(b => b.classList.toggle('active', Number(b.dataset.wpm) === v))
  }

  #render() {
    const entry = this.words[this.index]
    const w = entry?.w ?? ''
    const p = w ? pivotOf(w) : 0
    this.left.textContent = w.slice(0, p)
    this.pivot.textContent = w[p] ?? ''
    this.right.textContent = w.slice(p + 1)
    const pct = this.words.length > 1 ? (this.index / (this.words.length - 1)) * 100 : 0
    this.fill.style.width = `${pct}%`
    const remaining = this.words.length - this.index
    const mins = remaining / settings.wpm
    this.label.textContent = `${Math.max(1, Math.round(mins))} min left in chapter`
    if (!this.playing) this.#renderContext()
  }

  /** While paused, show the surrounding sentence for orientation. */
  #renderContext() {
    const from = Math.max(0, this.index - 12)
    const to = Math.min(this.words.length, this.index + 13)
    this.context.replaceChildren(...this.words.slice(from, to).flatMap((x, i) => {
      const span = document.createElement(from + i === this.index ? 'mark' : 'span')
      span.textContent = x.w
      return [span, ' ']
    }))
  }

  #wire() {
    const on = (id, fn) => $(id, this.el).addEventListener('click', fn)
    on('#rsvp-close', () => this.close())
    on('#rsvp-play', () => this.toggle())
    on('#rsvp-back', () => this.step(-10))
    on('#rsvp-prev', () => this.step(-1))
    on('#rsvp-next', () => this.step(1))
    on('#rsvp-fwd', () => this.step(10))
    on('#rsvp-slower', () => this.#setWpm(settings.wpm - 25))
    on('#rsvp-faster', () => this.#setWpm(settings.wpm + 25))
    $$('.rsvp-preset', this.el).forEach(b => b.addEventListener('click', () => this.#setWpm(Number(b.dataset.wpm))))
    $('.rsvp-stage', this.el).addEventListener('click', () => this.toggle())
  }

  handleKey(e) {
    switch (e.key) {
      case ' ': case 'k': e.preventDefault(); this.toggle(); return true
      case 'Escape': this.close(); return true
      case 'ArrowLeft': this.step(e.shiftKey ? -10 : -1); return true
      case 'ArrowRight': this.step(e.shiftKey ? 10 : 1); return true
      case 'ArrowUp': this.#setWpm(settings.wpm + 25); return true
      case 'ArrowDown': this.#setWpm(settings.wpm - 25); return true
    }
    return false
  }
}
