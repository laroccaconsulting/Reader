/* ====================================================
   Reader — Main Application
   ==================================================== */

'use strict';

/* =====================================================
   SETTINGS
   ===================================================== */
const DEFAULTS = {
  theme: 'light',
  fontSize: 18,
  fontFamily: 'serif',
  lineHeight: 1.75,
  margin: 'medium',
};

/* =====================================================
   STATE
   ===================================================== */
const state = {
  view: 'library',           // 'library' | 'reader'
  book: null,                // current BOOKS entry
  chapters: [],              // parsed chapter objects [{title, content}]
  chapterIndex: 0,           // current chapter
  totalWords: 0,
  bookmarks: {},             // bookId -> [{chapter, label, timestamp}]
  progress: {},              // bookId -> {chapter, chapterCount, pct}
  downloaded: new Set(),     // bookIds cached in IndexedDB
  downloading: new Set(),    // bookIds being fetched right now
  dlCount: 0,                // books downloaded so far (for progress bar)
  settings: loadSettings(),
};

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('reader-settings') || '{}') };
  } catch { return { ...DEFAULTS }; }
}

function saveSettings() {
  localStorage.setItem('reader-settings', JSON.stringify(state.settings));
}

function applySettings() {
  const app = document.getElementById('app');
  app.setAttribute('data-theme', state.settings.theme);
  document.documentElement.setAttribute('data-theme', state.settings.theme);
  app.className = [
    `font-${state.settings.fontFamily}`,
    `margin-${state.settings.margin}`,
  ].join(' ');

  const inner = document.querySelector('.reader-inner');
  if (inner) {
    inner.style.fontSize = state.settings.fontSize + 'px';
    inner.style.lineHeight = state.settings.lineHeight;
  }

  // Sync theme-color meta tag
  const themeColors = { light: '#FAFAF8', sepia: '#F6F0E4', dark: '#18181B' };
  document.querySelector('meta[name="theme-color"]').content =
    themeColors[state.settings.theme] || '#FAFAF8';

  // Sync settings panel UI
  syncSettingsUI();
}

/* =====================================================
   INDEXEDDB
   ===================================================== */
let idb;

async function initDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('ReaderDB', 1);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('books'))    d.createObjectStore('books',    { keyPath: 'id' });
      if (!d.objectStoreNames.contains('progress')) d.createObjectStore('progress', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('bookmarks'))d.createObjectStore('bookmarks',{ keyPath: 'id' });
    };
    req.onsuccess = e => { idb = e.target.result; res(idb); };
    req.onerror   = () => rej(req.error);
  });
}

