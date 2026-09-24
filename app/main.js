/* Reader — application entry point.
 * Routes (hash): #/library  #/discover  #/settings  #/read/<id>
 */

import * as db from './db.js'
import * as library from './library.js'
import { settings, update, applyTheme, onChange } from './settings.js'
import { Reader, tocHtml } from './reader/reader.js'
import { RSVP } from './reader/rsvp.js'
import { ReadAloud } from './reader/tts.js'
import { Highlights, COLORS } from './reader/highlights.js'
import { renderTypeSheet } from './ui/type-sheet.js'
import { renderSettings } from './ui/settings-screen.js'
import { Discover } from './ui/discover.js'
import { coverHtml } from './ui/covers.js'
import { $, $$, esc, html, raw, toast, Sheet, formatBytes, formatYear, formatDuration } from './ui/dom.js'
import { registerServiceWorker } from './sw-client.js'
import * as stats from './stats.js'
import * as SE from './catalog/standard-ebooks.js'
import * as PG from './catalog/gutenberg.js'
import { shareQuote } from './share/share-sheet.js'
import { parseLink, recordIdFor } from './share/quote-link.js'
import { relayConfigured } from './net.js'

const state = {
  books: [],
  filter: 'all',
  query: '',
  sort: localStorage.getItem('reader:sort') || 'recent',
  starterProgress: null,
}

const sheets = {}
let reader, rsvp, tts, highlights, discover

/* ======================================================================
   Library screen
   ====================================================================== */

const SORTS = {
  recent: { label: 'Recently read', fn: (a, b) => (b.lastOpenedAt ?? b.addedAt ?? 0) - (a.lastOpenedAt ?? a.addedAt ?? 0) },
  title: { label: 'Title', fn: (a, b) => a.title.localeCompare(b.title) },
  author: { label: 'Author', fn: (a, b) => lastName(a.author).localeCompare(lastName(b.author)) },
  added: { label: 'Recently added', fn: (a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0) },
}
const lastName = s => (s ?? '').split(/\s+/).pop()

const pct = b => Math.round((b.progress?.fraction ?? 0) * 100)
const isFinished = b => (b.progress?.fraction ?? 0) >= 0.985
const isReading = b => (b.progress?.fraction ?? 0) > 0.001 && !isFinished(b)

async function refreshLibrary() {
  state.books = await library.listBooks()
  renderLibrary()
}

function renderLibrary() {
  const q = state.query.toLowerCase()
  const filtered = state.books.filter(b => {
    if (q && !`${b.title} ${b.author} ${b.genre ?? ''}`.toLowerCase().includes(q)) return false
    switch (state.filter) {
      case 'reading': return isReading(b)
      case 'unread': return !isReading(b) && !isFinished(b)
      case 'finished': return isFinished(b)
      case 'offline': return b.downloaded
      default: return true
    }
  }).sort(SORTS[state.sort].fn)

  renderContinue()
  renderBanner()
  renderStats()

  const grid = $('#book-grid')
  grid.innerHTML = filtered.map(bookCard).join('')
  const empty = $('#library-empty')
  empty.hidden = filtered.length > 0
  if (!filtered.length) {
    empty.innerHTML = state.books.length
      ? '<strong>No matching books</strong>Try a different search or filter.'
      : `<strong>Your library is empty</strong>Find something wonderful in Discover, or import your own EPUB and TXT files.
         <div><a class="btn primary" href="#/discover">Discover books</a></div>`
  }
}

function bookCard(b) {
  const busy = library.isDownloading(b.id)
  const badge = busy
    ? '<span class="cover-badge busy" title="Downloading"><svg viewBox="0 0 24 24"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14"/></svg></span>'
    : !b.downloaded
      ? '<span class="cover-badge" title="Not downloaded yet"><svg viewBox="0 0 24 24"><path d="M7 18a4 4 0 01-.6-7.96A6 6 0 0118 9a4.5 4.5 0 01-.5 9z"/></svg></span>'
      : isFinished(b)
        ? '<span class="cover-badge done" title="Finished"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>'
        : ''
  const p = pct(b)
  const sub = isReading(b) ? `${p}%` : [formatYear(b.year), b.format === 'txt' ? '' : b.format?.toUpperCase()].filter(Boolean).join(' · ')
  return String(html`
    <div class="book-card" role="listitem">
      <button class="book-open" data-id="${b.id}" aria-label="${b.title} by ${b.author}${isReading(b) ? `, ${p}% read` : ''}${b.downloaded ? '' : ', not downloaded'}">
        ${coverHtml(b, { badge })}
      </button>
      <div>
        <div class="book-card-title">${b.title}</div>
        <div class="book-card-sub"><span>${sub || b.author}</span></div>
        ${isReading(b) ? raw(`<div class="bar" aria-hidden="true"><i style="width:${p}%"></i></div>`) : ''}
      </div>
    </div>`)
}

