/* Share a quote: tasteful image + a deep link to the exact passage. */

import { $, $$, html, toast, Sheet } from '../ui/dom.js'
import { coverColor } from '../ui/covers.js'
import { bookRef, buildLink, clampQuote, rangeContext } from './quote-link.js'
import { drawQuote, toBlob, FORMATS, STYLES } from './quote-image.js'

const SOURCE_LABEL = { starter: 'Project Gutenberg', gutenberg: 'Project Gutenberg', standardebooks: 'Standard Ebooks' }

let state = null
let previewUrl = null
let renderToken = 0

const fileName = (title, format) =>
  `${(title || 'quote').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-').slice(0, 40)}-quote-${format}.png`

export function shareQuote({ record, text, range, cfi }) {
  const { text: quote, truncated } = clampQuote(text)
  const ref = bookRef(record)
  const ctx = range ? rangeContext(range) : { prefix: '', suffix: '' }
  const link = ref ? buildLink({
    ref,
    text: quote,
    prefix: ctx.prefix,
    suffix: truncated ? '' : ctx.suffix,
    title: record.title,
    author: record.author,
    cfi,
  }) : null
  state = {
    quote, truncated, link,
    title: record.title,
    author: record.author,
    source: SOURCE_LABEL[record.source?.type] ?? '',
    color: coverColor(record),
    format: 'square',
    style: localStorage.getItem('reader:quote-style') || 'paper',
  }
  render()
  new Sheet($('#sheet-share')).open()
  drawPreview()
}

function render() {
  const s = state
  $('#share-body').innerHTML = String(html`
    <figure class="share-preview"><img id="share-img" alt="Quote card preview"></figure>
    <div class="share-options">
      <div class="segmented small" role="radiogroup" aria-label="Image shape">
        ${Object.entries(FORMATS).map(([k, f]) => html`<button role="radio" data-format="${k}" aria-checked="${String(s.format === k)}">${f.label}</button>`)}
      </div>
      <div class="segmented small" role="radiogroup" aria-label="Image style">
        ${Object.entries(STYLES).map(([k, st]) => html`<button role="radio" data-style="${k}" aria-checked="${String(s.style === k)}">${st.label}</button>`)}
      </div>
    </div>
    <div class="detail-actions">
      ${navigator.share ? html`<button class="btn primary" id="share-native">Share…</button>` : ''}
      <button class="btn ${navigator.share ? '' : 'primary'}" id="share-save">Save image</button>
      ${s.link ? html`<button class="btn" id="share-link">Copy link</button>` : ''}
    </div>
    ${s.link
      ? html`<p class="detail-source">The link opens this exact passage. Anyone without the book can get it free in one tap.${s.truncated ? ' Long passages are shortened to 280 characters.' : ''}</p>`
      : html`<p class="detail-source">Links are available for public-domain books from Discover and the starter shelf. Books you imported can be shared as an image of a short quote.</p>`}`)

  $$('#share-body [data-format]').forEach(b => b.addEventListener('click', () => { s.format = b.dataset.format; render(); drawPreview() }))
  $$('#share-body [data-style]').forEach(b => b.addEventListener('click', () => {
    s.style = b.dataset.style
    try { localStorage.setItem('reader:quote-style', s.style) } catch { /* private mode */ }
    render(); drawPreview()
  }))
  $('#share-native')?.addEventListener('click', shareNative)
  $('#share-save').addEventListener('click', saveImage)
  $('#share-link')?.addEventListener('click', copyLink)
}

async function currentBlob() {
  const s = state
  const canvas = await drawQuote({ text: s.quote, title: s.title, author: s.author, sourceLabel: s.source, coverColor: s.color }, { format: s.format, style: s.style })
  return toBlob(canvas)
}

async function drawPreview() {
  const token = ++renderToken
  const blob = await currentBlob()
  if (token !== renderToken) return
  if (previewUrl) URL.revokeObjectURL(previewUrl)
  previewUrl = URL.createObjectURL(blob)
  const img = $('#share-img')
  if (img) img.src = previewUrl
}

const shareText = () => `“${state.quote}”\n— ${state.title}${state.author ? `, ${state.author}` : ''}`

async function shareNative() {
  const blob = await currentBlob()
  const file = new File([blob], fileName(state.title, state.format), { type: 'image/png' })
  const data = { text: state.link ? `${shareText()}\n${state.link}` : shareText() }
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ ...data, files: [file] })
    else await navigator.share({ ...data, ...(state.link ? { url: state.link } : {}) })
  } catch (e) {
    if (e.name !== 'AbortError') toast('Sharing failed — try Save image or Copy link')
  }
}

async function saveImage() {
  const blob = await currentBlob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName(state.title, state.format)
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(state.link)
    toast('Link copied')
  } catch {
    prompt('Copy this link', state.link)
  }
}
