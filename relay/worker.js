/* Reader download relay — a tiny, logless CORS relay for Cloudflare Workers.
 *
 * Project Gutenberg doesn't send CORS headers, so browsers won't let web apps
 * read its files. This worker fetches an allow-listed URL and returns it with
 * `Access-Control-Allow-Origin`. It stores nothing and logs nothing.
 *
 *   GET https://<your-worker>/?url=https://www.gutenberg.org/ebooks/84.epub3.images
 */

const ALLOWED_HOSTS = new Set([
  'www.gutenberg.org',
  'gutenberg.org',
  'gutenberg.pglaf.org',
  'aleph.pglaf.org',
])

// Optional: restrict which web apps may use your relay (comma-separated origins
// in the ALLOWED_ORIGINS environment variable). Empty = any origin.
const corsHeaders = (origin, env) => {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const allow = !allowed.length ? '*' : allowed.includes(origin) ? origin : null
  return allow ? {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Type',
    'Vary': 'Origin',
  } : null
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? ''
    const cors = corsHeaders(origin, env)
    if (!cors) return new Response('Origin not allowed', { status: 403 })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: cors })

    const target = new URL(request.url).searchParams.get('url')
    let url
    try { url = new URL(target) } catch { return new Response('Missing or invalid ?url=', { status: 400, headers: cors }) }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
      return new Response('Host not allowed', { status: 403, headers: cors })
    }

    const upstream = await fetch(url, {
      method: request.method,
      redirect: 'follow',
      headers: { 'User-Agent': 'ReaderRelay/1.0 (+https://github.com/laroccaconsulting/Reader)' },
      cf: { cacheTtl: 86400, cacheEverything: true },
    })
    // Redirects may only land on allowed hosts too.
    if (!ALLOWED_HOSTS.has(new URL(upstream.url).hostname)) return new Response('Redirected off allow-list', { status: 403, headers: cors })

    const headers = new Headers(cors)
    for (const h of ['Content-Type', 'Content-Length', 'Last-Modified', 'ETag']) {
      const v = upstream.headers.get(h)
      if (v) headers.set(h, v)
    }
    headers.set('Cache-Control', 'public, max-age=86400')
    return new Response(upstream.body, { status: upstream.status, headers })
  },
}
