/* Discover: browse and search free libraries, then add books in one tap. */

import * as db from '../db.js'
import * as library from '../library.js'
import * as SE from '../catalog/standard-ebooks.js'
import * as PG from '../catalog/gutenberg.js'
import { relayConfigured } from '../net.js'
import { coverHtml } from './covers.js'
import { $, $$, html, raw, toast, Sheet } from './dom.js'

const SOURCES = [SE, PG]

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
    })
    $('#discover-scroll').addEventListener('scroll', e => {
      const el = e.currentTarget
      if (this.hasNext && !this.loading && el.scrollTop + el.clientHeight > el.scrollHeight - 600) this.loadMore()
    }, { passive: true })
  }

  show() {
    if (!this.shown) { this.shown = true; this.search('') }
  }

  #renderTabs() {
    $('#source-tabs').innerHTML = SOURCES.map(s => String(html`
      <button role="tab" data-source="${s.id}" aria-selected="${s === this.source}">${s.name}</button>`)).join('')
    $('#source-tabs').onclick = e => {
      const b = e.target.closest('[data-source]')
      if (!b) return
      this.source = SOURCES.find(s => s.id === b.dataset.source)
      $$('#source-tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)))
      this.search(this.query)
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
    const key = `${this.source.id}|${this.query}|${this.page}`
    try {
      const res = await this.source.list({ query: this.query, page: this.page, next: this.next, signal: controller.signal })
      if (controller.signal.aborted) return
      db.put('catalog', { key, data: res, fetchedAt: Date.now() }).catch(() => {})
      this.#append(res, reset)
    } catch (e) {
      if (e.name === 'AbortError') return
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

  async showDetails(it) {
    const body = $('#book-body')
    const owned = await library.getBook(it.id)
    const inLibrary = owned?.downloaded && owned.format === it.format
    const isPG = it.source.type === 'gutenberg'
    const hasStarterText = isPG && owned?.source?.type === 'starter'
    const blocked = isPG && !relayConfigured() && !inLibrary

    const render = extra => {
      body.innerHTML = String(html`
        <div class="detail">
          <div class="detail-head">
            ${coverHtml(it)}
            <div>
              <div class="detail-title">${it.title}</div>
              <div class="detail-author">${extra?.author ?? it.author}</div>
              <div class="detail-facts">
                <span>${this.source.name}</span>
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
                : html`<button class="btn primary" data-act="get">Get book</button>`}
          </div>
          ${blocked ? html`<p class="detail-source">Project Gutenberg blocks direct downloads from web apps. Set up a free <a href="#/settings">download relay</a> to get any of its 75,000 books, or download the EPUB from <a href="${it.source.page}" target="_blank" rel="noopener">gutenberg.org</a> and import it with the ⤒ button in your Library.</p>` : ''}
          <p class="detail-source">Public domain in the USA. <a href="${it.source.page}" target="_blank" rel="noopener">View on ${this.source.name}</a></p>
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
