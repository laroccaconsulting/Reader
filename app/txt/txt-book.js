/* Wraps a parsed plain-text book in foliate-js's "book" interface so the
 * same renderer, TOC, CFI, search and TTS code paths serve TXT and EPUB. */

import { parseText, escHtml } from './gutenberg.js'

const STYLE = `
  body { margin: 0; }
  h1 { font-size: 1.4em; text-align: center; margin: 1.5em 0 .5em; font-weight: 600; }
  h2 { font-size: 1.2em; text-align: center; margin: 1.5em 0 1.2em; font-weight: 600; line-height: 1.35; }
  h3 { font-size: .85em; text-align: center; letter-spacing: .08em; margin: 1.6em 0 .8em; font-weight: 600; }
  p { margin: 0; text-indent: 1.4em; }
  h1 + p, h2 + p, h3 + p, hr + p, p.verse + p, p.first { text-indent: 0; }
  p.verse { text-indent: 0; margin: .9em 0 .9em 1.2em; }
  hr { border: 0; text-align: center; margin: 1.4em 0; }
  hr::after { content: '⁂'; opacity: .6; }
`

export function makeTextBook(raw, meta = {}) {
  const parsed = parseText(raw, meta)
  const docs = parsed.sections.map(s => `<!DOCTYPE html>
<html lang="${escHtml(parsed.language)}"><head><meta charset="utf-8"><title>${escHtml(s.title)}</title>
<style>${STYLE}</style></head><body>${s.html}</body></html>`)

  const urls = new Map()
  const sections = parsed.sections.map((s, index) => ({
    id: index,
    size: s.size,
    linear: 'yes',
    load: () => {
      if (!urls.has(index)) urls.set(index, URL.createObjectURL(new Blob([docs[index]], { type: 'text/html' })))
      return urls.get(index)
    },
    unload: () => {
      const url = urls.get(index)
      if (url) { URL.revokeObjectURL(url); urls.delete(index) }
    },
    createDocument: () => new DOMParser().parseFromString(docs[index], 'text/html'),
  }))

  const indexOfHref = href => {
    const m = /^s(\d+)/.exec(href ?? '')
    return m ? Number(m[1]) : -1
  }

  return {
    sections,
    toc: parsed.toc,
    landmarks: [{ type: ['bodymatter'], href: `s${parsed.bodyIndex}` }],
    dir: 'ltr',
    metadata: { title: parsed.title, author: parsed.author, language: parsed.language },
    words: parsed.words,
    resolveHref: href => {
      const index = indexOfHref(href)
      return index >= 0 ? { index, anchor: doc => doc.body } : null
    },
    splitTOCHref: href => [indexOfHref(href), null],
    getTOCFragment: doc => doc.body,
    isExternal: href => /^\w+:/.test(href),
    destroy: () => { for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear() },
  }
}

/** Decode bytes as UTF-8, falling back to Windows-1252 (common in older Gutenberg files). */
export function decodeText(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
  catch { return new TextDecoder('windows-1252').decode(buffer) }
}
