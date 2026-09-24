/* Plain-text (Project Gutenberg style) book parsing.
 *
 * Pure functions, no DOM: runs in the browser and under `node --test`.
 *
 *   parseText(raw)  -> { title, author, sections: [{ title, level, html, size, group? }], toc }
 *
 * Chapter detection strategy, in order of preference:
 *   1. The book's own "Contents" list, matched against standalone heading
 *      paragraphs in the body (longest increasing sequence, so stray matches
 *      can't derail the order).
 *   2. Heading heuristics: "CHAPTER IV", "ACT II", lone roman numerals, or
 *      short ALL-CAPS title lines, with contents-list runs filtered out.
 *   3. Size-based splitting at paragraph boundaries.
 * Oversized sections are always split at paragraph boundaries.
 */

const START_RE = /\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\*{3}/i
const END_RE = /\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\*{3}/i

const MAX_SECTION_CHARS = 90_000
const FALLBACK_SECTION_CHARS = 40_000
const MIN_SECTION_CHARS = 300

/** Illustrated editions sometimes put the chapter heading inside the caption
 *  ("[Illustration: … \n\n Chapter I.]"). Drop the caption but keep that heading. */
function keepTrailingHeading(caption) {
  const paras = caption.slice(1, -1).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const last = paras[paras.length - 1] ?? ''
  return paras.length > 1 && /^(?:chapter|book|part|volume|act|stave)\s+[\w.]+\.?$/i.test(last) ? `\n\n${last}\n\n` : ''
}

/** Strip Gutenberg boilerplate and normalise whitespace. */
export function cleanText(raw) {
  let text = raw.replace(/^﻿/, '')
  const sm = START_RE.exec(text)
  if (sm) text = text.slice(sm.index + sm[0].length)
  const em = END_RE.exec(text)
  if (em) text = text.slice(0, em.index)
  return text
    .replace(/\r\n?/g, '\n')
    // [Illustration: …] captions can span several paragraphs; drop them entirely
    .replace(/\[Illustration(?:[:.][^\]]{0,2000})?\]/g, keepTrailingHeading)
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

/** Pull title/author from the Gutenberg header, if present. */
export function readHeader(raw) {
  const head = raw.slice(0, 5000)
  const title = /^Title:\s*(.+(?:\n {2,}.+)*)/m.exec(head)?.[1]?.replace(/\s+/g, ' ').trim()
  const author = /^Author:\s*(.+)/m.exec(head)?.[1]?.trim()
  const language = /^Language:\s*(.+)/m.exec(head)?.[1]?.trim()
  return { title, author, language }
}

/* ---------------------------------------------------------------------- */
/* Paragraph indexing                                                      */
/* ---------------------------------------------------------------------- */

/** Split into paragraphs, keeping their character offsets. */
export function paragraphs(text) {
  const out = []
  const re = /\n\s*\n/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ start: last, end: m.index, text: text.slice(last, m.index) })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ start: last, end: text.length, text: text.slice(last) })
  return out
}

export function normKey(s) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const isHeadingShaped = p => {
  const t = p.text.trim()
  if (!t || t.length > 200) return false
  const lines = t.split('\n')
  return lines.length <= 4 && lines.every(l => l.trim().length <= 90)
}

/* ---------------------------------------------------------------------- */
/* Strategy 1: the book's own contents list                                */
/* ---------------------------------------------------------------------- */

const CONTENTS_RE = /^\s*(?:table of\s+)?contents\.?:?\s*$/i

