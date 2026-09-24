# Privacy

Read Free has no accounts, no analytics, no ads and no trackers.

- **What's stored:** your books, reading progress, bookmarks and settings, only on your device
  (IndexedDB and localStorage in your browser). Nothing is uploaded anywhere.
- **Network requests:** the app talks directly to the library you browse or download from
  (standardebooks.org, gutenberg.org, archive.org for audiobooks). Project Gutenberg books come
  through Read Free's relay (relay.readfree.app), a tiny open-source server that only fetches from
  Gutenberg, stores nothing and keeps no logs; you can run your own instead.
  Opening the app and reading books makes no requests beyond loading the app itself.
- **Enforced, not just promised:** a Content-Security-Policy only allows scripts from the app
  itself, so third-party code (including scripts inside ebooks) cannot run. Referrers are
  never sent. The end-to-end tests check that a cold start makes zero third-party requests.
- **Backups** are files you export and keep yourself.
