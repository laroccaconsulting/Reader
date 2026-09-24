/* Discover: browse and search free libraries, then add books in one tap. */

import * as db from '../db.js'
import * as library from '../library.js'
import * as SE from '../catalog/standard-ebooks.js'
import * as PG from '../catalog/gutenberg.js'
import * as OPDS from '../catalog/opds.js'
import { relayConfigured } from '../net.js'
import { coverHtml } from './covers.js'
import { $, $$, html, raw, toast, Sheet } from './dom.js'

const SOURCES = [SE, PG, OPDS]

export class Discover {
  source = SE
  query = ''
  items = []
  page = 1
  next = null
  hasNext = false
  loading = false
  controller = null
  shown = false

  constructor({ onAdded, openBook }) {
    this.onAdded = onAdded
    this.openBook = openBook
    this.results = $('#discover-results')
    this.sheet = new Sheet($('#sheet-book'))
    this.#renderTabs()

    $('#discover-form').addEventListener('submit', e => {
      e.preventDefault()
      $('#discover-search').blur()
      this.search($('#discover-search').value.trim())
    })
    let t
    $('#discover-search').addEventListener('input', e => {
      clearTimeout(t)
      const v = e.target.value.trim()
      t = setTimeout(() => { if (v.length >= 3 || v === '') this.search(v) }, 450)
    })
    this.results.addEventListener('click', e => {
      const card = e.target.closest('[data-index]')
      if (card) this.showDetails(this.items[Number(card.dataset.index)])
      if (e.target.closest('#load-more')) this.loadMore()
      if (e.target.closest('#retry')) this.search(this.query)
      const nav = e.target.closest('[data-feed]')
      if (nav) this.#opdsOpen(nav.dataset.feed)
      const rm = e.target.closest('[data-remove-feed]')
      if (rm) { e.stopPropagation(); OPDS.removeFeed(rm.dataset.removeFeed).then(() => this.#opdsHome()) }
      if (e.target.closest('#feed-back')) this.#opdsBack()
    })
    $('#discover-scroll').addEventListener('scroll', e => {
      const el = e.currentTarget
      if (this.source.custom) {
        if (this.feed?.next && !this.loading && el.scrollTop + el.clientHeight > el.scrollHeight - 600) this.#opdsMore()
        return
      }
      if (this.hasNext && !this.loading && el.scrollTop + el.clientHeight > el.scrollHeight - 600) this.loadMore()
    }, { passive: true })
  }

  show() {
    if (!this.shown) { this.shown = true; this.search('') }
  }

  #renderTabs() {
    $('#source-tabs').innerHTML = SOURCES.map(s => String(html`
      <button role="tab" data-source="${s.id}" aria-selected="${String(s === this.source)}">${s.name}</button>`)).join('')
    $('#source-tabs').onclick = e => {
      const b = e.target.closest('[data-source]')
      if (!b) return
      this.controller?.abort()
      this.loading = false
      this.source = SOURCES.find(s => s.id === b.dataset.source)
      $$('#source-tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)))
      this.#renderNote()
      if (this.source.custom) { $('#discover-search').value = ''; this.#opdsHome() }
      else { $('#discover-search').placeholder = 'Search titles, authors, subjects'; this.search(this.query) }
    }
    this.#renderNote()
  }

  #renderNote() {
    let note = this.source.note
    if (this.source === PG && !relayConfigured()) {
      note += ' Gutenberg doesn’t allow web apps to download files directly, so downloads need a <a href="#/settings">download relay</a>. Many of these classics are also on Standard Ebooks.'
    }
    $('#source-note').innerHTML = note
  }

  async search(query) {
    if (this.source.custom) return this.#opdsSearch(query)
    this.query = query
    this.items = []
    this.page = 1
    this.next = null
    this.#renderNote()
    await this.#fetch(true)
  }

  async loadMore() {
    if (!this.hasNext || this.loading) return
    this.page++
    await this.#fetch(false)
  }

  async #fetch(reset) {
    this.controller?.abort()
    const controller = this.controller = new AbortController()
    this.loading = true
    if (reset) this.results.innerHTML = '<div class="status-box"><div class="spinner"></div></div>'
    else $('#load-more')?.replaceChildren(Object.assign(document.createElement('div'), { className: 'spinner' }))
    const source = this.source
    const key = `${source.id}|${this.query}|${this.page}`
    try {
      const res = await source.list({ query: this.query, page: this.page, next: this.next, signal: controller.signal })
      if (controller.signal.aborted || source !== this.source) return
      db.put('catalog', { key, data: res, fetchedAt: Date.now() }).catch(() => {})
      this.#append(res, reset)
    } catch (e) {
      if (e.name === 'AbortError' || source !== this.source) return
      const cached = await db.get('catalog', key).catch(() => null)
      if (cached) {
        this.#append(cached.data, reset)
        toast('Offline — showing saved results')
      } else {
        this.results.innerHTML = String(html`
          <div class="status-box">
            <strong>${navigator.onLine === false ? 'You’re offline' : 'Couldn’t reach ' + this.source.name}</strong>
            ${navigator.onLine === false ? 'Your library still works offline. Discover needs a connection.' : e.message}
            <div><button class="btn" id="retry">Try again</button></div>
          </div>`)
      }
    } finally {
      if (this.controller === controller) this.loading = false
    }
  }

  async #append(res, reset) {
    const start = this.items.length
    this.items.push(...res.items)
    this.hasNext = res.hasNext
    this.next = res.next ?? null
    const owned = new Map((await library.listBooks()).map(b => [b.id, b]))
    const cards = res.items.map((it, i) => this.#card(it, start + i, owned.get(it.id))).join('')
    if (reset) {
      this.results.innerHTML = this.items.length
        ? `<div class="book-grid" role="list">${cards}</div><div class="load-more" id="load-more"></div>`
        : String(html`<div class="status-box"><strong>No books found</strong>Try another title or author${this.source === SE ? ', or search Project Gutenberg' : ''}.</div>`)
      $('#discover-scroll').scrollTop = 0
    } else {
      $('#discover-results .book-grid')?.insertAdjacentHTML('beforeend', cards)
    }
    const more = $('#load-more')
    if (more) more.innerHTML = this.hasNext ? '<button class="btn" id="load-more-btn">Load more</button>' : ''
    $('#load-more-btn')?.addEventListener('click', () => this.loadMore())
  }

  #card(it, index, owned) {
    const badge = owned?.downloaded && owned.format === it.format
      ? '<span class="cover-badge done" title="In your library"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>'
      : ''
    return String(html`
      <div class="book-card" role="listitem">
        <button class="book-open" data-index="${index}" aria-label="${it.title} by ${it.author}">${coverHtml(it, { badge })}</button>
        <div>
          <div class="book-card-title">${it.title}</div>
          <div class="book-card-sub"><span>${it.author}</span></div>
        </div>
      </div>`)
  }

