/* App settings screen: appearance, downloads/relay, storage, backup, about. */

import * as db from '../db.js'
import * as library from '../library.js'
import { settings, update, THEMES } from '../settings.js'
import { relayed } from '../net.js'
import { $, html, toast, formatBytes } from './dom.js'
import { APP_VERSION } from '../version.js'

const THEME_LABELS = { auto: 'Match system', light: 'Light', sepia: 'Sepia', dark: 'Dark', black: 'Black' }

export async function renderSettings(root, { refreshLibrary, importFiles }) {
  const [books, estimate, persisted] = await Promise.all([
    library.listBooks(),
    db.storageEstimate(),
    navigator.storage?.persisted?.().catch(() => false) ?? false,
  ])
  const onDevice = books.filter(b => b.downloaded)
  const bookBytes = onDevice.reduce((n, b) => n + (b.size ?? 0), 0)

  root.innerHTML = String(html`
    <section class="settings-group">
      <h2>Appearance</h2>
      <div class="card">
        <div class="row"><div class="row-main">
          <div class="row-title" id="theme-title">Theme</div>
          <div class="options" role="radiogroup" aria-labelledby="theme-title" style="margin-top:10px">
            ${Object.entries(THEME_LABELS).map(([k, label]) => html`
              <button class="option" role="radio" data-theme-opt="${k}" aria-checked="${String(settings.theme === k)}">
                <span class="theme-dot" style="background:${k === 'auto' ? 'linear-gradient(135deg,#FAFAF8 50%,#18181B 50%)' : THEMES[k].bg}"></span>${label}
              </button>`)}
          </div>
          <div class="row-sub" style="margin-top:10px">Fonts, text size, spacing and page layout are in the <strong>Aa</strong> menu while reading.</div>
        </div></div>
      </div>
    </section>

    <section class="settings-group">
      <h2>Downloads</h2>
      <div class="card">
        <div class="row"><div class="row-main">
          <div class="row-title"><label for="relay-url">Download relay</label></div>
          <div class="row-sub">Standard Ebooks and your own files work out of the box. Project Gutenberg blocks direct downloads from web apps, so its books need a relay: a tiny, logless, open-source server you run for free on your own Cloudflare account.
            <a href="https://github.com/laroccaconsulting/Reader/blob/claude/offline-ereader-app-k5Pz3/relay/README.md" target="_blank" rel="noopener">Set one up in 5 minutes</a>.</div>
          <input type="url" id="relay-url" placeholder="https://reader-relay.yourname.workers.dev" value="${settings.relayUrl}" inputmode="url" autocomplete="off" spellcheck="false">
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn" id="relay-save">Save</button>
            <button class="btn ghost" id="relay-test" ${settings.relayUrl ? '' : 'disabled'}>Test</button>
          </div>
        </div></div>
      </div>
    </section>

    <section class="settings-group">
      <h2>Storage</h2>
      <div class="card">
        <div class="row"><div class="row-main">
          <div class="row-title">${onDevice.length} of ${books.length} books on this device</div>
          <div class="row-sub">${formatBytes(bookBytes)} of books${estimate?.usage ? ` · ${formatBytes(estimate.usage)} used in total` : ''}${estimate?.quota ? ` of ${formatBytes(estimate.quota)} available` : ''}</div>
        </div></div>
        <div class="row"><div class="row-main">
          <div class="row-title">Protect my library</div>
          <div class="row-sub">${persisted
            ? 'Your browser will keep your books even when the device is low on space.'
            : 'Ask the browser not to clear your books when the device is low on space. Installing Reader to your home screen helps too.'}</div>
        </div>${persisted ? html`<span class="muted small">On</span>` : html`<button class="btn" id="persist">Protect</button>`}</div>
        <div class="row"><div class="row-main">
          <div class="row-title">Free up space</div>
          <div class="row-sub">Remove downloaded files but keep your library, progress and bookmarks. Books re-download when you open them.</div>
        </div><button class="btn danger" id="offload-all" ${onDevice.length ? '' : 'disabled'}>Remove</button></div>
      </div>
    </section>

    <section class="settings-group">
      <h2>Backup</h2>
      <div class="card">
        <div class="row"><div class="row-main">
          <div class="row-title">Export reading data</div>
          <div class="row-sub">Progress, bookmarks, settings and your book list, as a small JSON file. Books themselves are not included.</div>
        </div><button class="btn" id="export">Export</button></div>
        <div class="row"><div class="row-main">
          <div class="row-title">Restore from backup</div>
          <div class="row-sub">Merges a previously exported file into this device.</div>
        </div><button class="btn" id="import-backup">Restore</button>
        <input type="file" id="backup-input" accept="application/json,.json" hidden></div>
        <div class="row"><div class="row-main">
          <div class="row-title">Import books</div>
          <div class="row-sub">EPUB, TXT, FB2, MOBI, AZW3 and CBZ files. You can also drag files onto the window${'launchQueue' in window ? ', or open them with Reader from your file manager' : ''}.</div>
        </div><button class="btn" id="import-books">Choose files</button></div>
      </div>
    </section>

    <section class="settings-group">
      <h2>About</h2>
      <div class="card">
        <div class="prose">
          <p><strong>Reader ${APP_VERSION}</strong> is free and open-source software. It has no ads, no accounts and no analytics, and it never will.</p>
          <p><strong>Privacy:</strong> everything (your books, progress, bookmarks and settings) stays on this device. The app only contacts the libraries you browse and download from, directly. It has no servers of its own.</p>
          <p>Books come from <a href="https://www.gutenberg.org" target="_blank" rel="noopener">Project Gutenberg</a> and <a href="https://standardebooks.org" target="_blank" rel="noopener">Standard Ebooks</a>, both volunteer-run. Consider supporting them.</p>
          <p>Rendering by <a href="https://github.com/johnfactotum/foliate-js" target="_blank" rel="noopener">foliate-js</a> (MIT). Fonts: Literata, Atkinson Hyperlegible and OpenDyslexic (SIL OFL).
            <a href="https://github.com/laroccaconsulting/Reader" target="_blank" rel="noopener">Source code</a>.</p>
        </div>
      </div>
    </section>`)

  root.onclick = async e => {
    const theme = e.target.closest("[data-theme-opt]")
    if (theme) {
      update({ theme: theme.dataset.themeOpt })
      root.querySelectorAll("[data-theme-opt]").forEach(b => b.setAttribute('aria-checked', String(b === theme)))
    }
  }

  $('#relay-save', root).addEventListener('click', () => {
    const v = $('#relay-url', root).value.trim()
    if (v && !/^https:\/\//.test(v)) { toast('The relay address must start with https://'); return }
    update({ relayUrl: v })
    $('#relay-test', root).disabled = !v
    toast(v ? 'Relay saved' : 'Relay removed')
  })
  $('#relay-test', root).addEventListener('click', async () => {
    try {
      const res = await fetch(relayed('https://www.gutenberg.org/cache/epub/84/pg84.cover.small.jpg'))
      toast(res.ok ? 'Relay works — Gutenberg downloads are enabled' : `Relay answered ${res.status}`)
    } catch (err) {
      toast(`Relay unreachable: ${err.message}`)
    }
  })
  $('#persist', root)?.addEventListener('click', async () => {
    const ok = await db.requestPersistence()
    toast(ok ? 'Library protected' : 'Your browser declined. Installing Reader to your home screen usually allows it.')
    renderSettings(root, { refreshLibrary, importFiles })
  })
  $('#offload-all', root).addEventListener('click', async () => {
    if (!confirm(`Remove ${onDevice.length} downloaded books from this device? Your library, progress and bookmarks are kept.`)) return
    for (const b of onDevice) {
      if (b.source?.type === 'local') continue // imported files can't be re-downloaded
      await library.removeBook(b.id, { keepRecord: true })
    }
    toast('Downloads removed (your own imported files were kept)')
    refreshLibrary()
    renderSettings(root, { refreshLibrary, importFiles })
  })
  $('#export', root).addEventListener('click', exportBackup)
  $('#import-backup', root).addEventListener('click', () => $('#backup-input', root).click())
  $('#backup-input', root).addEventListener('change', async e => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const n = await importBackup(JSON.parse(await file.text()))
      toast(`Restored ${n} books’ reading data`)
      refreshLibrary()
    } catch (err) {
      toast(`That file couldn’t be restored: ${err.message}`)
    }
  })
  $('#import-books', root).addEventListener('click', () => document.getElementById('file-input').click())
}

async function exportBackup() {
  const [books, progress, annotations] = await Promise.all([db.getAll('books'), db.getAll('progress'), db.getAll('annotations')])
  const data = {
    app: 'reader',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    books: books.map(({ cover, ...b }) => ({ ...b, downloaded: false })),
    progress,
    annotations,
  }
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `reader-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}

async function importBackup(data) {
  if (data?.app !== 'reader' || !Array.isArray(data.books)) throw new Error('not a Reader backup')
  let n = 0
  for (const b of data.books) {
    const existing = await db.get('books', b.id)
    if (!existing) {
      if (b.source?.type === 'local') continue // file isn't in the backup
      await db.put('books', { ...b, downloaded: false })
    }
    n++
  }
  for (const p of data.progress ?? []) {
    const cur = await db.get('progress', p.id)
    if (!cur || (p.updatedAt ?? 0) > (cur.updatedAt ?? 0)) await db.put('progress', p)
  }
  for (const a of data.annotations ?? []) await db.put('annotations', a)
  if (data.settings) {
    const { relayUrl, ...rest } = data.settings
    update({ ...rest, ...(relayUrl ? { relayUrl } : {}) })
  }
  return n
}