function contentsEntries(text, paras) {
  const limit = Math.min(text.length * 0.25, 60_000)
  const idx = paras.findIndex(p => p.start < limit && CONTENTS_RE.test(p.text.trim().split('\n')[0]))
  if (idx < 0) return null

  // Contents lines: everything after the heading until the first entry
  // reappears as a standalone paragraph (the start of the body).
  const entries = []
  let firstKey = null
  let bodyStart = null
  let closed = false
  const contentsPara = paras[idx]
  // The contents heading paragraph may itself contain entries on following lines.
  const pending = contentsPara.text.split('\n').slice(1).map(l => ({ line: l, para: idx }))
  for (let i = idx + 1; i < paras.length && entries.length < 1200; i++) {
    const p = paras[i]
    if (firstKey && normKey(p.text) === firstKey) { bodyStart = p.start; break }
    if (p.text.length > 3000) { bodyStart = p.start; break } // clearly prose
    // Two or more blank lines after some entries ends the list (e.g. an
    // "Illustrations" list or dramatis personae follows); keep scanning for the body.
    const gap = text.slice(paras[i - 1].end, p.start)
    if (entries.length >= 2 && (gap.match(/\n/g) || []).length >= 3) closed = true
    if (closed) continue
    for (const line of p.text.split('\n')) pending.push({ line, para: i })
    while (pending.length) {
      const { line } = pending.shift()
      const cleaned = line.replace(/\s*(?:\.{2,}|\s{3,})\s*\d+\s*$/, '').replace(/^[\[\]\s]+|[\[\]\s]+$/g, '').trim()
      if (!cleaned || cleaned.length > 120) continue
      const key = normKey(cleaned)
      if (!key) continue
      if (!firstKey) firstKey = key
      entries.push({ label: cleaned, key, indent: /^\s*/.exec(line)[0].length })
    }
  }
  if (entries.length < 2) return null
  return { entries, bodyStart: bodyStart ?? contentsPara.end, contentsIndex: idx }
}

/** Longest strictly increasing subsequence over (entry, position) pairs. */
function bestSequence(pairs) {
  // pairs sorted by entry asc, position desc (so one entry can't be used twice)
  pairs.sort((a, b) => a.entry - b.entry || b.pos - a.pos)
  const tails = []
  const tailIdx = []
  const prev = new Array(pairs.length)
  for (let i = 0; i < pairs.length; i++) {
    const pos = pairs[i].pos
    let lo = 0, hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (tails[mid] < pos) lo = mid + 1
      else hi = mid
    }
    tails[lo] = pos
    tailIdx[lo] = i
    prev[i] = lo > 0 ? tailIdx[lo - 1] : -1
  }
  const out = []
  let k = tailIdx[tails.length - 1]
  while (k !== undefined && k >= 0) { out.push(pairs[k]); k = prev[k] }
  return out.reverse()
}

function headingsFromContents(text, paras) {
  const found = contentsEntries(text, paras)
  if (!found) return null
  const { entries, bodyStart } = found

  const byKey = new Map()
  for (const p of paras) {
    if (p.start < bodyStart || !isHeadingShaped(p)) continue
    const t = p.text.trim()
    const keys = new Set([normKey(t), normKey(t.split('\n')[0])])
    for (const key of keys) {
      if (!key) continue
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key).push(p)
    }
  }

  // Loose matches: "Scene I." -> "SCENE I. Athens. A room…", "First Book" -> "THE FIRST BOOK"
  const headingParas = paras.filter(p => p.start >= bodyStart && isHeadingShaped(p))
    .map(p => ({ p, key: normKey(p.text.trim()) }))
  const pairs = []
  entries.forEach((e, entry) => {
    const seen = new Set()
    for (const p of byKey.get(e.key) ?? []) { seen.add(p); pairs.push({ entry, pos: p.start, para: p }) }
    if (e.key.length < 5) return
    for (const { p, key } of headingParas) {
      if (seen.has(p)) continue
      if (key.startsWith(e.key + ' ') || key.endsWith(' ' + e.key)) pairs.push({ entry, pos: p.start, para: p })
    }
  })
  const seq = bestSequence(pairs)
  if (seq.length < 2 || seq.length < entries.length * 0.4) return null

  return {
    bodyStart,
    headings: seq.map(({ entry, para }) => ({
      start: para.start,
      end: para.end,
      label: entries[entry].label,
      raw: para.text,
    })),
  }
}

/* ---------------------------------------------------------------------- */
/* Strategy 2: heading heuristics                                          */
/* ---------------------------------------------------------------------- */