function dbGet(store, key) {
  if (!idb) return Promise.resolve(undefined);
  return new Promise((res, rej) => {
    const tx  = idb.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

function dbPut(store, value) {
  if (!idb) return Promise.resolve();
  return new Promise((res, rej) => {
    const tx  = idb.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

function dbGetAllKeys(store) {
  if (!idb) return Promise.resolve([]);
  return new Promise((res, rej) => {
    const tx  = idb.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAllKeys();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

function dbDelete(store, key) {
  if (!idb) return Promise.resolve();
  return new Promise((res, rej) => {
    const tx  = idb.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}

/* =====================================================
   GUTENBERG FETCHING
   ===================================================== */

// Fetch book: repo-hosted copy first (same-origin, no CORS), then Gutenberg fallbacks
async function fetchBookText(bookId) {
  const urls = [
    // Served from the repo via GitHub Pages — fastest, no CORS
    `books/${bookId}.txt`,
    // Direct Gutenberg cache CDN
    ...gutenbergUrls(bookId),
    // CORS proxy fallbacks
    `https://corsproxy.io/?${encodeURIComponent(`https://www.gutenberg.org/cache/epub/${bookId}/pg${bookId}.txt`)}`,
    `https://corsproxy.io/?${encodeURIComponent(`https://www.gutenberg.org/files/${bookId}/${bookId}-0.txt`)}`,
  ];

  for (const url of urls) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const text = await resp.text();
      if (text.length > 500) return text;
    } catch { /* try next */ }
  }
  throw new Error(`Cannot fetch book ${bookId}`);
}

async function getOrFetchBook(bookId) {
  const cached = await dbGet('books', bookId);
  if (cached) return cached.text;

  const raw  = await fetchBookText(bookId);
  const text = parseGutenbergText(raw);
  await dbPut('books', { id: bookId, text, fetched: Date.now() });
  state.downloaded.add(bookId);
  return text;
}

/* =====================================================
   TEXT PARSING
   ===================================================== */
function parseGutenbergText(raw) {
  const startRe = /\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\*{3}/i;
  const endRe   = /\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\*{3}/i;
  let text = raw;

  const sm = startRe.exec(text);
  if (sm) text = text.slice(sm.index + sm[0].length);

  const em = endRe.exec(text);
  if (em) text = text.slice(0, em.index);

  // Normalize line endings, strip excessive blank lines
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/\n{4,}/g, '\n\n\n');
  return text.trim();
}

const CHAPTER_RE = /\n\n((?:CHAPTER|PART|BOOK|SECTION|ACT|SCENE|CANTO|LETTER|PROLOGUE|EPILOGUE|PREFACE|INTRODUCTION|APPENDIX)(?:\s+(?:[IVXLCDM]+|\d+|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE|THIRTEEN|FOURTEEN|FIFTEEN|SIXTEEN|SEVENTEEN|EIGHTEEN|NINETEEN|TWENTY|[A-Z]+))?)(?:\s*[.:\-–—]\s*[^\n]*)?\n/gi;

function splitIntoChapters(text) {
  const results = [];
  let lastTitle = 'Beginning';
  let lastIndex = 0;
  let match;
  CHAPTER_RE.lastIndex = 0;

  while ((match = CHAPTER_RE.exec(text)) !== null) {
    const chunkText = text.slice(lastIndex, match.index).trim();
    if (chunkText.length > 200) {
      results.push({ title: lastTitle, content: chunkText });
    }
    lastTitle = toTitleCase(match[1].trim());
    lastIndex = match.index + match[0].length;
  }

  const final = text.slice(lastIndex).trim();
  if (final.length > 200) results.push({ title: lastTitle, content: final });

  // Fallback: split into word chunks if no chapters found
  if (results.length <= 1) return splitByWordCount(text, 3500);
  return results;
}

function splitByWordCount(text, wordsPerChunk) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    const n = Math.floor(i / wordsPerChunk) + 1;
    chunks.push({ title: `Part ${n}`, content: words.slice(i, i + wordsPerChunk).join(' ') });
  }
  return chunks.length ? chunks : [{ title: 'Text', content: text }];
}

function toTitleCase(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function readingTimeMin(words) {
  return Math.max(1, Math.round(words / 230));
}

function formatReadingTime(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/* =====================================================
   HTML RENDERING
   ===================================================== */
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Apply Gutenberg plain-text markup to a safe HTML string
function applyMarkup(text) {
  // Escape HTML first, then apply formatting
  let s = escHtml(text);
  // _italic_ → <em>italic</em>
  // \b doesn't work reliably because _ is a word char in JS regex; use lookahead instead
  s = s.replace(/_((?:[^_\n])+?)_/g, '<em>$1</em>');
  // =bold= → <strong>bold</strong>
  s = s.replace(/=([^=\n]+?)=/g, '<strong>$1</strong>');
  return s;
}

function chapterToHtml(content) {
  const blocks = content.split(/\n\n+/);
  const parts = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Section break: "* * *" or "***" on its own line
    if (/^\*[\s\*]*\*[\s\*]*\*$/.test(trimmed)) {
      parts.push('<hr>');
      continue;
    }

    // Skip [Illustration: ...] captions from Gutenberg
    if (/^\[Illustration/i.test(trimmed)) continue;

    const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    // Detect heading: 1-2 short ALL-CAPS lines, no sentence punctuation
    const isSingleLine = lines.length <= 2;
    const isShort = trimmed.length < 80;
    const isUpperish = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
    const hasSentencePunct = /[.!?]$/.test(trimmed) && trimmed.length > 30;

    if (isSingleLine && isShort && isUpperish && !hasSentencePunct) {
      parts.push(`<h3 class="chapter-sub">${applyMarkup(trimmed)}</h3>`);
      continue;
    }

    // Verse / poetry: multiple short lines
    const isVerse = lines.length > 2 && lines.every(l => l.length < 60);
    if (isVerse) {
      const joined = lines.map(l => applyMarkup(l)).join('<br>');
      parts.push(`<p class="verse">${joined}</p>`);
      continue;
    }

    // Normal paragraph
    const text = lines.join(' ');
    parts.push(`<p>${applyMarkup(text)}</p>`);
  }

  return parts.join('\n');
}

/* =====================================================
   LIBRARY VIEW
   ===================================================== */
let currentGenre = 'all';
let searchDebounce;

function renderLibrary() {
  const query  = (document.getElementById('search-input').value || '').toLowerCase().trim();
  const genre  = currentGenre;

  const filtered = BOOKS.filter(b => {
    const matchGenre  = genre === 'all' || b.genre === genre;
    const matchSearch = !query
      || b.title.toLowerCase().includes(query)
      || b.author.toLowerCase().includes(query)
      || b.genre.toLowerCase().includes(query);
    return matchGenre && matchSearch;
  });

  const grid = document.getElementById('book-grid');

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="no-results">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"/>
        </svg>
        <p>No books found for "${escHtml(query)}"</p>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map(book => buildBookCard(book)).join('');

  grid.querySelectorAll('.book-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = parseInt(card.dataset.id, 10);
      openBook(BOOKS.find(b => b.id === id));
    });
  });
}

function buildBookCard(book) {
  const { bg, text } = book.colors;
  const prog  = state.progress[book.id];
  const pct   = prog ? Math.round((prog.chapter / Math.max(prog.chapterCount - 1, 1)) * 100) : 0;
  const isNew = !prog || prog.chapter === 0;

  let statusIcon = '';
  if (state.downloading.has(book.id)) {
    statusIcon = `<div class="book-status-icon downloading" title="Downloading…">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M12 2v10m0 0l-3-3m3 3l3-3M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2"/>
      </svg></div>`;
  } else if (!state.downloaded.has(book.id)) {
    statusIcon = `<div class="book-status-icon" title="Not yet downloaded">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"/>
      </svg></div>`;
  }

  const progressHtml = pct > 0 ? `
    <div class="book-progress-track">
      <div class="book-progress-fill" style="width:${pct}%"></div>
    </div>
    <div class="book-progress-label">${pct === 100 ? 'Finished' : `${pct}% read`}</div>
  ` : '';

  return `
    <div class="book-card" data-id="${book.id}" role="button" tabindex="0"
         aria-label="${escHtml(book.title)} by ${escHtml(book.author)}">
      <div class="book-cover" style="background:${bg}">
        ${statusIcon}
        <div class="book-cover-title" style="color:${text}">${escHtml(book.title)}</div>
        <div class="book-cover-author" style="color:${text}">${escHtml(book.author)}</div>
      </div>
      <div class="book-info">
        <div class="book-meta">
          <span class="book-genre-badge">${escHtml(book.genre)}</span>
          <span class="book-year">${formatYear(book.year)}</span>
        </div>
        ${progressHtml}
      </div>
    </div>`;
}

function buildGenreFilters() {
  const genres = ['all', ...new Set(BOOKS.map(b => b.genre).sort())];
  const wrap = document.getElementById('genre-filters');
  wrap.innerHTML = genres.map(g => `
    <button class="filter-chip${g === 'all' ? ' active' : ''}" data-genre="${escHtml(g)}">
      ${g === 'all' ? 'All' : escHtml(g)}
    </button>`).join('');

  wrap.addEventListener('click', e => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    wrap.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentGenre = chip.dataset.genre;
    renderLibrary();
  });
}

/* =====================================================
   OPEN BOOK
   ===================================================== */
async function openBook(book) {
  if (!book) return;
  state.book = book;

  showLoading(`Opening "${book.title}"…`);

  try {
    const text = await getOrFetchBook(book.id);
    state.chapters = splitIntoChapters(text);
    state.totalWords = wordCount(text);

    // Restore progress
    const saved = state.progress[book.id] || await dbGet('progress', book.id);
    state.chapterIndex = saved ? Math.min(saved.chapter, state.chapters.length - 1) : 0;
    if (saved) state.progress[book.id] = saved;

    // Load bookmarks
    const bms = await dbGet('bookmarks', book.id);
    state.bookmarks[book.id] = bms ? bms.list : [];

    hideLoading();
    showReaderView();
    renderChapter(state.chapterIndex, saved?.scrollTop || 0);

  } catch (err) {
    hideLoading();
    showToast('Could not load book. Check your connection.');
    console.error(err);
  }
}

/* =====================================================
   READER VIEW
   ===================================================== */
let autoHideTimer;
let headerVisible = true;

function showReaderView() {
  const rv = document.getElementById('reader-view');
  rv.classList.remove('hidden');
  rv.classList.add('visible');
  document.getElementById('library-view').style.visibility = 'hidden';
  state.view = 'reader';

  // Update header
  document.querySelector('.reader-header .title').textContent  = state.book.title;
  document.querySelector('.reader-header .author').textContent = state.book.author;

  updateBookmarkBtn();
  startProgressTracking();
}

function closeReaderView() {
  stopProgressTracking();
  saveCurrentProgress();

  const rv = document.getElementById('reader-view');
  rv.classList.remove('visible');
  rv.classList.add('hidden');
  document.getElementById('library-view').style.visibility = 'visible';
  state.view = 'library';
  state.book = null;
  state.chapters = [];
  renderLibrary();
}

function renderChapter(index, scrollTop = 0) {
  state.chapterIndex = index;
  const chapter = state.chapters[index];
  if (!chapter) return;

  const inner = document.getElementById('reader-inner');
  inner.style.fontSize  = state.settings.fontSize + 'px';
  inner.style.lineHeight = state.settings.lineHeight;

  // Build chapter HTML
  const bodyHtml = chapterToHtml(chapter.content);

  const words = wordCount(chapter.content);
  const remainWords = state.chapters.slice(index).reduce((s, c) => s + wordCount(c.content), 0);
  const remainMin   = readingTimeMin(remainWords);

  inner.innerHTML = `
    <div class="chapter-start">
      <h2>${escHtml(chapter.title)}</h2>
      ${bodyHtml}
    </div>
    <nav class="chapter-nav" aria-label="Chapter navigation">
      <button class="chapter-nav-btn" id="prev-chapter" ${index === 0 ? 'disabled' : ''} aria-label="Previous chapter">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 18l-6-6 6-6"/>
        </svg>
        Prev
      </button>
      <div class="chapter-nav-info">
        ${index + 1} / ${state.chapters.length}<br>
        <span style="opacity:.7">~${formatReadingTime(remainMin)} left</span>
      </div>
      <button class="chapter-nav-btn" id="next-chapter" ${index === state.chapters.length - 1 ? 'disabled' : ''} aria-label="Next chapter">
        Next
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18l6-6-6-6"/>
        </svg>
      </button>
    </nav>`;

  // Navigation
  inner.querySelector('#prev-chapter')?.addEventListener('click', () => {
    if (state.chapterIndex > 0) {
      renderChapter(state.chapterIndex - 1);
      document.getElementById('reader-content').scrollTop = 0;
    }
  });
  inner.querySelector('#next-chapter')?.addEventListener('click', () => {
    if (state.chapterIndex < state.chapters.length - 1) {
      renderChapter(state.chapterIndex + 1);
      document.getElementById('reader-content').scrollTop = 0;
    }
  });

  // Restore scroll position
  const content = document.getElementById('reader-content');
  content.scrollTop = scrollTop;

  updateProgressBar();
  updateFooter(words, remainMin);
}

function updateProgressBar() {
  const pct = state.chapters.length <= 1
    ? 0
    : (state.chapterIndex / (state.chapters.length - 1)) * 100;
  document.getElementById('reader-progress-fill').style.width = pct + '%';
}

function updateFooter(chapterWords, remainMin) {
  document.getElementById('footer-chapter').textContent =
    `${state.chapterIndex + 1} of ${state.chapters.length}`;
  document.getElementById('footer-time').textContent =
    `~${formatReadingTime(remainMin)} left`;
}

/* ---- Auto-hide header/footer on scroll ---- */
function setupScrollBehavior() {
  const content = document.getElementById('reader-content');
  let lastY = 0;

  content.addEventListener('scroll', () => {
    const y = content.scrollTop;
    const dy = y - lastY;
    lastY = y;

    if (dy > 8 && y > 80) {
      hideReaderChrome();
    } else if (dy < -8) {
      showReaderChrome();
      resetAutoHide();
    }
  }, { passive: true });
}

function hideReaderChrome() {
  document.querySelector('.reader-header').classList.add('hide');
  document.querySelector('.reader-footer').classList.add('hide');
  headerVisible = false;
}

function showReaderChrome() {
  document.querySelector('.reader-header').classList.remove('hide');
  document.querySelector('.reader-footer').classList.remove('hide');
  headerVisible = true;
}

function resetAutoHide() {
  clearTimeout(autoHideTimer);
  autoHideTimer = setTimeout(hideReaderChrome, 5000);
}

/* =====================================================
   PROGRESS TRACKING
   ===================================================== */
let progressInterval;

function startProgressTracking() {
  progressInterval = setInterval(saveCurrentProgress, 4000);
}

function stopProgressTracking() {
  clearInterval(progressInterval);
}

async function saveCurrentProgress() {
  if (!state.book || !state.chapters.length) return;
  const data = {
    id:           state.book.id,
    chapter:      state.chapterIndex,
    chapterCount: state.chapters.length,
    scrollTop:    document.getElementById('reader-content').scrollTop,
    pct:          Math.round((state.chapterIndex / Math.max(state.chapters.length - 1, 1)) * 100),
    timestamp:    Date.now(),
  };
  state.progress[state.book.id] = data;
  await dbPut('progress', data);
}

/* =====================================================
   BOOKMARKS
   ===================================================== */
function updateBookmarkBtn() {
  const bms   = state.bookmarks[state.book?.id] || [];
  const btn   = document.getElementById('bookmark-btn');
  const isSet = bms.some(b => b.chapter === state.chapterIndex);
  btn.classList.toggle('active', isSet);
  btn.title = isSet ? 'Remove bookmark' : 'Add bookmark';
}

async function toggleBookmark() {
  if (!state.book) return;
  const id  = state.book.id;
  const ch  = state.chapterIndex;
  let bms   = state.bookmarks[id] || [];
  const idx = bms.findIndex(b => b.chapter === ch);

  if (idx >= 0) {
    bms.splice(idx, 1);
    showToast('Bookmark removed');
  } else {
    bms.push({
      chapter:   ch,
      label:     state.chapters[ch]?.title || `Chapter ${ch + 1}`,
      timestamp: Date.now(),
    });
    showToast('Bookmarked!');
  }

  bms.sort((a, b) => a.chapter - b.chapter);
  state.bookmarks[id] = bms;
  await dbPut('bookmarks', { id, list: bms });
  updateBookmarkBtn();
}

/* =====================================================
   TABLE OF CONTENTS PANEL
   ===================================================== */
function openTOC() {
  const list = state.chapters.map((ch, i) => `
    <li class="toc-item${i === state.chapterIndex ? ' current' : ''}" data-chapter="${i}">
      <span class="toc-num">${i + 1}</span>
      <span class="toc-title">${escHtml(ch.title)}</span>
    </li>`).join('');

  document.getElementById('toc-list').innerHTML = list;
  document.getElementById('toc-list').querySelectorAll('.toc-item').forEach(item => {
    item.addEventListener('click', () => {
      const ch = parseInt(item.dataset.chapter, 10);
      closePanel('toc-panel');
      renderChapter(ch);
      document.getElementById('reader-content').scrollTop = 0;
    });
  });
  openPanel('toc-panel');
}

/* =====================================================
   BOOKMARKS PANEL
   ===================================================== */
function openBookmarksPanel() {
  const bms = state.bookmarks[state.book?.id] || [];
  const body = document.getElementById('bookmarks-body');

  if (!bms.length) {
    body.innerHTML = `<div class="bookmark-empty">No bookmarks yet.<br>Tap the bookmark icon while reading.</div>`;
  } else {
    body.innerHTML = bms.map((bm, i) => `
      <div class="bookmark-item" data-i="${i}">
        <div style="flex:1">
          <div class="bookmark-label">${escHtml(bm.label)}</div>
          <div class="bookmark-chapter">Chapter ${bm.chapter + 1}</div>
        </div>
        <button class="bookmark-delete" data-bm="${i}" aria-label="Delete bookmark">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>`).join('');

    body.querySelectorAll('.bookmark-item').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.bookmark-delete')) return;
        const i = parseInt(el.dataset.i, 10);
        closePanel('bookmarks-panel');
        renderChapter(bms[i].chapter);
        document.getElementById('reader-content').scrollTop = 0;
      });
    });

    body.querySelectorAll('.bookmark-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const i = parseInt(btn.dataset.bm, 10);
        const id = state.book.id;
        state.bookmarks[id].splice(i, 1);
        await dbPut('bookmarks', { id, list: state.bookmarks[id] });
        updateBookmarkBtn();
        openBookmarksPanel(); // re-render
      });
    });
  }

  openPanel('bookmarks-panel');
}

