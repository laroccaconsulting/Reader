/* Read-along: human-narrated LibriVox audio that plays in the reader, opens the
 * right chapter, and turns pages to follow the narration. Audio keeps playing
 * with the screen locked (lock-screen controls via Media Session) and chapters
 * can be saved for offline listening. */

import * as db from '../db.js'
import { settings, update } from '../settings.js'
import { $, toast, formatBytes } from '../ui/dom.js'
import { coverUrl } from '../ui/covers.js'
import { findRecording } from './librivox.js'
import { mapTracks } from './chapters.js'
import { syncPoints, timeToFraction, fractionToTime, leadFromAnchor, DEFAULT_LEAD } from './sync.js'

/* Saved narration lives in the 'files' store next to book files; the list of a
 * book's saved chapters is kept in kv `audiofiles|<bookId>` so removal is cheap. */
export const audioKey = url => `audio|${url}`
const fmt = s => {
  if (!isFinite(s)) return '0:00'
  s = Math.max(0, Math.floor(s))
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

export class ReadAlong extends EventTarget {
  recording = null
  tracks = []
  index = -1
  active = false
  #objectUrl = null
  #following = true
  #lastFollow = 0
  #navigating = false
  #navTarget = null
  #sync = { lead: DEFAULT_LEAD, anchors: {} } // per book: narrator's intro length and tapped marks per track
  #aligning = false
  #docIndex = new WeakMap()
  #lastSave = 0
  #lookupToken = 0

  constructor(reader) {
    super()
    this.reader = reader
    this.audio = $('#audio-el')
    this.bar = $('#audio-bar')
    this.btn = $('#audio-btn')

    this.btn.addEventListener('click', () => this.active ? this.stop() : this.start())
    $('#audio-play').addEventListener('click', () => this.toggle())
    $('#audio-back').addEventListener('click', () => this.seekBy(-15))
    $('#audio-fwd').addEventListener('click', () => this.seekBy(30))
    $('#audio-prev').addEventListener('click', () => this.prevTrack())
    $('#audio-next').addEventListener('click', () => this.playTrack(this.index + 1))
    $('#audio-rate').addEventListener('click', () => this.#cycleRate())
    $('#audio-sync').addEventListener('click', () => { this.#following = true; this.#follow(true) })
    $('#audio-save').addEventListener('click', () => this.saveOffline())
    $('#audio-close').addEventListener('click', () => this.stop())
    $('#audio-align').addEventListener('click', () => this.#setAligning(!this.#aligning))
    $('#audio-align-reset').addEventListener('click', () => this.#resetSync())
    // While aligning, a tap on the text marks where the narrator is (and doesn't turn the page)
    reader.addEventListener('section-load', e => {
      const { doc, index } = e.detail
      this.#docIndex.set(doc, index)
      doc.addEventListener('click', ev => {
        if (!this.#aligning) return
        ev.preventDefault(); ev.stopPropagation()
        this.#markAt(doc, ev.clientX, ev.clientY)
      }, true)
    })
    reader.addEventListener('tap', e => { if (this.#aligning) e.preventDefault() })
    $('#audio-seek').addEventListener('input', e => {
      if (this.audio.duration) this.audio.currentTime = Number(e.target.value) * this.audio.duration
    })

    this.audio.addEventListener('timeupdate', () => this.#onTime())
    this.audio.addEventListener('play', () => this.#renderState())
    this.audio.addEventListener('pause', () => { this.#renderState(); this.#savePosition(true) })
    this.audio.addEventListener('ended', () => this.playTrack(this.index + 1))
    this.audio.addEventListener('error', () => {
      if (this.active) toast(navigator.onLine === false ? 'This chapter isn’t saved for offline listening' : 'Couldn’t load the narration')
    })

    reader.addEventListener('open', () => this.lookup())
    reader.addEventListener('close', () => { this.stop(); this.btn.hidden = true; this.recording = null; this.tracks = []; this.index = -1; this.#lookupToken++ })
    // Turning away from the narration (reading ahead, looking something up) stops
    // the page from following until "Follow the narrator" or the next chapter.
    reader.addEventListener('relocate', () => {
      if (this.active && !this.#isOwnMove() && this.#following && !this.#onNarratedPage()) {
        this.#following = false
        this.#renderState()
      }
    })
    this.#renderRate()
  }

  /* ---------------- discovery ---------------- */

  async lookup() {
    const token = ++this.#lookupToken
    const rec = this.reader.record
    this.btn.hidden = true
    this.recording = null
    if (!rec || rec.source?.type === 'local') return
    try {
      const recording = await findRecording(rec)
      if (token !== this.#lookupToken || !recording) return
      this.recording = recording
      this.tracks = mapTracks(recording.tracks, this.reader.book?.toc ?? [])
      this.#sync = { lead: DEFAULT_LEAD, anchors: {}, ...(await db.kvGet(this.#syncKey(), null)) }
      this.btn.hidden = false
      this.btn.title = `Listen: LibriVox recording (${fmt(recording.totalDuration)})`
    } catch (e) {
      console.warn('Read-along lookup failed', e)
    }
  }

  /* ---------------- playback ---------------- */

  async start() {
    if (!this.recording) return
    this.dispatchEvent(new Event('start'))
    this.active = true
    this.bar.hidden = false
    this.reader.root.classList.add('audio-on')
    const saved = await db.kvGet(`audiopos|${this.reader.record.id}`, null)
    const here = this.#trackForLocation()
    if (saved && saved.track === here) await this.playTrack(here, saved.time)
    else await this.playTrack(here, this.#estimateTime(here), { navigate: false })
    this.reader.hideChrome()
  }

  stop() {
    if (!this.active) return
    this.#setAligning(false)
    this.#savePosition(true)
    this.active = false
    this.audio.pause()
    this.bar.hidden = true
    this.reader.root.classList.remove('audio-on')
    if (this.#objectUrl) { URL.revokeObjectURL(this.#objectUrl); this.#objectUrl = null }
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'
  }

  toggle() { this.audio.paused ? this.audio.play().catch(() => {}) : this.audio.pause() }

  seekBy(s) { this.audio.currentTime = Math.max(0, Math.min((this.audio.duration || 0) - 1, this.audio.currentTime + s)) }

  prevTrack() {
    if (this.audio.currentTime > 5) this.audio.currentTime = 0
    else this.playTrack(this.index - 1)
  }

  /** Roughly where in track i the narrator reads the current page (from the track's listed length). */
  #estimateTime(i) {
    const points = this.#points(i, this.tracks[i]?.duration), page = this.#pageBounds()
    if (!points || !page) return 0
    const t = fractionToTime(points, page.from)
    return t > points[0].t + 2 ? Math.max(0, t - 3) : 0
  }

  /** The track whose chapter contains (or most recently precedes) the current page. */
  #trackForLocation() {
    const current = this.reader.location?.section?.current ?? 0
    let best = 0
    this.tracks.forEach((t, i) => {
      const idx = this.#sectionOf(t)
      if (idx != null && idx <= current) best = i
    })
    return best
  }

  #sectionOf(track) {
    if (!track?.href) return null
    try { return this.reader.view.resolveNavigation(track.href)?.index ?? null } catch { return null }
  }

  async playTrack(i, startAt = 0, { navigate = true } = {}) {
    if (i < 0 || i >= this.tracks.length) {
      if (i >= this.tracks.length) { this.stop(); toast('The end of the recording') }
      return
    }
    this.index = i
    const track = this.tracks[i]
    const stored = await db.get('files', audioKey(track.url)).catch(() => null)
    if (this.#objectUrl) { URL.revokeObjectURL(this.#objectUrl); this.#objectUrl = null }
    if (stored?.blob) this.#objectUrl = URL.createObjectURL(stored.blob)
    this.audio.src = this.#objectUrl ?? track.url
    this.audio.playbackRate = settings.audioRate ?? 1
    this.audio.preservesPitch = true
    if (startAt) this.audio.addEventListener('loadedmetadata', () => { this.audio.currentTime = startAt }, { once: true })
    if (navigate && track.href) await this.#goTo(track.href)
    if (navigate) this.#following = true
    this.#mediaSession(track)
    this.#renderState()
    try { await this.audio.play() } catch { this.#renderState() } // iOS may need a tap; the bar shows ▶
  }

  /** Did this relocation come from our own navigation? A page turn by the reader
   *  right after one of ours lands somewhere other than where we were going. */
  #isOwnMove() {
    if (!this.#navigating) return false
    if (this.#navTarget == null) return true
    const page = this.#pageBounds()
    return !page || (this.#navTarget >= page.from - 0.003 && this.#navTarget <= page.to + 0.003)
  }

  async #goTo(target) {
    this.#navigating = true
    this.#navTarget = null
    try { await this.reader.goTo(target) } finally { setTimeout(() => { this.#navigating = false }, 250) }
  }

  /* ---------------- follow along ---------------- */

  #span(i) {
    const fractions = this.reader.view?.getSectionFractions?.() ?? []
    const start = this.#sectionOf(this.tracks[i])
    if (start == null || !fractions.length) return null
    let endSection = null
    for (let j = i + 1; j < this.tracks.length; j++) {
      const s = this.#sectionOf(this.tracks[j])
      if (s != null && s > start) { endSection = s; break }
    }
    return { from: fractions[start] ?? 0, to: endSection != null ? fractions[endSection] : (fractions[start + 1] ?? 1) }
  }

  #syncKey() { return `audiosync|${this.reader.record?.id}|${this.recording?.id}` }

  /** Time→book-fraction points for track i (see sync.js). */
  #points(i, duration = this.audio.duration) {
    const span = this.#span(i)
    if (!span || !(duration > 0) || span.to <= span.from) return null
    return syncPoints({ ...span, duration, lead: this.#sync.lead, anchors: this.#sync.anchors[i] ?? [] })
  }

  /** Where in the book (0–1) the narrator is. */
  #narratedFraction() {
    const points = this.#points(this.index)
    return points ? Math.min(0.9999, timeToFraction(points, this.audio.currentTime)) : null
  }

  /* ---------------- fine-tuning the sync ---------------- */

  #setAligning(on) {
    this.#aligning = on
    this.bar.classList.toggle('aligning', on)
    this.reader.root.classList.toggle('audio-aligning', on)
    $('#audio-align').setAttribute('aria-pressed', String(on))
    this.#renderState()
  }

  /** The reader tapped the word they're hearing: remember that spot for this track. */
  #markAt(doc, x, y) {
    const index = this.#docIndex.get(doc)
    const fractions = this.reader.view?.getSectionFractions?.() ?? []
    const pos = doc.caretPositionFromPoint?.(x, y)
    const range = pos ? doc.createRange() : doc.caretRangeFromPoint?.(x, y)
    if (pos) range.setStart(pos.offsetNode, pos.offset)
    if (index == null || !range || fractions[index] == null) return
    const before = doc.createRange()
    before.setStart(doc.body, 0)
    before.setEnd(range.startContainer, range.startOffset)
    const within = before.toString().length / Math.max(1, doc.body.textContent.length)
    const f = fractions[index] + within * ((fractions[index + 1] ?? 1) - fractions[index])
    const t = Math.max(0, this.audio.currentTime - 0.6) // people tap a moment after hearing the word
    const span = this.#span(this.index)
    if (!span || f < span.from || f > span.to) { toast('That’s outside the chapter being read'); return }
    const list = (this.#sync.anchors[this.index] ?? []).filter(a => Math.abs(a.t - t) > 4 && Math.abs(a.f - f) > 0.0005)
    list.push({ t, f })
    this.#sync.anchors[this.index] = list
    const lead = leadFromAnchor({ ...span, duration: this.audio.duration }, { t, f })
    if (lead != null) this.#sync.lead = lead
    db.kvSet(this.#syncKey(), this.#sync).catch(() => {})
    this.#setAligning(false)
    this.#following = true
    toast('Synced. Pages will follow from here.')
    this.#renderState()
    this.#follow() // already on the right page; turns only if the narrator is past it
  }

  #resetSync() {
    this.#sync = { lead: DEFAULT_LEAD, anchors: {} }
    db.kvSet(this.#syncKey(), this.#sync).catch(() => {})
    this.#setAligning(false)
    toast('Sync reset')
    this.#following = true
    this.#follow(true)
  }

  #pageBounds() {
    // foliate reports `fraction` at the end of the visible page; `location` is in
    // coarse units, so its start is at or a little before the page's first word.
    const loc = this.reader.location
    if (loc?.fraction == null) return null
    const { current, total } = loc.location ?? {}
    return { from: total ? Math.min(current / total, loc.fraction) : loc.fraction, to: loc.fraction }
  }

  #onNarratedPage() {
    const target = this.#narratedFraction(), page = this.#pageBounds()
    if (target == null || !page) return true
    const slack = 0.003
    return target >= page.from - slack && target <= page.to + slack
  }

  /** Turn to the page the narrator has reached. */
  #follow(force = false) {
    if (!this.active || (!force && !this.#following)) return
    const target = this.#narratedFraction(), page = this.#pageBounds()
    if (target == null || !page) return
    if (force || target >= page.to || target < page.from - 0.002) {
      this.#navigating = true
      this.#navTarget = target
      Promise.resolve(this.reader.goToFraction(target))
        .finally(() => setTimeout(() => { this.#navigating = false }, 400))
    }
  }

  #onTime() {
    const { currentTime: t, duration: d } = this.audio
    $('#audio-time').textContent = `${fmt(t)} / ${fmt(d)}`
    if (d && document.activeElement !== $('#audio-seek')) $('#audio-seek').value = t / d
    if (Date.now() - this.#lastFollow > 1000 || this.audio.paused) { this.#lastFollow = Date.now(); this.#follow() }
    this.#savePosition()
    if ('mediaSession' in navigator && d && navigator.mediaSession.setPositionState) {
      try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(t, d), playbackRate: this.audio.playbackRate }) } catch { /* ignore */ }
    }
  }

  #savePosition(force = false) {
    if (!this.reader.record || this.index < 0) return
    if (!force && Date.now() - this.#lastSave < 10000) return
    this.#lastSave = Date.now()
    db.kvSet(`audiopos|${this.reader.record.id}`, { track: this.index, time: this.audio.currentTime }).catch(() => {})
  }

  /* ---------------- offline ---------------- */

  async saveOffline() {
    const r = this.recording
    if (!r) return
    const missing = []
    for (const t of this.tracks) if (!(await db.get('files', audioKey(t.url)).catch(() => null))) missing.push(t)
    if (!missing.length) { toast('The whole recording is saved on this device'); return }
    const bytes = missing.reduce((n, t) => n + (t.size ?? 0), 0)
    if (!confirm(`Save ${missing.length} chapter${missing.length === 1 ? '' : 's'} of narration for offline listening (${formatBytes(bytes)})?`)) return
    db.requestPersistence()
    const bookId = this.reader.record?.id
    const saved = new Set(await db.kvGet(`audiofiles|${bookId}`, []))
    let done = 0
    for (const t of missing) {
      $('#audio-save').setAttribute('aria-label', `Saving ${done + 1} of ${missing.length}`)
      $('#audio-save').classList.add('busy')
      try {
        const res = await fetch(t.url)
        if (!res.ok) throw new Error(res.status)
        await db.put('files', { id: audioKey(t.url), blob: await res.blob() })
        saved.add(audioKey(t.url))
        await db.kvSet(`audiofiles|${bookId}`, [...saved])
        done++
      } catch (e) {
        toast(`Saving stopped: ${e.message}. Saved ${done} of ${missing.length}.`)
        break
      }
    }
    $('#audio-save').classList.remove('busy')
    $('#audio-save').setAttribute('aria-label', 'Save narration for offline')
    if (done === missing.length) toast('Narration saved for offline listening')
  }

  /* ---------------- UI ---------------- */

  #renderState() {
    const t = this.tracks[this.index]
    $('#audio-track').textContent = this.#aligning ? 'Tap the word you’re hearing'
      : t ? (t.label && t.title !== t.label ? `${t.title} · ${t.label}` : t.title) : ''
    $('#audio-align-reset').hidden = !this.#aligning || !(Object.keys(this.#sync.anchors).length || this.#sync.lead !== DEFAULT_LEAD)
    this.bar.classList.toggle('playing', !this.audio.paused)
    $('#audio-sync').hidden = this.#following
  }

  #cycleRate() {
    const rates = [0.8, 1, 1.15, 1.3, 1.5, 1.75, 2]
    const i = rates.indexOf(settings.audioRate ?? 1)
    const rate = rates[(i + 1) % rates.length]
    update({ audioRate: rate })
    this.audio.playbackRate = rate
    this.#renderRate()
  }

  #renderRate() { $('#audio-rate').textContent = `${settings.audioRate ?? 1}×` }

  #mediaSession(track) {
    if (!('mediaSession' in navigator)) return
    const rec = this.reader.record
    const art = coverUrl(rec)
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: `${rec.author}${this.recording.readers ? ` · read by ${this.recording.readers}` : ''}`,
      album: rec.title,
      artwork: art ? [{ src: art, sizes: '512x512' }] : [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    })
    const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn) } catch { /* unsupported */ } }
    set('play', () => this.audio.play())
    set('pause', () => this.audio.pause())
    set('seekbackward', () => this.seekBy(-15))
    set('seekforward', () => this.seekBy(30))
    set('previoustrack', () => this.prevTrack())
    set('nexttrack', () => this.playTrack(this.index + 1))
  }
}