function renderContinue() {
  const slot = $('#continue-slot')
  const current = state.books.filter(isReading).sort(SORTS.recent.fn)[0]
  if (!current || state.query || state.filter !== 'all') { slot.innerHTML = ''; return }
  const p = pct(current)
  slot.innerHTML = str(html`
    <button class="continue book-open" data-id="${current.id}" aria-label="Continue reading ${current.title}, ${p}% read">
      ${coverHtml(current)}
      <div class="continue-meta">
        <div class="continue-kicker">Continue reading</div>
        <div class="continue-title">${current.title}</div>
        <div class="continue-sub">${current.progress?.label || current.author}</div>
        <div class="bar" aria-hidden="true"><i style="width:${p}%"></i></div>
      </div>
    </button>`)
}

async function renderStats() {
  const el = $('#stats-line')
  const s = await stats.summary()
  if (!s.total) { el.hidden = true; return }
  el.hidden = false
  const max = Math.max(60, ...s.week.map(w => w.seconds))
  el.innerHTML = str(html`
    <span><strong>${formatDuration(s.today / 60)}</strong> today</span>
    ${s.streak > 1 ? html`<span><strong>${s.streak}</strong>-day streak</span>` : ''}
    <span class="spark" aria-hidden="true">${s.week.map(w => html`<i style="height:${Math.max(8, Math.round(w.seconds / max * 100))}%" class="${w.seconds ? 'on' : ''}"></i>`)}</span>`)
}

async function renderBanner() {
  const slot = $('#banner-slot')
  const pending = state.books.filter(b => !b.downloaded && b.source?.type === 'starter')
  const dismissed = await db.kvGet('starter-banner-dismissed', false)
  if (state.starterProgress) {
    const { done, total } = state.starterProgress
    slot.innerHTML = str(html`
      <div class="banner" role="status">
        <p><strong>Saving classics for offline reading…</strong>${done} of ${total}</p>
        <div class="bar"><i style="width:${Math.round(done / total * 100)}%"></i></div>
      </div>`)
    return
  }
  if (!pending.length || dismissed || state.query || state.filter !== 'all') { slot.innerHTML = ''; return }
  slot.innerHTML = str(html`
    <div class="banner">
      <p><strong>Take the classics offline</strong>Save all ${pending.length} starter books on this device (about ${pending.length > 40 ? '39 MB' : 'a few MB'}). Or just tap any book to download it.</p>
      <div class="banner-actions">
        <button class="btn primary" id="starter-download">Download all</button>
        <button class="btn ghost" id="starter-dismiss">Not now</button>
      </div>
    </div>`)
  $('#starter-download').addEventListener('click', downloadStarter)
  $('#starter-dismiss').addEventListener('click', async () => { await db.kvSet('starter-banner-dismissed', true); renderBanner() })
}

async function downloadStarter() {
  const pending = state.books.filter(b => !b.downloaded && b.source?.type === 'starter')
  state.starterProgress = { done: 0, total: pending.length }
  renderBanner()
  db.requestPersistence()
  let failed = 0
  const queue = [...pending]
  const worker = async () => {
    while (queue.length) {
      const b = queue.shift()
      try { await library.ensureDownloaded(b.id) } catch { failed++ }
      state.starterProgress.done++
      renderBanner()
    }
  }
  await Promise.all([worker(), worker(), worker()])
  state.starterProgress = null
  await refreshLibrary()
  toast(failed ? `${pending.length - failed} books saved, ${failed} failed — check your connection` : 'All classics are ready offline')
}

/* ---------- open a book from the library ---------- */

async function openFromLibrary(id) {
  const rec = await library.getBook(id)
  if (!rec) return
  if (!rec.downloaded) {
    toast(`Downloading “${rec.title}”…`)
    try {
      await library.ensureDownloaded(id)
    } catch (e) {
      toast(e.name === 'CorsError' ? 'This library needs a download relay. See Settings → Downloads.' : `Couldn’t download: ${e.message}`)
      return
    }
  }
  return navigate(`#/read/${encodeURIComponent(id)}`)
}

