// Prints how the parser splits every bundled book. `node tests/unit/corpus-report.mjs [id]`
import { readFileSync, readdirSync } from 'node:fs'
import { parseText } from '../../app/txt/gutenberg.js'
const only = process.argv[2]
for (const f of readdirSync('books').filter(f => f.endsWith('.txt'))) {
  const id = f.replace('.txt', '')
  if (only && id !== only) continue
  const book = parseText(readFileSync(`books/${f}`, 'utf8'))
  const big = Math.max(...book.sections.map(s => s.html.length))
  const labels = book.toc.map(t => t.subitems ? `${t.label}[${t.subitems.length}]` : t.label)
  console.log(`${id}\tsections=${book.sections.length}\ttoc=${book.toc.length}\tmax=${Math.round(big / 1024)}KB\t${labels.slice(0, only ? 999 : 6).join(' | ')}`)
}
