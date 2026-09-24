# Reader — Evaluation & Roadmap

_Evaluation of `claude/offline-ereader-app-k5Pz3` @ `8d2cdc6`, September 2026._

**Vision:** the best fully offline, installable, open-source ereader on the web. It connects directly and cleanly to free public-domain libraries. No ads, no tracking and no accounts, ever.

> **Status (Milestone A, shipped):** rebuilt on foliate-js with EPUB/TXT/FB2/MOBI/CBZ support, CFI-based
> progress, a new contents-aware text parser (all 51 starter books pass the regression corpus), Standard Ebooks and
> Project Gutenberg in Discover, local import, bookmarks, in-book search, read-aloud, RSVP v2, backup/restore,
> a hashed service-worker precache, a CSP, GPL-3.0 licence, and CI with unit plus Playwright (mobile, desktop and offline) tests.
> CORS findings from CI: Standard Ebooks, Gutenberg OPDS, Internet Archive, Open Library and Wikisource allow
> browser access; Gutenberg *files* do not (on any mirror), hence the optional `relay/`.

---

## 1. Summary

The prototype is a good start. It is about 110 KB of hand-written HTML, CSS and JS with no dependencies. It installs as a PWA and works offline once books are cached. The typography is pleasant, with three themes and swipe navigation, and it has a working RSVP speed-reader. It shows the product can feel good.

It can't grow into the vision as it stands. It reads **Gutenberg plain text only** and splits chapters with a regex, which breaks many books (details in §3). It saves reading position as a pixel scroll offset. It gets books from a CORS proxy run by someone else, and it carries 39 MB of text in git. Everything important we want next depends on a real document model: EPUB, real tables of contents, highlights, search, pagination and imports.