function showBookDetails(rec) {
  const body = $('#book-body')
  const p = pct(rec)
  body.innerHTML = str(html`
    <div class="detail">
      <div class="detail-head">
        ${coverHtml(rec)}
        <div>
          <div class="detail-title">${rec.title}</div>
          <div class="detail-author">${rec.author}</div>
          <div class="detail-facts">
            ${rec.year != null ? html`<span>${formatYear(rec.year)}</span>` : ''}
            ${rec.format ? html`<span>${rec.format.toUpperCase()}</span>` : ''}
            ${rec.size ? html`<span>${formatBytes(rec.size)}</span>` : ''}
            ${isReading(rec) ? html`<span>${p}% read</span>` : ''}
          </div>
        </div>
      </div>
      ${rec.description ? html`<p class="detail-desc">${rec.description}</p>` : ''}
      <div class="detail-actions">
        <button class="btn primary" data-act="read">${isReading(rec) ? 'Continue reading' : 'Read'}</button>
        ${rec.downloaded && rec.source?.type !== 'local' ? html`<button class="btn" data-act="offload">Remove download</button>` : ''}
        <button class="btn danger" data-act="remove">Remove from library</button>
      </div>
      ${rec.source?.type && rec.source.type !== 'local' ? html`<p class="detail-source">Source: ${sourceName(rec.source)}. Public domain in the USA.</p>` : ''}
    </div>`)
  body.querySelector('[data-act="read"]').addEventListener('click', () => { sheets.book.close(); openFromLibrary(rec.id) })
  body.querySelector('[data-act="offload"]')?.addEventListener('click', async () => {
    await library.removeBook(rec.id, { keepRecord: true }); sheets.book.close(); toast('Download removed. Progress kept.')
  })
  body.querySelector('[data-act="remove"]').addEventListener('click', async () => {
    await library.removeBook(rec.id)
    sheets.book.close()
    toast(`Removed “${rec.title}”`)
  })
  sheets.book.open()
  if (rec.source?.type === 'starter' && navigator.onLine !== false) offerStandardEdition(rec)
}

const norm = s => (s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

/** For bundled plain-text classics, offer the typeset Standard Ebooks edition if one exists. */
async function offerStandardEdition(rec) {
  try {
    const { items } = await SE.list({ query: rec.title })
    const match = items.find(it => norm(it.title) === norm(rec.title) && norm(it.author).includes(norm(lastName(rec.author))))
    if (!match || !sheets.book.isOpen) return
    const actions = $('#book-body .detail-actions')
    const btn = document.createElement('button')
    btn.className = 'btn'
    btn.textContent = 'Get the Standard Ebooks edition'
    btn.title = 'Carefully typeset EPUB with proper chapters, typography and cover. Your place is kept.'
    actions.append(btn)
    btn.addEventListener('click', async () => {
      btn.disabled = true
      btn.textContent = 'Downloading…'
      try {
        await library.addRemoteBook({ ...match, id: rec.id, description: rec.description, year: rec.year, genre: rec.genre })
        toast(`Upgraded “${rec.title}” to the Standard Ebooks edition`)
        sheets.book.close()
        refreshLibrary()
      } catch (e) {
        btn.disabled = false
        btn.textContent = 'Try again'
        toast(`Download failed: ${e.message}`)
      }
    })
  } catch { /* offline or SE unreachable: nothing to offer */ }
}

const sourceName = s => ({
  starter: 'Project Gutenberg (bundled with Reader)',
  gutenberg: 'Project Gutenberg',
  standardebooks: 'Standard Ebooks',
  archive: 'Internet Archive',
  opds: s.feedTitle ?? 'OPDS catalog',
}[s.type] ?? s.type)

/* ======================================================================
   Import
   ====================================================================== */

async function importFiles(files) {
  const list = [...files].filter(f => library.formatOf(f.name))
  if (!list.length) { toast('No supported books found (EPUB, TXT, FB2, MOBI, AZW3, CBZ)'); return }
  let last = null
  for (const f of list) {
    try { last = await library.importFile(f) }
    catch (e) { console.error(e); toast(`Couldn’t import ${f.name}: ${e.message}`) }
  }
  await refreshLibrary()
  if (last) toast(list.length === 1 ? `Added “${last.title}”` : `Added ${list.length} books`, {
    action: list.length === 1 ? 'Read' : undefined,
    onAction: () => openFromLibrary(last.id),
  })
}

/** Files shared to Reader from other apps arrive via the service worker's share-target handler. */
async function importSharedFiles() {
  if (!location.hash.includes('shared=1') || !('caches' in window)) return
  history.replaceState(null, '', '#/library')
  const cache = await caches.open('reader-share')
  const files = []
  for (const req of await cache.keys()) {
    const res = await cache.match(req)
    const name = decodeURIComponent(res.headers.get('X-File-Name') ?? 'book')
    files.push(new File([await res.blob()], name, { type: res.headers.get('Content-Type') ?? '' }))
    await cache.delete(req)
  }
  if (files.length) importFiles(files)
}

function setupImport() {
  $('#import-btn').addEventListener('click', () => $('#file-input').click())
  $('#file-input').addEventListener('change', e => { importFiles(e.target.files); e.target.value = '' })

  let depth = 0
  addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { depth++; document.body.classList.add('dragging') } })
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging') } })
  addEventListener('dragover', e => e.preventDefault())
  addEventListener('drop', e => {
    e.preventDefault()
    depth = 0
    document.body.classList.remove('dragging')
    if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files)
  })

  // Installed PWA: "Open with Reader" (File Handling API)
  if ('launchQueue' in window) {
    launchQueue.setConsumer(async params => {
      const files = await Promise.all((params.files ?? []).map(h => h.getFile()))
      if (files.length) importFiles(files)
    })
  }
}

