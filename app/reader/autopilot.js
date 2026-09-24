/* Autopilot: hands-free reading that keeps your pace.
 *
 * Pages layout: a progress bar fills while you read each page, then the page
 * turns. Behind? Press and hold anywhere: the page waits while you finish,
 * and turns the moment you let go. Ahead? Tap the right side to turn early.
 * Both teach Autopilot your real pace, so it adapts.
 *
 * Scroll layout: the text glides at your reading speed. Hold to pause, drag
 * to nudge; nudges and holds adapt the speed too.
 *
 * Speed is in words per minute, measured from the text actually on screen,
 * so it stays right when you change font size, margins or layout.
 */

import { settings, update, onChange } from '../settings.js'
import { $ } from '../ui/dom.js'

const HOLD_MS = 280
const MIN_PAGE_MS = 1800
const LEARN_RATE = 0.3        // how strongly one page moves the pace
const MAX_STEP = 0.2          // at most ±20% per page
const MIN_WPM = 60, MAX_WPM = 900

const countWords = text => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length
const round5 = n => Math.round(n / 5) * 5
const clampWpm = (n, step = 1) => Math.max(MIN_WPM, Math.min(MAX_WPM, Math.round(n / step) * step))

export class Autopilot extends EventTarget {
  active = false
  atChapterEnd = false
  paused = false
  held = false
  elapsed = 0          // ms of reading time on this page (paused time excluded)
  duration = 0         // planned ms for this page
  words = 0
  #frame = 0
  #last = 0
  #selfFlip = false
  #lastFraction = 0
  #lastPageKey = ''
  #holdTimer = null
  #holdStart = 0
  #pointer = null      // { x, y, moved, t }
  #carry = 0
  #pxPerMs = 0
  #fadeTimer = null
  #docs = new Set()
  #quietUntil = 0     // ignore page moves caused by layout changes
  #settleUntil = 0    // let a newly loaded chapter lay out before scrolling it