/* =====================================================
   SETTINGS PANEL
   ===================================================== */
function syncSettingsUI() {
  const s = state.settings;

  document.getElementById('font-size-display').textContent = s.fontSize + 'px';

  document.querySelectorAll('.font-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.font === s.fontFamily);
  });

  document.getElementById('line-height-slider').value = s.lineHeight;

  document.querySelectorAll('.margin-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.margin === s.margin);
  });

  document.querySelectorAll('.theme-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === s.theme);
  });
}

function setupSettingsListeners() {
  // Font size
  document.getElementById('font-decrease').addEventListener('click', () => {
    state.settings.fontSize = Math.max(14, state.settings.fontSize - 1);
    applySettings(); saveSettings();
  });
  document.getElementById('font-increase').addEventListener('click', () => {
    state.settings.fontSize = Math.min(28, state.settings.fontSize + 1);
    applySettings(); saveSettings();
  });

  // Font family
  document.querySelectorAll('.font-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.fontFamily = btn.dataset.font;
      applySettings(); saveSettings();
    });
  });

  // Line height
  document.getElementById('line-height-slider').addEventListener('input', e => {
    state.settings.lineHeight = parseFloat(e.target.value);
    applySettings(); saveSettings();
  });

  // Margins
  document.querySelectorAll('.margin-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.margin = btn.dataset.margin;
      applySettings(); saveSettings();
    });
  });

  // Theme
  document.querySelectorAll('.theme-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.theme = btn.dataset.theme;
      applySettings(); saveSettings();
    });
  });
}

