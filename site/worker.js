/* readfree.app: the static app (served by Cloudflare's asset handling, which
 * never reaches this code) plus link previews for shared quotes. This Worker
 * only runs for /q/*, /img/* and /oembed (see run_worker_first). It stores
 * nothing: everything it needs is in the URL. */

import satori, { init as initSatori } from 'satori/standalone'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
import yoga from 'satori/yoga.wasm'
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'
import literata400 from '@fontsource/literata/files/literata-latin-400-normal.woff'
import literata600 from '@fontsource/literata/files/literata-latin-600-normal.woff'
import atkinson400 from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff'
import atkinson700 from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff'
import { parseShare, sharePage, oembed, card } from './preview.js'

let ready = null
const setup = () => (ready ??= Promise.all([initSatori(yoga), initWasm(resvgWasm)]))

const fonts = [
  { name: 'Literata', data: literata400, weight: 400, style: 'normal' },
  { name: 'Literata', data: literata600, weight: 600, style: 'normal' },
  { name: 'Atkinson', data: atkinson400, weight: 400, style: 'normal' },
  { name: 'Atkinson', data: atkinson700, weight: 700, style: 'normal' },
]

const DAY = 86400
const headers = (type, maxAge, extra = {}) => ({
  'Content-Type': type,
  'Cache-Control': `public, max-age=${maxAge}`,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  ...extra,
})

async function renderImage(share, ctx, request) {
  const cache = caches.default
  const hit = await cache.match(request)
  if (hit) return hit
  await setup()
  const svg = await satori(card(share), { width: 1200, height: 630, fonts })
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng()
  const res = new Response(png, { headers: headers('image/png', 365 * DAY, { 'Access-Control-Allow-Origin': '*' }) })
  ctx.waitUntil(cache.put(request, res.clone()))
  return res
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })

    if (url.pathname === '/oembed') {
      let target
      try { target = new URL(url.searchParams.get('url') ?? '') } catch { /* invalid */ }
      const share = target && ['readfree.app', 'www.readfree.app'].includes(target.hostname) && parseShare(target)
      if (!share || share.kind !== 'q') return new Response('Not found', { status: 404 })
      return new Response(JSON.stringify(oembed(share)), { headers: headers('application/json+oembed', DAY, { 'Access-Control-Allow-Origin': '*' }) })
    }

    const share = parseShare(url)
    if (share?.kind === 'q') {
      return new Response(sharePage(share), {
        headers: headers('text/html; charset=utf-8', DAY, {
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'",
        }),
      })
    }
    if (share?.kind === 'img') {
      try { return await renderImage(share, ctx, request) } catch (e) {
        console.error('card render failed', e)
        return env.ASSETS.fetch(new Request(new URL('/icons/icon-512.png', url)))
      }
    }
    // Anything else under these paths: hand to the app (it shows its own not-found state).
    if (url.pathname.startsWith('/q/')) return Response.redirect(new URL('/', url), 302)
    return env.ASSETS.fetch(request)
  },
}