/* ======================================================================
   Reader screen
   ====================================================================== */

async function showReader(id) {
  const rec = await library.getBook(id)
  if (!rec || !rec.downloaded) { history.replaceState(null, '', '#/library'); await route(); if (rec) openFromLibrary(id); return }
  const el = $('#reader')
  el.hidden = false
  document.body.classList.add('reading')
  $('#reader-loading').classList.remove('done')
  $('#reader-title').textContent = rec.title
  $('#reader-chapter').textContent = rec.author
  try {
    await reader.open(rec)
    stats.startSession(rec.id)
  } catch (e) {
    console.error(e)
    toast(`Couldn’t open this book: ${e.message}`)
    history.replaceState(null, '', '#/library'); route()
    return
  } finally {
    $('#reader-loading').classList.add('done')
  }
}

async function hideReader() {
  if (rsvp?.isOpen) await rsvp.close()
  Sheet.closeTop()
  await reader.close()
  await stats.endSession()
  $('#reader').hidden = true
  document.body.classList.remove('reading')
  refreshLibrary()
}

function onRelocate() {
  stats.activity()
  const loc = reader.location
  const { left, right } = reader.progressText()
  $('#reader-chapter').textContent = left || reader.record?.author || ''
  $('#status-left').textContent = left
  $('#status-right').textContent = right
  $('#mini-left').textContent = left
  $('#mini-right').textContent = `${Math.round((loc?.fraction ?? 0) * 100)}%`
  const slider = $('#progress-slider')
  if (document.activeElement !== slider) slider.value = loc?.fraction ?? 0
  const marked = Boolean(reader.currentBookmark())
  $('#bookmark-btn').setAttribute('aria-pressed', String(marked))
  $('#bookmark-btn').setAttribute('aria-label', marked ? 'Remove bookmark' : 'Bookmark this page')
}

function openNav(pane = 'toc') {
  const current = reader.location?.tocItem?.href
  $('#toc-list').innerHTML = reader.toc.length
    ? tocHtml(reader.toc, current)
    : '<li class="muted small" style="padding:12px 4px">This book has no table of contents.</li>'
  renderMarks()
  selectNavPane(pane)
  sheets.nav.open()
  requestAnimationFrame(() => $('#toc-list .current')?.scrollIntoView({ block: 'center' }))
}