/* =====================================================
   PANEL MANAGEMENT
   ===================================================== */
function openPanel(id) {
  document.getElementById(id).classList.add('open');
  document.getElementById('panel-backdrop').classList.add('visible');
}

function closePanel(id) {
  document.getElementById(id).classList.remove('open');
  const anyOpen = document.querySelector('.panel.open');
  if (!anyOpen) document.getElementById('panel-backdrop').classList.remove('visible');
}

function closeAllPanels() {
  document.querySelectorAll('.panel.open').forEach(p => p.classList.remove('open'));
  document.getElementById('panel-backdrop').classList.remove('visible');
}

/* =====================================================
   LOADING OVERLAY
   ===================================================== */
function showLoading(msg) {
  document.getElementById('loading-text').textContent = msg || 'Loading…';
  document.getElementById('loading-overlay').classList.remove('fade-out');
  document.getElementById('loading-overlay').style.pointerEvents = 'all';
}

function hideLoading() {
  const el = document.getElementById('loading-overlay');
  el.classList.add('fade-out');
  setTimeout(() => { el.style.pointerEvents = 'none'; }, 400);
}

/* =====================================================
   TOAST
   ===================================================== */
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* =====================================================
   BACKGROUND DOWNLOAD
   ===================================================== */
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function backgroundDownloadAll() {
  const bar   = document.getElementById('download-bar');
  const fill  = document.getElementById('dl-fill');
  const label = document.getElementById('dl-label');

  const toFetch = BOOKS.filter(b => !state.downloaded.has(b.id));
  if (!toFetch.length) return;

  let done = 0;
  let failed = 0;
  bar.classList.add('visible');

  // Fetch 2 at a time with a pause between batches — avoids rate-limiting
  for (let i = 0; i < toFetch.length; i += 2) {
    const batch = toFetch.slice(i, i + 2);
    await Promise.allSettled(batch.map(async book => {
      state.downloading.add(book.id);
      try {
        await getOrFetchBook(book.id);
        state.downloaded.add(book.id);
      } catch {
        failed++;
      }
      state.downloading.delete(book.id);
      done++;
      const pct = Math.round((done / toFetch.length) * 100);
      fill.style.width  = pct + '%';
      label.textContent = `Downloading library… ${done} / ${toFetch.length}`;
      if (state.view === 'library') renderLibrary();
    }));

    // Brief pause between batches so Gutenberg doesn't rate-limit us
    if (i + 2 < toFetch.length) await sleep(800);
  }

  bar.classList.remove('visible');
  if (state.view === 'library') renderLibrary();

  if (failed === 0) {
    showToast('All books ready for offline reading!');
  } else if (failed < toFetch.length) {
    showToast(`${toFetch.length - failed} books downloaded. Tap ↓ to retry the rest.`);
  } else {
    showToast('Download failed — check your connection and tap ↓ to retry.');
  }
}