const NUM = String.raw`(?:[IVXLCDM]+|\d+|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE|THIRTEEN|FOURTEEN|FIFTEEN|SIXTEEN|SEVENTEEN|EIGHTEEN|NINETEEN|TWENTY|THE\s+\w+)`
const ORD = String.raw`(?:FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ELEVENTH|TWELFTH)`
const KEYWORD_RE = new RegExp(
  String.raw`^\s*(?:(?:CHAPTER|PART|BOOK|VOLUME|SECTION|ACT|SCENE|CANTO|STAVE|LETTER)\s+${NUM}\b|(?:THE\s+)?${ORD}\s+(?:BOOK|PART|ACT|CHAPTER|VOLUME)\b|(?:PROLOGUE|EPILOGUE|PREFACE|INTRODUCTION|APPENDIX|CONCLUSION|FOREWORD|AFTERWORD|INDUCTION)\b)`,
  'i')
const ROMAN_RE = /^\s*(?:[IVXLC]+|\d{1,3})\.?\s*$/
const CAPS_RE = /^\s*[A-Z0-9][A-Z0-9 ,.'’"“”:;&\-—!?()]{2,70}$/

function heuristicHeadings(paras, keywordsOnly = false) {
  const pick = test => paras.filter(p => isHeadingShaped(p) && test(p.text.trim()))
  const kinds = [
    pick(t => KEYWORD_RE.test(t.split('\n')[0])),
    pick(t => ROMAN_RE.test(t.split('\n')[0]) && t.split('\n').length <= 2),
    pick(t => !t.includes('\n') && CAPS_RE.test(t) && /[A-Z]{3}/.test(t) && !/[.,;]$/.test(t.replace(/\b(?:MR|MRS|DR|ST)\.$/, ''))),
  ]
  for (const cands of keywordsOnly ? kinds.slice(0, 2) : kinds) {
    const filtered = dropContentsRuns(cands)
    if (filtered.length >= 2) {
      return filtered.map(p => ({ start: p.start, end: p.end, label: headingLabel(p.text), raw: p.text }))
    }
  }
  return null
}

/** "CHAPTER I.\nIN WHICH …\nMASTER" -> "CHAPTER I. IN WHICH … MASTER" */
function headingLabel(raw) {
  const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 1) return lines[0]
  const [first, ...rest] = lines
  return `${first}${/[.:—-]$/.test(first) ? '' : '.'} ${rest.join(' ')}`
}

/** Remove runs of >= 3 candidates packed closely together (a contents list). */
function dropContentsRuns(cands) {
  const out = []
  let run = []
  const flush = () => { if (run.length < 3) out.push(...run); run = [] }
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i]
    const prev = run[run.length - 1]
    if (prev && c.start - prev.end < 200) run.push(c)
    else { flush(); run = [c] }
  }
  flush()
  return out
}

/* ---------------------------------------------------------------------- */
/* Assembly                                                                */
/* ---------------------------------------------------------------------- */

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with'])

/** "CHAPTER XIV. THE SECRET OF THE SEA" -> "Chapter XIV. The Secret of the Sea".
 *  Mixed-case input only has its ALL-CAPS words recased. */
export function formatTitle(s) {
  const t = s.replace(/\s+/g, ' ').trim()
  const allCaps = t === t.toUpperCase()
  let first = true
  return t.replace(/(\p{L}[\p{L}'’]*)|([.:;!?—–]|--)/gu, (match, word, _p, offset) => {
    if (!word) { first = true; return match } // sentence-ish punctuation restarts capitalisation
    const isFirst = first || !/\p{L}/u.test(t.slice(offset + word.length))
    first = false
    if (ROMAN_WORD.test(word) && word !== 'I' || (word === 'I' && isRomanContext(t))) return word
    if (!allCaps && (word !== word.toUpperCase() || word.length === 1)) return word
    const lower = word.toLowerCase()
    if (!isFirst && SMALL_WORDS.has(lower)) return lower
    return lower[0].toUpperCase() + lower.slice(1)
  })
}

// A lone "I" is a numeral in "ACT I", "PART I.", "I." but a pronoun in "WHERE I LIVED".
const isRomanContext = t => /^(?:\S+\s+)?I\b\.?(?:\s|$)/.test(t) && !/^[A-Z]+\s+I\s+[A-Z]{2,}/.test(t) || /^I\.?$/.test(t)

const ROMAN_WORD = /^(?=[MDCLXVI])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/

/** Split `text` into chunks of roughly `size` chars at paragraph boundaries. */
function chunkAtParagraphs(text, size) {
  if (text.length <= size) return [text]
  const out = []
  let rest = text
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n\n', size)
    if (cut < size * 0.5) cut = rest.indexOf('\n\n', size)
    if (cut < 0) break
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest.trim()) out.push(rest)
  return out
}

