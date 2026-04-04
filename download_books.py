#!/usr/bin/env python3
"""Download and clean 50 Project Gutenberg books into books/{id}.txt"""

import re, time, urllib.request, urllib.error, os, sys

BOOKS = [
    (1342, "Pride and Prejudice"),
    (84,   "Frankenstein"),
    (1661, "The Adventures of Sherlock Holmes"),
    (11,   "Alice's Adventures in Wonderland"),
    (5200, "The Metamorphosis"),
    (2701, "Moby-Dick"),
    (98,   "A Tale of Two Cities"),
    (844,  "The Importance of Being Earnest"),
    (174,  "The Picture of Dorian Gray"),
    (345,  "Dracula"),
    (2554, "Crime and Punishment"),
    (43,   "Dr Jekyll and Mr Hyde"),
    (120,  "Treasure Island"),
    (36,   "The War of the Worlds"),
    (1513, "Romeo and Juliet"),
    (1524, "Hamlet"),
    (1533, "Macbeth"),
    (1514, "A Midsummer Night's Dream"),
    (74,   "The Adventures of Tom Sawyer"),
    (76,   "Adventures of Huckleberry Finn"),
    (1184, "The Count of Monte Cristo"),
    (1257, "The Three Musketeers"),
    (103,  "Around the World in 80 Days"),
    (164,  "Twenty Thousand Leagues Under the Sea"),
    (3748, "Journey to the Center of the Earth"),
    (35,   "The Time Machine"),
    (5230, "The Invisible Man"),
    (2097, "The Island of Doctor Moreau"),
    (215,  "The Call of the Wild"),
    (910,  "White Fang"),
    (161,  "Sense and Sensibility"),
    (158,  "Emma"),
    (1260, "Jane Eyre"),
    (768,  "Wuthering Heights"),
    (514,  "Little Women"),
    (4300, "Ulysses"),
    (996,  "Don Quixote"),
    (135,  "Les Misérables"),
    (2600, "War and Peace"),
    (1399, "Anna Karenina"),
    (28054,"The Brothers Karamazov"),
    (600,  "Notes from Underground"),
    (1727, "The Odyssey"),
    (6130, "The Iliad"),
    (1497, "The Republic"),
    (2680, "Meditations"),
    (205,  "Walden"),
    (132,  "The Art of War"),
    (2591, "Grimm's Fairy Tales"),
    (11339,"Aesop's Fables"),
    (2852, "The Hound of the Baskervilles"),
]

START_RE = re.compile(r'\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\*{3}', re.I)
END_RE   = re.compile(r'\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\*{3}',   re.I)

def clean(raw):
    text = raw
    m = START_RE.search(text)
    if m:
        text = text[m.end():]
    m = END_RE.search(text)
    if m:
        text = text[:m.start()]
    text = re.sub(r'\r\n', '\n', text)
    text = re.sub(r'\r',   '\n', text)
    text = re.sub(r'\n{4,}', '\n\n\n', text)
    return text.strip()

def fetch(book_id):
    urls = [
        f"https://www.gutenberg.org/cache/epub/{book_id}/pg{book_id}.txt",
        f"https://www.gutenberg.org/files/{book_id}/{book_id}-0.txt",
        f"https://www.gutenberg.org/files/{book_id}/{book_id}.txt",
    ]
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; ReaderApp/1.0)'
            })
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read().decode('utf-8', errors='replace')
                if len(raw) > 500:
                    return raw
        except Exception as e:
            continue
    return None

os.makedirs('books', exist_ok=True)
ok, fail = 0, 0

for i, (book_id, title) in enumerate(BOOKS):
    out = f"books/{book_id}.txt"
    if os.path.exists(out) and os.path.getsize(out) > 500:
        print(f"  skip  [{i+1:2}/{len(BOOKS)}] {title}")
        ok += 1
        continue

    print(f"  fetch [{i+1:2}/{len(BOOKS)}] {title} ... ", end='', flush=True)
    raw = fetch(book_id)
    if raw:
        text = clean(raw)
        with open(out, 'w', encoding='utf-8') as f:
            f.write(text)
        kb = os.path.getsize(out) // 1024
        print(f"OK ({kb}KB)")
        ok += 1
    else:
        print("FAILED")
        fail += 1

    time.sleep(0.6)   # be polite to Gutenberg

print(f"\nDone: {ok} downloaded, {fail} failed")
if fail:
    sys.exit(1)
