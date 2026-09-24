/* Read aloud with the device's own speech voices (Web Speech API).
 * foliate-js turns the page into SSML with a <mark> per sentence; we speak one
 * sentence per utterance (reliable on iOS and Android), highlighting as we go
 * and turning pages/sections automatically. */

import { settings, update } from '../settings.js'
import { $, html, toast } from '../ui/dom.js'
import { rankVoices, voiceLabel } from './voices.js'

/** Split an SSML string into [{ mark, text }] chunks. */
export function ssmlChunks(ssml) {
  const doc = new DOMParser().parseFromString(ssml, 'application/xml')
  const chunks = []
  let current = { mark: null, text: '' }
  const walk = node => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) current.text += child.nodeValue
      else if (child.nodeType === 1) {
        if (child.localName === 'mark') {
          if (current.text.trim()) chunks.push(current)
          current = { mark: child.getAttribute('name'), text: '' }
        } else if (child.localName === 'break') current.text += ' '
        else walk(child)
      }
    }
  }
  walk(doc.documentElement)
  if (current.text.trim()) chunks.push(current)
  return chunks.map(c => ({ ...c, text: c.text.replace(/\s+/g, ' ').trim() }))
}

export class ReadAloud {
  active = false
  playing = false
  chunks = []
  index = 0
  #token = 0

