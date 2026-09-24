/* Map audiobook tracks ("Chapters 1-3", "Chapter 06", "Preface") onto a book's
 * table of contents. Pure functions: unit-tested under node. */

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 }

export function romanToInt(s) {
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }
  const t = s.toUpperCase()
  if (!/^[IVXLCDM]+$/.test(t)) return NaN
  let total = 0
  for (let i = 0; i < t.length; i++) {
    const v = map[t[i]], next = map[t[i + 1]] ?? 0
    total += v < next ? -v : v
  }
  return total
}

const toNumber = token => {
  if (!token) return NaN
  if (/^\d+$/.test(token)) return Number(token)
  const lower = token.toLowerCase()
  if (lower in WORD_NUMBERS) return WORD_NUMBERS[lower]
  return romanToInt(token)
}

/** "Chapters 1-3" -> [1, 3]; "Chapter 06" -> [6, 6]; "Chapter XIV" -> [14, 14]; else null. */
export function trackRange(title = '', fileName = '') {
  const m = /\bchap(?:ter)?s?\.?\s*([0-9]+|[ivxlc]+|[a-z]+)(?:\s*(?:-|–|—|to|&|and)\s*([0-9]+|[ivxlc]+|[a-z]+))?/i.exec(title)
  if (m) {
    const a = toNumber(m[1]), b = m[2] ? toNumber(m[2]) : a
    if (a > 0) return [a, b > 0 ? b : a]
  }
  // LibriVox file names: prideandprejudice_01-03_austen_64kb.mp3
  const f = /_(\d{1,3})(?:-(\d{1,3}))?_[a-z]+_(?:64kb|128kb)\.mp3$/i.exec(fileName)
  if (f && !/^(intro|preface|prologue)/i.test(title)) {
    const a = Number(f[1]), b = f[2] ? Number(f[2]) : a
    return [a, b]
  }
  return null
}

const CHAPTERISH = /^(?:chapter|chap\.?|stave|letter)\s+([0-9]+|[ivxlcdm]+|[a-z]+)\b|^([ivxlcdm]+|\d+)\.?(?:\s|$)/i

const flatten = items => items.flatMap(i => [i, ...flatten(i.subitems ?? [])])

/** The book's chapters in reading order, with their chapter numbers when known. */
export function chapterList(toc) {
  const all = flatten(toc)
  const chapters = all
    .map(item => {
      const m = CHAPTERISH.exec((item.label ?? '').trim())
      return m ? { item, n: toNumber(m[1] ?? m[2]) } : null
    })
    .filter(Boolean)
  return { all, chapters }
}

const norm = s => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Attach a TOC href to each track.
 * Chapter numbers are matched by ordinal (the Nth chapter-like entry), which also
 * works for books whose chapter numbering restarts each volume, as LibriVox numbers
 * continuously. Untitled or non-chapter tracks match by label (Preface, Epilogue),
 * otherwise they follow the previous track.
 */
export function mapTracks(tracks, toc) {
  const { all, chapters } = chapterList(toc)
  let lastIndex = -1
  return tracks.map((track, i) => {
    let target = null
    const range = trackRange(track.title, track.name)
    if (range && chapters.length) {
      const ordinal = Math.min(range[0], chapters.length) - 1
      target = chapters[ordinal]?.item ?? null
    }
    if (!target) {
      const key = norm(track.title).replace(/^(section|part|track)\s*\d+\s*/, '')
      if (key) target = all.find(item => norm(item.label).startsWith(key) || (key.length > 5 && norm(item.label).includes(key))) ?? null
    }
    if (!target && i === 0) target = all[0] ?? null
    const index = target ? all.indexOf(target) : -1
    if (index >= 0) lastIndex = index
    return { ...track, range, href: target?.href ?? all[lastIndex]?.href ?? null, label: target?.label ?? null }
  })
}