const GROUP_RE = new RegExp(String.raw`^\s*(?:(?:the\s+)?(?:VOLUME|BOOK|PART|ACT|STAVE|CANTO)\b|(?:THE\s+)?${ORD}\s+(?:BOOK|PART|ACT|VOLUME)\b)`, 'i')
const isGroupHeading = s => s.body.length < 20 || (s.body.length < MIN_SECTION_CHARS && GROUP_RE.test(s.title))

const stripBrackets = s => s.trim().replace(/^\[[^\]]*$\n?/m, '').replace(/^[\[\]\s]+|[\[\]\s]+$/g, '')

function buildSections(text, headings) {
  const sections = []
  const front = text.slice(0, headings[0].start).trim()
  if (front.length > MIN_SECTION_CHARS) sections.push({ title: 'Front Matter', heading: null, body: front, level: 0 })

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i]
    const next = headings[i + 1]
    const body = text.slice(h.end, next ? next.start : text.length).trim()
    sections.push({ title: formatTitle(stripBrackets(h.label)), heading: stripBrackets(h.raw), body, level: 0 })
  }

  // A heading with (almost) no text before the next heading is a group
  // (VOLUME ONE -> Chapter 1, ACT I -> Scene I). Fold it into the next
  // section and nest the following sections beneath it in the TOC.
  const merged = []
  let group = null
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    const next = sections[i + 1]
    if (s.heading && next && isGroupHeading(s)) {
      group = { title: s.title }
      next.groupHeading = [...(s.groupHeading ?? []), s.heading, ...(s.body ? [s.body] : [])]
      next.group = group
      continue
    }
    if (group && !s.group) s.group = group
    if (group) s.level = 1
    merged.push(s)
  }
  return merged
}

function sizeFallback(text) {
  return chunkAtParagraphs(text, FALLBACK_SECTION_CHARS)
    .map((body, i) => ({ title: `Part ${i + 1}`, heading: null, body, level: 0 }))
}

/** Detect chapters. Returns [{ title, heading, body, level, group?, groupHeading? }]. */
export function splitSections(text) {
  const paras = paragraphs(text)
  const fromContents = headingsFromContents(text, paras)
  const headings = fromContents?.headings ?? heuristicHeadings(paras)
  let sections = headings ? buildSections(text, headings) : sizeFallback(text)
  if (sections.length === 0) sections = sizeFallback(text)

  // Big sections often hide unlisted chapters (contents lists only parts).
  sections = sections.flatMap(s => {
    if (s.body.length < 60_000) return [s]
    const inner = heuristicHeadings(paragraphs(s.body), true)
    if (!inner || inner.length < 2) return [s]
    const sub = buildSections(s.body, inner)
    const group = s.group ?? { title: s.title }
    const lead = sub[0].heading === null ? sub.shift() : null
    sub.forEach(x => { x.group = group; x.level = 1 })
    sub[0].groupHeading = [...(s.groupHeading ?? []), ...(s.heading ? [s.heading] : []), ...(lead ? [lead.body] : [])]
    return sub
  })

  // Cap oversized sections.
  const out = []
  for (const s of sections) {
    const parts = chunkAtParagraphs(s.body, MAX_SECTION_CHARS)
    parts.forEach((body, i) => out.push(i === 0
      ? { ...s, body }
      : { ...s, body, heading: null, groupHeading: null, title: `${s.title} (${i + 1})`, continuation: true }))
  }
  return out
}

/* ---------------------------------------------------------------------- */
/* HTML rendering                                                          */
/* ---------------------------------------------------------------------- */

export function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Gutenberg plain-text markup on an escaped string. Underscores at word
 *  boundaries *toggle* italics (they often wrap long passages with roman
 *  titles inside), so pair them in order and close any left open. */
function inlineMarkup(text) {
  const parts = escHtml(text).split(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/u)
  let out = parts[0]
  let open = false
  for (let i = 1; i < parts.length; i++) {
    out += (open ? '</em>' : '<em>') + parts[i]
    open = !open
  }
  if (open) out += '</em>'
  return out
    .replace(/<em>(\s*)<\/em>/g, '$1')
    .replace(/(^|\s)=([^=\n]+?)=(?=\s|[.,;:!?]|$)/g, '$1<strong>$2</strong>')
}

