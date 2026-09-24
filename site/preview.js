/* Link previews for shared quotes (pure functions; unit-tested under node).
 *
 *   /q/<ref>?t=<quote>&p=&s=&b=<title>&a=<author>&c=   the share link
 *   /img/<ref>.png?t=&b=&a=                             the preview card
 *
 * Only public-domain library books can be linked (pg1342, se:author/title),
 * and quotes are capped, matching what the app itself allows. */

export const SITE = 'https://readfree.app'
export const MAX_QUOTE = 280
const REF = /^(?:pg\d{1,6}|se:[a-z0-9-]+\/[a-z0-9-]+(?:\/[a-z0-9-]+)?)$/

const squash = s => (s ?? '').replace(/\s+/g, ' ').trim()
const cap = (s, n) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s)

/** Parse a /q/ or /img/ request; null if it isn't a valid shared quote. */
export function parseShare(url) {
  const m = /^\/(q|img)\/(.+)$/.exec(url.pathname)
  if (!m) return null
  let path = m[2]
  if (m[1] === 'img') {
    if (!path.endsWith('.png')) return null
    path = path.slice(0, -4)
  }
  let ref
  try { ref = decodeURIComponent(path) } catch { return null }
  if (!REF.test(ref)) return null
  const q = url.searchParams
  const text = cap(squash(q.get('t')), MAX_QUOTE)
  if (!text) return null
  return {
    kind: m[1],
    ref,
    text,
    title: cap(squash(q.get('b')), 120),
    author: cap(squash(q.get('a')), 80),
    search: url.search,
  }
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const imagePath = share => {
  const q = new URLSearchParams({ t: share.text })
  if (share.title) q.set('b', share.title)
  if (share.author) q.set('a', share.author)
  return `/img/${encodeURIComponent(share.ref)}.png?${q}`
}

/** The page link-preview bots read. People are sent straight on into the app. */
export function sharePage(share) {
  const app = `/#/q/${encodeURIComponent(share.ref)}${share.search}`
  const link = `${SITE}/q/${encodeURIComponent(share.ref)}${share.search}`
  const byline = [share.title, share.author].filter(Boolean).join(' by ')
  const heading = byline || 'A passage from a free classic'
  const quote = `“${share.text}”`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(heading)} · Read Free</title>
<meta name="description" content="${esc(quote)}">
<link rel="canonical" href="${esc(link)}">
<meta property="og:site_name" content="Read Free">
<meta property="og:type" content="article">
<meta property="og:url" content="${esc(link)}">
<meta property="og:title" content="${esc(heading)}">
<meta property="og:description" content="${esc(quote)} Read it free, no ads, no account.">
<meta property="og:image" content="${esc(SITE + imagePath(share))}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(quote)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="alternate" type="application/json+oembed" href="${esc(`${SITE}/oembed?url=${encodeURIComponent(link)}`)}" title="${esc(heading)}">
<meta http-equiv="refresh" content="0; url=${esc(app)}">
<style>body{font:18px/1.5 Georgia,serif;max-width:36em;margin:15vh auto;padding:0 20px;color:#2A241C;background:#F7F3EA}a{color:#8C5A2B}</style>
</head>
<body>
<blockquote>${esc(quote)}</blockquote>
<p>${esc(heading)}</p>
<p><a href="${esc(app)}">Read it free in Read Free</a></p>
</body>
</html>`
}

/** oEmbed for a share link (so Notion, WordPress, Medium etc. embed the card). */
export function oembed(share) {
  const byline = [share.title, share.author].filter(Boolean).join(' by ')
  return {
    version: '1.0',
    type: 'photo',
    title: byline ? `${byline}: “${share.text}”` : `“${share.text}”`,
    author_name: share.author || undefined,
    provider_name: 'Read Free',
    provider_url: SITE,
    url: SITE + imagePath(share),
    width: 1200,
    height: 630,
  }
}

/* ---- the card: same "Paper" design as the app's wide share image ---- */

const PAPER = { bg: '#F7F3EA', text: '#2A241C', muted: '#7A6F60', accent: '#8C5A2B', rule: 'rgba(42,36,28,.18)' }
const h = (type, style, ...children) => ({ type, props: { style, children: children.length === 1 ? children[0] : children } })

export function quoteSize(text) {
  const n = text.length
  return n <= 70 ? 50 : n <= 120 ? 44 : n <= 180 ? 38 : n <= 230 ? 34 : 31
}

export function card(share) {
  const size = quoteSize(share.text)
  // The app drops a trailing "…" from shortened quotes; put it back on the card.
  const text = /[.!?;:…"”’')\]]$/.test(share.text) ? share.text : `${share.text}…`
  const brand = share.ref.startsWith('se:') ? 'READFREE.APP  ·  STANDARD EBOOKS' : 'READFREE.APP  ·  PROJECT GUTENBERG'
  return h('div', { width: 1200, height: 630, display: 'flex', flexDirection: 'column', padding: '50px 96px 44px', background: PAPER.bg, color: PAPER.text },
    h('div', { fontFamily: 'Literata', fontWeight: 600, fontSize: 96, lineHeight: 1, height: 58, color: PAPER.accent, marginLeft: -6 }, '“'),
    h('div', { display: 'block', fontFamily: 'Literata', fontSize: size, lineHeight: 1.38, flexGrow: 1, overflow: 'hidden', lineClamp: 7 }, text),
    h('div', { width: 160, height: 3, background: PAPER.rule, marginTop: 10, marginBottom: 18 }, ''),
    h('div', { display: 'flex', alignItems: 'baseline', fontSize: 28, whiteSpace: 'nowrap', overflow: 'hidden' },
      h('span', { fontFamily: 'Literata', fontWeight: 600 }, share.title || 'A free classic'),
      share.author ? h('span', { fontFamily: 'Atkinson', fontSize: 22, color: PAPER.muted, marginLeft: 10 }, `· ${share.author}`) : h('span', {}, '')),
    h('div', { fontFamily: 'Atkinson', fontWeight: 700, fontSize: 18, letterSpacing: 1, color: PAPER.muted, marginTop: 14 }, brand))
}