/* =====================================================
   KEYBOARD SHORTCUTS
   ===================================================== */
function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if (state.view !== 'reader') return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      if (state.chapterIndex < state.chapters.length - 1) {
        renderChapter(state.chapterIndex + 1);
        document.getElementById('reader-content').scrollTop = 0;
      }
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      if (state.chapterIndex > 0) {
        renderChapter(state.chapterIndex - 1);
        document.getElementById('reader-content').scrollTop = 0;
      }
    }
    if (e.key === 'Escape') {
      if (document.querySelector('.panel.open')) { closeAllPanels(); return; }
      closeReaderView();
    }
  });
}

/* =====================================================
   SWIPE GESTURE (reader)
   ===================================================== */
function setupSwipeGesture() {
  const content = document.getElementById('reader-content');
  let startX = 0, startY = 0;

  content.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  content.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0 && state.chapterIndex < state.chapters.length - 1) {
      renderChapter(state.chapterIndex + 1);
      content.scrollTop = 0;
    } else if (dx > 0 && state.chapterIndex > 0) {
      renderChapter(state.chapterIndex - 1);
      content.scrollTop = 0;
    }
  }, { passive: true });
}

/* =====================================================
   INITIALISE
   ===================================================== */
async function init() {
  // IndexedDB is unavailable in Safari Private Browsing — degrade gracefully
  try {
    await initDB();

    const cachedIds = await dbGetAllKeys('books');
    cachedIds.forEach(id => state.downloaded.add(id));

    const progressKeys = await dbGetAllKeys('progress');
    await Promise.all(progressKeys.map(async key => {
      const rec = await dbGet('progress', key);
      if (rec) state.progress[rec.id] = rec;
    }));
  } catch (e) {
    console.warn('IndexedDB unavailable, running in memory-only mode:', e);
    idb = null; // flag so downstream DB calls are skipped
  }

  // Build UI — always runs, even without DB
  buildGenreFilters();
  renderLibrary();
  applySettings();

  // Wire up library controls
  document.getElementById('search-input').addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(renderLibrary, 200);
  });

  document.getElementById('download-all-btn').addEventListener('click', () => {
    backgroundDownloadAll();
    showToast('Downloading all books in background…');
  });

  // Wire up reader controls
  document.getElementById('back-btn').addEventListener('click', closeReaderView);
  document.getElementById('bookmark-btn').addEventListener('click', toggleBookmark);
  document.getElementById('toc-btn').addEventListener('click', openTOC);
  document.getElementById('bookmarks-btn').addEventListener('click', openBookmarksPanel);
  document.getElementById('settings-btn').addEventListener('click', () => openPanel('settings-panel'));

  document.getElementById('close-settings').addEventListener('click',  () => closePanel('settings-panel'));
  document.getElementById('close-toc').addEventListener('click',       () => closePanel('toc-panel'));
  document.getElementById('close-bookmarks').addEventListener('click', () => closePanel('bookmarks-panel'));
  document.getElementById('panel-backdrop').addEventListener('click',  closeAllPanels);

  setupSettingsListeners();
  setupScrollBehavior();
  setupSwipeGesture();
  setupKeyboard();

  // RSVP
  document.getElementById('rsvp-btn').addEventListener('click', openRSVP);
  setupRSVP();

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Start background download of all books (quietly)
  backgroundDownloadAll();
}