/** Apply markup across the whole block, then join lines with `sep`. */
const markupLines = (lines, sep) => inlineMarkup(lines.join('\n')).split('\n').join(sep)

/** Convert a block of plain text to HTML paragraphs. */
export function blocksToHtml(content) {
  const parts = []
  for (const block of content.split(/\n\s*\n/)) {
    const trimmed = block.replace(/^\n+|\n+$/g, '')
    if (!trimmed.trim()) continue
    const flat = trimmed.trim()

    if (/^[*\s]+$/.test(flat) && (flat.match(/\*/g) || []).length >= 3) { parts.push('<hr>'); continue }

    const lines = trimmed.split('\n')
    const stripped = lines.map(l => l.trim()).filter(Boolean)
    const isUpper = flat === flat.toUpperCase() && /[A-Z]{2}/.test(flat)
    if (stripped.length <= 2 && flat.length < 80 && isUpper && !/[.!?]["”’]?$/.test(flat)) {
      parts.push(`<h3>${markupLines(stripped, '<br>')}</h3>`)
      continue
    }

    // Verse / letters / lists: many short or indented lines
    const indented = lines.filter(l => /^\s{2,}/.test(l)).length
    const short = stripped.filter(l => l.length < 55).length
    if (stripped.length > 1 && (short === stripped.length || indented >= stripped.length * 0.6)) {
      parts.push(`<p class="verse">${markupLines(stripped, '<br>')}</p>`)
      continue
    }

    parts.push(`<p>${markupLines(stripped, ' ')}</p>`)
  }
  return parts.join('\n')
}

function headingHtml(raw, tag) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
  return `<${tag}>${lines.map(l => inlineMarkup(formatTitle(l))).join('<br>')}</${tag}>`
}

export function sectionToHtml(section) {
  const parts = []
  for (const g of section.groupHeading ?? []) parts.push(headingHtml(g, 'h1'))
  if (section.heading) parts.push(headingHtml(section.heading, 'h2'))
  parts.push(blocksToHtml(section.body))
  return parts.join('\n')
}

/* ---------------------------------------------------------------------- */
/* Public entry                                                            */
/* ---------------------------------------------------------------------- */

export function parseText(raw, meta = {}) {
  const header = readHeader(raw)
  const text = cleanText(raw)
  const sections = splitSections(text)

  // TOC with one level of grouping
  const toc = []
  let currentGroup = null
  sections.forEach((s, index) => {
    if (s.continuation) return
    const item = { label: s.title, href: `s${index}` }
    if (s.group) {
      if (currentGroup?.ref !== s.group) {
        currentGroup = { ref: s.group, item: { label: s.group.title, href: `s${index}`, subitems: [] } }
        toc.push(currentGroup.item)
      }
      currentGroup.item.subitems.push(item)
    } else {
      currentGroup = null
      toc.push(item)
    }
  })

  // Open at the story: skip front matter, and an editor's preface or introduction
  // when a first chapter follows soon after.
  const FRONT = /^(?:front matter|(?:editor.s |translator.s )?(?:preface|introduction|contents|list of illustrations|note)\b)/i
  const FIRST = /^(?:chapter|book|part|stave|volume|letter)\s+(?:1|i|one|the first)\b|^(?:1|i)\.?$/i
  let bodyIndex = sections.findIndex(s => s.title !== 'Front Matter')
  const first = sections.findIndex(s => FIRST.test(s.title))
  if (first > bodyIndex && first <= bodyIndex + 4 && sections.slice(bodyIndex, first).every(s => FRONT.test(s.title))) bodyIndex = first
  return {
    bodyIndex: Math.max(0, bodyIndex),
    title: meta.title ?? header.title ?? 'Untitled',
    author: meta.author ?? header.author ?? '',
    language: meta.language ?? header.language ?? 'en',
    sections: sections.map(s => ({ title: s.title, html: sectionToHtml(s), size: s.body.length })),
    toc,
    words: text.split(/\s+/).length,
  }
}