**Recommendation:** keep the design language and UX ideas. Rebuild the core on EPUB with a proven rendering engine ([foliate-js](https://github.com/johnfactotum/foliate-js), MIT). Add a real storage layer and position locators. Connect to libraries through **OPDS** and the **Gutendex** API instead of a hard-coded list of 50 books.

---

## 2. What works well (keep)

| Area | Notes |
|---|---|
| Zero-dependency, fast shell | The app shell loads instantly, with no framework cost. Keep the bundle this small as a goal. |
| Visual design | Clean library grid, genre colours, bottom-sheet panels, three reading themes, `prefers-reduced-motion` respected. |
| Offline model | The service worker caches the shell and book text goes into IndexedDB. The direction is right, but see the issues below. |
| RSVP mode | Pivot-letter (ORP) centring and punctuation-aware pauses. A real differentiator, so keep and extend it. |
| Encoding | The Latin-1/UTF-8 fallback works. **0 mojibake sequences** across all 51 bundled books (checked). |
| iOS care | Safe-area insets, standalone mode fixes and status-bar handling were all worked through. |
| Graceful degradation | Keeps working in memory only if IndexedDB is unavailable (Safari private mode). |

---

## 3. Measured problems

I ran the app's own `splitIntoChapters()` over every bundled book in `books/` to get the numbers below.

### 3.1 Correctness bugs (fix now)

| # | Problem | Evidence | Impact |
|---|---|---|---|
| B1 | **The fallback chapter splitter removes all paragraph breaks.** `splitByWordCount` joins words with `' '`. | `js/app.js:223-231`. **8 of 51 books** read as one wall of text: *The Metamorphosis, Jekyll & Hyde, The Time Machine, Sherlock Holmes, Walden, The Count of Monte Cristo, Grimm, Aesop*. | Severe. Some of the best-known titles can't be read comfortably. |
| B2 | **Table-of-contents lines are detected as chapters**, which puts chapters out of order. | *Moby-Dick* opens on "Epilogue". *Midsummer*: `Act v, Act i, Scene ii…`. *Tom Sawyer* opens on "Chapter xxxiv". *Dracula* has "Chapter i" twice. | The TOC and the reading order are wrong. |
| B3 | **Huge single "chapters".** | *Ulysses* has 2 chapters with one of 1.07 MB. *The Republic* has chapters of up to 826 KB. | The page freezes on low-end phones because the whole chapter is inserted as one `innerHTML`. |
| B4 | **`toTitleCase` lowercases Roman numerals.** | "Chapter xiv", "Act iii" (`js/app.js:233`). | Looks broken in the TOC and header. |
| B5 | **Escape inside RSVP closes the whole book.** Arrow keys in RSVP also change the chapter underneath. | Two `document` keydown listeners, `js/app.js:906` and `js/app.js:1174`. Both fire. | Lost place and a confusing experience. |
| B6 | **The book-download workflow can't run.** `if False:` has no body. | `.github/workflows/download-books.yml:82`: `IndentationError` (verified with `py_compile`). | The book pipeline is broken. It is also hard-wired to a feature branch (`:15`). |
| B7 | **Reading position is saved as pixel `scrollTop`.** | `js/app.js:625`. | Changing font size, margins or rotating the device loses your place. Highlights and sync can't be built on this. |
| B8 | **Progress % is chapters read ÷ chapters.** | `js/app.js:626`, `:366`. | Wrong when chapter lengths vary, which is almost always. |
| B9 | **The service worker's offline fallback returns `index.html` for any failed same-origin request**, including `books/*.txt`. | `sw.js:50`. | A book only avoids being saved as HTML because `index.html` happens not to contain the word "the". Fragile. |
| B10 | **Book cards can't be opened from the keyboard.** They have `role="button" tabindex="0"` but no Enter/Space handler. | `js/app.js:355-360`. | Accessibility failure. |

### 3.2 Architecture and product gaps

- **Text only.** No EPUB, so no images, footnotes, real TOCs, poetry layout or semantic italics. Gutenberg's own EPUB3 files and all of **Standard Ebooks** are much better sources than `.txt`.
- **The catalog is hard-coded 3 times.** `js/books.js`, `download_books.py` and the workflow each keep their own list of the same 50 books, and they have already drifted apart (titles differ).
- **Third-party CORS proxy (`corsproxy.io`).** Every fallback download sends the reader's IP address and reading choices to an unknown third party (`js/app.js:140`). That goes against "no tracking, ever".
- **39 MB of book text committed to git.** Every clone carries it, and every "re-download" commit adds more history that can't be removed.
- **Double storage.** The service worker also saves each `books/*.txt` response in Cache Storage (`sw.js:44-48`), so books are stored twice.
- **Automatic 39 MB download on first visit** (`js/app.js:1017`), without asking. That is bad on metered data.
- **No `navigator.storage.persist()`.** Browsers are free to evict the library.
- **Service-worker updates by hand.** The `CACHE` name is bumped manually, and three commits in the history exist only to "bust the cache". The shell is cache-first with no revalidation, so users can be stuck on stale code.
- **Performance.** `renderChapter` re-counts the words of every remaining chapter on each page turn (`js/app.js:507`). For *War and Peace* (366 chapters) that is about 3 MB of `split()` per tap.
- **Installability and icons.** There is only an SVG icon, and iOS ignores SVG `apple-touch-icon`. There are no 192/512 PNG or maskable icons. `theme_color` (#6B5EA8) doesn't match the UI.
- **Typography.** The "Mono" option is stored as `dyslexic` and uses Courier. There are no bundled open fonts, no hyphenation, no justification option and no pagination mode.
- **Accessibility.** Panels don't trap focus or restore it. There are no visible focus styles to check against. The font-size range in px (14–28) ignores the user's OS text size.
- **Project basics.** No LICENSE, README, tests, lint or CI checks, and no privacy statement. It can't honestly be called "open source" yet.
- **Unused state.** `dlCount`. `getBookColors` ignores its `index` argument.

---

## 4. Target architecture

```
┌────────────────────────────── App shell (PWA) ─────────────────────────────┐
│  Library UI · Discover UI · Reader UI · Settings            (vanilla TS +  │
│                                                              web comps)    │
├──────────────┬───────────────────┬────────────────────┬────────────────────┤
│ Render engine│ Catalog layer     │ Storage layer      │ Service worker     │
│ foliate-js   │ OPDS 1.2/2.0      │ IndexedDB (idb):   │ Hashed precache    │
│ EPUB·FB2·CBZ │ Gutendex search   │  books (Blob)      │ Stale-while-reval. │
│ TXT→EPUB conv│ Standard Ebooks   │  meta · progress   │ Share-target /     │
│ paged+scroll │ Internet Archive  │  annotations       │ file-handler       │
│ CFI locators │ Wikisource export │  catalog cache     │ Background fetch   │
│              │ User OPDS feeds   │ persist() · quota  │ (where supported)  │
└──────────────┴───────────────────┴────────────────────┴────────────────────┘
          Optional, self-hostable, logless CORS relay (Cloudflare Worker, ~40 LOC)
```

Key decisions (each open to debate):

1. **EPUB is the canonical format.** Plain-text sources are converted to a small internal structure (or to EPUB) on import, so one rendering path serves everything.
2. **foliate-js is the renderer.** It is MIT licensed, needs no build step, is actively maintained and powers the Foliate desktop app. It already handles EPUB, MOBI/AZW3, FB2, CBZ and PDF, paginated and scrolled layouts, CFI locators, search and TTS hooks. Writing our own EPUB engine would cost months.
3. **Locators, not pixels.** EPUB CFI (or `{spine, paragraph, charOffset}` for text) drives progress, bookmarks, highlights, "% read" and future sync.
4. **Library integration through open standards.** OPDS means any catalog works (Standard Ebooks, Gutenberg's OPDS, Feedbooks PD, Internet Archive, and the user's own Calibre-Web, Kavita or Komga). Gutendex adds fast full-catalog search over Gutenberg's roughly 75k titles.
5. **CORS strategy.** I couldn't verify these endpoints' CORS headers from this environment because the sandbox proxy blocked the requests. **This needs a spike (task P1.6).** Order of preference:
   (a) direct fetch where the source sends `Access-Control-Allow-Origin`;
   (b) our own open-source, logless relay that users can self-host or turn off entirely;
   (c) a curated "starter shelf" mirrored as GitHub Release assets or on the Pages deploy (not in git history);
   (d) local import (drag and drop, file picker, share target), which always works.
   Drop `corsproxy.io`.
6. **Privacy is enforced by the browser, not just promised.** A strict `Content-Security-Policy` with a `connect-src` allow-list of library domains makes it technically impossible to add trackers or ads by accident. Stay tooling-light: Vite and TypeScript for development, static output, no runtime framework.
7. **Licence.** The user's call. My suggestion is **GPL-3.0-or-later**: any distributed fork must stay open, which protects the "no ads, open source" promise. It is compatible with MIT dependencies such as foliate-js. MIT is the alternative if maximum reuse matters more.

---

## 5. Action plan

Sizes: S ≈ ≤1 day, M ≈ 2–4 days, L ≈ 1–2 weeks (single developer).

### Phase 0: Stabilise what exists (S–M, do first)
- [ ] P0.1 Fix B1: keep newlines when splitting by size, and split at paragraph boundaries.
- [ ] P0.2 Fix B2: ignore headings inside the leading "Contents" block, enforce increasing order, and remove duplicate chapters.
- [ ] P0.3 Fix B3: cap chapter size by splitting long chapters into sections at paragraph breaks.
- [ ] P0.4 Fix B4: keep Roman numerals upper-case.
- [ ] P0.5 Fix B5: use a single keydown dispatcher that knows which view is on top (RSVP > panel > reader > library).
- [ ] P0.6 Fix B6: make one `catalog.json` the single source of truth for the app, the script and the workflow. The workflow should run on `main`.
- [ ] P0.7 Fix B9 and double storage: the service worker should fall back only on `navigate` requests and not cache `books/`.
- [ ] P0.8 Fix B10, and ask before the 39 MB auto-download (offer "Download starter shelf (39 MB)?").
- [ ] P0.9 Add `LICENSE`, `README.md` and `PRIVACY.md` ("we collect nothing"), plus PNG icons (180/192/512 and maskable).

### Phase 1: Foundation (L)
- [ ] P1.1 Tooling: Vite, TypeScript, ES modules, ESLint/Prettier, Vitest and Playwright. CI on every PR, deploy to Pages from `main`.
- [ ] P1.2 Service worker with a hashed precache manifest (Workbox or hand-written), stale-while-revalidate, and an "Update available, reload" prompt. No more manual cache bumps.
- [ ] P1.3 Storage layer on `idb`: `books` (Blob plus metadata), `progress` (locator), `annotations`, `collections`, `catalogCache`. Include schema migrations, a `persist()` request and a quota display.
- [ ] P1.4 Locator model to replace pixel `scrollTop`. Migrate existing progress.
- [ ] P1.5 A regression corpus test: run the parser over every starter book in CI and check chapter counts, order and that paragraphs are kept.
- [ ] P1.6 **CORS spike**: document which of Gutenberg, Gutendex, Standard Ebooks, Internet Archive and Wikisource can be fetched directly. Build the optional relay only if it is needed.
- [ ] P1.7 CSP meta/header with a `connect-src` allow-list, plus an e2e test asserting zero third-party requests on a cold start.

### Phase 2: A real reading engine (L)
- [ ] P2.1 Integrate foliate-js with a paginated mode (tap zones and page-curl or slide) and a scrolled mode.
- [ ] P2.2 Import local files: EPUB, TXT, FB2, CBZ and PDF, via the picker, drag and drop, the manifest `file_handlers` and `share_target`.
- [ ] P2.3 Convert Gutenberg TXT to a structured book using the fixed parser, as a fallback only.
- [ ] P2.4 Typography: bundle open fonts (Literata, Atkinson Hyperlegible, OpenDyslexic, iA Writer Quattro or similar), add `hyphens:auto` with the correct `lang`, a justification toggle, paragraph spacing or indent, and rem-based sizing that respects the OS text size.
- [ ] P2.5 Real covers from the EPUB or the catalog, falling back to the current generated genre covers (they look good).

### Phase 3: Direct library integration (L)
- [ ] P3.1 **Discover** tab with Gutendex search (title, author, subject, language), sorted by popularity, with infinite scroll and cached results for offline browsing.
- [ ] P3.2 OPDS 1.2/2.0 client: browse, search, facets and acquisition links. Built-in feeds for Standard Ebooks, Gutenberg and Internet Archive, and "Add your own feed" (Calibre-Web, Kavita and others).
- [ ] P3.3 Source preference: when a title exists in several sources, prefer Standard Ebooks, then Gutenberg EPUB3 with images, then Gutenberg EPUB, then TXT.
- [ ] P3.4 Download manager: a queue, retry with backoff, size shown before download, pause and resume, Background Fetch where the browser supports it, and a per-book storage breakdown and delete.
- [ ] P3.5 A curated starter shelf built from `catalog.json` at deploy time and hosted as release assets, not in git.
- [ ] P3.6 Attribution: a source link, licence and transcriber credits on each book page, following the Project Gutenberg trademark rules.

### Phase 4: Reading power features (L)
- [ ] P4.1 Highlights (several colours) and notes, anchored to locators. Export to Markdown or JSON.
- [ ] P4.2 Full-text search inside a book and across the library (an index built in a Web Worker).
- [ ] P4.3 Text-to-speech with the Web Speech API (on-device voices work offline), sentence highlighting and a sleep timer.
- [ ] P4.4 RSVP v2: start from the current position, move the position forward on exit, open across chapters and show the surrounding sentence while paused.
- [ ] P4.5 Offline dictionary: an optional downloadable pack (e.g. WordNet or a Wiktionary extract) with long-press to look up a word.
- [ ] P4.6 Reading stats (time, pages and streaks, stored only on the device), shelves and collections, and "Continue reading" at the top of the library.

### Phase 5: Polish, reach, trust (M–L)
- [ ] P5.1 A full WCAG 2.2 AA audit: focus trap and restore in panels, screen-reader labels, contrast in all themes, reduced motion.
- [ ] P5.2 i18n of the UI, plus right-to-left and vertical-writing support through foliate-js.
- [ ] P5.3 Backup and restore of the library, annotations and settings to a file. Optional sync the user controls (WebDAV or remoteStorage), never our own server.
- [ ] P5.4 Performance budgets enforced in CI: shell < 100 KB gzip, cold start < 1 s on a mid-range Android, opening a cached book < 300 ms.
- [ ] P5.5 Contributor docs, issue templates and a public roadmap.

---

## 6. Definition of "best"

| Pillar | Measurable bar |
|---|---|
| Offline | Full e2e test suite passes in airplane mode after first load. Library survives storage pressure (`persist()` granted). |
| Beautiful | Typography that matches a native app: open fonts, hyphenation, pagination, and a book-accurate TOC for every starter title. |
| Library access | Any of the roughly 75k Gutenberg titles, all Standard Ebooks and any OPDS feed within 2 taps of search. |
| Efficient | Lighthouse PWA and Performance ≥ 95. Budgets from P5.4 are held in CI. |
| Private and ad-free | CSP-enforced zero third-party requests without user action. No analytics, ever. `PRIVACY.md` in the repo. |
| Open | Copyleft (or MIT) licence, reproducible build, CI-tested, and documented for contributors. |

---

## 7. Suggested next step

Start **Phase 0** on this branch. It is small, fixes visible bugs for readers today, and gives us the regression corpus (P1.5) to protect the parser while the EPUB engine lands.
