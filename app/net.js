/* Network helpers.
 *
 * Every request goes straight to the library that hosts the book. Some hosts
 * (notably gutenberg.org) don't send CORS headers, so browsers refuse to let
 * web apps read their files. For those, users can configure their own relay
 * (see /relay). No third-party proxy is ever used by default.
 */

import { settings } from './settings.js'

export class CorsError extends Error {
  constructor(url) {
    super(`The library at ${new URL(url).host} doesn't allow direct downloads from web apps.`)
    this.name = 'CorsError'
    this.url = url
  }
}

/** Hosts known (verified in CI) to block cross-origin reads. Skip the doomed direct attempt. */
const NO_CORS_HOSTS = new Set(['www.gutenberg.org', 'gutenberg.org', 'gutenberg.pglaf.org'])

export const needsRelay = url => {
  try { return NO_CORS_HOSTS.has(new URL(url, location.href).host) } catch { return false }
}

/* The public relay only answers the official sites; forks and local copies set their own. */
export const PUBLIC_RELAY = 'https://relay.readfree.app'
const OFFICIAL = new Set(['https://readfree.app', 'https://www.readfree.app', 'https://laroccaconsulting.github.io'])
export const relayUrl = () => settings.relayUrl || (OFFICIAL.has(globalThis.location?.origin) ? PUBLIC_RELAY : '')

export const relayConfigured = () => Boolean(relayUrl())

export function relayed(url) {
  const base = relayUrl().replace(/\/+$/, '')
  return `${base}/?url=${encodeURIComponent(url)}`
}

async function readWithProgress(res, onProgress) {
  const total = Number(res.headers.get('content-length')) || 0
  if (!onProgress || !res.body) return new Uint8Array(await res.arrayBuffer())
  const reader = res.body.getReader()
  const chunks = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress(received, total)
  }
  const out = new Uint8Array(received)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.length }
  return out
}

/** Fetch a URL as bytes, using the user's relay when the host needs one. */
export async function fetchBytes(url, { onProgress, sameOrigin = false, signal } = {}) {
  const attempts = []
  if (sameOrigin || !needsRelay(url)) attempts.push(url)
  if (!sameOrigin && relayConfigured()) attempts.push(relayed(url))
  if (!attempts.length) throw new CorsError(url)

  let lastError
  for (const target of attempts) {
    try {
      const res = await fetch(target, { signal, cache: 'no-store' })
      if (!res.ok) { lastError = new Error(`${res.status} ${res.statusText}`); continue }
      const bytes = await readWithProgress(res, onProgress)
      return { bytes, type: res.headers.get('content-type')?.split(';')[0] ?? '' }
    } catch (e) {
      if (e.name === 'AbortError') throw e
      lastError = e instanceof TypeError && target === url && !sameOrigin ? new CorsError(url) : e
    }
  }
  throw lastError
}

/** Fetch text/JSON/XML for catalogs (direct first, relay as fallback). */
export async function fetchText(url, { signal, accept } = {}) {
  const headers = accept ? { Accept: accept } : undefined
  const direct = !needsRelay(url) || !relayConfigured()
  try {
    const res = await fetch(direct ? url : relayed(url), { signal, headers })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return await res.text()
  } catch (e) {
    if (e.name === 'AbortError' || !direct || !relayConfigured()) throw e
    const res = await fetch(relayed(url), { signal, headers })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return await res.text()
  }
}

export const isOnline = () => navigator.onLine !== false