  constructor(reader) {
    this.reader = reader
    this.bar = $('#tts-bar')
    this.supported = 'speechSynthesis' in globalThis && 'SpeechSynthesisUtterance' in globalThis
    $('#tts-play').addEventListener('click', () => this.toggle())
    $('#tts-prev').addEventListener('click', () => this.skip(-1))
    $('#tts-next').addEventListener('click', () => this.skip(1))
    $('#tts-close').addEventListener('click', () => this.stop())
    $('#tts-rate').addEventListener('click', () => this.#cycleRate())
    $('#tts-voice').addEventListener('click', () => this.openVoices())
    this.#renderRate()
    reader.addEventListener('close', () => this.stop())
  }

  get lang() { return (this.reader.book?.metadata?.language ?? 'en').toString().slice(0, 2).toLowerCase() }

  /** The chosen voice if it suits the book's language, else the best one available. */
  voice() {
    const ranked = rankVoices(speechSynthesis.getVoices(), this.lang)
    return ranked.find(v => v.name === settings.voice) ?? ranked[0] ?? null
  }

  /* ---- voice picker (sheet opened from the read-aloud bar) ---- */

  voiceSheet = null // set by main.js

  async openVoices() {
    if (!this.supported || !this.voiceSheet) return
    let voices = speechSynthesis.getVoices()
    if (!voices.length) { // Safari/Chrome load the list asynchronously
      await new Promise(r => { speechSynthesis.addEventListener('voiceschanged', r, { once: true }); setTimeout(r, 1500) })
      voices = speechSynthesis.getVoices()
    }
    const ranked = rankVoices(voices, this.lang)
    const current = this.voice()?.name
    const apple = /iPhone|iPad|Macintosh/.test(navigator.userAgent)
    const hasGood = ranked.some(v => /premium|enhanced/i.test(v.name))
    $('#voice-body').innerHTML = String(html`
      ${ranked.length ? html`<ul class="voice-list" role="radiogroup" aria-label="Voices">
        ${ranked.map(v => {
          const l = voiceLabel(v)
          return html`<li><button role="radio" aria-checked="${String(v.name === current)}" data-voice="${v.name}">
            <span class="voice-check" aria-hidden="true">✓</span>
            <span class="voice-main"><span class="voice-name">${l.name}</span><span class="voice-sub">${l.region}</span></span>
            ${l.quality !== 'standard' ? html`<span class="voice-badge">${l.quality === 'premium' ? 'Premium' : 'Enhanced'}</span>` : ''}
          </button></li>`
        })}
      </ul>` : html`<p class="voice-tip">This device has no voices for this book’s language.</p>`}
      ${apple ? html`<p class="voice-tip">${hasGood ? 'Want more voices?' : 'For much more natural voices,'} on iPhone or iPad open <strong>Settings → Accessibility → Spoken Content → Voices</strong>, choose <strong>English</strong> (or the book’s language), and download one marked <strong>Enhanced</strong> or <strong>Premium</strong>, such as Ava, Zoe or Evan. Then reopen Read Free and pick it here.</p>`
        : html`<p class="voice-tip">Voices come from your device. You can add more in your system’s speech or accessibility settings.</p>`}`)
    $('#voice-body').onclick = e => {
      const btn = e.target.closest('[data-voice]')
      if (!btn) return
      update({ voice: btn.dataset.voice })
      for (const b of $('#voice-body').querySelectorAll('[data-voice]')) b.setAttribute('aria-checked', String(b === btn))
      if (this.playing) { this.pause(); this.play() } // continue the book in the new voice
      else this.#sample()
    }
    this.voiceSheet.open()
  }

  #sample() {
    const u = new SpeechSynthesisUtterance(this.chunks[this.index]?.text?.slice(0, 160) || 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.')
    const voice = this.voice()
    if (voice) { u.voice = voice; u.lang = voice.lang }
    u.rate = settings.ttsRate ?? 1
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  }

  async start() {
    if (!this.supported) { toast('Read aloud isn’t supported in this browser'); return }
    const { view, location } = this.reader
    if (!view) return
    this.active = true
    this.bar.hidden = false
    this.reader.root.classList.add('tts-on')
    await view.initTTS('sentence', range => this.#highlight(range))
    const from = location?.range?.cloneRange()
    from?.collapse(true)
    const ssml = from ? view.tts.from(from) : view.tts.start()
    this.#load(ssml)
    this.play()
  }

  #load(ssml) {
    this.chunks = ssml ? ssmlChunks(ssml) : []
    this.index = 0
  }

  play() {
    this.playing = true
    this.bar.classList.add('playing')
    this.#speakCurrent()
  }

  pause() {
    this.playing = false
    this.bar.classList.remove('playing')
    this.#token++
    speechSynthesis.cancel()
  }

  toggle() { this.playing ? this.pause() : this.play() }

  stop() {
    if (!this.active) return
    this.pause()
    this.active = false
    this.bar.hidden = true
    this.reader.root.classList.remove('tts-on')
    this.#clearHighlight()
  }

  skip(dir) {
    const was = this.playing
    this.pause()
    const target = this.index + dir
    if (target >= 0 && target < this.chunks.length) this.index = target
    else if (dir > 0) { this.#advance().then(() => was && this.play()); return }
    else {
      const ssml = this.reader.view.tts.prev(true)
      if (ssml) { this.chunks = ssmlChunks(ssml); this.index = Math.max(0, this.chunks.length - 1) }
    }
    const chunk = this.chunks[this.index]
    if (chunk?.mark) this.reader.view.tts.setMark(chunk.mark)
    if (was) this.play()
  }

  async #advance() {
    const { view } = this.reader
    const ssml = view.tts.next()
    if (ssml) { this.#load(ssml); return true }
    // End of section: move on to the next one and continue there.
    await view.renderer.nextSection?.()
    await new Promise(r => setTimeout(r, 200))
    await view.initTTS('sentence', range => this.#highlight(range))
    const next = view.tts.start()
    if (!next) { this.stop(); return false }
    this.#load(next)
    return true
  }

  #speakCurrent() {
    const token = ++this.#token
    const chunk = this.chunks[this.index]
    if (!chunk) {
      this.#advance().then(ok => { if (ok && this.playing && token === this.#token) this.#speakCurrent() })
      return
    }
    if (chunk.mark) this.reader.view.tts.setMark(chunk.mark)
    const u = new SpeechSynthesisUtterance(chunk.text)
    const voice = this.voice()
    if (voice) { u.voice = voice; u.lang = voice.lang }
    u.rate = settings.ttsRate ?? 1
    u.onend = () => {
      if (token !== this.#token || !this.playing) return
      this.index++
      this.#speakCurrent()
    }
    u.onerror = e => {
      if (token !== this.#token || e.error === 'interrupted' || e.error === 'canceled') return
      console.warn('TTS error', e.error)
      this.pause()
      toast('Speech stopped unexpectedly')
    }
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  }

  #highlight(range) {
    const { view } = this.reader
    view.renderer.scrollToAnchor?.(range, true)
    const win = range.startContainer.ownerDocument?.defaultView
    if (win?.CSS?.highlights && win.Highlight) {
      const doc = win.document
      if (!doc.getElementById('tts-style')) {
        const style = doc.createElement('style')
        style.id = 'tts-style'
        style.textContent = '::highlight(tts) { background-color: rgba(157, 143, 212, .38); }'
        doc.head.append(style)
      }
      win.CSS.highlights.set('tts', new win.Highlight(range))
      this.lastWin = win
    }
  }

  #clearHighlight() {
    try { this.lastWin?.CSS?.highlights?.delete('tts') } catch { /* doc gone */ }
  }

  #cycleRate() {
    const rates = [0.8, 1, 1.2, 1.5, 1.8]
    const i = rates.indexOf(settings.ttsRate ?? 1)
    update({ ttsRate: rates[(i + 1) % rates.length] })
    this.#renderRate()
    if (this.playing) { this.pause(); this.play() }
  }

  #renderRate() {
    $('#tts-rate').textContent = `${settings.ttsRate ?? 1}×`
  }
}