function selectNavPane(pane) {
  $$('#nav-tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.pane === pane)))
  $('#toc-list').hidden = pane !== 'toc'
  $('#marks-list').hidden = pane !== 'marks'
}

function renderMarks() {
  const items = [
    ...reader.bookmarks.map(m => ({ ...m, kind: 'bookmark' })),
    ...highlights.forBook().map(h => ({ ...h, kind: 'highlight' })),
  ].sort((a, b) => (a.fraction ?? 0) - (b.fraction ?? 0))
  const hasHighlights = items.some(i => i.kind === 'highlight')
  $('#marks-list').innerHTML = items.length
    ? (hasHighlights ? '<div class="marks-toolbar"><button class="btn ghost" id="export-notes">Export notes</button></div>' : '')
      + items.map(m => str(html`
      <div class="mark">
        <button class="mark-open" data-cfi="${m.cfi}">
          <div class="mark-label">${m.kind === 'highlight' ? raw(`<span class="mark-swatch" style="background:${COLORS[m.color] ?? COLORS.yellow}"></span>`) : '🔖 '}${m.label || (m.kind === 'bookmark' ? 'Bookmark' : 'Highlight')} · ${Math.round((m.fraction ?? 0) * 100)}%</div>
          <div class="mark-text">${m.text}</div>
          ${m.note ? html`<div class="mark-note">${m.note}</div>` : ''}
        </button>
        ${m.kind === 'highlight' ? html`<button class="icon-btn" data-share="${m.id}" aria-label="Share quote"><svg viewBox="0 0 24 24"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/></svg></button>` : ''}
        ${m.kind === 'highlight' ? html`<button class="icon-btn" data-note="${m.id}" aria-label="Edit note"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/></svg></button>` : ''}
        <button class="icon-btn" data-del="${m.id}" data-kind="${m.kind}" aria-label="Delete ${m.kind}"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      </div>`)).join('')
    : '<p class="empty"><strong>No notes or bookmarks yet</strong>Select text to highlight it or add a note. Tap the bookmark icon to save your place.</p>'
  $('#export-notes')?.addEventListener('click', () => {
    const blob = new Blob([highlights.toMarkdown()], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${reader.record.title.replace(/[^\w\s-]/g, '').trim() || 'notes'} - notes.md`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10000)
  })
}

async function runBookSearch(query) {
  const results = $('#book-search-results')
  const status = $('#book-search-status')
  results.innerHTML = ''
  if (!query.trim()) { status.textContent = ''; reader.view?.clearSearch(); return }
  status.textContent = 'Searching…'
  const token = (runBookSearch.token = Symbol())
  let count = 0
  try {
    for await (const r of reader.view.search({ query })) {
      if (token !== runBookSearch.token) return
      if (r === 'done') break
      if (r.progress != null) { status.textContent = `Searching… ${Math.round(r.progress * 100)}%`; continue }
      if (!r.subitems) continue
      count += r.subitems.length
      const group = document.createElement('li')
      group.innerHTML = str(html`<h3>${r.label || 'Section'}</h3>`) + r.subitems.slice(0, 50).map(s => str(html`
        <button class="search-hit" data-cfi="${s.cfi}">${s.excerpt.pre}<mark>${s.excerpt.match}</mark>${s.excerpt.post}</button>`)).join('')
      results.append(group)
    }
    status.textContent = count ? `${count} result${count === 1 ? '' : 's'}` : 'No results'
  } catch (e) {
    console.error(e)
    status.textContent = 'Search failed'
  }
}

function setupReaderUI() {
  reader = new Reader($('#reader'))
  rsvp = new RSVP(reader)
  tts = new ReadAloud(reader)
  highlights = new Highlights(reader, { noteSheet: sheets.note, defineSheet: sheets.define })
  highlights.addEventListener('change', () => { if (sheets.nav.isOpen) renderMarks() })
  highlights.addEventListener('share', e => shareQuote({ record: reader.record, ...e.detail }))
  reader.addEventListener('footnote', e => {
    const { paragraphs, href } = e.detail
    $('#footnote-text').innerHTML = paragraphs.map(p => str(html`<p>${p}</p>`)).join('')
    $('#footnote-go').onclick = () => { sheets.footnote.close(); reader.goTo(href) }
    sheets.footnote.open()
  })
  reader.addEventListener('tap', e => { if (highlights.popoverOpen) { e.preventDefault(); highlights.hidePopover() } })
  $('#listen-btn').hidden = !tts.supported
  $('#listen-btn').addEventListener('click', () => { tts.active ? tts.stop() : tts.start(); reader.hideChrome() })
  reader.addEventListener('relocate', onRelocate)
  reader.addEventListener('bookmarks', () => { onRelocate(); if (sheets.nav.isOpen) renderMarks() })
  reader.addEventListener('doc-keydown', e => handleKey(e.detail))

  $('#reader-back').addEventListener('click', () => {
    if (history.state?.fromApp) history.back()
    else { history.replaceState(null, '', '#/library'); route() }
  })
  $('#toc-btn').addEventListener('click', () => openNav('toc'))
  $('#bookmark-btn').addEventListener('click', () => reader.toggleBookmark())
  $('#type-btn').addEventListener('click', () => { renderTypeSheet($('#type-body')); sheets.type.open() })
  $('#rsvp-btn').addEventListener('click', () => { tts.stop(); rsvp.open() })
  $('#search-btn').addEventListener('click', () => sheets.search.open())

  $('#nav-tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-pane]')
    if (b) selectNavPane(b.dataset.pane)
  })
  $('#toc-list').addEventListener('click', e => {
    const b = e.target.closest('[data-href]')
    if (!b) return
    sheets.nav.close()
    reader.goTo(b.dataset.href)
    reader.hideChrome()
  })
  $('#marks-list').addEventListener('click', e => {
    const del = e.target.closest('[data-del]')
    if (del) { del.dataset.kind === 'highlight' ? highlights.remove(del.dataset.del) : reader.deleteAnnotation(del.dataset.del); return }
    const share = e.target.closest('[data-share]')
    if (share) {
      const h = highlights.list.find(x => x.id === share.dataset.share)
      if (h) { sheets.nav.close(); shareQuote({ record: reader.record, text: h.text, cfi: h.cfi, range: null }) }
      return
    }
    const note = e.target.closest('[data-note]')
    if (note) { sheets.nav.close(); highlights.editNote(note.dataset.note); return }
    const open = e.target.closest('[data-cfi]')
    if (open) { sheets.nav.close(); reader.goTo(open.dataset.cfi); reader.hideChrome() }
  })

  const slider = $('#progress-slider')
  slider.addEventListener('change', () => reader.goToFraction(Number(slider.value)))
  slider.addEventListener('input', () => {
    $('#status-right').textContent = `${Math.round(slider.value * 100)}%`
  })

  let searchTimer
  $('#book-search-form').addEventListener('submit', e => { e.preventDefault(); runBookSearch($('#book-search').value) })
  $('#book-search').addEventListener('input', e => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => { if (e.target.value.length >= 3 || !e.target.value) runBookSearch(e.target.value) }, 500)
  })
  $('#book-search-results').addEventListener('click', e => {
    const hit = e.target.closest('[data-cfi]')
    if (!hit) return
    sheets.search.close()
    reader.goTo(hit.dataset.cfi)
  })
  sheets.search.onClose = () => { if (!$('#book-search').value) reader.view?.clearSearch() }

  // Wheel: page turns in paginated mode (trackpads/mice)
  let wheelLock = 0
  $('#reader-stage').addEventListener('wheel', e => {
    if (settings.flow !== 'paginated' || Math.abs(e.deltaY) < 20 || Date.now() < wheelLock) return
    wheelLock = Date.now() + 350
    e.deltaY > 0 ? reader.next() : reader.prev()
  }, { passive: true })
}

/* ======================================================================
   Keyboard
   ====================================================================== */

function handleKey(e) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
  const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) && e.target.type !== 'range'
  if (rsvp?.isOpen) { if (rsvp.handleKey(e)) e.preventDefault(); return }
  if (e.key === 'Escape') {
    if (Sheet.closeTop()) { e.preventDefault(); return }
    if (highlights?.popoverOpen) { e.preventDefault(); highlights.hidePopover(); return }
    if (reader?.isOpen) { e.preventDefault(); $('#reader-back').click() }
    return
  }
  if (inField || Sheet.stack.length) return
  if (!reader?.isOpen) {
    if (e.key === '/' && currentRoute() === 'library') { e.preventDefault(); $('#library-search').focus() }
    return
  }
  const k = e.key
  if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey) || k === 'l' || k === 'j') { e.preventDefault(); reader.next() }
  else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey) || k === 'h' || k === 'k') { e.preventDefault(); reader.prev() }
  else if (k === 'ArrowDown' && settings.flow === 'paginated') { e.preventDefault(); reader.next() }
  else if (k === 'ArrowUp' && settings.flow === 'paginated') { e.preventDefault(); reader.prev() }
  else if (k === 't') openNav('toc')
  else if (k === 'b') reader.toggleBookmark()
  else if (k === 'f' || k === '/') { e.preventDefault(); sheets.search.open() }
  else if (k === 'r') { tts.stop(); rsvp.open() }
  else if (k === 'p') tts.active ? tts.toggle() : tts.start()
  else if (k === 'm') reader.toggleChrome()
}

/* ======================================================================
   Routing
   ====================================================================== */

const currentRoute = () => (location.hash.match(/^#\/(\w+)/)?.[1]) ?? 'library'

async function route() {
  const hash = location.hash || '#/library'
  const quote = parseLink(hash)
  if (quote) { await openQuote(quote); return }
  const read = hash.match(/^#\/read\/(.+)$/)
  if (read) {
    await showReader(decodeURIComponent(read[1]))
    return
  }
  if (reader?.isOpen) await hideReader()
  const name = ['library', 'discover', 'settings'].includes(currentRoute()) ? currentRoute() : 'library'
  for (const s of $$('.screen')) s.hidden = s.dataset.screen !== name
  for (const a of $$('#tabbar a')) {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  }
  document.title = { library: 'Reader', discover: 'Discover · Reader', settings: 'Settings · Reader' }[name]
  if (name === 'discover') discover.show()
  if (name === 'settings') renderSettings($('#settings-body'), { refreshLibrary, importFiles })
}

/* ======================================================================
   Shared quote links  (#/q/<book-ref>?t=…)
   ====================================================================== */

async function openQuote(quote) {
  const id = recordIdFor(quote.ref)
  const rec = id ? await library.getBook(id) : null
  if (rec?.downloaded) {
    history.replaceState({ fromApp: false }, '', `#/read/${encodeURIComponent(rec.id)}`)
    await showReader(rec.id)
    const found = await reader.goToQuote(quote).catch(() => false)
    if (!found) toast('Couldn’t find that exact passage in this edition')
    return
  }
  // Landing card for people who don't have the book (yet).
  history.replaceState(null, '', '#/library')
  await route()
  const body = $('#quote-body')
  body.innerHTML = str(html`
    <blockquote class="landing-quote">${quote.text}</blockquote>
    <p class="landing-cite"><strong>${quote.title || 'A public-domain book'}</strong>${quote.author ? html`<br>${quote.author}` : ''}</p>
    <div class="detail-actions"><button class="btn primary" id="quote-get">Read it free — it’s public domain</button></div>
    <p class="detail-source">Reader is a free, open-source ereader with no ads and no tracking. The book is downloaded straight from ${quote.ref.startsWith('se:') ? 'Standard Ebooks' : 'Project Gutenberg'} to this device and opens at this passage.</p>`)
  $('#quote-get').addEventListener('click', async e => {
    const btn = e.currentTarget
    btn.disabled = true
    btn.textContent = 'Getting the book…'
    try {
      const recId = await acquireForQuote(quote)
      sheets.quote.close()
      await navigate(`#/read/${encodeURIComponent(recId)}`)
      if (!(await reader.goToQuote(quote))) toast('Couldn’t find that exact passage in this edition')
    } catch (err) {
      btn.disabled = false
      btn.textContent = 'Try again'
      toast(err.message)
    }
  })
  sheets.quote.open()
}

/** Download the quoted book: same source if possible, else the Standard Ebooks edition. */
async function acquireForQuote(quote) {
  const id = recordIdFor(quote.ref)
  const existing = await library.getBook(id)
  if (existing) { await library.ensureDownloaded(id); return id }
  if (quote.ref.startsWith('se:')) {
    const path = `/ebooks/${quote.ref.slice(3)}`
    await library.addRemoteBook({
      id, title: quote.title || 'Untitled', author: quote.author, format: 'epub', language: 'en',
      source: { type: 'standardebooks', url: SE.epubUrl(path), page: `https://standardebooks.org${path}` },
    })
    return id
  }
  const pg = Number(quote.ref.slice(2))
  if (relayConfigured()) {
    await library.addRemoteBook({
      id, title: quote.title || `Gutenberg #${pg}`, author: quote.author, format: 'epub', language: 'en',
      coverUrl: PG.coverFor(pg),
      source: { type: 'gutenberg', gutenberg: pg, url: PG.epubFor(pg), page: `https://www.gutenberg.org/ebooks/${pg}`, fileName: `pg${pg}.epub` },
    })
    return id
  }
  // No relay: look for the same title on Standard Ebooks.
  if (quote.title) {
    const { items } = await SE.list({ query: quote.title }).catch(() => ({ items: [] }))
    const match = items.find(it => norm(it.title) === norm(quote.title))
    if (match) { await library.addRemoteBook(match); return match.id }
  }
  throw new Error('This book comes from Project Gutenberg, which needs a download relay (Settings → Downloads).')
}

/* ======================================================================
   Helpers & init
   ====================================================================== */

const str = String

/** Navigate within the app, remembering that "back" can return here. */
function navigate(hash) {
  history.pushState({ fromApp: true }, '', hash)
  return route()
}

function setupLibraryUI() {
  $('#library-search').addEventListener('input', e => { state.query = e.target.value.trim(); renderLibrary() })
  $('#library-filters').addEventListener('click', e => {
    const chip = e.target.closest('[data-filter]')
    if (!chip) return
    state.filter = chip.dataset.filter
    $$('#library-filters .chip').forEach(c => {
      c.classList.toggle('active', c === chip)
      c.setAttribute('aria-checked', String(c === chip))
    })
    renderLibrary()
  })
  $('#sort-btn').addEventListener('click', () => {
    const keys = Object.keys(SORTS)
    state.sort = keys[(keys.indexOf(state.sort) + 1) % keys.length]
    localStorage.setItem('reader:sort', state.sort)
    toast(`Sorted by ${SORTS[state.sort].label.toLowerCase()}`)
    renderLibrary()
  })

  // Tap opens; long-press / right-click shows details.
  const scroll = $('#library-scroll')
  let pressTimer = null, pressed = null, longPressed = false
  scroll.addEventListener('pointerdown', e => {
    const b = e.target.closest('.book-open')
    if (!b || e.button !== 0) return
    pressed = b
    longPressed = false
    pressTimer = setTimeout(async () => {
      longPressed = true
      const rec = state.books.find(x => x.id === b.dataset.id)
      if (rec) showBookDetails(rec)
    }, 550)
  })
  const cancel = () => clearTimeout(pressTimer)
  scroll.addEventListener('pointerup', cancel)
  scroll.addEventListener('pointercancel', cancel)
  scroll.addEventListener('pointermove', e => { if (Math.abs(e.movementY) > 4) cancel() })
  scroll.addEventListener('contextmenu', e => {
    const b = e.target.closest('.book-open')
    if (!b) return
    e.preventDefault()
    cancel()
    if (longPressed) return // touch long-press already opened the details
    const rec = state.books.find(x => x.id === b.dataset.id)
    if (rec) showBookDetails(rec)
  })
  scroll.addEventListener('click', e => {
    const b = e.target.closest('.book-open')
    if (!b || longPressed || pressed !== b) { longPressed = false; return }
    openFromLibrary(b.dataset.id)
  })
}

async function init() {
  applyTheme()
  onChange((_, patch) => { if ('theme' in patch) applyTheme() })

  for (const id of ['nav', 'type', 'search', 'book', 'note', 'define', 'footnote', 'share', 'quote']) sheets[id] = new Sheet($(`#sheet-${id}`))
  $('#sheet-backdrop').addEventListener('click', () => Sheet.closeTop())

  // Broken remote cover images fall back to the generated cover underneath.
  document.addEventListener('error', e => { if (e.target.matches?.('.cover img')) e.target.remove() }, true)

  setupLibraryUI()
  setupReaderUI()
  setupImport()
  discover = new Discover({ onAdded: refreshLibrary, openBook: openFromLibrary })
  document.addEventListener('keydown', handleKey)

  library.onLibraryChange(() => { if (!reader.isOpen) refreshLibrary() })

  await library.seedStarterShelf()
  const legacy = await db.migrateLegacy()
  if (legacy.length) await library.importLegacy(legacy)
  await refreshLibrary()

  // Mark in-app navigations so "back" can use history instead of reloading.
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[href^="#/"]')
    if (a) { e.preventDefault(); navigate(a.getAttribute('href')) }
  })
  addEventListener('popstate', route)
  await route()

  importSharedFiles()
  registerServiceWorker()
  if (state.books.some(b => b.downloaded)) db.requestPersistence()
}

init().catch(e => {
  console.error(e)
  document.body.insertAdjacentHTML('beforeend', `<p style="padding:24px">Reader failed to start: ${esc(e.message)}</p>`)
})
