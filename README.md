# Read Free

A free, open-source ereader for the web that works **fully offline**, installs
like a native app, and connects directly to the great free libraries. **No ads,
no accounts and no tracking, ever.**

**Use it:** https://readfree.app (then *Add to Home Screen* / *Install*)

## Features

- **Reads almost anything:** EPUB 2/3, plain text, FB2, MOBI/AZW3, CBZ. Rendering is by [foliate-js](https://github.com/johnfactotum/foliate-js).
- **Free libraries, built in:** browse and search [Standard Ebooks](https://standardebooks.org)
  (one-tap downloads) and [Project Gutenberg](https://www.gutenberg.org) (75,000+ books; downloads
  need a [relay](relay/README.md)). 51 classics come bundled for offline reading.
- **Offline first:** the app and your books live on your device. After the first visit it works in airplane mode.
- **Beautiful typography:** Literata, Atkinson Hyperlegible, OpenDyslexic, justification and hyphenation,
  one or two pages at a time, or scrolling. Themes: light, sepia, dark and true black.
- **Reading tools:** a real table of contents, bookmarks, full-text search, a position slider,
  read-aloud with your device's voices, and a speed-reading (RSVP) mode that picks up where you are.
- **Autopilot:** hands-free reading. In page mode a progress bar fills as you read; hold anywhere
  when you need longer (the page turns when you let go), tap ahead to turn early, and it learns your
  pace. In scroll mode the text glides at your words-per-minute, with hold-to-pause and fine +/− control.
- **Share quotes:** select text → share a tasteful quote card (square, story or wide) and a link that
  opens the exact passage, even for someone who doesn't have the book yet. See [docs/SHARING_AND_DOMAIN.md](docs/SHARING_AND_DOMAIN.md).
- **Yours:** import your own files (button, drag and drop, or *Open with* on desktop), and export a backup of your progress and bookmarks.
- **Private by construction:** a strict Content-Security-Policy means no third-party code can run,
  including scripts embedded in books. See [PRIVACY.md](PRIVACY.md).

## Development

No build step and no framework: plain ES modules served as static files.

```sh
npm install            # dev tooling only (Playwright)
npm run serve          # http://localhost:8080
npm test               # unit tests: text parser over every bundled book
npm run test:e2e       # browser tests: mobile + desktop, including offline mode
npm run build          # regenerate sw.js + app/version.js after changing any file
```

`sw.js` is generated: `scripts/build.mjs` precaches every app file under a content hash,
so each deploy updates cleanly (users get a "new version" prompt). CI fails if you forget
to run `npm run build`.

| Path | What |
|---|---|
| `app/` | Application modules (`main.js` entry point, `reader/`, `catalog/`, `txt/`, `ui/`) |
| `vendor/foliate-js/` | Vendored rendering engine (MIT); see `VERSION` for the upstream commit |
| `data/starter.json` | The bundled starter shelf, the single source of truth |
| `books/` | Plain-text starter books, refreshed by `scripts/download-starter.py` |
| `relay/` | Optional Cloudflare Worker that makes Gutenberg downloads possible |
| `docs/` | Evaluation and roadmap |

## Licence

Read Free is licensed under the [GNU GPL v3 or later](LICENSE). Bundled components keep their own
licences: foliate-js (MIT), zip.js (BSD-3-Clause), fflate (MIT), fonts (SIL OFL 1.1, see
`fonts/`). The book texts are in the public domain in the USA.