/* =====================================================
   RSVP — Rapid Serial Visual Presentation
   ===================================================== */
const rsvp = {
  words:   [],
  index:   0,
  wpm:     250,
  playing: false,
  timer:   null,
};

// Optimal Recognition Point index for a word
function orpIndex(word) {
  const n = word.replace(/[^a-zA-Z]/g, '').length || word.length;
  if (n <= 1)  return 0;
  if (n <= 5)  return 1;
  if (n <= 9)  return 2;
  if (n <= 13) return 3;
  return 4;
}

function extractRSVPWords(content) {
  return content
    .replace(/\[Illustration[^\]]*\]/gi, '')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 0);
}

function showRSVPWord(idx) {
  const word  = rsvp.words[idx] || '';
  const pivot = orpIndex(word);

  document.getElementById('rsvp-left').textContent  = word.slice(0, pivot);
  document.getElementById('rsvp-orp').textContent   = word[pivot] || '';
  document.getElementById('rsvp-right').textContent = word.slice(pivot + 1);

  const pct = rsvp.words.length > 1
    ? Math.round((idx / (rsvp.words.length - 1)) * 100) : 100;
  document.getElementById('rsvp-progress-fill').style.width = pct + '%';
  document.getElementById('rsvp-progress-label').textContent =
    `word ${idx + 1} of ${rsvp.words.length}`;

  // Sync preset highlight
  document.querySelectorAll('.rsvp-preset').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.wpm) === rsvp.wpm);
  });
}

