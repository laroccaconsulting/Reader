#!/usr/bin/env node
/* Performance budget: gzip size of the code needed to show the library (CI gate). */
import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

const BUDGET_KB = 110 // app shell: HTML + CSS + JS loaded at startup (fonts and books excluded)
const startup = [
  'index.html', 'styles/app.css', 'styles/fonts.css', 'app/boot-theme.js',
  'app/main.js', 'app/db.js', 'app/library.js', 'app/settings.js', 'app/net.js', 'app/version.js', 'app/stats.js', 'app/sw-client.js',
  'app/reader/reader.js', 'app/reader/rsvp.js', 'app/reader/tts.js', 'app/reader/highlights.js', 'app/reader/define.js', 'app/reader/autopilot.js',
  'app/ui/dom.js', 'app/ui/covers.js', 'app/ui/discover.js', 'app/ui/type-sheet.js', 'app/ui/settings-screen.js', 'app/ui/install.js',
  'app/share/quote-link.js', 'app/share/quote-image.js', 'app/share/share-sheet.js', 'app/reader/footnotes.js',
  'app/catalog/standard-ebooks.js', 'app/catalog/gutenberg.js', 'app/catalog/opds.js', 'app/txt/txt-book.js', 'app/txt/gutenberg.js',
  'vendor/foliate-js/view.js', 'vendor/foliate-js/epubcfi.js', 'vendor/foliate-js/progress.js',
  'vendor/foliate-js/overlayer.js', 'vendor/foliate-js/text-walker.js', 'vendor/foliate-js/opds.js',
]
let total = 0
for (const f of startup) total += gzipSync(readFileSync(f)).length
const kb = total / 1024
console.log(`startup payload: ${kb.toFixed(1)} KB gzip (budget ${BUDGET_KB} KB)`)
if (kb > BUDGET_KB) { console.error('Over budget!'); process.exit(1) }