  /* ---------------- OPDS catalogs ---------------- */

  feedStack = []
  feed = null

  async #opdsHome() {
    this.feed = null
    this.feedStack = []
    this.items = []
    const saved = await OPDS.savedFeeds()
    const suggested = OPDS.SUGGESTED.filter(s => !saved.some(f => f.url === s.url))
    $('#discover-search').placeholder = 'Search the open catalog'
    this.results.innerHTML = String(html`
      <form class="add-feed" id="add-feed">
        <label for="feed-url" class="type-label"><span>Add a catalog</span></label>
        <div class="add-feed-row">
          <input type="url" id="feed-url" placeholder="https://example.org/opds" inputmode="url" autocomplete="off" spellcheck="false" required>
          <button class="btn primary">Add</button>
        </div>
      </form>
      ${saved.length ? html`<h2 class="list-heading">Your catalogs</h2>` : ''}
      <div class="nav-list">
        ${saved.map(f => html`
          <div class="nav-row">
            <button class="nav-item" data-feed="${f.url}"><strong>${f.title}</strong><span>${f.url}</span></button>
            <button class="icon-btn" data-remove-feed="${f.url}" aria-label="Remove ${f.title}"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
          </div>`)}
      </div>
      ${suggested.length ? html`<h2 class="list-heading">Suggested</h2>
        <div class="nav-list">${suggested.map(f => html`<div class="nav-row"><button class="nav-item" data-feed="${f.url}"><strong>${f.title}</strong><span>${f.url}</span></button></div>`)}</div>` : ''}`)
    $('#add-feed').addEventListener('submit', async e => {
      e.preventDefault()
      const url = $('#feed-url').value.trim()
      try {
        const feed = await OPDS.load(url)
        await OPDS.saveFeed({ title: feed.title, url })
        this.#opdsShow(feed, true)
      } catch (err) {
        toast(err.name === 'TypeError' ? 'That catalog doesn’t allow access from web apps (CORS), or is offline.' : `Couldn’t open catalog: ${err.message}`)
      }
    })
  }

  async #opdsOpen(url, push = true) {
    this.results.innerHTML = '<div class="status-box"><div class="spinner"></div></div>'
    try {
      const feed = await OPDS.load(url)
      db.put('catalog', { key: `opds|${url}`, data: feed, fetchedAt: Date.now() }).catch(() => {})
      this.#opdsShow(feed, push)
    } catch (err) {
      const cached = await db.get('catalog', `opds|${url}`).catch(() => null)
      if (cached) { this.#opdsShow(cached.data, push); toast('Offline — showing saved catalog page'); return }
      this.results.innerHTML = String(html`<div class="status-box"><strong>Couldn’t open this catalog</strong>${err.name === 'TypeError' ? 'It may not allow access from web apps (CORS), or you’re offline.' : err.message}
        <div><button class="btn" id="feed-back">Back</button></div></div>`)
    }
  }

  #opdsShow(feed, push) {
    if (push && this.feed) this.feedStack.push(this.feed)
    this.feed = feed
    this.items = feed.items.slice()
    $('#discover-search').placeholder = feed.searchLink ? `Search ${feed.title}` : 'Search the open catalog'
    this.results.innerHTML = String(html`
      <div class="feed-head">
        <button class="icon-btn" id="feed-back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
        <h2>${feed.title}</h2>
      </div>
      ${feed.navigation.length ? html`<div class="nav-list">${feed.navigation.map(n => html`
        <div class="nav-row"><button class="nav-item" data-feed="${n.href}"><strong>${n.title}</strong>${n.summary ? html`<span>${n.summary}</span>` : ''}</button></div>`)}</div>` : ''}
      ${feed.items.length ? html`<div class="book-grid" role="list">${raw(feed.items.map((it, i) => this.#card(it, i)).join(''))}</div>` : ''}
      ${!feed.items.length && !feed.navigation.length ? html`<div class="status-box">This page is empty.</div>` : ''}`)
    $('#discover-scroll').scrollTop = 0
  }

  async #opdsMore() {
    const next = this.feed?.next
    if (!next) return
    this.loading = true
    this.feed.next = null
    try {
      const more = await OPDS.load(next)
      const start = this.items.length
      this.items.push(...more.items)
      this.feed.next = more.next
      $('#discover-results .book-grid')?.insertAdjacentHTML('beforeend', more.items.map((it, i) => this.#card(it, start + i)).join(''))
    } catch { /* ignore; user can scroll again */ } finally { this.loading = false }
  }

  #opdsBack() {
    const prev = this.feedStack.pop()
    if (prev) this.#opdsShow(prev, false)
    else this.#opdsHome()
  }

  async #opdsSearch(query) {
    if (!query) { this.feed ? this.#opdsShow(this.feed, false) : this.#opdsHome(); return }
    const link = this.feed?.searchLink
    if (!link) { toast(this.feed ? 'This catalog has no search' : 'Open a catalog first, then search it'); return }
    try {
      const url = await OPDS.searchUrl(link, query)
      this.#opdsOpen(url)
    } catch (e) { toast(`Search failed: ${e.message}`) }
  }

  async showDetails(it) {
    const body = $('#book-body')
    const owned = await library.getBook(it.id)
    const inLibrary = owned?.downloaded && owned.format === it.format
    const isPG = it.source.type === 'gutenberg'
    const hasStarterText = isPG && owned?.source?.type === 'starter'
    const blocked = isPG && !relayConfigured() && !inLibrary
    const noFile = !it.source.url

    const render = extra => {
      body.innerHTML = String(html`
        <div class="detail">
          <div class="detail-head">
            ${coverHtml(it)}
            <div>
              <div class="detail-title">${it.title}</div>
              <div class="detail-author">${extra?.author ?? it.author}</div>
              <div class="detail-facts">
                <span>${it.source.feedTitle ?? this.source.name}</span>
                ${it.format && it.format !== 'epub' ? html`<span>${it.format.toUpperCase()}</span>` : ''}
                ${extra?.words ? html`<span>${Math.round(extra.words / 1000)}k words</span>` : ''}
                ${extra?.downloads ? html`<span>${extra.downloads.toLocaleString()} downloads</span>` : ''}
              </div>
            </div>
          </div>
          ${extra?.description ? html`<p class="detail-desc">${extra.description}</p>` : extra ? '' : raw('<div class="spinner"></div>')}
          ${extra?.subjects?.length ? html`<div class="chips" style="padding:0;margin:0">${extra.subjects.map(s => html`<span class="chip">${s}</span>`)}</div>` : ''}
          <div class="detail-actions">
            ${inLibrary
              ? html`<button class="btn primary" data-act="read">Read</button>`
              : blocked
                ? html`
                  ${hasStarterText ? html`<button class="btn primary" data-act="read-starter">Read plain-text edition</button>` : ''}
                  <button class="btn ${hasStarterText ? '' : 'primary'}" data-act="find-se">Find on Standard Ebooks</button>`
                : noFile
                  ? html`<p class="detail-source">This catalog entry has no free download in a supported format.</p>`
                  : html`<button class="btn primary" data-act="get">Get book</button>`}
          </div>
          ${blocked ? html`<p class="detail-source">Project Gutenberg blocks direct downloads from web apps. Set up a free <a href="#/settings">download relay</a> to get any of its 75,000 books, or download the EPUB from <a href="${it.source.page}" target="_blank" rel="noopener">gutenberg.org</a> and import it with the ⤒ button in your Library.</p>` : ''}
          ${it.source.type === 'opds'
            ? html`<p class="detail-source">From ${it.source.feedTitle ?? 'an OPDS catalog'}.${it.source.page ? html` <a href="${it.source.page}" target="_blank" rel="noopener">View online</a>` : ''}</p>`
            : html`<p class="detail-source">Public domain in the USA. <a href="${it.source.page}" target="_blank" rel="noopener">View on ${this.source.name}</a></p>`}
        </div>`)
      body.querySelector('[data-act="read"]')?.addEventListener('click', () => { this.sheet.close(); this.openBook(it.id) })
      body.querySelector('[data-act="read-starter"]')?.addEventListener('click', () => { this.sheet.close(); this.openBook(it.id) })
      body.querySelector('[data-act="find-se"]')?.addEventListener('click', () => {
        this.sheet.close()
        this.source = SE
        $$('#source-tabs button').forEach(x => x.setAttribute('aria-selected', String(x.dataset.source === SE.id)))
        const q = it.title.split(/[;:]/)[0]
        $('#discover-search').value = q
        this.search(q)
      })
      body.querySelector('[data-act="get"]')?.addEventListener('click', e => this.#get(it, e.currentTarget))
    }
    render(null)
    this.sheet.open()
    try {
      const extra = await this.source.details(it)
      if (this.sheet.isOpen) render(extra)
      if (extra.author && !it.author) it.author = extra.author
      it.description = extra.description
    } catch {
      if (this.sheet.isOpen) render({})
    }
  }

  async #get(it, button) {
    button.disabled = true
    button.textContent = 'Downloading…'
    try {
      await library.addRemoteBook(it)
      this.onAdded?.()
      button.disabled = false
      button.textContent = 'Read'
      button.dataset.act = 'read'
      button.replaceWith(button.cloneNode(true))
      $('#book-body [data-act="read"]').addEventListener('click', () => { this.sheet.close(); this.openBook(it.id) })
      toast(`“${it.title}” is in your library`)
      db.requestPersistence()
    } catch (e) {
      console.error(e)
      button.disabled = false
      button.textContent = 'Try again'
      toast(e.name === 'CorsError' ? 'This library blocks direct downloads. Set up a relay in Settings.' : `Download failed: ${e.message}`)
    }
  }
}
