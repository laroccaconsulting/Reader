/* User preferences. Kept in localStorage so the theme applies before first paint. */

export const THEMES = {
  light: { bg: '#FAFAF8', text: '#2C2820', link: '#5248A0', meta: '#FAFAF8' },
  sepia: { bg: '#F6F0E4', text: '#3B2A17', link: '#7B4E22', meta: '#F6F0E4' },
  dark:  { bg: '#18181B', text: '#E4E0D8', link: '#B4A8E0', meta: '#18181B' },
  black: { bg: '#000000', text: '#C9C5BD', link: '#A99DDB', meta: '#000000' },
}

export const FONTS = {
  publisher: { label: 'Original', stack: null },
  literata: { label: 'Literata', stack: `'Literata', Georgia, serif` },
  georgia: { label: 'Georgia', stack: `Georgia, 'Times New Roman', serif` },
  atkinson: { label: 'Hyperlegible', stack: `'Atkinson Hyperlegible', system-ui, sans-serif` },
  system: { label: 'System', stack: `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` },
  dyslexic: { label: 'OpenDyslexic', stack: `'OpenDyslexic', 'Comic Sans MS', sans-serif` },
}

export const DEFAULTS = {
  theme: 'auto',          // auto | light | sepia | dark | black
  font: 'literata',
  fontSize: 100,          // percent of the reader's default size
  lineHeight: 1.55,
  margin: 'medium',       // narrow | medium | wide
  justify: true,
  hyphenate: true,
  flow: 'paginated',      // paginated | scrolled
  columns: 'auto',        // auto (2 on wide screens) | 1
  animated: true,
  wpm: 300,
  ttsRate: 1,
  autoWpm: 230,
  autoCalibrate: true,
  voice: '',
  relayUrl: '',
  autoDownloadStarter: false,
}

const KEY = 'reader:settings:v2'
const listeners = new Set()

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } }
  catch { return { ...DEFAULTS } }
}

export const settings = load()

export function update(patch) {
  Object.assign(settings, patch)
  try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch { /* storage blocked */ }
  for (const fn of listeners) fn(settings, patch)
}

export function onChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const systemDark = () => globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches

/** The concrete theme in effect ('auto' resolved against the OS). */
export function effectiveTheme(s = settings) {
  return s.theme === 'auto' ? (systemDark() ? 'dark' : 'light') : s.theme
}

/** Apply the UI theme to the document. */
export function applyTheme() {
  const theme = effectiveTheme()
  document.documentElement.dataset.theme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = THEMES[theme].meta
}

globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if (settings.theme === 'auto') { applyTheme(); for (const fn of listeners) fn(settings, { theme: 'auto' }) }
})

const MARGINS = { narrow: 0.03, medium: 0.06, wide: 0.1 }
export const marginFraction = () => MARGINS[settings.margin] ?? MARGINS.medium

/** CSS injected into every book document. `fontCSS` is the @font-face block with absolute URLs. */
export function bookCSS(fontCSS = '') {
  const t = THEMES[effectiveTheme()]
  const font = FONTS[settings.font] ?? FONTS.literata
  const important = font.stack ? ' !important' : ''
  return `
${fontCSS}
@namespace epub "http://www.idpf.org/2007/ops";
html {
  color-scheme: ${effectiveTheme() === 'light' || effectiveTheme() === 'sepia' ? 'light' : 'dark'};
  background: ${t.bg} !important;
  color: ${t.text} !important;
  font-size: ${settings.fontSize}% !important;
  -webkit-text-size-adjust: none;
}
body { background: transparent !important; color: inherit !important; }
${font.stack ? `body, p, li, blockquote, dd, div, span, td { font-family: ${font.stack}${important}; }` : ''}
p, li, blockquote, dd {
  line-height: ${settings.lineHeight}${important};
  text-align: ${settings.justify ? 'justify' : 'start'};
  -webkit-hyphens: ${settings.hyphenate ? 'auto' : 'manual'};
  hyphens: ${settings.hyphenate ? 'auto' : 'manual'};
  -webkit-hyphenate-limit-before: 3;
  -webkit-hyphenate-limit-after: 2;
  -webkit-hyphenate-limit-lines: 2;
  hanging-punctuation: allow-end last;
  widows: 2;
  orphans: 2;
}
[align="left"] { text-align: left; }
[align="right"] { text-align: right; }
[align="center"] { text-align: center; }
h1, h2, h3, h4, h5, h6 { color: inherit !important; }
a:link, a:visited { color: ${t.link} !important; }
pre { white-space: pre-wrap !important; }
img, svg { max-width: 100%; height: auto; }
${effectiveTheme() === 'dark' || effectiveTheme() === 'black' ? 'img { filter: brightness(.85); }' : ''}
::selection { background: rgba(157, 143, 212, .35); }
aside[epub|type~="endnote"], aside[epub|type~="footnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] { display: none; }
`
}
