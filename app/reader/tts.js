/* Read aloud with the device's own speech voices (Web Speech API).
 * foliate-js turns the page into SSML with a <mark> per sentence; we speak one
 * sentence per utterance (reliable on iOS and Android), highlighting as we go
 * and turning pages/sections automatically. */

import { settings, update } from '../settings.js'
import { $, toast } from '../ui/dom.js'

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
    this.#renderRate()
    reader.addEventListener('close', () => this.stop())
  }

  voice() {
    const lang = (this.reader.book?.metadata?.language ?? 'en').toString().slice(0, 2).toLowerCase()
    const voices = speechSynthesis.getVoices()
    return voices.find(v => v.name === settings.voice)
      ?? voices.find(v => v.lang?.toLowerCase().startsWith(lang) && v.localService && v.default)
      ?? voices.find(v => v.lang?.toLowerCase().startsWith(lang) && v.localService)
      ?? voices.find(v => v.lang?.toLowerCase().startsWith(lang))
      ?? null
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
