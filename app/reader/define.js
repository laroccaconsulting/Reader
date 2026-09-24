/* Word definitions from Wiktionary (CORS-enabled REST API). Lookups are cached
 * on the device so words you've looked up once work offline. */

import * as db from '../db.js'

const strip = s => (s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()

export function normalizeWord(text) {
  return text.trim().replace(/^[^\p{L}]+|[^\p{L}'’-]+$/gu, '').replace(/’/g, "'")
}

export const isSingleWord = text => /^[\p{L}'’-]{2,40}$/u.test(normalizeWord(text)) && !/\s/.test(text.trim())

/** -> [{ partOfSpeech, definitions: [string], examples: [string] }] or [] */
export async function define(word, lang = 'en') {
  const w = normalizeWord(word)
  const key = `define|${lang}|${w.toLowerCase()}`
  const cached = await db.get('catalog', key).catch(() => null)
  if (cached) return cached.data
  const tryWord = async x => {
    const res = await fetch(`https://${lang}.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(x)}`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`${res.status}`)
    return res.json()
  }
  const json = (await tryWord(w)) ?? (w !== w.toLowerCase() ? await tryWord(w.toLowerCase()) : null)
  const entries = (json?.[lang] ?? json?.en ?? []).map(e => ({
    partOfSpeech: e.partOfSpeech,
    definitions: (e.definitions ?? []).map(d => strip(d.definition)).filter(Boolean).slice(0, 4),
    examples: (e.definitions ?? []).flatMap(d => d.examples ?? []).map(strip).filter(Boolean).slice(0, 1),
  })).filter(e => e.definitions.length).slice(0, 4)
  await db.put('catalog', { key, data: entries, fetchedAt: Date.now() }).catch(() => {})
  return entries
}