function rsvpDelay(word) {
  const base = 60000 / rsvp.wpm;
  if (/[.!?]$/.test(word))  return base * 2.2; // sentence end
  if (/[,;:\-—]$/.test(word)) return base * 1.4; // clause break
  if (word.length > 10)      return base * 1.2; // long word
  return base;
}

function rsvpTick() {
  if (!rsvp.playing) return;
  rsvp.index++;
  if (rsvp.index >= rsvp.words.length) {
    rsvp.index = rsvp.words.length - 1;
    rsvpPause();
    return;
  }
  showRSVPWord(rsvp.index);
  rsvp.timer = setTimeout(rsvpTick, rsvpDelay(rsvp.words[rsvp.index]));
}

function rsvpPlay() {
  if (rsvp.index >= rsvp.words.length - 1) rsvp.index = 0;
  rsvp.playing = true;
  document.querySelector('.rsvp-play-btn .icon-play').style.display  = 'none';
  document.querySelector('.rsvp-play-btn .icon-pause').style.display = '';
  rsvp.timer = setTimeout(rsvpTick, rsvpDelay(rsvp.words[rsvp.index]));
}

function rsvpPause() {
  rsvp.playing = false;
  clearTimeout(rsvp.timer);
  document.querySelector('.rsvp-play-btn .icon-play').style.display  = '';
  document.querySelector('.rsvp-play-btn .icon-pause').style.display = 'none';
}

