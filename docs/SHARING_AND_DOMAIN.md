# Sharing quotes, and getting a domain

## What ships today (step 1, no server)

Select text → **Share** (or the share icon on a saved highlight):

- **Quote image** made on the device, in Literata. Shapes: square 1080², story 1080×1920,
  wide 1200×630. Styles: Paper, Ink, Cover (the book's colour). Share it through the phone's share
  sheet or save it.
- **Passage link**, for public-domain books from the starter shelf, Standard Ebooks or Gutenberg:

  ```
  https://laroccaconsulting.github.io/Reader/#/q/pg1342?t=<quote>&p=<before>&s=<after>&b=<title>&a=<author>&c=<cfi>
  ```

  - `pg1342` / `se:mary-shelley/frankenstein` name the **book**, not a file, so a link made in the
    Gutenberg text still opens in the Standard Ebooks edition.
  - The passage is found by its **text plus a little context** (the same idea as browser Text
    Fragments). `c` (CFI) is only a shortcut when the edition matches.
  - `b`/`a` let the landing card show title and author with no network request.
  - Someone without the book sees the quote and **Read it free**, which downloads the book and
    opens it at the passage, highlighted.
- Books you imported yourself can be shared only as an image of a short quote (≤ 280 characters),
  never as a link. That keeps Reader from being a way to redistribute copyrighted text.

Limitation until step 2: link previews in iMessage, WhatsApp, Slack or X show the generic app card,
not the quote. Link previews are built by bots that don't run JavaScript, and everything after
`#` never reaches a server.

## Step 2 (needs a domain + one Cloudflare Worker)

One stateless Worker on the domain, deployed alongside the Gutenberg relay:

| Path | Returns |
|---|---|
| `/q/pg1342?t=…` | A tiny HTML page with `og:title`, `og:description`, `og:image` for that quote, then redirects people to the app at `/#/q/…` |
| `/img/pg1342.png?t=…` | The quote card rendered on the fly (same design as the app) |
| `/oembed?url=…` | oEmbed JSON, so pasting a link into WordPress, Medium or Notion embeds the card |

It stores nothing, because the quote is in the URL. The app would then share `https://<domain>/q/…`
links instead of `#/q/…`, and old links keep working.

## Choosing a domain

What matters for a viral share link: **short, readable aloud, and trustworthy-looking** in a
preview.

- Ideas to check for availability: `readfree.ink`, `reader.page`, `pagesofold.com`, `quote.ink`,
  `readerapp.org`, `openreader.app`, `rdr.ink`. Short `.ink`, `.page` and `.app` names suit books,
  and `.page`/`.app` are HTTPS-only by design.
- Register it through **Cloudflare Registrar** (sold at cost, no markup, free WHOIS privacy). It
  also puts the DNS where the Worker lives, so step 2 is a few clicks. Porkbun and Namecheap are
  fine alternatives.
- Expect roughly $10–20/year for `.org`/`.com`/`.page`/`.ink`.

## Connecting it (once you have one)

1. **App on GitHub Pages:** repo *Settings → Pages → Custom domain* → enter e.g. `readfree.ink`,
   tick *Enforce HTTPS*. In DNS add the four GitHub Pages `A` records (and `AAAA`), or a `CNAME` for
   a subdomain such as `app.readfree.ink`. GitHub adds a `CNAME` file to the branch.
2. **Worker:** route `readfree.ink/q/*`, `/img/*` and `/oembed*` to it (Cloudflare dashboard →
   Workers → Routes).
3. **Heads-up:** the app's origin changes, and browsers keep offline data per origin. To avoid
   anyone losing their library, keep the old github.io address working and show a one-time "Move my
   library" prompt that exports and imports the backup (the backup feature already exists).

Tell me the domain when you have it and I'll do the Worker, the link switch and the migration prompt.
