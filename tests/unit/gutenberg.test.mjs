import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { parseText, formatTitle, blocksToHtml, cleanText } from '../../app/txt/gutenberg.js'

const load = id => parseText(readFileSync(`books/${id}.txt`, 'utf8'))
const labels = book => book.toc.flatMap(t => [t.label, ...(t.subitems ?? []).map(s => s.label)])

test('formatTitle keeps roman numerals and title-cases shouting', () => {
  assert.equal(formatTitle('CHAPTER XIV. THE SECRET OF THE SEA'), 'Chapter XIV. The Secret of the Sea')
  assert.equal(formatTitle('ACT I'), 'Act I')
  assert.equal(formatTitle('WHERE I LIVED, AND WHAT I LIVED FOR'), 'Where I Lived, and What I Lived For')
  assert.equal(formatTitle('Chapter 1. Loomings.'), 'Chapter 1. Loomings.')
  assert.equal(formatTitle('LES MISÉRABLES'), 'Les Misérables')
  assert.equal(formatTitle('CHAPTER I. IN WHICH PHILEAS FOGG'), 'Chapter I. In Which Phileas Fogg')
})

test('blocksToHtml keeps paragraphs, italics, verse and escapes HTML', () => {
  const html = blocksToHtml('One _two_ three and a fairly long line of prose that wraps like Gutenberg\nfour.\n\n<script>x</script>\n\nshort line\nshort line two\nand three')
  assert.match(html, /<p>One <em>two<\/em> three and a fairly long line of prose that wraps like Gutenberg four\.<\/p>/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /<p class="verse">short line<br>short line two<br>and three<\/p>/)
})

test('cleanText strips Gutenberg boilerplate', () => {
  const raw = 'Header\r\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\r\nBody text\r\n*** END OF THE PROJECT GUTENBERG EBOOK X ***\r\nLicense'
  assert.equal(cleanText(raw), 'Body text')
})

test('every bundled book keeps its paragraphs and has sane sections', () => {
  for (const f of readdirSync('books').filter(f => f.endsWith('.txt'))) {
    const book = parseText(readFileSync(`books/${f}`, 'utf8'))
    assert.ok(book.sections.length >= 3, `${f}: only ${book.sections.length} sections`)
    for (const s of book.sections) {
      assert.ok(s.html.length < 150_000, `${f}: section "${s.title}" is ${s.html.length} chars`)
    }
    const paras = book.sections.reduce((n, s) => n + (s.html.match(/<p[ >]/g) || []).length, 0)
    assert.ok(paras >= book.sections.length, `${f}: paragraphs lost (${paras})`)
    for (const l of labels(book)) assert.doesNotMatch(l, /\b(?:Xiv|Iii|Vii)\b/, `${f}: lowercased numeral in "${l}"`)
  }
})

test('previously broken books now split into real chapters', () => {
  assert.deepEqual(labels(load(5200)), ['I', 'II', 'III'])                       // Metamorphosis
  assert.equal(labels(load(43))[1], 'Story of the Door')                         // Jekyll & Hyde
  assert.equal(labels(load(1661))[1], 'I. A Scandal in Bohemia')                 // Sherlock Holmes
  assert.ok(labels(load(11339)).includes('The Fox and the Grapes'))              // Aesop
  assert.ok(labels(load(2591)).includes('Hans in Luck'))                         // Grimm
})

test('illustration captions are removed and multi-line italics kept', () => {
  const pp = load(1342)
  const all = pp.sections.map(s => s.html).join('')
  assert.doesNotMatch(all, /\[Illustration/)
  assert.match(blocksToHtml('_To J. Comyns Carr\nin acknowledgment_'), /<em>To J\. Comyns Carr<br>in acknowledgment<\/em>/)
})

test('contents lists are not mistaken for chapters (order is preserved)', () => {
  const moby = labels(load(2701))
  assert.equal(moby[1], 'Etymology.')
  assert.equal(moby.indexOf('Chapter 1. Loomings.'), 3)
  assert.equal(labels(load(74))[1], 'Preface')                                   // Tom Sawyer
  const hamlet = load(1524).toc.map(t => t.label)
  assert.deepEqual(hamlet.slice(1), ['Act I', 'Act II', 'Act III', 'Act IV', 'Act V'])
  const dracula = labels(load(345))
  assert.equal(new Set(dracula).size, dracula.length, 'duplicate chapters in Dracula')
})
