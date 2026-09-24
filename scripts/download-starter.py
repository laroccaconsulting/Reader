#!/usr/bin/env python3
"""Download and clean the starter shelf (data/starter.json) into books/{id}.txt.

    python3 scripts/download-starter.py           # fetch missing books
    python3 scripts/download-starter.py --force   # re-fetch everything
"""
import json, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
START_RE = re.compile(r'\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\*{3}', re.I)
END_RE = re.compile(r'\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\*{3}', re.I)


def clean(raw):
    m = START_RE.search(raw)
    if m:
        raw = raw[m.end():]
    m = END_RE.search(raw)
    if m:
        raw = raw[:m.start()]
    raw = re.sub(r'\r\n?', '\n', raw)
    raw = re.sub(r'\n{4,}', '\n\n\n', raw)
    return raw.strip()


def fetch(book_id):
    for url in (f"https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}.txt",
                f"https://www.gutenberg.org/files/{book_id}/{book_id}-0.txt",
                f"https://www.gutenberg.org/files/{book_id}/{book_id}.txt"):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'ReaderStarterShelf/2.0'})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            try:
                text = data.decode('utf-8')
            except UnicodeDecodeError:
                text = data.decode('cp1252', errors='replace')
            if len(text) > 500:
                return text
        except Exception:
            continue
    return None


def main():
    force = '--force' in sys.argv
    books = json.load(open(os.path.join(ROOT, 'data', 'starter.json')))['books']
    os.makedirs(os.path.join(ROOT, 'books'), exist_ok=True)
    failed = 0
    for i, book in enumerate(books, 1):
        out = os.path.join(ROOT, 'books', f"{book['gutenberg']}.txt")
        label = f"[{i:2}/{len(books)}] {book['title']}"
        if not force and os.path.exists(out) and os.path.getsize(out) > 500:
            print(f"  skip  {label}")
            continue
        text = fetch(book['gutenberg'])
        if text is None:
            print(f"  FAIL  {label}")
            failed += 1
            continue
        with open(out, 'w', encoding='utf-8') as f:
            f.write(clean(text))
        print(f"  ok    {label} ({os.path.getsize(out) // 1024} KB)")
        time.sleep(0.6)  # be polite to Gutenberg
    print(f"done, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