  constructor(reader) {
    super()
    this.reader = reader
    this.ui = $('#auto-ui')
    this.bar = $('#auto-fill', this.ui)
    this.pill = $('#auto-pill', this.ui)
    this.status = $('#auto-status', this.ui)
    this.wpmEl = $('#auto-wpm', this.ui)

    $('#auto-toggle', this.ui).addEventListener('click', () => this.togglePause())
    $('#auto-slower', this.ui).addEventListener('click', () => this.nudgeSpeed(-5))
    $('#auto-faster', this.ui).addEventListener('click', () => this.nudgeSpeed(5))
    $('#auto-stop', this.ui).addEventListener('click', () => this.stop())
    this.#repeatOnHold($('#auto-slower', this.ui), -5)
    this.#repeatOnHold($('#auto-faster', this.ui), 5)

    reader.addEventListener('relocate', e => this.#onRelocate(e.detail))
    reader.addEventListener('section-load', e => this.#attachDoc(e.detail.doc))
    reader.addEventListener('close', () => this.stop())
    reader.addEventListener('layout', () => { if (this.active) this.#resetPage() })
    reader.addEventListener('tap', e => {
      if (!this.active) return
      e.preventDefault()
      this.#onTap(e.detail?.x)
    })
    // Taps on the stage outside the book iframe (margins)
    reader.stage.addEventListener('pointerdown', e => this.#pointerDown(e, e.clientX, e.clientY))
    reader.stage.addEventListener('pointerup', e => this.#pointerUp(e))
    reader.stage.addEventListener('pointercancel', () => this.#cancelHold())
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.active) this.pause() })
    onChange((_, patch) => { if (!('autoWpm' in patch)) this.#quietUntil = performance.now() + 1500 })
  }

  get paginated() { return settings.flow !== 'scrolled' }
  get wpm() { return settings.autoWpm ?? 230 }

  /* ---------------- lifecycle ---------------- */

  start() {
    if (!this.reader.view) return
    this.active = true
    this.paused = false
    this.held = false
    this.reader.root.classList.add('autopilot')
    this.ui.hidden = false
    this.ui.dataset.mode = this.paginated ? 'pages' : 'scroll'
    for (const doc of this.reader.view.renderer.getContents().map(c => c.doc)) this.#attachDoc(doc)
    this.#setNoSelect(true)
    this.reader.hideChrome()
    this.#lastPageKey = (this.reader.location?.range?.toString() ?? '').slice(0, 80)
    this.#lastFraction = this.reader.location?.fraction ?? 0
    this.#resetPage()
    this.#render()
    this.#showPill()
    this.#loop()
    this.dispatchEvent(new Event('start'))
  }

  stop() {
    if (!this.active) return
    this.active = false
    this.atChapterEnd = false
    cancelAnimationFrame(this.#frame)
    this.#setNoSelect(false)
    this.reader.root.classList.remove('autopilot', 'auto-held', 'auto-pill-on')
    this.ui.hidden = true
    this.dispatchEvent(new Event('stop'))
  }

  toggle() { this.active ? this.stop() : this.start() }

  pause() {
    if (!this.active || this.paused) return
    this.paused = true
    this.#render()
    this.#showPill(true)
  }

  resume() {
    if (!this.active) return
    if (this.atChapterEnd) {
      this.atChapterEnd = false
      this.elapsed = 0
      this.#flip('auto')
    }
    this.paused = false
    this.#last = performance.now()
    this.#render()
    this.#showPill()
  }

  togglePause() { this.paused ? this.resume() : this.pause() }

  nudgeSpeed(delta) {
    update({ autoWpm: clampWpm(this.wpm + delta, 5) })
    this.#rescaleDuration()
    this.#render()
    this.#showPill()
  }

  /* ---------------- page timing ---------------- */

  #resetPage() {
    const text = this.reader.location?.range?.toString() ?? ''
    this.words = countWords(text)
    this.elapsed = 0
    this.#last = performance.now()
    this.#rescaleDuration()
    if (!this.paginated) this.#computeScrollSpeed()
  }

  #rescaleDuration() {
    const fraction = this.duration ? this.elapsed / this.duration : 0
    this.duration = Math.max(MIN_PAGE_MS, (this.words / this.wpm) * 60000)
    this.elapsed = fraction * this.duration
    if (!this.paginated) this.#computeScrollSpeed()
  }

  #computeScrollSpeed() {
    const size = this.reader.view?.renderer?.size || innerHeight
    const wordsPerPx = this.words / Math.max(1, size)
    this.#pxPerMs = wordsPerPx > 0 ? (this.wpm / 60000) / wordsPerPx : size / 20000
  }

  #loop = () => {
    if (!this.active) return
    const now = performance.now()
    const dt = Math.min(100, now - this.#last)
    this.#last = now
    if (!this.paused && !this.held && !this.#pointer && !this.#blocked()) {
      if (this.paginated) {
        this.elapsed += dt
        if (this.elapsed >= this.duration) this.#flip('auto')
      } else {
        this.#scrollStep(dt)
      }
    }
    this.#renderBar()
    this.#frame = requestAnimationFrame(this.#loop)
  }

  /** Sheets, dialogs or speed reading on top: don't advance underneath. */
  #blocked() {
    return document.querySelector('.sheet.open, .rsvp.open') !== null
  }

  async #flip(reason) {
    if (this.#selfFlip) return
    this.#selfFlip = true
    this.elapsed = this.duration
    const before = this.reader.location?.fraction ?? 0
    try {
      await this.reader.next()
    } finally {
      this.#settleUntil = performance.now() + 600
      setTimeout(() => { this.#selfFlip = false }, 50)
    }
    if (reason === 'auto' && (this.reader.location?.fraction ?? 0) <= before && before > 0.995) {
      this.stop()
      this.dispatchEvent(new CustomEvent('end'))
    }
  }

  #scrollStep(dt) {
    const r = this.reader.view?.renderer
    if (!r?.scrollByPixels || this.#selfFlip || performance.now() < this.#settleUntil) return
    if (r.viewSize - r.end < 2) {
      // End of the chapter: stop and let the reader finish the last lines.
      // Tapping (or resuming) moves on to the next chapter.
      this.atChapterEnd = true
      this.pause()
      return
    }
    this.#carry += this.#pxPerMs * dt
    const whole = Math.trunc(this.#carry)
    if (whole) { r.scrollByPixels(whole); this.#carry -= whole }
  }

  #onRelocate(detail) {
    if (!this.active) return
    const fraction = detail.fraction ?? 0
    const pageKey = (detail.range?.toString() ?? '').slice(0, 80)
    const pageChanged = pageKey !== this.#lastPageKey
    this.#lastPageKey = pageKey
    if (this.paginated && !pageChanged) return // layout reflow (fonts, resize): same page, keep the timer
    if (this.paginated && !this.#selfFlip && performance.now() > this.#quietUntil && fraction > this.#lastFraction && this.elapsed > 0 && this.elapsed < this.duration) {
      // The reader turned forward themselves (swipe, keys) before the bar ran out: they're ahead.
      this.#learn(this.elapsed, +1)
    }
    this.#lastFraction = fraction
    if (this.paginated || !this.words) this.#resetPage()
    else {
      const text = detail.range?.toString() ?? ''
      const w = countWords(text)
      if (w) { this.words = w; this.#computeScrollSpeed() }
    }
  }

  /** Blend the pace implied by how long this page actually took into the speed. */
  // direction: -1 = the reader needed more time (only ever slow down),
  //            +1 = the reader was ahead (only ever speed up)
  #learn(actualMs, direction) {
    if (settings.autoCalibrate === false || this.words < 25 || actualMs < this.duration * 0.25) return
    const implied = (this.words / actualMs) * 60000
    const current = this.wpm
    let next = current * (1 - LEARN_RATE) + implied * LEARN_RATE
    next = Math.max(current * (1 - MAX_STEP), Math.min(current * (1 + MAX_STEP), next))
    next = direction < 0 ? Math.min(next, current) : Math.max(next, current)
    next = clampWpm(next)
    if (next === current) return
    update({ autoWpm: next })
    this.#flash(next > current ? `Speeding up · ${next} wpm` : `Slowing down · ${next} wpm`)
  }

  /* ---------------- input: tap zones, hold, drag ---------------- */

  #attachDoc(doc) {
    if (!doc || this.#docs.has(doc)) return
    this.#docs.add(doc)
    const frameLeft = () => doc.defaultView?.frameElement?.getBoundingClientRect() ?? { left: 0, top: 0 }
    doc.addEventListener('pointerdown', e => {
      const f = frameLeft()
      this.#pointerDown(e, f.left + e.clientX, f.top + e.clientY)
    })
    doc.addEventListener('pointermove', e => this.#pointerMove(e))
    doc.addEventListener('pointerup', e => this.#pointerUp(e))
    doc.addEventListener('pointercancel', () => this.#cancelHold())
    if (this.active) this.#setNoSelect(true)
  }

  #pointerDown(e, x, y) {
    if (!this.active || e.button > 0) return
    this.#pointer = { x, y, sy: e.screenY, moved: false, t: performance.now() }
    clearTimeout(this.#holdTimer)
    this.#holdTimer = setTimeout(() => {
      if (!this.#pointer || this.#pointer.moved) return
      this.held = true
      this.#holdStart = performance.now()
      this.reader.root.classList.add('auto-held')
      this.#render()
    }, HOLD_MS)
  }

  #pointerMove(e) {
    const p = this.#pointer
    if (!p) return
    if (Math.abs(e.screenY - p.sy) > 12) p.moved = true
  }

  #pointerUp(e) {
    const p = this.#pointer
    clearTimeout(this.#holdTimer)
    this.#pointer = null
    if (!this.active || !p) return
    if (this.held) {
      this.held = false
      this.reader.root.classList.remove('auto-held')
      this.reader.suppressTap = Date.now() // swallow the click that follows a long press
      const heldMs = performance.now() - this.#holdStart
      if (this.paginated) {
        // "I needed longer": learn from the true time, then turn the page now.
        this.#learn(this.elapsed + heldMs, -1)
        this.#flip('hold')
      } else {
        if (heldMs > 1000 && settings.autoCalibrate !== false) this.nudgeSpeed(-round5(this.wpm * 0.03) || -5)
        this.#last = performance.now()
      }
      this.#render()
      return
    }
    if (!this.paginated && p.moved) {
      // Dragging in scroll mode: back = slow down a touch, forward = speed up a touch.
      const dy = e.screenY - p.sy
      if (settings.autoCalibrate !== false && Math.abs(dy) > 60) this.nudgeSpeed(dy > 0 ? -5 : 5)
      this.#last = performance.now()
    }
  }

  #cancelHold() {
    clearTimeout(this.#holdTimer)
    this.#pointer = null
    if (this.held) {
      this.held = false
      this.reader.root.classList.remove('auto-held')
      this.#render()
    }
  }

  #onTap(x) {
    const stage = this.reader.stage.getBoundingClientRect()
    const rel = x == null ? 0.5 : (x - stage.left) / (stage.width || innerWidth)
    if (this.paginated && rel > 0.72) {
      this.#learn(this.elapsed, +1)   // ahead of the bar: speed up
      this.#flip('early')
    } else if (this.paginated && rel < 0.28) {
      this.#selfFlip = true
      Promise.resolve(this.reader.prev()).finally(() => setTimeout(() => { this.#selfFlip = false }, 50))
    } else {
      this.togglePause()
    }
  }

  handleKey(e) {
    if (!this.active) return false
    switch (e.key) {
      case ' ': case 'k': this.togglePause(); return true
      case 'Escape': this.stop(); return true
      case 'ArrowRight': case 'PageDown': if (this.paginated) { this.#learn(this.elapsed, +1); this.#flip('early') } else this.nudgeSpeed(5); return true
      case 'ArrowLeft': case 'PageUp': if (this.paginated) this.reader.prev(); else this.nudgeSpeed(-5); return true
      case 'ArrowUp': this.nudgeSpeed(5); return true
      case 'ArrowDown': this.nudgeSpeed(-5); return true
    }
    return false
  }

  /* ---------------- UI ---------------- */

  #setNoSelect(on) {
    for (const doc of this.#docs) {
      if (!doc?.documentElement) continue
      let style = doc.getElementById('autopilot-style')
      if (on && !style) {
        style = doc.createElement('style')
        style.id = 'autopilot-style'
        style.textContent = 'html { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }'
        doc.head?.append(style)
      } else if (!on) style?.remove()
    }
  }

  #render() {
    this.wpmEl.textContent = `${this.wpm} wpm`
    this.ui.classList.toggle('paused', this.paused)
    this.ui.classList.toggle('held', this.held)
    $('#auto-toggle', this.ui).setAttribute('aria-label', this.paused ? 'Resume autopilot' : 'Pause autopilot')
    this.status.textContent = this.held
      ? (this.paginated ? 'Holding · let go to turn' : 'Holding')
      : this.atChapterEnd ? 'End of chapter · tap to continue'
      : this.paused ? 'Paused · tap the middle to continue' : ''
  }

  #renderBar() {
    if (!this.paginated) return
    const pct = this.duration ? Math.min(1, this.elapsed / this.duration) : 0
    this.bar.style.transform = `scaleX(${pct})`
  }

  #showPill(sticky = false) {
    this.pill.classList.add('visible')
    this.reader.root.classList.add('auto-pill-on')
    clearTimeout(this.#fadeTimer)
    if (!sticky) this.#fadeTimer = setTimeout(() => {
      if (this.paused || this.held) return
      this.pill.classList.remove('visible')
      this.reader.root.classList.remove('auto-pill-on')
    }, 2600)
  }

  #flash(message) {
    this.status.textContent = message
    this.#showPill()
    setTimeout(() => { if (this.status.textContent === message) this.#render() }, 2200)
  }

  #repeatOnHold(button, delta) {
    let t
    const stop = () => clearInterval(t)
    button.addEventListener('pointerdown', () => { t = setTimeout(() => { t = setInterval(() => this.nudgeSpeed(delta), 90) }, 450) })
    button.addEventListener('pointerup', stop)
    button.addEventListener('pointerleave', stop)
    button.addEventListener('pointercancel', stop)
  }
}
