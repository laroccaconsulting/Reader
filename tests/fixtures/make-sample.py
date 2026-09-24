#!/usr/bin/env python3
"""Regenerates tests/fixtures/sample.epub (a tiny EPUB 3 used by the e2e tests)."""
import os, struct, zipfile, zlib

HERE = os.path.dirname(os.path.abspath(__file__))

def png(w, h, rgb):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')

chapters = [("The Beginning", "It was a bright cold day in April. " * 60),
            ("The Middle", "The clocks were striking thirteen and the lighthouse keeper smiled. " * 80),
            ("The End", "Everything ended quietly, the way good stories do. " * 50)]
XHTML = '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">'

z = zipfile.ZipFile(os.path.join(HERE, 'sample.epub'), 'w')
z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
z.writestr('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
items = ''.join(f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(3))
spine = ''.join(f'<itemref idref="c{i}"/>' for i in range(3))
z.writestr('OEBPS/content.opf', f'''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:reader-test-sample</dc:identifier><dc:title>A Test Voyage</dc:title><dc:creator>Ada Tester</dc:creator><dc:language>en</dc:language><dc:description>A tiny book used by Reader's automated tests.</dc:description><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta><meta name="cover" content="cover"/></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>{items}<item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine>{spine}<itemref idref="notes" linear="no"/></spine></package>''')
navli = ''.join(f'<li><a href="c{i}.xhtml">{t}</a></li>' for i, (t, _) in enumerate(chapters))
z.writestr('OEBPS/nav.xhtml', f'{XHTML}<head><title>Nav</title></head><body><nav epub:type="toc"><ol>{navli}</ol></nav></body></html>')
for i, (t, body) in enumerate(chapters):
    paras = ''.join(f'<p>{body}</p>' for _ in range(3))
    ref = '<p>See the note.<a href="notes.xhtml#n1" id="r1" epub:type="noteref">1</a></p>' if i == 0 else ''
    # The script must never run: Reader's CSP blocks scripts inside books.
    z.writestr(f'OEBPS/c{i}.xhtml', f'{XHTML}<head><title>{t}</title><script>window.parent.__epubScriptRan = true</script></head><body><h1>{t}</h1>{ref}{paras}</body></html>')
z.writestr('OEBPS/notes.xhtml', f'{XHTML}<head><title>Notes</title></head><body><section epub:type="endnotes"><ol><li id="n1" epub:type="endnote"><p>Lighthouses were once kept by hand. <a href="c0.xhtml#r1" epub:type="backlink">↩</a></p></li></ol></section></body></html>')
z.writestr('OEBPS/cover.png', png(60, 90, (40, 90, 140)))
z.close()
