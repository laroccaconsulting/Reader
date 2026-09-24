import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseShare, sharePage, oembed, card } from '../../site/preview.js'
import { buildLink, shareBase, SHARE_SITE, parseLink } from '../../app/share/quote-link.js'

const link = buildLink({ ref: 'se:jane-austen/pride-and-prejudice', text: 'It is a truth universally acknowledged', prefix: 'CHAPTER I', suffix: ', that a single', title: 'Pride and Prejudice', author: 'Jane Austen' }, SHARE_SITE)

test('share links on the official sites use readfree.app paths', () => {
  assert.equal(shareBase('https://readfree.app'), SHARE_SITE)
  assert.equal(shareBase('https://laroccaconsulting.github.io'), SHARE_SITE)
  assert.equal(shareBase('http://localhost:4173'), null)
  assert.match(link, /^https:\/\/readfree\.app\/q\/se%3Ajane-austen%2Fpride-and-prejudice\?t=It\+is/)
  // what the service worker / preview page hands to the app still parses
  const u = new URL(link)
  const app = parseLink(`#/q/${u.pathname.slice(3)}${u.search}`)
  assert.equal(app.ref, 'se:jane-austen/pride-and-prejudice')
  assert.equal(app.suffix, ', that a single')
})

test('the preview server accepts only library books and valid quotes', () => {
  const share = parseShare(new URL(link))
  assert.equal(share.kind, 'q')
  assert.equal(share.ref, 'se:jane-austen/pride-and-prejudice')
  assert.equal(share.title, 'Pride and Prejudice')
  assert.equal(parseShare(new URL('https://readfree.app/img/pg1342.png?t=Hi')).kind, 'img')
  assert.equal(parseShare(new URL('https://readfree.app/img/pg1342?t=Hi')), null)
  assert.equal(parseShare(new URL('https://readfree.app/q/local-book?t=Hi')), null)
  assert.equal(parseShare(new URL('https://readfree.app/q/pg1342')), null)
  assert.equal(parseShare(new URL(`https://readfree.app/q/pg1342?t=${'word '.repeat(200)}`)).text.length <= 280, true)
})

test('the preview page escapes everything and points bots at the card', () => {
  const share = parseShare(new URL('https://readfree.app/q/pg1342?t=%3Cscript%3Ealert(1)%3C%2Fscript%3E%22&b=A%20%26%20B'))
  const html = sharePage(share)
  assert.ok(!html.includes('<script>'))
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /property="og:image" content="https:\/\/readfree\.app\/img\/pg1342\.png\?t=/)
  assert.match(html, /name="twitter:card" content="summary_large_image"/)
  assert.match(html, /http-equiv="refresh" content="0; url=\/#\/q\/pg1342\?/)
  assert.equal(oembed(share).type, 'photo')
})

test('the card adds back the ellipsis of a shortened quote', () => {
  const text = c => JSON.stringify(card(c))
  assert.match(text({ ref: 'pg1', text: 'and so it went', title: '', author: '' }), /and so it went…/)
  assert.doesNotMatch(text({ ref: 'pg1', text: 'The end.', title: '', author: '' }), /The end\.…/)
})