function rsvpTogglePlay() {
  rsvp.playing ? rsvpPause() : rsvpPlay();
}

function rsvpSetWpm(wpm) {
  rsvp.wpm = Math.max(50, Math.min(1000, wpm));
  document.getElementById('rsvp-wpm-label').textContent = rsvp.wpm + ' wpm';
  document.querySelectorAll('.rsvp-preset').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.wpm) === rsvp.wpm);
  });
}

function openRSVP() {
  if (!state.chapters.length) return;
  const content = state.chapters[state.chapterIndex]?.content || '';
  rsvp.words   = extractRSVPWords(content);
  rsvp.index   = 0;
  rsvp.playing = false;
  clearTimeout(rsvp.timer);

  // Reset play button state
  document.querySelector('.rsvp-play-btn .icon-play').style.display  = '';
  document.querySelector('.rsvp-play-btn .icon-pause').style.display = 'none';

  rsvpSetWpm(rsvp.wpm);
  showRSVPWord(0);
  document.getElementById('rsvp-overlay').classList.add('open');
}

function closeRSVP() {
  rsvpPause();
  document.getElementById('rsvp-overlay').classList.remove('open');
}

function setupRSVP() {
  document.getElementById('rsvp-close').addEventListener('click', closeRSVP);

  document.getElementById('rsvp-play').addEventListener('click', rsvpTogglePlay);

  document.getElementById('rsvp-prev').addEventListener('click', () => {
    rsvpPause();
    rsvp.index = Math.max(0, rsvp.index - 1);
    showRSVPWord(rsvp.index);
  });
  document.getElementById('rsvp-next').addEventListener('click', () => {
    rsvpPause();
    rsvp.index = Math.min(rsvp.words.length - 1, rsvp.index + 1);
    showRSVPWord(rsvp.index);
  });
  document.getElementById('rsvp-skip-back').addEventListener('click', () => {
    rsvpPause();
    rsvp.index = Math.max(0, rsvp.index - 10);
    showRSVPWord(rsvp.index);
  });
  document.getElementById('rsvp-skip-fwd').addEventListener('click', () => {
    rsvpPause();
    rsvp.index = Math.min(rsvp.words.length - 1, rsvp.index + 10);
    showRSVPWord(rsvp.index);
  });

  document.getElementById('rsvp-wpm-up').addEventListener('click', () =>
    rsvpSetWpm(rsvp.wpm + 25));
  document.getElementById('rsvp-wpm-down').addEventListener('click', () =>
    rsvpSetWpm(rsvp.wpm - 25));

  document.querySelectorAll('.rsvp-preset').forEach(btn => {
    btn.addEventListener('click', () => rsvpSetWpm(parseInt(btn.dataset.wpm)));
  });

  // Spacebar toggles play/pause in RSVP
  document.addEventListener('keydown', e => {
    if (!document.getElementById('rsvp-overlay').classList.contains('open')) return;
    if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); rsvpTogglePlay(); }
    if (e.key === 'Escape') closeRSVP();
    if (e.key === 'ArrowLeft')  { rsvpPause(); rsvp.index = Math.max(0, rsvp.index - 1); showRSVPWord(rsvp.index); }
    if (e.key === 'ArrowRight') { rsvpPause(); rsvp.index = Math.min(rsvp.words.length - 1, rsvp.index + 1); showRSVPWord(rsvp.index); }
  });
}

document.addEventListener('DOMContentLoaded', init);
